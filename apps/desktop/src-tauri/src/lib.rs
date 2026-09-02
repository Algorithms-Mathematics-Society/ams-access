use base64::Engine as _;
use core_rs::exam::{
    evaluate_readiness, CheckOutcome, CloseAppsResult, DeviceState, EnforcementDecision,
    KeyboardInterceptResult, NetworkCheckResult, ProcessScanResult, ReadinessReport, SessionPolicy,
    VirtDetectionResult,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

/// Pinned TLS trust anchors (PEM) for every Rust-side HTTPS call to the backend.
/// These are the Let's Encrypt roots — ISRG Root X1 and X2 — that the API
/// origin's certificate chains to. Pinning to them (built-in OS roots OFF)
/// defeats a locally-installed MITM root (mitmproxy/Burp/corporate TLS
/// inspection) while surviving routine leaf rotation, since the roots outlive
/// every leaf by a decade.
///
/// This replaced the Google Trust Services set that was pinned when the
/// backend ran on Cloud Run. That backend is gone; keeping its roots would
/// have rejected every call to the current API — a pin against a CA you no
/// longer use is not security, it is an outage.
///
/// Because pinning bypasses the OS trust store, `api.amsaccess.com` must
/// resolve straight to the origin (Cloudflare DNS-only). Putting the orange
/// cloud in front would present Cloudflare's edge certificate, which does not
/// chain to ISRG, and every request from this app would fail.
///
/// Blank this string to disable pinning in an emergency (kill-switch).
const PINNED_ROOTS_PEM: &str = include_str!("../assets/tls/isrg-roots.pem");

const MAX_FACE_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_FACE_IMAGE_PIXELS: u64 = 2_000_000;
const EXPECTED_BLAZEFACE_ASSETS: &[(&str, &str, u64)] = &[
    (
        "group1-shard1of1.bin",
        "60b481ab6c19352673cdb21e02e639f90883db1393ac52d07c7ea4e1e11cb2cd",
        401768,
    ),
    (
        "model.json",
        "7b6bb6f35e5a7899232de51dda8bf514ef9664ca7ec58388c9fecc088c883b58",
        64036,
    ),
];
// ── Violation log ─────────────────────────────────────────────────────────────

// SEC-4: every event carries a monotonic `seq` and a hash-chain link
// (`prev_hash` → `hash`). Together they make the local spool tamper-EVIDENT:
// the server (which already receives events in near-real-time and is the system
// of record) can detect suppression (a gap in `seq` that never arrives),
// reordering, or any edit (a broken chain link / mismatched `hash`). The new
// fields default on deserialize so spool files written before this change still
// load. See `next_chain_link` for the digest definition the server re-computes.
#[derive(Serialize, Deserialize, Clone)]
struct ViolationEntry {
    kind: String,
    detail: String,
    ts: u64,
    #[serde(default)]
    seq: u64,
    #[serde(default)]
    prev_hash: String,
    #[serde(default)]
    hash: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ProctoringEventEntry {
    kind: String,
    detail: String,
    ts: u64,
    payload: serde_json::Value,
    #[serde(default)]
    seq: u64,
    #[serde(default)]
    prev_hash: String,
    #[serde(default)]
    hash: String,
}

static VIOLATION_LOG: OnceLock<Mutex<Vec<ViolationEntry>>> = OnceLock::new();
static PROCTORING_LOG: OnceLock<Mutex<Vec<ProctoringEventEntry>>> = OnceLock::new();
// True while a real exam lockdown (lock_desktop) owns the keyboard intercept.
// Readiness probes consult this so they never tear down a live exam lockdown,
// and release the intercept otherwise (a probe must not leave Cmd+Tab/Cmd+Q
// blocked while the candidate is still on the home screen).
static LOCKDOWN_ENGAGED: AtomicBool = AtomicBool::new(false);

fn violation_log() -> &'static Mutex<Vec<ViolationEntry>> {
    VIOLATION_LOG.get_or_init(|| Mutex::new(Vec::new()))
}

fn proctoring_log() -> &'static Mutex<Vec<ProctoringEventEntry>> {
    PROCTORING_LOG.get_or_init(|| Mutex::new(Vec::new()))
}

fn unix_ts_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── SEC-4: tamper-evident event chain ─────────────────────────────────────────
//
// A single monotonic sequence + hash chain spans BOTH the violation and
// proctoring streams (they share one counter). The chain is anchored by a
// per-run nonce (the genesis `prev_hash`), so chains from different app runs are
// distinguishable and cannot be spliced together. The server merges both
// streams by `seq`, then verifies: `seq` is contiguous from 0 (a gap that never
// arrives = suppression), each `prev_hash` equals the previous event's `hash`
// (no reordering/insertion), and each `hash` re-computes (no edits).
//
// This is tamper-EVIDENCE, not prevention: a candidate who fully controls the
// machine can rewrite the on-disk spool, but the server already holds what it
// received, so any divergence is detectable. Unforgeable integrity additionally
// needs a server-ISSUED per-session key (HMAC) held only in memory — that is the
// backend half of this fix and is documented in fable-sec-june-12.md (SEC-4).
struct EventChainState {
    seq: u64,
    prev_hash: String,
}

static EVENT_CHAIN: OnceLock<Mutex<EventChainState>> = OnceLock::new();

/// Per-run anchor for the event chain. Unique per process run so the server can
/// tell runs apart; not secret (integrity comes from the server already holding
/// received events, not from this value being unpredictable).
fn gen_run_nonce() -> String {
    let pid = u64::from(std::process::id());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(b"ams-access-run-nonce-v1");
    hasher.update(pid.to_le_bytes());
    hasher.update(nanos.to_le_bytes());
    hex::encode(hasher.finalize())
}

fn event_chain() -> &'static Mutex<EventChainState> {
    EVENT_CHAIN.get_or_init(|| {
        Mutex::new(EventChainState {
            seq: 0,
            prev_hash: gen_run_nonce(),
        })
    })
}

/// Reserve the next `(seq, prev_hash, hash)` for an event and advance the chain.
/// `payload_digest` is a hex SHA-256 of the proctoring payload (empty for
/// violations); the server re-computes `hash` over exactly these inputs.
fn next_chain_link(
    ts: u64,
    kind: &str,
    detail: &str,
    payload_digest: &str,
) -> (u64, String, String) {
    // Poison-tolerant: a panic elsewhere must not stop the audit chain.
    let mut chain = event_chain()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let seq = chain.seq;
    let prev_hash = chain.prev_hash.clone();

    let mut hasher = Sha256::new();
    hasher.update(seq.to_le_bytes());
    hasher.update(ts.to_le_bytes());
    hasher.update(kind.as_bytes());
    hasher.update([0u8]);
    hasher.update(detail.as_bytes());
    hasher.update([0u8]);
    hasher.update(payload_digest.as_bytes());
    hasher.update([0u8]);
    hasher.update(prev_hash.as_bytes());
    let hash = hex::encode(hasher.finalize());

    chain.seq = seq.wrapping_add(1);
    chain.prev_hash = hash.clone();
    (seq, prev_hash, hash)
}

fn payload_digest(payload: &serde_json::Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(payload.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

fn violation_entry(kind: &str, detail: &str) -> ViolationEntry {
    let ts = unix_ts_ms();
    let (seq, prev_hash, hash) = next_chain_link(ts, kind, detail, "");
    ViolationEntry {
        kind: kind.to_string(),
        detail: detail.to_string(),
        ts,
        seq,
        prev_hash,
        hash,
    }
}

fn proctoring_log_dir(app: Option<&tauri::AppHandle>) -> PathBuf {
    if let Some(app) = app {
        if let Ok(dir) = app.path().app_data_dir() {
            return dir.join("proctoring");
        }
    }

    std::env::temp_dir().join("ams_access").join("proctoring")
}

fn persist_violation(app: Option<&tauri::AppHandle>, entry: &ViolationEntry) {
    persist_jsonl(app, "violations.jsonl", entry);
}

fn persist_proctoring_event(app: Option<&tauri::AppHandle>, entry: &ProctoringEventEntry) {
    persist_jsonl(app, "proctoring-events.jsonl", entry);
}

fn persist_jsonl<T: Serialize>(app: Option<&tauri::AppHandle>, filename: &str, entry: &T) {
    let dir = proctoring_log_dir(app);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(filename);
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    // SEC-4: the spool can hold sensitive proctoring detail; keep it readable
    // and writable only by the owning user (0600) so other local accounts can't
    // read it or tamper with the audit trail. Applied on the create path; an
    // existing file's mode is left as-is (idempotent re-tightening below).
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    if let Ok(mut file) = options.open(&path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = writeln!(file, "{line}");
        }
    }
}

// ── F4: pinned HTTP client ─────────────────────────────────────────────────────
//
// Single construction point for every outbound HTTPS client so the backend TLS
// trust anchors are enforced uniformly. Returns a `reqwest::ClientBuilder` —
// callers add their own timeout and `.build()`, preserving the per-site timeouts
// that already existed.
//
// MECHANISM: trust-anchor pinning. We parse the embedded Let's Encrypt roots
// (`PINNED_ROOTS_PEM`) and hand them to reqwest's `tls_certs_only`, which
// trusts ONLY those roots — the OS/built-in root store is turned OFF. Because
// the API origin's Let's Encrypt leaf chains to these long-lived ISRG roots,
// the backend continues to validate, but a locally-installed MITM root
// (mitmproxy/Burp/corporate TLS inspection) — which chains to the user's own
// root, not ISRG — is rejected. Pinning the long-lived roots (not the leaf)
// means routine 90-day renewal does not break us.
//
// KILL-SWITCH: if `PINNED_ROOTS_PEM` is blanked, we log a one-time warning and
// fall back to an un-pinned, system-root client. This is intentional and is the
// only path to an un-pinned client; when roots ARE configured we never silently
// fall back (that would be a security downgrade) — a parse failure of the
// embedded, build-time-constant bundle is an impossible-without-a-corrupted-build
// state, so we `.expect` and fail fast.
//
// SCOPE: This pins ONLY the Rust-side reqwest calls — the event-stream upload,
// the readiness-report delivery, and the clock-skew probe — all of which are
// best-effort / non-fatal telemetry or probe traffic. The exam SUBMISSION
// traffic does NOT pass through here: it is issued by the embedded webview
// (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) via JS `fetch`,
// which uses the OS trust store and is therefore NOT pinned by this function.
// Truly pinning the submission path would require routing submissions through a
// Rust `#[tauri::command]` that uses this pinned client — an architectural
// follow-up gated on the production submission API. Tracked as F4-followup.
fn pinned_http_client_builder() -> reqwest::ClientBuilder {
    use std::sync::Once;

    if PINNED_ROOTS_PEM.trim().is_empty() {
        static WARN_ONCE: Once = Once::new();
        WARN_ONCE.call_once(|| {
            eprintln!(
                "WARNING: TLS certificate pinning is DISABLED (PINNED_ROOTS_PEM is empty; \
                 kill-switch engaged); using system roots only — see remediation F4."
            );
        });
        return reqwest::Client::builder();
    }

    // The embedded bundle is build-time-constant data already verified to parse
    // and validate by the orchestrator; a failure here means a corrupted build,
    // so fail fast rather than silently downgrade to an un-pinned client.
    let certs = reqwest::Certificate::from_pem_bundle(PINNED_ROOTS_PEM.as_bytes())
        .expect("embedded ISRG roots PEM must parse");
    // Guard the fail-closed footgun: a non-blank bundle that parses to ZERO certs
    // (e.g. comments/whitespace only) would yield an empty root store that rejects
    // EVERY connection. That can only happen if the asset is gutted, so treat it
    // as a build error and fail fast rather than ship a client that can't talk to
    // the backend at all. (Real asset = 2 ISRG roots, so this never fires.)
    assert!(
        !certs.is_empty(),
        "PINNED_ROOTS_PEM is non-empty but contained no certificates — corrupted isrg-roots.pem"
    );
    reqwest::Client::builder().tls_certs_only(certs)
}

fn record_violation(app: Option<&tauri::AppHandle>, kind: &str, detail: &str) {
    let entry = violation_entry(kind, detail);
    if let Ok(mut log) = violation_log().lock() {
        log.push(entry.clone());
    }
    persist_violation(app, &entry);
}

// ── Event streaming (organizer visibility) ────────────────────────────────────
//
// The JSONL files written by persist_violation / persist_proctoring_event are
// the durable offline spool. A background task tails them from a persisted
// byte offset ("high-water mark" in sync-state.json) and uploads batches to
// `POST {api_url}/sessions/{session_id}/events` every 5 s, with exponential
// backoff on failure. Offsets only advance after a 2xx response, so nothing
// is ever lost — a crash, an offline stretch, or a webview reload just delays
// delivery. The frontend arms the stream via `configure_event_stream` once a
// session id exists; without a config the tail consumes nothing.

#[derive(Clone)]
struct EventSyncConfig {
    api_url: String,
    session_id: String,
    /// Participant bearer token. Every session endpoint requires it — this
    /// app cannot hold the platform's internal secret, because it runs on a
    /// machine the candidate controls and anything shipped inside it is
    /// theirs.
    token: String,
}

static EVENT_SYNC_CONFIG: OnceLock<Mutex<Option<EventSyncConfig>>> = OnceLock::new();

fn event_sync_config() -> &'static Mutex<Option<EventSyncConfig>> {
    EVENT_SYNC_CONFIG.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize, Deserialize, Default)]
