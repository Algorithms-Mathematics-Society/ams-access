use base64::Engine as _;
use core_rs::exam::{
    evaluate_readiness, CloseAppsResult, DeviceState, EnforcementDecision, KeyboardInterceptResult,
    NetworkCheckResult, ProcessScanResult, ReadinessReport, SessionPolicy, VirtDetectionResult,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::Write;
use std::net::ToSocketAddrs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;

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

#[derive(Serialize, Deserialize, Clone)]
struct ViolationEntry {
    kind: String,
    detail: String,
    ts: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct ProctoringEventEntry {
    kind: String,
    detail: String,
    ts: u64,
    payload: serde_json::Value,
}

static VIOLATION_LOG: OnceLock<Mutex<Vec<ViolationEntry>>> = OnceLock::new();
static PROCTORING_LOG: OnceLock<Mutex<Vec<ProctoringEventEntry>>> = OnceLock::new();

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

fn violation_entry(kind: &str, detail: &str) -> ViolationEntry {
    ViolationEntry {
        kind: kind.to_string(),
        detail: detail.to_string(),
        ts: unix_ts_ms(),
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
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        if let Ok(line) = serde_json::to_string(entry) {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn record_violation(app: Option<&tauri::AppHandle>, kind: &str, detail: &str) {
    let entry = violation_entry(kind, detail);
    if let Ok(mut log) = violation_log().lock() {
        log.push(entry.clone());
    }
    persist_violation(app, &entry);
}

fn record_proctoring_event(
    app: Option<&tauri::AppHandle>,
    kind: &str,
    detail: &str,
    payload: serde_json::Value,
) {
    let entry = ProctoringEventEntry {
        kind: kind.to_string(),
        detail: detail.to_string(),
        ts: unix_ts_ms(),
        payload,
    };
    if let Ok(mut log) = proctoring_log().lock() {
        log.push(entry.clone());
    }
    persist_proctoring_event(app, &entry);
}

fn collect_fast_device_state() -> DeviceState {
    #[cfg(target_os = "windows")]
    let platform = Some(if platform_rs::windows::is_elevated() {
        "windows".to_string()
    } else {
        "windows_no_admin".to_string()
    });
    #[cfg(not(target_os = "windows"))]
    let platform = Some(std::env::consts::OS.to_string());

    #[cfg(target_os = "linux")]
    let restricted_processes = Some(platform_rs::linux::scan_processes());
    #[cfg(target_os = "windows")]
    let restricted_processes = Some(platform_rs::windows::scan_processes());
    #[cfg(target_os = "macos")]
    let restricted_processes = Some(platform_rs::macos::scan_processes());
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    let restricted_processes = Some(ProcessScanResult {
        found: vec![],
        clean: true,
    });

    #[cfg(target_os = "linux")]
    let virtualization = Some(platform_rs::linux::detect_virtualization());
    #[cfg(target_os = "windows")]
    let virtualization = Some(platform_rs::windows::detect_virtualization());
    #[cfg(target_os = "macos")]
    let virtualization = Some(platform_rs::macos::detect_virtualization());
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    let virtualization = Some(VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "unknown".to_string(),
    });

    DeviceState {
        platform,
        camera_available: None,
        microphone_available: None,
        network: None,
        keyboard: None,
        restricted_processes,
        virtualization,
    }
}

async fn collect_device_state_inner(
    network_host: Option<String>,
    camera_available: Option<bool>,
    microphone_available: Option<bool>,
    activate_keyboard: bool,
) -> DeviceState {
    let mut state = collect_fast_device_state();
    state.camera_available = camera_available;
    state.microphone_available = microphone_available;
    state.keyboard = if activate_keyboard {
        Some(enable_keyboard_intercept())
    } else {
        None
    };

    if let Some(host) = network_host.filter(|host| !host.trim().is_empty()) {
        state.network = Some(check_network_stability(host).await);
    }

    state
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Collect native and browser-supplied readiness facts without deciding policy in React.
#[tauri::command]
async fn collect_device_state(
    network_host: Option<String>,
    camera_available: Option<bool>,
    microphone_available: Option<bool>,
    activate_keyboard: Option<bool>,
) -> DeviceState {
    collect_device_state_inner(
        network_host,
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
) -> Result<ReadinessReport, String> {
    let policy = policy.unwrap_or_default();
    let report = evaluate_readiness(&policy, contest_id, device_id, &device_state);
    if report.decision == EnforcementDecision::Blocked {
        return Err(
            serde_json::to_string(&report).unwrap_or_else(|_| "readiness blocked".to_string())
        );
    }
    let _ = lock_desktop(app).await;
    Ok(report)
}

/// Scan running processes for known restricted applications.
#[tauri::command]
fn scan_processes() -> ProcessScanResult {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::scan_processes();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::scan_processes();
    #[cfg(target_os = "macos")]
    return platform_rs::macos::scan_processes();
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    ProcessScanResult {
        found: vec![],
        clean: true,
    }
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
    #[cfg(target_os = "linux")]
    let safe: Vec<String> = apps
        .into_iter()
        .filter(|n| platform_rs::linux::is_restricted_name(n))
        .collect();
    #[cfg(target_os = "windows")]
    let safe: Vec<String> = apps
        .into_iter()
        .filter(|n| platform_rs::windows::is_restricted_name(n))
        .collect();
    #[cfg(target_os = "macos")]
    let safe: Vec<String> = apps
        .into_iter()
        .filter(|n| platform_rs::macos::is_restricted_name(n))
        .collect();
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    let safe: Vec<String> = vec![];

    if safe.is_empty() {
        return CloseAppsResult {
            closed: vec![],
            failed: vec![],
        };
    }

    #[cfg(target_os = "linux")]
    return platform_rs::linux::close_apps(&safe);
    #[cfg(target_os = "windows")]
    return platform_rs::windows::close_apps(&safe);
    #[cfg(target_os = "macos")]
    return platform_rs::macos::close_apps(&safe);
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    CloseAppsResult {
        closed: vec![],
        failed: safe,
    }
}

/// Detect virtualisation / VM environment.
#[tauri::command]
fn detect_virtualization() -> VirtDetectionResult {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::detect_virtualization();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::detect_virtualization();
    #[cfg(target_os = "macos")]
    return platform_rs::macos::detect_virtualization();
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "unknown".to_string(),
    }
}

/// Install platform-level keyboard intercept.
#[tauri::command]
fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::enable_keyboard_intercept();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::enable_keyboard_intercept();
    #[cfg(target_os = "macos")]
    return platform_rs::macos::enable_keyboard_intercept();
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    KeyboardInterceptResult {
        active: false,
        method: "none".to_string(),
        platform: "unknown".to_string(),
    }
}

/// Release keyboard intercept (called on exit / crash recovery).
#[tauri::command]
fn disable_keyboard_intercept() {
    #[cfg(target_os = "linux")]
    platform_rs::linux::disable_keyboard_intercept();
    #[cfg(target_os = "windows")]
    platform_rs::windows::disable_keyboard_intercept();
    #[cfg(target_os = "macos")]
    platform_rs::macos::disable_keyboard_intercept();
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
        return false;
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

/// Check whether the privileged network helper daemon is reachable (macOS only).
#[tauri::command]
fn network_helper_running() -> bool {
    #[cfg(target_os = "macos")]
    return platform_rs::macos::network_helper_running();
    #[cfg(not(target_os = "macos"))]
    true
}

/// Install the network helper daemon and request admin credentials via the
/// standard macOS auth dialog. Resource paths are resolved inside Rust so the
/// renderer cannot choose an arbitrary root-installed binary.
#[tauri::command]
fn install_network_helper(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    let _ = app;
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

        return platform_rs::macos::install_network_helper(
            &helper_binary.to_string_lossy(),
            &plist_source.to_string_lossy(),
            &client_binary.to_string_lossy(),
        );
    }
    #[cfg(not(target_os = "macos"))]
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
async fn check_network_stability(host: String) -> NetworkCheckResult {
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
            };
        }
    };

    let quality = match latency_ms {
        0..=80 => "excellent",
        81..=200 => "good",
        201..=500 => "fair",
        _ => "poor",
    };

    NetworkCheckResult {
        reachable,
        latency_ms: Some(latency_ms),
        jitter_ms: Some(0),
        quality: quality.to_string(),
    }
}

/// Current OS identifier.
#[tauri::command]
fn get_platform() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
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
    };
    let env = get_security_environment();
    let processes = scan_processes();
    let virt = detect_virtualization();
    let network = match network_host.filter(|host| !host.trim().is_empty()) {
        Some(host) => Some(check_network_stability(host).await),
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
        }
    }

    #[cfg(target_os = "linux")]
    return platform_rs::linux::lock_desktop();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::lock_desktop();
    #[cfg(target_os = "macos")]
    return platform_rs::macos::lock_desktop();
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    false
}