struct EventSyncState {
    violations_offset: u64,
    proctoring_offset: u64,
}

const EVENT_SYNC_INTERVAL_SECS: u64 = 5;
const EVENT_SYNC_MAX_BACKOFF_SECS: u64 = 60;
const EVENT_SYNC_MAX_BATCH: usize = 200;

/// Arm (or disarm, with `session_id: None`) the violation/proctoring event
/// uploader. Called by the frontend as soon as a server session id exists.
#[tauri::command]
fn configure_event_stream(api_url: String, session_id: Option<String>, token: Option<String>) {
    if let Ok(mut config) = event_sync_config().lock() {
        let token = token.unwrap_or_default();
        *config = match session_id {
            // Without a token the uploads would 401 for ever and the spool
            // would grow unbounded, so an unarmed stream is the honest state.
            Some(session_id)
                if !session_id.trim().is_empty()
                    && !api_url.trim().is_empty()
                    && !token.trim().is_empty() =>
            {
                Some(EventSyncConfig {
                    api_url: api_url.trim().trim_end_matches('/').to_string(),
                    session_id: session_id.trim().to_string(),
                    token: token.trim().to_string(),
                })
            }
            _ => None,
        };
    }
}

/// Read complete JSONL lines from `path` starting at `*offset`, append them to
/// `out` tagged with `stream`, and advance `*offset` past every consumed line.
///
/// - A trailing line without '\n' is a write in progress — left for next time.
/// - Unparseable lines are consumed but skipped, so a corrupt line can never
///   stall the stream (no poison pill).
/// - `*offset` beyond the file length means the file was replaced — restart
///   from the beginning.
fn read_new_jsonl_events(
    path: &Path,
    offset: &mut u64,
    stream: &str,
    out: &mut Vec<serde_json::Value>,
) {
    use std::io::{Read, Seek, SeekFrom};

    let Ok(mut file) = std::fs::File::open(path) else {
        return;
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if *offset > len {
        *offset = 0;
    }
    if *offset == len || file.seek(SeekFrom::Start(*offset)).is_err() {
        return;
    }
    let mut buf = String::new();
    if file.read_to_string(&mut buf).is_err() {
        return;
    }

    let mut consumed = 0usize;
    for line in buf.split_inclusive('\n') {
        if !line.ends_with('\n') || out.len() >= EVENT_SYNC_MAX_BATCH {
            break;
        }
        consumed += line.len();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(object) = value.as_object_mut() {
                object.insert("stream".to_string(), serde_json::json!(stream));
            }
            out.push(value);
        }
    }
    *offset += consumed as u64;
}

/// Background uploader: tails the JSONL spool and ships batches to the
/// backend. Runs for the lifetime of the process; idles cheaply when no
/// session is configured or nothing is pending.
fn spawn_event_sync_task(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Ok(client) = pinned_http_client_builder()
            .timeout(Duration::from_secs(10))
            .build()
        else {
            return;
        };
        let mut delay = EVENT_SYNC_INTERVAL_SECS;
        loop {
            tokio::time::sleep(Duration::from_secs(delay)).await;

            let Some(config) = event_sync_config().lock().ok().and_then(|c| c.clone()) else {
                delay = EVENT_SYNC_INTERVAL_SECS;
                continue;
            };

            let dir = proctoring_log_dir(Some(&app));
            let state_path = dir.join("sync-state.json");
            let mut state: EventSyncState = std::fs::read_to_string(&state_path)
                .ok()
                .and_then(|raw| serde_json::from_str(&raw).ok())
                .unwrap_or_default();

            let mut events = Vec::new();
            let mut violations_offset = state.violations_offset;
            let mut proctoring_offset = state.proctoring_offset;
            read_new_jsonl_events(
                &dir.join("violations.jsonl"),
                &mut violations_offset,
                "violation",
                &mut events,
            );
            read_new_jsonl_events(
                &dir.join("proctoring-events.jsonl"),
                &mut proctoring_offset,
                "proctoring",
                &mut events,
            );

            if events.is_empty() {
                delay = EVENT_SYNC_INTERVAL_SECS;
                continue;
            }

            let url = format!("{}/sessions/{}/events", config.api_url, config.session_id);
            let delivered = client
                .post(&url)
                .bearer_auth(&config.token)
                .json(&serde_json::json!({ "events": events }))
                .send()
                .await
                .map(|response| response.status().is_success())
                .unwrap_or(false);

            if delivered {
                state.violations_offset = violations_offset;
                state.proctoring_offset = proctoring_offset;
                if let Ok(raw) = serde_json::to_string(&state) {
                    let _ = std::fs::write(&state_path, raw);
                }
                delay = EVENT_SYNC_INTERVAL_SECS;
            } else {
                // Offsets NOT persisted — the same batch retries after backoff.
                delay = (delay * 2).min(EVENT_SYNC_MAX_BACKOFF_SECS);
            }
        }
    });
}

fn record_proctoring_event(
    app: Option<&tauri::AppHandle>,
    kind: &str,
    detail: &str,
    payload: serde_json::Value,
) {
    let ts = unix_ts_ms();
    let digest = payload_digest(&payload);
    let (seq, prev_hash, hash) = next_chain_link(ts, kind, detail, &digest);
    let entry = ProctoringEventEntry {
        kind: kind.to_string(),
        detail: detail.to_string(),
        ts,
        payload,
        seq,
        prev_hash,
        hash,
    };
    if let Ok(mut log) = proctoring_log().lock() {
        log.push(entry.clone());
    }
    persist_proctoring_event(app, &entry);
}

#[cfg(target_os = "windows")]
fn severity_str(s: platform_rs::kiosk::Severity) -> &'static str {
    use platform_rs::kiosk::Severity::{High, Info, Low, Medium};
    match s {
        Info => "info",
        Low => "low",
        Medium => "medium",
        High => "high",
    }
}

#[cfg(target_os = "windows")]
fn execute_kiosk_action(
    app: &tauri::AppHandle,
    exam_hwnd: isize,
    action: platform_rs::kiosk::Action,
) {
    use platform_rs::kiosk::Action;
    use tauri::{Emitter, Manager};
    match action {
        Action::ReassertFullscreen => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_fullscreen(true);
            }
        }
        Action::ReassertAlwaysOnTop => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(true);
            }
        }
        Action::NudgeForeground => platform_rs::windows::set_exam_foreground(exam_hwnd),
        Action::Report {
            event,
            severity,
            detail,
        } => {
            record_violation(Some(app), event, &detail);
            record_proctoring_event(
                Some(app),
                event,
                &detail,
                serde_json::json!({ "severity": severity_str(severity), "source": "kiosk" }),
            );
            let _ = app.emit(
                "lockdown-event",
                serde_json::json!({ "kind": event, "detail": detail }),
            );
        }
        Action::ResumeBannerAndReport {
            ever_locked,
            duration_ms,
        } => {
            let detail = format!("away {}s", duration_ms / 1000);
            record_violation(Some(app), "focus_resumed", &detail);
            record_proctoring_event(
                Some(app),
                "focus_resumed",
                &detail,
                serde_json::json!({
                    "severity": "info",
                    "duration_ms": duration_ms,
                    "ever_locked": ever_locked,
                    "source": "kiosk"
                }),
            );
            let _ = app.emit(
                "lockdown-event",
                serde_json::json!({
                    "kind": "focus_resumed",
                    "detail": detail,
                    "duration_ms": duration_ms,
                    "ever_locked": ever_locked,
                }),
            );
        }
    }
}

/// Whether this build asks for elevation, decided at compile time by
/// `AMS_FIREWALL=1` in build.rs.
///
/// False by default. The only thing on Windows that needs elevation is
/// `netsh advfirewall`; everything else in the proctoring surface runs as a
/// normal user, and `requireAdministrator` costs a UAC prompt on *every*
/// launch rather than one at install. Builds that do not want the firewall
/// must therefore not try to elevate and must not call netsh — otherwise they
/// raise the prompt this exists to remove, and then get refused anyway.
//
// Compared as bytes rather than with `matches!(.., Some("1"))`: matching on
// `str` in a constant is still unstable, and this has to be a `const` so the
// dead branch is removed at compile time rather than evaluated per call.
#[cfg(target_os = "windows")]
const WANTS_FIREWALL: bool = match option_env!("AMS_FIREWALL_BUILD") {
    Some(value) => {
        let bytes = value.as_bytes();
        bytes.len() == 1 && bytes[0] == b'1'
    }
    None => false,
};

fn collect_fast_device_state() -> DeviceState {
    // Three states, not two. A Store build is unelevated *by construction* and
    // no amount of clicking will change that, whereas `windows_no_admin` is a
    // machine where elevation was possible and did not happen — one is a known
    // property of the build, the other is a candidate an invigilator may be
    // able to help. Collapsing them would make the console unable to tell a
    // deliberately reduced client from a failed setup.
    // What an invigilator needs to tell apart, in the order it matters:
    //
    //   windows_msix     a Store build. Can never elevate, so never a firewall.
    //   windows          elevated: a firewall build, running as intended.
    //   windows_no_admin a firewall build that did NOT get elevation. This is
    //                    the only one that is a *problem* — the candidate was
    //                    meant to have a firewall and does not.
    //
    // A default (no-firewall) build reports `windows_no_firewall` rather than
    // `windows_no_admin`. They are both unelevated, but conflating them would
    // put every ordinary contestant on the invigilator's screen wearing the
    // label that used to mean "this one needs help", and the label would stop
    // meaning anything within one contest.
    #[cfg(target_os = "windows")]
    let platform = Some(if platform_rs::windows::is_packaged() {
        "windows_msix".to_string()
    } else if platform_rs::windows::is_elevated() {
        "windows".to_string()
    } else if WANTS_FIREWALL {
        "windows_no_admin".to_string()
    } else {
        "windows_no_firewall".to_string()
    });
    #[cfg(not(target_os = "windows"))]
    let platform = Some(std::env::consts::OS.to_string());

    let restricted_processes = Some(scan_processes());
    let virtualization = Some(detect_virtualization());

    // Windows-only native probes for the readiness policy: extra/wireless displays
    // and an active inbound RDP listener. Left None on every other platform so the
    // policy stays inert there (matches core-rs DisplayScan/rdp_server semantics).
    #[cfg(target_os = "windows")]
    let external_displays = Some(platform_rs::windows::detect_external_displays());
    #[cfg(not(target_os = "windows"))]
    let external_displays = None;
    #[cfg(target_os = "windows")]
    let rdp_server = Some(platform_rs::windows::detect_rdp_server());
    #[cfg(not(target_os = "windows"))]
    let rdp_server = None;

    DeviceState {
        platform,
        camera_available: None,
        microphone_available: None,
        network: None,
        keyboard: None,
        restricted_processes,
        virtualization,
        external_displays,
        rdp_server,
        // Populated for real in collect_device_state_inner (Linux only); the fast
        // path leaves it unknown so it never blocks on its own.
        network_helper_ready: None,
    }
}

async fn collect_device_state_inner(
    network_host: Option<String>,
    api_url: Option<String>,
    camera_available: Option<bool>,
    microphone_available: Option<bool>,
    activate_keyboard: bool,
) -> DeviceState {
    let mut state = collect_fast_device_state();
    state.camera_available = camera_available;
    state.microphone_available = microphone_available;
    state.keyboard = if activate_keyboard {
        // Transactional probe: prove the intercept can engage, then release it
        // immediately — unless an exam lockdown currently owns it (rescans
        // during a locked session must not tear the lockdown down).
        let result = enable_keyboard_intercept();
        if !LOCKDOWN_ENGAGED.load(Ordering::SeqCst) {
            disable_keyboard_intercept();
        }
        Some(result)
    } else {
        None
    };

    if let Some(host) = network_host.filter(|host| !host.trim().is_empty()) {
        state.network = Some(check_network_stability_with_fallback(host, api_url).await);
    }

    // Linux egress lockdown runs through the privileged helper; surface whether
    // it is installed/reachable so the readiness policy can hard-block a strict
    // contest that would otherwise run with unrestricted egress (core-rs
    // CheckKind::Network gate). Other platforms leave this None (inert).
    #[cfg(target_os = "linux")]
    {
        match platform_rs::linux::network_helper_status() {
            Ok(()) => state.network_helper_ready = Some(true),
            Err(reason) => {
                // Log the precise reason (socket down, auth rejected, etc.) — without
                // this the readiness gate only ever shows a bool, which hid a daemon
                // capability bug behind a generic "not running" for a long time.
                eprintln!("[ams][network-helper] readiness ping failed: {reason}");
                state.network_helper_ready = Some(false);
            }
        }
    }

    state
}

/// Dispatch `platform_rs::<os>::$func(args…)` for the compiled target OS,
/// with `$fallback` as the expression for unsupported platforms. Exactly one
/// branch survives cfg-stripping, so the macro is usable in expression
/// position and replaces the hand-rolled `#[cfg(target_os = …)]` ladders that
/// every cross-platform command used to repeat.
macro_rules! platform_dispatch {
    ($func:ident ( $($arg:expr),* $(,)? ), else $fallback:expr) => {{
        #[cfg(target_os = "linux")]
        {
            platform_rs::linux::$func($($arg),*)
        }
        #[cfg(target_os = "windows")]
        {
            platform_rs::windows::$func($($arg),*)
        }
        #[cfg(target_os = "macos")]
        {
            platform_rs::macos::$func($($arg),*)
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            $fallback
        }
    }};
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Collect native and browser-supplied readiness facts without deciding policy in React.
#[tauri::command]
async fn collect_device_state(
    network_host: Option<String>,
    api_url: Option<String>,
    camera_available: Option<bool>,
    microphone_available: Option<bool>,
    activate_keyboard: Option<bool>,
) -> DeviceState {
    collect_device_state_inner(
        network_host,
        api_url,
        camera_available,
        microphone_available,
        activate_keyboard.unwrap_or(false),
    )
    .await
}

/// Evaluate a session policy against a device-state snapshot.
#[tauri::command]
fn evaluate_session_readiness(
    policy: Option<SessionPolicy>,
    contest_id: Option<String>,
    device_id: Option<String>,
    device_state: DeviceState,
) -> ReadinessReport {
    let policy = policy.unwrap_or_default();
    evaluate_readiness(&policy, contest_id, device_id, &device_state)
}

/// Final native gate before entering the contest surface.
#[tauri::command]
async fn start_secure_session(
    app: tauri::AppHandle,
    policy: Option<SessionPolicy>,
    contest_id: Option<String>,
    device_id: Option<String>,
    device_state: DeviceState,
    api_url: Option<String>,
    token: Option<String>,
) -> Result<ReadinessReport, String> {
    let policy = policy.unwrap_or_default();
    let report = evaluate_readiness(&policy, contest_id, device_id, &device_state);

    // Delivered before the block check, not after. A blocked report is the
    // one an invigilator actually needs — it is what they read off the
    // console to decide whether to waive a check. Returning early first
    // meant the only reports the platform ever saw were the ones where
    // nothing had gone wrong.
    deliver_readiness_report(&app, &report, api_url, token).await;

    if report.decision == EnforcementDecision::Blocked {
        return Err(
            serde_json::to_string(&report).unwrap_or_else(|_| "readiness blocked".to_string())
        );
    }
    let _ = lock_desktop(app).await;
    Ok(report)
}

/// Short-term readiness attestation: deliver the full evaluated report to the
/// backend so the server has a durable record of what this device claimed at
/// the entry gate (`POST /contests/:id/readiness-reports`). The server — not
/// this client — decides whether to gate session activation on it, so
/// delivery is best-effort here: a failure is logged as a proctoring event
/// (and will reach the organizer via the event stream) but never blocks entry
/// client-side. Long-term this becomes a device-key-signed report; see
/// BACKLOG.md.
async fn deliver_readiness_report(
    app: &tauri::AppHandle,
    report: &ReadinessReport,
    api_url: Option<String>,
    token: Option<String>,
) {
    let Some(api) = api_url
        .as_deref()
        .map(|u| u.trim().trim_end_matches('/'))
        .filter(|u| !u.is_empty())
    else {
        return;
    };
    let Some(contest_id) = report.contest_id.as_deref() else {
        return;
    };
    // The endpoint is authenticated, so without a token there is nothing to
    // deliver. Reporting it as a failure would be misleading — nobody tried.
    let Some(token) = token.as_deref().map(str::trim).filter(|t| !t.is_empty()) else {
        return;
    };

    // Under `/participant`: the staff routers own `/contests/{uid}`, and the
    // two paths collided.
    let url = format!("{api}/participant/contests/{contest_id}/readiness-reports");

    // The checks the client itself judged failing. This is what an
    // invigilator reads off the console before granting a waiver, so it has
    // to name the check rather than just say "not ready".
    //
    // The kind is serialised rather than formatted: `CheckKind` is
    // `rename_all = "snake_case"`, so serde produces exactly the identifier
    // the server stores and the override client matches on. `Debug` would
    // give `Virtualization` where every other layer says `virtualization`.
    let failed_checks: Vec<serde_json::Value> = report
        .checks
        .iter()
        .filter(|check| matches!(check.outcome, CheckOutcome::Fail))
        .filter_map(|check| serde_json::to_value(&check.kind).ok())
        .collect();

    // Checks this platform cannot run at all — reported separately because
    // they are neither passes nor failures. Without this the tri-state exists
    // in the client and dies here: the invigilation screen would show a Linux
    // machine as clean, which is exactly the fiction the tri-state removed.
    let unsupported_checks: Vec<serde_json::Value> = report
        .checks
        .iter()
        .filter(|check| matches!(check.outcome, CheckOutcome::Unknown))
        .filter_map(|check| serde_json::to_value(&check.kind).ok())
        .collect();

    let delivered = match pinned_http_client_builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(client) => client
            .post(&url)
            .bearer_auth(token)
            .json(&serde_json::json!({
                "contest_uid": contest_id,
                "device_fingerprint": report.device_id,
                // Blocked is the only decision that is not "ready".
                // AllowedWithWarnings still let the candidate in, and
                // recording it as a failure would misrepresent the gate.
                "passed": !matches!(report.decision, EnforcementDecision::Blocked),
                "failed_checks": failed_checks,
                "unsupported_checks": unsupported_checks,
                // The schema has always accepted these and the client has
                // never sent them, so every stored report reads "" for the
                // two fields that say which build on which OS produced it.
                "os_name": std::env::consts::OS,
                "app_version": app.package_info().version.to_string(),
                "report": report,
            }))
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    };

    record_proctoring_event(
        Some(app),
        if delivered {
            "readiness_report_delivered"
        } else {
            "readiness_report_delivery_failed"
        },
        &format!("entry-gate readiness report → {url}"),
        serde_json::json!({
            "decision": report.decision,
            "delivered": delivered,
        }),
    );
}

/// Scan running processes for known restricted applications.
#[tauri::command]
fn scan_processes() -> ProcessScanResult {
    platform_dispatch!(scan_processes(), else ProcessScanResult {
        found: vec![],
        clean: true,
    })
}

/// Close each restricted app by name. The `apps` list comes from the
/// frontend and is validated server-side against the platform's RESTRICTED
/// list before any kill is issued. Names not on the list are silently ignored.
#[tauri::command]
fn close_restricted_apps(apps: Vec<String>) -> CloseAppsResult {
    if apps.is_empty() {
        return CloseAppsResult {
            closed: vec![],
            failed: vec![],
        };
    }

    // Security: only kill names that appear in the platform's RESTRICTED list.
    // The Tauri IPC boundary is not a trust boundary — validate on the backend.
    let safe: Vec<String> = apps
        .into_iter()
        .filter(|n| platform_dispatch!(is_restricted_name(n), else false))
        .collect();

    if safe.is_empty() {
        return CloseAppsResult {
            closed: vec![],
            failed: vec![],
        };
    }

    platform_dispatch!(close_apps(&safe), else CloseAppsResult {
        closed: vec![],
        failed: safe,
    })
}

/// Detect virtualisation / VM environment.
#[tauri::command]
fn detect_virtualization() -> VirtDetectionResult {
    platform_dispatch!(detect_virtualization(), else VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "unknown".to_string(),
    })
}

/// Install platform-level keyboard intercept.
#[tauri::command]
fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    platform_dispatch!(enable_keyboard_intercept(), else KeyboardInterceptResult {
        active: false,
        method: "none".to_string(),
        platform: "unknown".to_string(),
    })
}