/// Release full exam lockdown.
#[tauri::command]
async fn unlock_desktop(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(false);
        let _ = win.set_fullscreen(false);
    }
    #[cfg(target_os = "linux")]
    platform_rs::linux::unlock_desktop();
    #[cfg(target_os = "windows")]
    platform_rs::windows::unlock_desktop();
    #[cfg(target_os = "macos")]
    platform_rs::macos::unlock_desktop();
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

    if ips.is_empty() {
        return Err("Could not resolve any allowed domains to IPs".to_string());
    }

    #[cfg(target_os = "linux")]
    return platform_rs::linux::enable_network_lockdown(&ips).map(|_| true);
    #[cfg(target_os = "windows")]
    return platform_rs::windows::enable_network_lockdown(&ips).map(|_| true);
    #[cfg(target_os = "macos")]
    return platform_rs::macos::enable_network_lockdown(&ips).map(|_| true);

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    Err("Network lockdown not supported on this platform".to_string())
}

/// Remove all AMS firewall rules and restore normal internet access.
#[tauri::command]
async fn disable_network_lockdown() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::disable_network_lockdown().map(|_| true);
    #[cfg(target_os = "windows")]
    return platform_rs::windows::disable_network_lockdown().map(|_| true);
    #[cfg(target_os = "macos")]
    return platform_rs::macos::disable_network_lockdown().map(|_| true);

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    Err("Network lockdown not supported on this platform".to_string())
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

    let dir = if cfg!(target_os = "windows") {
        format!(
            "{}\\ams_faces",
            std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".into())
        )
    } else {
        std::env::temp_dir().join("ams_faces").display().to_string()
    };

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
    platform_rs::linux::disable_keyboard_intercept();
    #[cfg(target_os = "macos")]
    let _ = platform_rs::macos::disable_network_lockdown();
    std::process::exit(0);
}