/// Release keyboard intercept (called on exit / crash recovery).
#[tauri::command]
fn disable_keyboard_intercept() {
    platform_dispatch!(disable_keyboard_intercept(), else ())
}

/// Check whether Accessibility permission is granted (macOS only).
///
/// CGEventTap requires this permission. Returns true on non-macOS platforms.
#[tauri::command]
fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::check_accessibility_permission();
    #[cfg(not(target_os = "macos"))]
    true
}

/// Check whether an active screen-sharing / remote desktop session is present.
#[tauri::command]
fn check_screen_sharing() -> bool {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::detect_remote_desktop();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::detect_remote_desktop();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    false
}

/// Detect whether any active screen capture process or mechanism is present (Windows only).
#[tauri::command]
fn detect_screen_capture_active() -> bool {
    #[cfg(target_os = "windows")]
    return platform_rs::windows::detect_screen_capture();
    #[cfg(not(target_os = "windows"))]
    false
}

/// Apply DWM capture exclusion so the exam window appears black to all capture APIs.
/// On Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// On macOS: handled at the CGEventTap / window layer (no-op here).
#[tauri::command]
fn apply_capture_protection(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        if let Some(win) = app.get_webview_window("main") {
            if let Ok(hwnd) = win.hwnd() {
                return platform_rs::windows::apply_capture_protection(hwnd.0 as isize);
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        true
    }
}

/// Set whether the Escape key is passed through to the editor (false) or blocked (true).
/// Call with blocked=false when the Monaco editor gains focus, true on blur.
#[tauri::command]
fn set_escape_blocked(blocked: bool) {
    #[cfg(target_os = "windows")]
    platform_rs::windows::set_escape_blocked(blocked);
    #[cfg(target_os = "macos")]
    platform_rs::macos::set_escape_blocked(blocked);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = blocked;
}

/// Check whether the privileged network helper daemon is reachable.
///
/// macOS: LaunchDaemon over /private/var/run/ams-proctor.sock.
/// Linux: systemd unit over /run/ams-proctor.sock.
/// Other platforms have no helper and report `true` (lockdown is enforced
/// in-process there, e.g. Windows WFP).
#[tauri::command]
fn network_helper_running() -> bool {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::network_helper_running();
    #[cfg(target_os = "linux")]
    return platform_rs::linux::network_helper_running();
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    true
}

/// Install the network helper daemon and request admin credentials via the
/// standard macOS auth dialog. Resource paths are resolved inside Rust so the
/// renderer cannot choose an arbitrary root-installed binary.
#[tauri::command]
fn install_network_helper(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
    #[cfg(target_os = "linux")]
    {
        // Resolve the bundled helper binary + systemd unit from the Tauri
        // resource dir so the renderer cannot point us at an arbitrary
        // root-installed binary. Install elevates via pkexec (one polkit prompt).
        let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        let helper_binary = resource_dir
            .join("helpers")
            .join("ams-access-networkhelper");
        let unit_source = resource_dir
            .join("helpers")
            .join("ams-proctor-helper.service");
        // The app's own absolute path is pinned into the helper's root-owned
        // client config so the daemon can full-path-authorize the peer.
        let client_binary = std::env::current_exe().map_err(|e| e.to_string())?;

        if !helper_binary.exists() {
            return Err(format!(
                "helper_binary_missing:{}",
                helper_binary.to_string_lossy()
            ));
        }
        if !unit_source.exists() {
            return Err(format!(
                "helper_unit_missing:{}",
                unit_source.to_string_lossy()
            ));
        }

        #[allow(clippy::needless_return)]
        return platform_rs::linux::install_network_helper(
            &helper_binary.to_string_lossy(),
            &unit_source.to_string_lossy(),
            &client_binary.to_string_lossy(),
        );
    }
    #[cfg(target_os = "macos")]
    {
        let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
        let helper_binary = resource_dir
            .join("helpers")
            .join("com.ams.access.networkhelper");
        let plist_source = resource_dir
            .join("helpers")
            .join("com.ams.access.networkhelper.plist");
        let client_binary = std::env::current_exe().map_err(|e| e.to_string())?;

        if !helper_binary.exists() {
            return Err(format!(
                "helper_binary_missing:{}",
                helper_binary.to_string_lossy()
            ));
        }
        if !plist_source.exists() {
            return Err(format!(
                "helper_plist_missing:{}",
                plist_source.to_string_lossy()
            ));
        }

        platform_rs::macos::install_network_helper(
            &helper_binary.to_string_lossy(),
            &plist_source.to_string_lossy(),
            &client_binary.to_string_lossy(),
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Ok(())
}

/// Return the list of apps that TCC has granted `kTCCServiceScreenCapture` on macOS.
///
/// The frontend cross-references this with RESTRICTED + the live process scan.
/// An empty vec on non-macOS is not a signal — only macOS uses TCC.
#[tauri::command]
fn get_screen_capture_permitted_apps() -> Vec<String> {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::apps_with_screen_capture_permission();
    #[cfg(not(target_os = "macos"))]
    vec![]
}

/// Check whether any process currently holds an active screen-capture session (macOS only).
#[tauri::command]
fn detect_active_screen_share() -> bool {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::detect_active_screen_share();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Open System Settings → Privacy & Security → Accessibility so the candidate can
/// grant the permission without navigating there manually.
#[tauri::command]
fn open_accessibility_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}

/// True when the process runs with the privileges full lockdown needs
/// (UAC-elevated on Windows; other platforms have no equivalent gate here).
#[tauri::command]
fn is_process_elevated() -> bool {
    process_elevated()
}

fn process_elevated() -> bool {
    #[cfg(target_os = "windows")]
    return platform_rs::windows::is_elevated();
    #[cfg(not(target_os = "windows"))]
    true
}

/// Relaunch the app elevated via the standard one-click UAC consent prompt
/// (Windows only). On success the unelevated instance exits and the elevated
/// one takes over — the candidate never touches the OS manually.
/// Errors with "uac_declined" if the candidate dismisses the prompt.
#[tauri::command]
fn relaunch_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        platform_rs::windows::relaunch_as_admin()?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("not_supported_on_this_platform".to_string())
    }
}

/// Deep-link into the OS privacy settings page for `section` ("camera" or
/// "microphone"). Windows opens the matching ms-settings page; other
/// platforms are a no-op (macOS camera/mic prompts are handled natively).
#[tauri::command]
fn open_privacy_settings(section: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return platform_rs::windows::open_privacy_settings(&section);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = section;
        Ok(())
    }
}

/// Measure network reachability and latency using a multi-probe strategy
/// that is resilient to Linux iptables rules and restrictive firewall policies.
///
/// Strategy (in priority order):
///   1. Localhost / loopback hosts get a synthetic "excellent" result immediately —
///      no real probe needed and avoids false negatives in dev environments.
///   2. DNS resolution timing gives an instant low-overhead latency signal.
///   3. TCP connect is attempted on ports 443 → 80 → 53 with a 1500ms timeout.
///      Using multiple ports avoids iptables-DROP hangs that occur when a single
///      port is firewalled and the kernel never sends RST/ICMP.
///   4. If all TCP probes fail but DNS succeeded, the host is considered reachable
///      with the DNS latency as the reported value.
#[tauri::command]
async fn check_network_stability(host: String, api_url: Option<String>) -> NetworkCheckResult {
    let host = host.trim().to_string();

    // ── 1. Localhost shortcut ──────────────────────────────────────────────────
    let is_loopback =
        host == "localhost" || host.starts_with("127.") || host == "::1" || host.is_empty();

    if is_loopback {
        return NetworkCheckResult {
            reachable: true,
            latency_ms: Some(1),
            jitter_ms: Some(0),
            quality: "excellent".to_string(),
            // Same machine as the dev API — the clock cannot disagree with itself.
            clock_skew_ms: Some(0),
        };
    }

    // ── 2. DNS resolution latency ─────────────────────────────────────────────
    let dns_addr = format!("{}:443", host);
    let dns_start = Instant::now();
    let dns_resolved = tokio::time::timeout(
        Duration::from_millis(2000),
        tokio::task::spawn_blocking({
            let a = dns_addr.clone();
            move || a.to_socket_addrs().map(|mut it| it.next())
        }),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .and_then(|r| r.ok())
    .flatten();

    let dns_latency_ms = dns_start.elapsed().as_millis() as u64;

    // ── 3. TCP probes on multiple ports ───────────────────────────────────────
    // Try ports in order; return on the first success. This avoids iptables-DROP
    // hangs on Linux where a blocked port causes connect() to hang for the full
    // timeout rather than immediately failing.
    let probe_ports: &[u16] = &[443, 80, 53];
    let mut tcp_latency: Option<u64> = None;

    'outer: for &port in probe_ports {
        let sample_addr = format!("{}:{}", host, port);
        // Take 2 samples per port and use the minimum
        for _ in 0..2u32 {
            let addr = sample_addr.clone();
            let start = Instant::now();
            let connected = tokio::time::timeout(
                Duration::from_millis(1500),
                tokio::net::TcpStream::connect(&addr),
            )
            .await
            .ok()
            .and_then(Result::ok)
            .is_some();

            if connected {
                tcp_latency = Some(start.elapsed().as_millis() as u64);
                break 'outer;
            }
        }
    }

    // ── 4. Decide reachability and quality ────────────────────────────────────
    let (reachable, latency_ms) = match (tcp_latency, dns_resolved) {
        (Some(tcp), _) => (true, tcp),
        (None, Some(_)) => (true, dns_latency_ms), // DNS worked but TCP blocked
        (None, None) => {
            return NetworkCheckResult {
                reachable: false,
                latency_ms: None,
                jitter_ms: None,
                quality: "unreachable".to_string(),
                clock_skew_ms: None,
            };
        }
    };

    // The previous cutoff marked anything above 500ms as "poor", which caused
    // normal-but-slow home networks to fail readiness too aggressively inside
    // Proctor. Widen the acceptable band so only very sluggish links are
    // flagged as poor.
    let quality = match latency_ms {
        0..=80 => "excellent",
        81..=200 => "good",
        201..=1000 => "fair",
        _ => "poor",
    };

    // ── 5. Clock-integrity signal ──────────────────────────────────────────────
    // The device clock drives report and submission timestamps; compare it to
    // the contest server via the HTTP Date header. Only attempted when the
    // caller supplied the API base URL, and never fails the probe by itself —
    // core-rs decides whether the measured skew blocks readiness.
    let clock_skew_ms = match api_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(api) => measure_clock_skew(api).await,
        None => None,
    };

    NetworkCheckResult {
        reachable,
        latency_ms: Some(latency_ms),
        jitter_ms: Some(0),
        quality: quality.to_string(),
        clock_skew_ms,
    }
}

async fn check_network_stability_with_fallback(
    host: String,
    api_url: Option<String>,
) -> NetworkCheckResult {
    let primary = check_network_stability(host, api_url.clone()).await;
    if primary.reachable {
        return primary;
    }

    // If the AMS API host is unavailable, verify that the client can still
    // reach the public internet before reporting a hard network failure.
    let fallback = check_network_stability("www.google.com".to_string(), None).await;
    if fallback.reachable {
        return fallback;
    }

    primary
}

/// Measure device-clock skew (server − local, ms) from the HTTP `Date` header
/// of any response from the contest API — every response carries one per
/// RFC 9110, regardless of status code. Granularity is one second plus up to
/// one RTT of error, which is far finer than the 120 s readiness bound.
/// Returns `None` when no trustworthy signal could be obtained.
async fn measure_clock_skew(api_url: &str) -> Option<i64> {
    let client = pinned_http_client_builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let response = client.get(api_url).send().await.ok()?;
    let date = response
        .headers()
        .get(reqwest::header::DATE)?
        .to_str()
        .ok()?;
    let server = httpdate::parse_http_date(date).ok()?;
    let server_ms = server
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    let local_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some(server_ms - local_ms)
}

/// Current OS identifier.
#[tauri::command]
fn get_platform() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "elevated": process_elevated(),
    })
}

#[derive(Serialize, Deserialize)]
pub struct SecurityEnvironment {
    pub os: String,
    pub display_server: String,
    pub ld_preload_injection: bool,
    pub ptrace_scope: u8,
}

/// Collect security-relevant environment metadata.
#[tauri::command]
fn get_security_environment() -> SecurityEnvironment {
    #[cfg(target_os = "linux")]
    return SecurityEnvironment {
        os: "linux".to_string(),
        display_server: platform_rs::linux::detect_display_server(),
        ld_preload_injection: platform_rs::linux::check_ld_preload().is_some(),
        ptrace_scope: platform_rs::linux::check_ptrace_scope(),
    };

    #[cfg(not(target_os = "linux"))]
    SecurityEnvironment {
        os: std::env::consts::OS.to_string(),
        display_server: "native".to_string(),
        ld_preload_injection: false,
        ptrace_scope: 1,
    }
}

#[derive(Serialize, Deserialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub family: String,
    pub elevated: bool,
}

#[derive(Serialize, Deserialize)]
pub struct FullTelemetry {
    pub platform: PlatformInfo,
    pub env: SecurityEnvironment,
    pub processes: ProcessScanResult,
    pub virt: VirtDetectionResult,
    pub network: Option<NetworkCheckResult>,
}

#[tauri::command]
async fn get_full_telemetry(network_host: Option<String>) -> FullTelemetry {
    let platform = PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        elevated: process_elevated(),
    };
    let env = get_security_environment();
    let processes = scan_processes();
    let virt = detect_virtualization();
    let network = match network_host.filter(|host| !host.trim().is_empty()) {
        Some(host) => Some(check_network_stability_with_fallback(host, None).await),
        None => None,
    };

    FullTelemetry {
        platform,
        env,
        processes,
        virt,
        network,
    }
}

/// Full exam lockdown — always-on-top + keyboard intercept + sleep prevention + capture protection.
#[tauri::command]
async fn lock_desktop(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
        let _ = win.set_fullscreen(true);
    }

    // Apply DWM capture exclusion (black screen in all capture APIs) and start the
    // virtual desktop guard (moves exam window to any desktop the user switches to).
    #[cfg(target_os = "windows")]
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(hwnd) = win.hwnd() {
            platform_rs::windows::apply_capture_protection(hwnd.0 as isize);
            platform_rs::windows::spawn_virtual_desktop_guard(hwnd.0 as isize);

            // F6: native clipboard monitor. Subscribes to WM_CLIPBOARDUPDATE and
            // emits classified clipboard events (image capture / external write /
            // write) as proctoring audit events. Metadata only — never reads
            // clipboard contents. Register the callback once, then start the
            // message-only-window monitor for the exam HWND.
            let cb_app = app.clone();
            platform_rs::windows::set_clipboard_event_callback(move |kind, detail, payload| {
                let payload: serde_json::Value =
                    serde_json::from_str(&payload).unwrap_or_else(|_| serde_json::json!({}));
                record_proctoring_event(Some(&cb_app), kind, detail, payload);
            });
            platform_rs::windows::start_clipboard_monitor(hwnd.0 as isize);

            // F11: injected-keystroke rejection. The LL keyboard hook swallows any
            // synthetic (SendInput/keybd_event) keystroke during lockdown and raises
            // this callback so the blocked attempt is recorded as a proctoring
            // violation. Emission is throttled (once/sec) inside platform-rs.
            let inj_app = app.clone();
            platform_rs::windows::set_injected_input_callback(move |kind, detail| {
                record_violation(Some(&inj_app), kind, detail);
            });

            // F1 + kiosk: native focus watchdog. Re-asserts fullscreen/foreground
            // (drift-checked, flicker-safe) and reports lock/loss with severity.
            // Posture is DETECT-AND-REPORT: CAD/Win+L are unblockable from user
            // mode (see windows-fullscreen-kiosk spec §1); we never claim to block
            // them and never auto-end a contest. All decision logic is the pure,
            // unit-tested platform_rs::kiosk::decide(); this thread only observes
            // and executes. Drains any open episode via on_teardown() on exit.
            // NOTE: the loop sleeps BEFORE its first LOCKDOWN_ENGAGED check — this
            // thread is spawned just before LOCKDOWN_ENGAGED is set true, so an
            // immediate check would observe false and exit at once. Do not move
            // the sleep below the flag check.
            let app_handle = app.clone();
            let hwnd_raw = hwnd.0 as isize;
            std::thread::spawn(move || {
                use tauri::Manager;
                let start = std::time::Instant::now();
                let mut state = platform_rs::kiosk::KioskState::default();
                loop {
                    std::thread::sleep(Duration::from_millis(750));
                    let now_ms = start.elapsed().as_millis() as u64;
                    if !LOCKDOWN_ENGAGED.load(Ordering::SeqCst) {
                        for action in platform_rs::kiosk::on_teardown(&mut state, now_ms) {
                            execute_kiosk_action(&app_handle, hwnd_raw, action);
                        }
                        break;
                    }
                    let (exam_fg, fg_null, fg_hwnd, fg_secure, fg_proc) =
                        platform_rs::windows::observe_foreground(hwnd_raw);
                    let (is_fs, is_aot) = app_handle
                        .get_webview_window("main")
                        .map(|w| {
                            (
                                w.is_fullscreen().unwrap_or(true),
                                w.is_always_on_top().unwrap_or(true),
                            )
                        })
                        .unwrap_or((true, true));
                    let input = platform_rs::kiosk::TickInput {
                        now_ms,
                        exam_is_foreground: exam_fg,
                        foreground_is_null: fg_null,
                        foreground_hwnd: fg_hwnd,
                        foreground_is_secure_system: fg_secure,
                        foreground_process: fg_proc,
                        is_fullscreen: is_fs,
                        is_always_on_top: is_aot,
                    };
                    for action in platform_rs::kiosk::decide(&mut state, input) {
                        execute_kiosk_action(&app_handle, hwnd_raw, action);
                    }
                }
            });
        }
    }

    let locked = platform_dispatch!(lock_desktop(), else false);

    // Only a successful lockdown owns the intercept; on failure readiness
    // probes keep releasing it after each scan.
    LOCKDOWN_ENGAGED.store(locked, Ordering::SeqCst);
    locked
}

/// Release full exam lockdown.
#[tauri::command]
async fn unlock_desktop(app: tauri::AppHandle) {
    use tauri::Manager;
    LOCKDOWN_ENGAGED.store(false, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
        let _ = win.set_fullscreen(false);
    }
    #[cfg(target_os = "windows")]
    platform_rs::windows::stop_clipboard_monitor();
    // The session is over, so the enrolment snapshots have nothing left to be
    // for. See purge_face_captures.
    purge_face_captures();
    platform_dispatch!(unlock_desktop(), else ())
}

/// Read-only probe: is a real exam lockdown (lock_desktop) currently engaged?
///
/// The contest UI uses this as a defense-in-depth chokepoint — no real
/// (non-dry-run) proctored session may render the contest unless lockdown is
/// engaged. Read-only: it never mutates state or touches the OS.
#[tauri::command]
fn is_lockdown_engaged() -> bool {
    LOCKDOWN_ENGAGED.load(Ordering::SeqCst)
}

/// Return all recorded violations for this session.
#[tauri::command]
fn get_violation_log(app: tauri::AppHandle) -> Vec<ViolationEntry> {
    let mut entries = violation_log()
        .lock()
        .ok()
        .map(|v| v.clone())
        .unwrap_or_default();

    let path = proctoring_log_dir(Some(&app)).join("violations.jsonl");
    if let Ok(raw) = std::fs::read_to_string(path) {
        for line in raw.lines() {
            if let Ok(entry) = serde_json::from_str::<ViolationEntry>(line) {
                if !entries
                    .iter()
                    .any(|existing| existing.ts == entry.ts && existing.kind == entry.kind)
                {
                    entries.push(entry);
                }
            }
        }
    }
    entries.sort_by_key(|entry| entry.ts);
    entries
}

/// Record a violation from the frontend (blocked app opened during exam, focus lost, etc).
#[tauri::command]
fn log_violation(app: tauri::AppHandle, kind: String, detail: String) {
    record_violation(Some(&app), &kind, &detail);
}

/// Persist a structured proctoring audit event from the frontend.
#[tauri::command]
fn log_proctoring_event(
    app: tauri::AppHandle,
    kind: Option<String>,
    event: Option<String>,
    detail: Option<String>,
    reason: Option<String>,
    timestamp: Option<u64>,
    payload: Option<serde_json::Value>,
) {
    let event_kind = kind
        .or(event)
        .unwrap_or_else(|| "proctoring_event".to_string());
    let event_detail = detail
        .or(reason)
        .unwrap_or_else(|| "frontend_proctoring_event".to_string());
    let mut event_payload = payload.unwrap_or_else(|| serde_json::json!({}));
    if let serde_json::Value::Object(ref mut object) = event_payload {
        if let Some(ts) = timestamp {
            object.insert("frontend_ts".to_string(), serde_json::json!(ts));
        }
    }
    record_proctoring_event(Some(&app), &event_kind, &event_detail, event_payload);
}

/// Return persisted structured proctoring events for this session.
#[tauri::command]
fn get_proctoring_log(app: tauri::AppHandle) -> Vec<ProctoringEventEntry> {
    let mut entries = proctoring_log()
        .lock()
        .ok()
        .map(|v| v.clone())
        .unwrap_or_default();
    let mut seen: HashSet<(u64, String)> = entries
        .iter()
        .map(|entry| (entry.ts, entry.kind.clone()))
        .collect();

    let path = proctoring_log_dir(Some(&app)).join("proctoring-events.jsonl");
    if let Ok(raw) = std::fs::read_to_string(path) {
        for line in raw.lines() {
            if let Ok(entry) = serde_json::from_str::<ProctoringEventEntry>(line) {
                if seen.insert((entry.ts, entry.kind.clone())) {
                    entries.push(entry);
                }
            }
        }
    }
    entries.sort_by_key(|entry| entry.ts);
    entries
}