pub fn run() {
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

    // Restore any OS state left behind by a previous crashed session — runs BEFORE
    // Tauri initialises so it can't race with the first enable_keyboard_intercept call.
    #[cfg(target_os = "linux")]
    platform_rs::linux::recover_keyboard_if_crashed();
    #[cfg(target_os = "windows")]
    platform_rs::windows::recover_registry_if_crashed();

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
            check_screen_sharing,
            get_screen_capture_permitted_apps,
            detect_active_screen_share,
            network_helper_running,
            install_network_helper,
            detect_screen_capture_active,
            apply_capture_protection,
            set_escape_blocked,
        ])
        .setup(|app| {
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
            // On macOS, WKWebView's getUserMedia() does NOT trigger the macOS TCC
            // permission dialog on its own — only a native AVCaptureDevice.requestAccess
            // call does. Fire it here so the system dialog appears on first launch
            // and the app is registered in System Settings → Privacy → Camera/Microphone.
            #[cfg(target_os = "macos")]
            platform_rs::macos::request_av_permissions();
            let _ = app;
            Ok(())
        })
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(target_os = "linux")]
                platform_rs::linux::disable_keyboard_intercept();
                #[cfg(target_os = "windows")]
                {
                    // unlock_desktop covers keyboard, sleep prevention, registry, shield, game bar
                    platform_rs::windows::unlock_desktop();
                    // Firewall rules must be cleared even on crash — intentional persistence
                    let _ = platform_rs::windows::disable_network_lockdown();
                }
                #[cfg(target_os = "macos")]
                {
                    platform_rs::macos::disable_keyboard_intercept();
                    let _ = platform_rs::macos::disable_network_lockdown();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error running AMS Access");
}