/// Lock outbound network to `allowed_domains` only (resolved to IPs at call time).
/// Rules are applied at the OS firewall level and persist until `disable_network_lockdown`
/// is explicitly called — intentional, so an app crash does not restore internet access.
#[tauri::command]
async fn enable_network_lockdown(allowed_domains: Vec<String>) -> Result<bool, String> {
    // A build that never asked for elevation cannot raise a firewall, so say
    // so instead of resolving every allowlist host and then handing netsh a
    // command it will refuse. `false` is the existing "not applied" answer —
    // the caller already treats it as advisory, because this has always been
    // best-effort on machines where it could not engage.
    #[cfg(target_os = "windows")]
    if !WANTS_FIREWALL {
        return Ok(false);
    }

    let mut ips: Vec<String> = Vec::new();

    for domain in &allowed_domains {
        // If it's already a raw IP, use it directly
        if domain.parse::<std::net::IpAddr>().is_ok() {
            if !ips.contains(domain) {
                ips.push(domain.clone());
            }
            continue;
        }
        // Try resolving as hostname (port doesn't matter for resolution; use 443)
        let addr = format!("{}:443", domain);
        if let Ok(addrs) = addr.as_str().to_socket_addrs() {
            for a in addrs {
                let ip = a.ip().to_string();
                if !ips.contains(&ip) {
                    ips.push(ip);
                }
            }
        }
    }

    // LX-3/LX-4: under the default-DROP firewall the system DNS resolver must
    // stay reachable or every subsequent name lookup (incl. re-resolution of the
    // allowed API/judge hosts) fails. Add each /etc/resolv.conf nameserver to the
    // allowlist. We add the resolver *host* (covers both UDP and TCP 53 in the
    // helper's address-based rules) rather than port-scoping, mirroring how the
    // allowed API hosts are permitted wholesale. Both v4 and v6 nameservers are
    // included; the helper family-splits them.
    #[cfg(target_os = "linux")]
    for ns in resolv_conf_nameservers() {
        if !ips.contains(&ns) {
            ips.push(ns);
        }
    }

    if ips.is_empty() {
        return Err("Could not resolve any allowed domains to IPs".to_string());
    }

    // The Linux/macOS client returns Err when the privileged helper is not
    // installed/running. We propagate that verbatim instead of swallowing it:
    // an exam must NOT proceed with unrestricted egress. This is the last-line
    // enforcement at ContestLaunch; the readiness policy already hard-blocks a
    // strict Linux contest earlier via the CheckKind::Network helper gate in
    // `packages/core-rs/src/exam/mod.rs` (fed by `network_helper_ready`).
    platform_dispatch!(
        enable_network_lockdown(&ips),
        else Err("Network lockdown not supported on this platform".to_string())
    )
    .map(|_| true)
}

/// Parse `nameserver <ip>` lines out of a resolv.conf-format string.
/// Returns valid IP literals only, in order, deduped.
#[cfg(target_os = "linux")]
fn parse_resolv_nameservers(contents: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("nameserver") {
            let candidate = rest.trim();
            if candidate.parse::<std::net::IpAddr>().is_ok()
                && !out.contains(&candidate.to_string())
            {
                out.push(candidate.to_string());
            }
        }
    }
    out
}

/// Nameservers the default-DROP firewall must keep reachable so name
/// resolution survives the lockdown. Unions /etc/resolv.conf with
/// /run/systemd/resolve/resolv.conf: on systemd-resolved hosts /etc only holds
/// the 127.0.0.53 stub, while the REAL upstream servers (which the stub must
/// reach) live in the /run file. Missing files are skipped.
#[cfg(target_os = "linux")]
fn resolv_conf_nameservers() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in ["/etc/resolv.conf", "/run/systemd/resolve/resolv.conf"] {
        if let Ok(contents) = std::fs::read_to_string(path) {
            for ns in parse_resolv_nameservers(&contents) {
                if !out.contains(&ns) {
                    out.push(ns);
                }
            }
        }
    }
    out
}

#[cfg(all(test, target_os = "linux"))]
mod resolv_tests {
    use super::parse_resolv_nameservers;

    #[test]
    fn parses_nameservers_skips_comments_and_dupes() {
        let etc = "# stub\nnameserver 127.0.0.53\noptions edns0 trust-ad\nsearch .\n";
        let run = "# real upstream\nnameserver 192.168.0.1\nnameserver 192.168.0.1\nnameserver not-an-ip\n";
        let mut all = parse_resolv_nameservers(etc);
        for ns in parse_resolv_nameservers(run) {
            if !all.contains(&ns) {
                all.push(ns);
            }
        }
        // The real upstream MUST be present (this is the bug fix), the stub too,
        // duplicates collapsed, and the malformed line dropped.
        assert!(
            all.contains(&"192.168.0.1".to_string()),
            "real upstream must be allowlisted"
        );
        assert!(all.contains(&"127.0.0.53".to_string()));
        assert_eq!(
            all.iter().filter(|x| x.as_str() == "192.168.0.1").count(),
            1
        );
        assert!(!all.iter().any(|x| x == "not-an-ip"));
    }
}

/// Remove all AMS firewall rules and restore normal internet access.
#[tauri::command]
async fn disable_network_lockdown() -> Result<bool, String> {
    // Nothing was ever applied, so there is nothing to tear down — and calling
    // netsh here would fail noisily on the exit path of every ordinary exam.
    #[cfg(target_os = "windows")]
    if !WANTS_FIREWALL {
        return Ok(false);
    }

    platform_dispatch!(
        disable_network_lockdown(),
        else Err("Network lockdown not supported on this platform".to_string())
    )
    .map(|_| true)
}

/// Where face captures land. One definition, because the purge below has to
/// agree with the writer exactly — a purge pointed at the wrong directory
/// silently does nothing, which is indistinguishable from working.
fn face_capture_dir() -> String {
    if cfg!(target_os = "windows") {
        format!(
            "{}\\ams_faces",
            std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".into())
        )
    } else {
        std::env::temp_dir().join("ams_faces").display().to_string()
    }
}

/// Delete the face captures this machine has accumulated.
///
/// Nothing ever uploads these — there is no endpoint and no reviewer, so the
/// only thing they can do after a session is sit on a contestant's disk. They
/// were never cleaned up, so every rehearsal and every exam left another set
/// behind indefinitely.
///
/// Called on teardown and again at startup. Startup is the one that matters:
/// teardown does not run when the app is killed mid-exam, which is exactly the
/// case that used to strand them for good.
///
/// Best-effort by design. A file held open by an antivirus scanner must not
/// take down lockdown teardown, and failing to delete a temp file is not
/// something to tell a candidate about mid-contest.
fn purge_face_captures() {
    let dir = face_capture_dir();
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => eprintln!("[ams][faces] cleared {dir}"),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => eprintln!("[ams][faces] could not clear {dir}: {err}"),
    }
}

/// Result returned by `save_face_image` — includes backend image validation outcome.
#[derive(Serialize)]
struct FaceSaveResult {
    path: String,
    face_verified: bool,
    rejection_reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ModelManifest {
    files: Vec<ModelManifestFile>,
}

#[derive(Serialize, Deserialize)]
struct ModelManifestFile {
    path: String,
    sha256: String,
    bytes: u64,
}

#[derive(Serialize)]
struct ModelAssetVerification {
    ok: bool,
    base_dir: Option<String>,
    checked_files: usize,
    error: Option<String>,
}

fn candidate_model_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("models").join("blazeface"));
    }
    #[cfg(debug_assertions)]
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("apps/web/public/models/blazeface"));
        dirs.push(cwd.join("../../web/public/models/blazeface"));
    }
    dirs
}

fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    let digest = Sha256::digest(&bytes);
    Ok((hex::encode(digest), size))
}

fn safe_relative_manifest_path(path: &str) -> Option<&Path> {
    let relative = Path::new(path);
    if path.trim().is_empty()
        || relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(relative)
}

fn manifest_file_set(manifest: &ModelManifest) -> Option<HashSet<String>> {
    let mut files = HashSet::new();
    for file in &manifest.files {
        let relative = safe_relative_manifest_path(&file.path)?;
        files.insert(relative.to_string_lossy().replace('\\', "/"));
    }
    Some(files)
}

fn verify_blazeface_model_shape(base: &Path, manifest: &ModelManifest) -> Result<(), String> {
    let manifest_files =
        manifest_file_set(manifest).ok_or_else(|| "invalid_manifest_path".to_string())?;
    let expected_files: HashSet<String> = EXPECTED_BLAZEFACE_ASSETS
        .iter()
        .map(|(path, _, _)| (*path).to_string())
        .collect();
    if manifest_files != expected_files {
        return Err("manifest_assets_do_not_match_pinned_set".to_string());
    }

    for (expected_path, expected_hash, expected_bytes) in EXPECTED_BLAZEFACE_ASSETS {
        let Some(file) = manifest
            .files
            .iter()
            .find(|file| file.path == *expected_path)
        else {
            return Err(format!("missing_expected_asset: {expected_path}"));
        };
        if file.sha256 != *expected_hash || file.bytes != *expected_bytes {
            return Err(format!("unexpected_manifest_digest: {expected_path}"));
        }
    }

    let model_path = base.join("model.json");
    let raw =
        std::fs::read_to_string(&model_path).map_err(|e| format!("model_json_read_failed: {e}"))?;
    let model_json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("model_json_parse_failed: {e}"))?;
    if model_json.get("format").and_then(|v| v.as_str()) != Some("graph-model") {
        return Err("unexpected_model_format".to_string());
    }

    let mut referenced_weights = HashSet::new();
    let groups = model_json
        .get("weightsManifest")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "weights_manifest_missing".to_string())?;
    for group in groups {
        let paths = group
            .get("paths")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "weights_paths_missing".to_string())?;
        for path_value in paths {
            let path = path_value
                .as_str()
                .ok_or_else(|| "weights_path_not_string".to_string())?;
            let relative = safe_relative_manifest_path(path)
                .ok_or_else(|| format!("invalid_weight_path: {path}"))?;
            let normalized = relative.to_string_lossy().replace('\\', "/");
            if !manifest_files.contains(&normalized) {
                return Err(format!("weight_missing_from_manifest: {normalized}"));
            }

            let bytes = std::fs::read(base.join(relative))
                .map_err(|e| format!("weight_read_failed: {normalized}: {e}"))?;
            let prefix_len = bytes.len().min(256);
            let prefix = String::from_utf8_lossy(&bytes[..prefix_len]).to_ascii_lowercase();
            if prefix.contains("<html") || prefix.contains("<!doctype") {
                return Err(format!("weight_asset_is_html: {normalized}"));
            }
            referenced_weights.insert(normalized);
        }
    }

    if referenced_weights.is_empty() {
        return Err("no_weight_assets_referenced".to_string());
    }

    Ok(())
}

#[tauri::command]
fn verify_face_model_assets(app: tauri::AppHandle) -> ModelAssetVerification {
    for base in candidate_model_dirs(&app) {
        let manifest_path = base.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(raw) => raw,
            Err(e) => {
                return ModelAssetVerification {
                    ok: false,
                    base_dir: Some(base.display().to_string()),
                    checked_files: 0,
                    error: Some(format!("manifest_read_failed: {e}")),
                };
            }
        };
        let manifest: ModelManifest = match serde_json::from_str(&raw) {
            Ok(manifest) => manifest,
            Err(e) => {
                return ModelAssetVerification {
                    ok: false,
                    base_dir: Some(base.display().to_string()),
                    checked_files: 0,
                    error: Some(format!("manifest_parse_failed: {e}")),
                };
            }
        };

        if manifest.files.is_empty() {
            return ModelAssetVerification {
                ok: false,
                base_dir: Some(base.display().to_string()),
                checked_files: 0,
                error: Some("manifest_empty".to_string()),
            };
        }

        for file in &manifest.files {
            let relative = match safe_relative_manifest_path(&file.path) {
                Some(relative) => relative,
                None => {
                    return ModelAssetVerification {
                        ok: false,
                        base_dir: Some(base.display().to_string()),
                        checked_files: 0,
                        error: Some(format!("invalid_manifest_path: {}", file.path)),
                    };
                }
            };
            let path = base.join(relative);
            let (actual_hash, actual_size) = match sha256_file(&path) {
                Ok(result) => result,
                Err(e) => {
                    return ModelAssetVerification {
                        ok: false,
                        base_dir: Some(base.display().to_string()),
                        checked_files: 0,
                        error: Some(format!("asset_read_failed: {}: {e}", file.path)),
                    };
                }
            };
            if actual_size != file.bytes || actual_hash != file.sha256 {
                return ModelAssetVerification {
                    ok: false,
                    base_dir: Some(base.display().to_string()),
                    checked_files: 0,
                    error: Some(format!("asset_integrity_failed: {}", file.path)),
                };
            }
        }

        if let Err(error) = verify_blazeface_model_shape(&base, &manifest) {
            return ModelAssetVerification {
                ok: false,
                base_dir: Some(base.display().to_string()),
                checked_files: manifest.files.len(),
                error: Some(error),
            };
        }

        return ModelAssetVerification {
            ok: true,
            base_dir: Some(base.display().to_string()),
            checked_files: manifest.files.len(),
            error: None,
        };
    }

    ModelAssetVerification {
        ok: false,
        base_dir: None,
        checked_files: 0,
        error: Some("face_model_manifest_missing".to_string()),
    }
}

/// Validate a decoded PNG image to defend against blank/dark/uniform captures.
///
/// Uses Welford's online algorithm for a single-pass mean/variance over luma,
/// plus a dark-pixel ratio check.  Thresholds are conservative enough not to
/// reject a real face under poor lighting, but will reject a black canvas, a
/// covered camera, or any near-uniform image that cannot contain a face.
fn validate_face_image_bytes(bytes: &[u8]) -> (bool, Option<String>) {
    if bytes.len() > MAX_FACE_IMAGE_BYTES {
        return (false, Some("image_too_large".to_string()));
    }

    let img = match image::load_from_memory(bytes) {
        Ok(img) => img,
        Err(_) => return (false, Some("corrupt_image".to_string())),
    };

    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    if (w as u64) * (h as u64) > MAX_FACE_IMAGE_PIXELS {
        return (false, Some("image_dimensions_too_large".to_string()));
    }

    // Must be at least the size of our capture canvas (320x240), with margin.
    if w < 160 || h < 120 {
        return (false, Some("image_too_small".to_string()));
    }

    let total_pixels = (w as usize) * (h as usize);
    let total = total_pixels as f64;
    let mut lumas = Vec::with_capacity(total_pixels);
    let mut dark_count: u64 = 0;
    let mut clipped_count: u64 = 0;
    let center_x1 = w / 4;
    let center_x2 = (w * 3) / 4;
    let center_y1 = h / 5;
    let center_y2 = (h * 4) / 5;

    let mut mean: f64 = 0.0;
    let mut m2: f64 = 0.0;
    let mut n: f64 = 0.0;
    let mut center_mean: f64 = 0.0;
    let mut center_m2: f64 = 0.0;
    let mut center_n: f64 = 0.0;

    for (x, y, p) in rgb.enumerate_pixels() {
        let luma = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
        lumas.push(luma as f32);

        n += 1.0;
        let delta = luma - mean;
        mean += delta / n;
        m2 += delta * (luma - mean);

        if x >= center_x1 && x <= center_x2 && y >= center_y1 && y <= center_y2 {
            center_n += 1.0;
            let center_delta = luma - center_mean;
            center_mean += center_delta / center_n;
            center_m2 += center_delta * (luma - center_mean);
        }

        if luma < 20.0 {
            dark_count += 1;
        }
        if luma > 245.0 {
            clipped_count += 1;
        }
    }

    if (dark_count as f64) / total > 0.85 {
        return (false, Some("image_too_dark".to_string()));
    }
    if (clipped_count as f64) / total > 0.85 {
        return (false, Some("image_overexposed".to_string()));
    }

    let std_dev = if n > 1.0 { (m2 / n).sqrt() } else { 0.0 };
    if std_dev < 15.0 {
        return (false, Some("blank_or_uniform_image".to_string()));
    }

    let center_std_dev = if center_n > 1.0 {
        (center_m2 / center_n).sqrt()
    } else {
        0.0
    };
    if center_std_dev < 10.0 {
        return (false, Some("center_region_uniform".to_string()));
    }

    let idx = |x: u32, y: u32| -> usize { (y as usize) * (w as usize) + (x as usize) };
    let mut edge_count: u64 = 0;
    let mut center_edge_count: u64 = 0;
    let mut center_pixels: u64 = 0;
    for y in 0..h.saturating_sub(1) {
        for x in 0..w.saturating_sub(1) {
            let current = lumas[idx(x, y)] as f64;
            let dx = (current - lumas[idx(x + 1, y)] as f64).abs();
            let dy = (current - lumas[idx(x, y + 1)] as f64).abs();
            let edge_like = dx + dy > 35.0;
            if edge_like {
                edge_count += 1;
            }
            if x >= center_x1 && x <= center_x2 && y >= center_y1 && y <= center_y2 {
                center_pixels += 1;
                if edge_like {
                    center_edge_count += 1;
                }
            }
        }
    }

    let edge_density = (edge_count as f64) / total;
    let center_edge_density = if center_pixels > 0 {
        (center_edge_count as f64) / (center_pixels as f64)
    } else {
        0.0
    };

    // A valid calibration capture should contain a structured subject in the
    // center. This is intentionally image-statistical, not skin-tone based.
    if edge_density < 0.004 || center_edge_density < 0.008 {
        return (false, Some("no_structured_face_region".to_string()));
    }

    (true, None)
}

/// Save a base64-encoded face image to the faces directory.
///
/// Validates the image content before writing: rejects corrupt, blank,
/// near-uniform, or predominantly dark images so the frontend cannot advance
/// the stage without a real face present in the capture.
#[tauri::command]
async fn save_face_image(
    app: tauri::AppHandle,
    image_data: String,
    index: u8,
) -> Result<FaceSaveResult, String> {
    let b64 = image_data.split(',').nth(1).unwrap_or(image_data.as_str());
    let bytes = base64::prelude::BASE64_STANDARD.decode(b64).map_err(|e| {
        record_violation(
            Some(&app),
            "face_capture_rejected",
            &format!("base64_decode_failed: {e}"),
        );
        e.to_string()
    })?;

    let (face_verified, rejection_reason) = validate_face_image_bytes(&bytes);
    if !face_verified {
        let reason = rejection_reason
            .clone()
            .unwrap_or_else(|| "invalid_capture".to_string());
        record_violation(
            Some(&app),
            "face_capture_rejected",
            &format!("save_face_image rejected index {index}: {reason}"),
        );
        record_proctoring_event(
            Some(&app),
            "face_capture_rejected",
            &reason,
            serde_json::json!({ "index": index, "reason": reason.clone() }),
        );
        return Err(reason);
    }

    let dir = face_capture_dir();

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = format!("{}/face_{}.png", dir, index);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    record_proctoring_event(
        Some(&app),
        "face_capture_saved",
        "backend_face_validation_passed",
        serde_json::json!({ "index": index, "path": path.clone() }),
    );

    Ok(FaceSaveResult {
        path,
        face_verified,
        rejection_reason,
    })
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg(unix)]
mod unix_signal {
    use std::os::raw::c_int;
    extern "C" {
        pub fn signal(sig: c_int, handler: usize) -> usize;
    }
    pub const SIGINT: c_int = 2;
    pub const SIGTERM: c_int = 15;
    pub const SIGQUIT: c_int = 3;
    pub const SIGHUP: c_int = 1;
}

#[cfg(unix)]
extern "C" fn handle_sigterm(_sig: std::os::raw::c_int) {
    eprintln!("AMS Access intercepted termination signal; restoring keyboard shortcuts...");
    #[cfg(target_os = "linux")]
    {
        // Full unlock: keyboard intercept, the kill-shield / workspace-watchdog
        // threads (via SHIELD_ACTIVE=false), and the disabled touchpad — matching
        // the macOS arm in this same handler rather than restoring only the keyboard.
        platform_rs::linux::unlock_desktop();
        let _ = platform_rs::linux::disable_network_lockdown();
    }
    #[cfg(target_os = "macos")]
    {
        // Full unlock: keyboard intercept, trackpad gesture prefs (persisted via
        // `defaults write` — must be restored or they survive the process), and
        // the caffeinate child.
        platform_rs::macos::unlock_desktop();
        let _ = platform_rs::macos::disable_network_lockdown();
    }
    std::process::exit(0);
}

pub fn run() {
    // F5: harden the DLL search path before anything else loads a library, so a
    // malicious DLL planted in the launch directory or %CWD% can never be
    // preferred over the system copy (DLL preloading / search-order hijack).
    #[cfg(target_os = "windows")]
    platform_rs::windows::harden_dll_search_path();

    // The GUI must run inside the user's desktop session for WebKit camera,
    // microphone, DBus, and portal permissions to work correctly. Network
    // lockdown still requires elevated privileges and will report failure from
    // its command path if the process cannot modify firewall rules.
    #[cfg(unix)]
    {
        unsafe {
            unix_signal::signal(unix_signal::SIGINT, handle_sigterm as *const () as usize);
            unix_signal::signal(unix_signal::SIGTERM, handle_sigterm as *const () as usize);
            unix_signal::signal(unix_signal::SIGQUIT, handle_sigterm as *const () as usize);
            unix_signal::signal(unix_signal::SIGHUP, handle_sigterm as *const () as usize);
        }

        let uid_out = std::process::Command::new("id").arg("-u").output();
        if let Ok(out) = uid_out {
            let uid = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if uid != "0" {
                eprintln!(
                    "AMS Access is running without root; camera permissions should work, \
                     but network lockdown may require elevated privileges."
                );
            }
        }
    }

    // Keyboard recovery only. Firewall recovery is owned by the network helper,
    // which reconciles the AMS_PROCTOR chain against its /run marker on its own
    // startup; a tokenless disable from here would be rejected anyway.
    #[cfg(target_os = "linux")]
    platform_rs::linux::recover_keyboard_if_crashed();
    #[cfg(target_os = "windows")]
    {
        platform_rs::windows::recover_registry_if_crashed();
        // AMS_PROCTOR firewall rules persist across a crash BY DESIGN (a crash
        // must not restore internet mid-exam), but at process start no exam can
        // be active, so any still-present rule is a leftover that would strand the
        // candidate offline. Flush in the background; idempotent / no-op if no
        // rules exist. Mirrors the Linux path above. lock_desktop re-applies the
        // firewall when a real exam starts.
        std::thread::spawn(|| {
            let _ = platform_rs::windows::disable_network_lockdown();
        });
    }

    // Auto-elevate on Windows: full exam lockdown (firewall, registry, taskkill)
    // requires Administrator. Rather than make the candidate discover the Resolve
    // flow, raise the standard one-click UAC prompt up front — before any window
    // exists, so there's no flash of an unelevated UI. Runs at most once per
    // launch chain:
    //   • already elevated            → nothing to do.
    //   • a relaunched instance       → carries the marker arg, so we never
    //                                    prompt again; a declined/failed
    //                                    elevation therefore can't loop.
    //   • otherwise                   → prompt. On approval the elevated instance
    //                                    takes over and this one exits; on
    //                                    decline we continue unelevated and let
    //                                    the readiness check surface
    //                                    "Administrator required" with its
    //                                    Relaunch-as-Administrator action.
    #[cfg(target_os = "windows")]
    {
        let relaunched = std::env::args().any(|a| a == platform_rs::windows::RELAUNCH_MARKER);
        // A packaged (MSIX/Store) build is never elevated and never can be, so
        // prompting would be a UAC dialog that cannot succeed — and a `runas`
        // relaunch of a packaged exe either fails or starts a second instance
        // outside the package, which is worse than not trying.
        let packaged = platform_rs::windows::is_packaged();
        // And a build with no firewall has nothing to elevate *for*. Without
        // this the default build would prompt on every launch while the
        // manifest says asInvoker — the worst of both, since the prompt would
        // buy nothing.
        if WANTS_FIREWALL && !packaged && !relaunched && !platform_rs::windows::is_elevated() {
            match platform_rs::windows::relaunch_as_admin() {
                Ok(()) => std::process::exit(0),
                Err(e) => eprintln!(
                    "auto-elevation skipped ({e}); continuing unelevated — readiness \
                     will offer Relaunch as Administrator"
                ),
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        platform_rs::macos::recover_lockdown_if_crashed();
        // pfctl rules survive crashes BY DESIGN (a crash must not restore
        // internet mid-exam), but at process start no exam can be active, so
        // any still-active rules are leftovers from a crashed session. Flush
        // in the background so a candidate is never stranded offline with no
        // UI explaining why. No-op when the helper isn't installed/running.
        std::thread::spawn(|| {
            let _ = platform_rs::macos::disable_network_lockdown();
        });
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            collect_device_state,
            evaluate_session_readiness,
            start_secure_session,
            scan_processes,
            close_restricted_apps,
            detect_virtualization,
            enable_keyboard_intercept,
            disable_keyboard_intercept,
            lock_desktop,
            unlock_desktop,
            is_lockdown_engaged,
            get_violation_log,
            get_proctoring_log,
            log_violation,
            log_proctoring_event,
            check_network_stability,
            get_full_telemetry,
            get_platform,
            get_security_environment,
            save_face_image,
            verify_face_model_assets,
            enable_network_lockdown,
            disable_network_lockdown,
            check_accessibility_permission,
            open_accessibility_settings,
            is_process_elevated,
            relaunch_as_admin,
            open_privacy_settings,
            check_screen_sharing,
            get_screen_capture_permitted_apps,
            detect_active_screen_share,
            network_helper_running,
            install_network_helper,
            detect_screen_capture_active,
            apply_capture_protection,
            set_escape_blocked,
            configure_event_stream,
        ])
        .setup(|app| {
            // Anything left in the face-capture directory belongs to a run
            // that did not shut down cleanly — a crash, a kill, a power cut.
            // Teardown cannot clear those, so startup does. See
            // purge_face_captures.
            purge_face_captures();

            // Organizer event stream: tail the violation/proctoring spool and
            // upload once the frontend arms it with a session id.
            spawn_event_sync_task(app.handle().clone());

            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.with_webview(|wv| {
                        use webkit2gtk::{PermissionRequestExt, WebViewExt};
                        wv.inner().connect_permission_request(|_, req| {
                            req.allow();
                            true
                        });
                    })
                    .expect("with_webview failed — camera/mic permission handler not registered");
                }
            }
            // On Windows, WebView2 raises PermissionRequested for getUserMedia.
            // Mirror the Linux webkit2gtk auto-allow: grant camera/microphone to
            // the bundled exam UI so the candidate only ever deals with the
            // OS-level privacy toggle (which Stage 8 deep-links to), and a one-off
            // webview "Deny" can never be persisted and dead-end the camera stage.
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.with_webview(|wv| unsafe {
                        use webview2_com::Microsoft::Web::WebView2::Win32::{
                            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
                            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
                        };
                        use webview2_com::PermissionRequestedEventHandler;

                        let Ok(core) = wv.controller().CoreWebView2() else {
                            return;
                        };
                        let handler =
                            PermissionRequestedEventHandler::create(Box::new(|_core, args| {
                                if let Some(args) = args {
                                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                                    args.PermissionKind(&mut kind)?;
                                    if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                                        || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                    {
                                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                                    }
                                }
                                Ok(())
                            }));
                        let mut token = 0i64;
                        let _ = core.add_PermissionRequested(&handler, &mut token);
                    })
                    .expect("with_webview failed — camera/mic permission handler not registered");
                }
            }
            // On macOS, WKWebView's getUserMedia() does NOT trigger the macOS TCC
            // permission dialog on its own — only a native AVCaptureDevice.requestAccess
            // call does. Fire it here so the system dialog appears on first launch
            // and the app is registered in System Settings → Privacy → Camera/Microphone.
            #[cfg(target_os = "macos")]
            {
                platform_rs::macos::request_av_permissions();

                // Sink for security events raised from background lockdown
                // threads (Accessibility revoked mid-exam, screen sharing
                // detected, tap re-enabled). Persists to the violation +
                // proctoring logs and notifies the webview so the frontend
                // can react live if it subscribes to "lockdown-event".
                use tauri::Emitter;
                let handle = app.handle().clone();
                platform_rs::macos::set_lockdown_event_callback(move |kind, detail| {
                    record_violation(Some(&handle), kind, detail);
                    record_proctoring_event(
                        Some(&handle),
                        kind,
                        detail,
                        serde_json::json!({ "source": "platform_lockdown" }),
                    );
                    let _ = handle.emit(
                        "lockdown-event",
                        serde_json::json!({ "kind": kind, "detail": detail }),
                    );
                });
            }
            // Linux: sink for native lockdown events (the X11 focus-loss
            // watchdog). Mirrors the macOS registration — persist to the
            // violation + proctoring logs and notify the webview.
            #[cfg(target_os = "linux")]
            {
                use tauri::Emitter;
                let handle = app.handle().clone();
                platform_rs::linux::set_lockdown_event_callback(move |kind, detail| {
                    record_violation(Some(&handle), kind, detail);
                    record_proctoring_event(
                        Some(&handle),
                        kind,
                        detail,
                        serde_json::json!({ "source": "platform_lockdown" }),
                    );
                    let _ = handle.emit(
                        "lockdown-event",
                        serde_json::json!({ "kind": kind, "detail": detail }),
                    );
                });
            }
            let _ = app;
            Ok(())
        })
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(target_os = "linux")]
                {
                    // unlock_desktop covers keyboard intercept, the kill-shield /
                    // workspace-watchdog threads (via SHIELD_ACTIVE=false), and the
                    // disabled touchpad — not just the keyboard.
                    platform_rs::linux::unlock_desktop();
                    // Firewall rules must be cleared even on crash — intentional persistence
                    let _ = platform_rs::linux::disable_network_lockdown();
                }
                #[cfg(target_os = "windows")]
                {
                    // unlock_desktop covers keyboard, sleep prevention, registry, shield, game bar
                    platform_rs::windows::unlock_desktop();
                    // Firewall rules must be cleared even on crash — intentional persistence
                    let _ = platform_rs::windows::disable_network_lockdown();
                }
                #[cfg(target_os = "macos")]
                {
                    // unlock_desktop covers keyboard intercept, the persisted
                    // trackpad gesture prefs, and the caffeinate child — not
                    // just the event tap.
                    platform_rs::macos::unlock_desktop();
                    let _ = platform_rs::macos::disable_network_lockdown();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running AMS Access");
}

#[cfg(test)]
mod pinning_tests {
    use super::PINNED_ROOTS_PEM;

    /// SHA-256 fingerprints of ISRG Root X1 and X2 — the roots Let's Encrypt
    /// chains to, and the only ones this app trusts.
    ///
    /// Fingerprints rather than a substring search. An earlier version of
    /// this test looked for "ISRG Root X1" in the file text, which only
    /// worked while the bundle carried a comment header naming it; once the
    /// header was stripped the assertion tested nothing but the comment.
    /// A certificate's identity is its bytes, so that is what is checked.
    const ISRG_ROOT_X1_SHA256: &str =
        "96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6";
    const ISRG_ROOT_X2_SHA256: &str =
        "69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470";

    fn der_certificates() -> Vec<Vec<u8>> {
        use base64::Engine as _;

        let mut out = Vec::new();
        let mut current: Option<String> = None;
        for line in PINNED_ROOTS_PEM.lines() {
            let line = line.trim();
            if line == "-----BEGIN CERTIFICATE-----" {
                current = Some(String::new());
            } else if line == "-----END CERTIFICATE-----" {
                if let Some(body) = current.take() {
                    let der = base64::engine::general_purpose::STANDARD
                        .decode(body)
                        .expect("embedded certificate must be valid base64");
                    out.push(der);
                }
            } else if let Some(buf) = current.as_mut() {
                buf.push_str(line);
            }
        }
        out
    }

    fn fingerprint(der: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(der);
        hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// A corrupted or emptied bundle silently disables pinning via the
    /// kill-switch, which is exactly the failure nobody notices until an exam
    /// is being intercepted. Catch it at build time instead.
    #[test]
    fn pinned_bundle_contains_both_isrg_roots() {
        let prints: Vec<String> = der_certificates().iter().map(|d| fingerprint(d)).collect();

        assert_eq!(
            prints.len(),
            2,
            "expected ISRG Root X1 and X2; a shrunken bundle means some \
             Let's Encrypt chains would be rejected mid-contest"
        );
        assert!(
            prints.iter().any(|p| p == ISRG_ROOT_X1_SHA256),
            "ISRG Root X1 is missing from the pinned bundle"
        );
        assert!(
            prints.iter().any(|p| p == ISRG_ROOT_X2_SHA256),
            "ISRG Root X2 is missing from the pinned bundle"
        );
    }

    /// The Cloud Run backend is gone. Pinning its CA would reject every call
    /// to the current API — an outage dressed as a security control.
    #[test]
    fn pinned_bundle_holds_nothing_but_those_two_roots() {
        for der in der_certificates() {
            let print = fingerprint(&der);
            assert!(
                print == ISRG_ROOT_X1_SHA256 || print == ISRG_ROOT_X2_SHA256,
                "unexpected certificate pinned: {print}"
            );
        }
    }

    /// The kill-switch is deliberate, but it must require blanking the file —
    /// never fire because of a stray edit that leaves whitespace behind.
    #[test]
    fn pinning_is_enabled_in_this_build() {
        assert!(
            !PINNED_ROOTS_PEM.trim().is_empty(),
            "pinning is disabled; this must never ship"
        );
    }

    /// The bundle must be something reqwest can actually load; a file that
    /// parses here but not there would pass CI and fail on a candidate's
    /// machine.
    #[test]
    fn reqwest_accepts_the_bundle() {
        let certs = reqwest::Certificate::from_pem_bundle(PINNED_ROOTS_PEM.as_bytes())
            .expect("embedded roots must parse");
        assert_eq!(certs.len(), 2);
    }
}
