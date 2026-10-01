//! Unix implementation of the privileged network helper.
//!
//! Runs as root (macOS: LaunchDaemon; Linux: systemd unit). The main app
//! process — which intentionally runs in the *user* session so the webview can
//! reach the camera/mic/DBus/portals — communicates over a Unix domain socket
//! at SOCKET_PATH. All firewall operations (macOS pfctl, Linux
//! iptables/ip6tables) happen here so the unprivileged app never needs root.
//!
//! Protocol (shared verbatim with the macOS/Linux clients): newline-delimited
//! JSON, one request -> one response.
//!   Request:  {"cmd":"ping"}
//!             {"cmd":"enable","ips":["1.2.3.4"],"resolvers":["9.9.9.9"]}
//!             {"cmd":"disable"}
//!   Response: {"ok":true}
//!             {"ok":false,"error":"<message>"}

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use std::net::{IpAddr, Ipv4Addr};

#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;

// Peer authorization happens inline before admission, without reading request
// bytes. Only authorized clients can occupy the bounded worker pool.
const MAX_CONNECTIONS: usize = 8;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const FIREWALL_TIMEOUT: Duration = Duration::from_secs(8);
thread_local! {
    static FIREWALL_DEADLINE: std::cell::Cell<Option<Instant>> = const { std::cell::Cell::new(None) };
}
struct FirewallDeadline(Option<Instant>);
impl FirewallDeadline {
    fn begin() -> Self {
        Self(FIREWALL_DEADLINE.with(|slot| slot.replace(Some(Instant::now() + FIREWALL_TIMEOUT))))
    }
}
impl Drop for FirewallDeadline {
    fn drop(&mut self) {
        FIREWALL_DEADLINE.with(|slot| slot.set(self.0));
    }
}
fn command_budget() -> std::io::Result<Duration> {
    FIREWALL_DEADLINE.with(|slot| match slot.get() {
        Some(deadline) => deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .map(|left| left.min(COMMAND_TIMEOUT))
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "firewall operation timed out; restore system settings to retry",
                )
            }),
        None => Ok(COMMAND_TIMEOUT),
    })
}
fn command_output(
    command: &mut Command,
    input: Option<&[u8]>,
) -> std::io::Result<std::process::Output> {
    crate::process_runner::output(command, command_budget()?, input)
}

struct ConnectionLimiter {
    active: AtomicUsize,
    limit: usize,
}
impl ConnectionLimiter {
    fn new(limit: usize) -> Self {
        Self {
            active: AtomicUsize::new(0),
            limit,
        }
    }
    fn try_acquire(self: &Arc<Self>) -> Option<ConnectionPermit> {
        self.active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < self.limit).then_some(active + 1)
            })
            .ok()
            .map(|_| ConnectionPermit(self.clone()))
    }
}
struct ConnectionPermit(Arc<ConnectionLimiter>);
impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}

// ── Socket path (per-OS) ──────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
const SOCKET_PATH: &str = "/private/var/run/ams-proctor.sock";

// On Linux /run is the canonical tmpfs for runtime sockets; /var/run is a
// compatibility symlink to it on every modern distro. We bind /run and fall
// back to /var/run only if /run is somehow absent.
#[cfg(target_os = "linux")]
const SOCKET_PATH: &str = "/run/ams-proctor.sock";
#[cfg(target_os = "linux")]
const SOCKET_PATH_FALLBACK: &str = "/var/run/ams-proctor.sock";

#[cfg(target_os = "macos")]
const CLIENT_CONFIG_PATH: &str =
    "/Library/Application Support/AMS Access/network-helper-client.conf";

// Root-written file holding the absolute path of the authorized client binary.
// Present only when `install_network_helper` could pin a stable install path
// (.deb/.rpm). Absent for ephemeral installs (AppImage), where we fall back to
// the exe-basename allowlist. See `authorize_client`.
#[cfg(target_os = "linux")]
const CLIENT_CONFIG_PATH: &str = "/etc/ams-access/network-helper-client.conf";

#[cfg(target_os = "macos")]
const PFCTL: &str = "/sbin/pfctl";
#[cfg(target_os = "macos")]
const ANCHOR: &str = "com.apple/amsaccess.proctor";
#[cfg(target_os = "macos")]
const LEGACY_ANCHOR: &str = "com.amsaccess.proctor";

#[cfg(target_os = "linux")]
const IPTABLES: &str = "iptables";
#[cfg(target_os = "linux")]
const IP6TABLES: &str = "ip6tables";
#[cfg(target_os = "linux")]
const CHAIN: &str = "AMS_PROCTOR";

#[cfg(target_os = "linux")]
const MARKER_PATH: &str = "/run/ams-proctor.lock";

/// Persisted lockdown state. Lives in /run (tmpfs) so it shares the iptables
/// rules' boot-scoped lifetime: a reboot clears both; a same-boot helper
/// restart preserves both.
#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Marker {
    token: String,
    ips: Vec<String>,
    /// Resolvers, so a restart re-applies the same port scoping rather than
    /// silently widening them back to full access. `default` so a marker
    /// written by an older helper still deserialises instead of being read as
    /// Corrupt, which would leave a live exam's rules untouched.
    #[serde(default)]
    resolvers: Vec<String>,
    /// Durable cleanup intent: a timed-out restore must not be re-applied on restart.
    #[serde(default)]
    disabling: bool,
}

#[cfg(target_os = "linux")]
#[derive(Debug, PartialEq)]
enum MarkerState {
    Absent,
    Present(Marker),
    Corrupt,
}

#[cfg(target_os = "linux")]
#[derive(Debug, PartialEq)]
enum StartupAction {
    ReApply(Vec<String>, Vec<String>),
    Flush,
    LeaveAsIs,
}

#[cfg(target_os = "linux")]
#[derive(Debug, PartialEq)]
enum DisableDecision {
    Proceed,
    Reject,
    NoOp,
}

/// Decide what a starting daemon should do with the firewall. Fail-closed:
/// only a confidently-absent marker permits a flush.
#[cfg(target_os = "linux")]
fn startup_action(state: MarkerState) -> StartupAction {
    match state {
        MarkerState::Present(m) if m.disabling => StartupAction::Flush,
        MarkerState::Present(m) => StartupAction::ReApply(m.ips, m.resolvers),
        MarkerState::Absent => StartupAction::Flush,
        MarkerState::Corrupt => StartupAction::LeaveAsIs,
    }
}

/// Authorize a disable request against the stored marker. Only the owning
/// session's exact, non-empty token may lift an active lockdown.
#[cfg(target_os = "linux")]
fn authorize_disable(stored: Option<&Marker>, presented_token: &str) -> DisableDecision {
    match stored {
        None => DisableDecision::NoOp,
        Some(m) if !presented_token.is_empty() && m.token == presented_token => {
            DisableDecision::Proceed
        }
        Some(_) => DisableDecision::Reject,
    }
}

#[cfg(target_os = "linux")]
fn read_marker_at(path: &std::path::Path) -> MarkerState {
    match std::fs::read_to_string(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => MarkerState::Absent,
        Err(_) => MarkerState::Corrupt, // exists but unreadable → fail-closed
        Ok(s) => match serde_json::from_str::<Marker>(&s) {
            Ok(m) => MarkerState::Present(m),
            Err(_) => MarkerState::Corrupt,
        },
    }
}

/// Atomic write: a temp file in the same dir + rename, created 0600 so the
/// token is never world-readable and a reader never sees a half-written file.
#[cfg(target_os = "linux")]
fn write_marker_at(path: &std::path::Path, marker: &Marker) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let json = serde_json::to_string(marker).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

#[cfg(target_os = "linux")]
fn remove_marker_at(path: &std::path::Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "linux")]
fn read_marker() -> MarkerState {
    read_marker_at(std::path::Path::new(MARKER_PATH))
}

#[cfg(target_os = "linux")]
fn write_marker(marker: &Marker) -> std::io::Result<()> {
    write_marker_at(std::path::Path::new(MARKER_PATH), marker)
}

#[cfg(target_os = "linux")]
fn remove_marker() -> Result<(), String> {
    remove_marker_at(std::path::Path::new(MARKER_PATH))
        .map_err(|error| format!("firewall restored but recovery marker cleanup failed: {error}"))
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Request {
    Ping,
    Enable {
        ips: Vec<String>,
        /// DNS resolvers, allowed on port 53/853 ONLY.
        ///
        /// Optional so an older client that sends everything in `ips` keeps
        /// working — it simply gets the previous, unscoped behaviour rather
        /// than losing DNS entirely.
        #[serde(default)]
        resolvers: Vec<String>,
        #[serde(default)]
        token: String,
    },
    Disable {
        #[serde(default)]
        token: String,
    },
}

#[derive(Serialize)]
struct Response<'a> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

pub fn run() {
    let socket_path = bind_socket_path();
    let _ = std::fs::remove_file(socket_path);

    // Close the mode TOCTOU: a socket node is created with `0777 & ~umask`, so
    // without this the node would briefly be world-accessible between bind() and
    // the secure_socket() chmod below. Tighten the umask to 0o177 FIRST so the
    // node is born 0600. Linux-only — macOS intentionally serves an 0660
    // root:staff socket and relies on the per-connection peer check.
    #[cfg(target_os = "linux")]
    unsafe {
        libc::umask(0o177);
    }

    let listener = UnixListener::bind(socket_path).expect("AMS helper: failed to bind Unix socket");

    secure_socket(socket_path);

    // Marker-driven recovery (fail-closed). A starting daemon may be a reboot
    // (no marker → flush stale rules) OR a same-boot restart mid-exam (marker
    // present → re-apply, never drop the live lockdown). An unreadable marker
    // leaves existing rules untouched.
    #[cfg(target_os = "linux")]
    {
        let _guard = FIREWALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _deadline = FirewallDeadline::begin();
        match startup_action(read_marker()) {
            StartupAction::ReApply(ips, resolvers) => {
                let full: Vec<String> = ips
                    .iter()
                    .filter(|ip| !resolvers.contains(ip))
                    .cloned()
                    .collect();
                if let Err(e) = iptables_enable(&full, &resolvers) {
                    eprintln!("AMS helper: startup re-apply failed (rules left as-is): {e}");
                }
            }
            StartupAction::Flush => match finish_cleanup(iptables_disable, remove_marker) {
                Ok(()) => (),
                Err(error) => eprintln!(
                    "AMS helper: startup cleanup incomplete; recovery marker retained: {error}"
                ),
            },
            StartupAction::LeaveAsIs => {
                eprintln!(
                    "AMS helper: lock file unreadable at startup; leaving existing \
                     firewall in place (fail-closed)"
                );
            }
        }
    }

    eprintln!("AMS network helper ready on {socket_path}");

    let connections = Arc::new(ConnectionLimiter::new(MAX_CONNECTIONS));
    for stream in listener.incoming() {
        match stream {
            // Authenticate without reading peer-controlled data, before taking
            // a worker slot. Unauthorized peers get no blocking response write.
            Ok(s) => {
                let Some(permit) = admit_client(&s, &connections, authorize_client) else {
                    continue;
                };
                if let Err(e) = std::thread::Builder::new()
                    .name("ams-helper-client".into())
                    .spawn(move || {
                        let _permit = permit;
                        handle_client(s);
                    })
                {
                    // A failed spawn drops its closure, releasing the permit.
                    eprintln!("AMS helper worker spawn error: {e}");
                }
            }
            Err(e) => eprintln!("AMS helper accept error: {e}"),
        }
    }
}

/// Pick the socket path to bind. On Linux prefer /run, fall back to /var/run if
/// its parent directory is missing.
fn bind_socket_path() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        if std::path::Path::new("/run").is_dir() {
            SOCKET_PATH
        } else {
            SOCKET_PATH_FALLBACK
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        SOCKET_PATH
    }
}

/// Lock the socket down so only root (and, on macOS, the staff-group user
/// session app, which is then PID-authorized) can talk to it.
fn secure_socket(socket_path: &str) {
    #[cfg(target_os = "macos")]
    {
        // The socket is reachable by interactive users, but each accepted peer
        // is checked against the root-installed app executable path before any
        // command runs (see authorize_client).
        let _ = std::fs::set_permissions(socket_path, PermissionsExt::from_mode(0o660));
        let _ = command_output(
            Command::new("/usr/sbin/chown").args(["root:staff", socket_path]),
            None,
        );
    }
    #[cfg(target_os = "linux")]
    {
        // 0666, root-owned. The helper runs as root and owns the socket, but the
        // unprivileged user-session app must be able to connect() before the
        // SO_PEERCRED + pinned-exe check in authorize_client can run. A 0600
        // socket EACCESes that connect() in the kernel, so the peer check — the
        // REAL gate — would never execute and no client could ever talk to the
        // helper. 0666 lets any local process connect; only the root-pinned
        // client binary is then actually authorized (mirrors the macOS 0660
        // socket, which likewise relies on the per-connection peer check).
        let _ = std::fs::set_permissions(socket_path, PermissionsExt::from_mode(0o666));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = std::fs::set_permissions(socket_path, PermissionsExt::from_mode(0o600));
    }
}

fn admit_client(
    stream: &UnixStream,
    connections: &Arc<ConnectionLimiter>,
    authorize: impl FnOnce(&UnixStream) -> Result<(), String>,
) -> Option<ConnectionPermit> {
    authorize(stream).ok()?;
    let permit = connections.try_acquire();
    if permit.is_none() {
        // A small nonblocking reply to an authenticated peer. The accept loop
        // never waits for it, and no request has been read or dispatched.
        if stream.set_nonblocking(true).is_ok() {
            let _ = (&*stream).write_all(b"{\"ok\":false,\"error\":\"helper_busy\"}\n");
        }
    }
    permit
}

fn handle_client(stream: UnixStream) {
    serve_client(stream, REQUEST_TIMEOUT, authorize_client, dispatch);
}

/// Authorization precedes request reads and dispatch. Callbacks allow tests to
/// exercise framing/lifecycle without inspecting real peers or running firewall
/// commands. OS socket deadlines cover both authorized and denied peers.
fn serve_client(
    stream: UnixStream,
    request_timeout: Duration,
    authorize: impl FnOnce(&UnixStream) -> Result<(), String>,
    mut execute: impl FnMut(&str) -> String,
) {
    if stream.set_read_timeout(Some(request_timeout)).is_err()
        || stream.set_write_timeout(Some(WRITE_TIMEOUT)).is_err()
    {
        return;
    }
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(e) => {
            eprintln!("AMS helper stream clone error: {e}");
            return;
        }
    };
    if let Err(e) = authorize(&stream) {
        let _ = writeln!(writer, "{}", json_err(&e));
        return;
    }
    let mut reader = BufReader::new(stream);
    loop {
        match read_request(&mut reader, request_timeout) {
            Ok(Some(line)) => {
                let response = execute(&line);
                if writeln!(writer, "{response}").is_err() {
                    break;
                }
            }
            Ok(None) => break,
            Err(error) => {
                // Do not echo attacker-controlled bytes or keep consuming an
                // oversized frame. Discard the connection after one error.
                let _ = writeln!(writer, "{}", json_err(&error.to_string()));
                break;
            }
        }
    }
}

/// Read one complete newline-delimited request with bounded allocation and a
/// total framing deadline. Resetting only an idle timeout would allow a peer
/// sending one byte at a time to retain its slot indefinitely.
fn read_request(
    reader: &mut BufReader<UnixStream>,
    timeout: Duration,
) -> std::io::Result<Option<String>> {
    let deadline = Instant::now() + timeout;
    let mut line = Vec::new();
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|remaining| !remaining.is_zero())
            .ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::TimedOut, "request timed out")
            })?;
        reader.get_ref().set_read_timeout(Some(remaining))?;
        let available = match reader.fill_buf() {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        };
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "incomplete request",
                ))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(available.len(), |position| position + 1);
        if line.len() + count > MAX_REQUEST_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "request exceeds size limit",
            ));
        }
        line.extend_from_slice(&available[..count]);
        reader.consume(count);
        if newline.is_some() {
            line.pop(); // newline
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            return String::from_utf8(line).map(Some).map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "request is not UTF-8")
            });
        }
    }
}

// ── Authorization ─────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn authorize_client(stream: &UnixStream) -> Result<(), String> {
    let expected = std::fs::read_to_string(CLIENT_CONFIG_PATH)
        .map_err(|e| format!("read client config: {e}"))?
        .trim()
        .to_string();
    if expected.is_empty() {
        return Err("client config is empty".to_string());
    }

    let pid = peer_pid(stream)?;
    let actual = pid_path(pid)?;
    if actual == expected {
        Ok(())
    } else {
        Err("unauthorized client".to_string())
    }
}

/// Linux peer authorization via SO_PEERCRED.
///
/// The kernel stamps every Unix-socket peer with the credentials it had at
/// `connect(2)` time (`struct ucred { pid, uid, gid }`), which the connecting
/// process cannot forge. We:
///   1. Require readable credentials — refuse the connection if the kernel
///      cannot give us a ucred (should never happen for AF_UNIX, but if it does
///      we fail closed rather than open).
///   2. Resolve the peer's executable via `readlink /proc/<pid>/exe`.
///      - If a root-written `CLIENT_CONFIG_PATH` exists (written by
///        `install_network_helper` for stable installs), require the peer's
///        FULL resolved path to equal the pinned path — macOS parity, the strong
///        mode. A mismatch fails closed (we do NOT silently downgrade to the
///        basename check, or pinning would be pointless).
///      - If the config is ABSENT (ephemeral installs such as AppImage, whose
///        mount path changes every run, so a pinned path could not be honored),
///        fall back to requiring the exe BASENAME to be the AMS Access binary.
///
/// Honest residual weakness in the fallback (no-config) mode: a local process
/// whose exe basename matches `EXPECTED_CLIENT_BASENAMES` on the same host could
/// impersonate the client. Linux permits user-session clients to connect at
/// the filesystem layer; that fallback therefore relies on the basename check.
/// Pinning a stable executable path removes this particular fallback weakness.
#[cfg(target_os = "linux")]
fn authorize_client(stream: &UnixStream) -> Result<(), String> {
    // Expected basenames for the AMS Access client binary. `ams-access` is the
    // Cargo bin/product name; the dev binary and the packaged binary share it.
    const EXPECTED_CLIENT_BASENAMES: &[&str] = &["ams-access", "AMS Access"];

    #[repr(C)]
    struct Ucred {
        pid: libc::pid_t,
        uid: libc::uid_t,
        gid: libc::gid_t,
    }

    let mut cred = Ucred {
        pid: 0,
        uid: 0,
        gid: 0,
    };
    let mut len = std::mem::size_of::<Ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            (&mut cred as *mut Ucred).cast(),
            &mut len,
        )
    };
    if rc != 0 || cred.pid <= 0 {
        return Err("unable to read peer credentials".to_string());
    }

    // Resolve the peer executable. A dead/zombie peer or a hidden /proc (e.g.
    // hidepid=2 in a namespace) makes this unreadable → fail closed.
    let exe = std::fs::read_link(format!("/proc/{}/exe", cred.pid))
        .map_err(|e| format!("resolve peer exe (/proc/{}/exe): {e}", cred.pid))?;
    // `readlink` may append " (deleted)" if the binary was replaced after exec.
    let exe_path = exe.to_string_lossy().replace(" (deleted)", "");

    // Strong mode: a pinned absolute path was installed → require an exact match.
    if let Ok(pinned) = std::fs::read_to_string(CLIENT_CONFIG_PATH) {
        let pinned = pinned.trim();
        if !pinned.is_empty() {
            return if exe_path == pinned {
                Ok(())
            } else {
                Err(format!(
                    "unauthorized client: peer exe {exe_path:?} does not match pinned client path {pinned:?}"
                ))
            };
        }
    }

    // Fallback mode (no pinned path): basename allowlist.
    let basename = std::path::Path::new(&exe_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if EXPECTED_CLIENT_BASENAMES
        .iter()
        .any(|expected| basename == *expected)
    {
        Ok(())
    } else {
        Err(format!(
            "unauthorized client: peer exe basename {basename:?} not in allowlist"
        ))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn authorize_client(_stream: &UnixStream) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn peer_pid(stream: &UnixStream) -> Result<libc::pid_t, String> {
    const LOCAL_PEERPID: libc::c_int = 2;

    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            0,
            LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut len,
        )
    };

    if rc == 0 && pid > 0 {
        Ok(pid)
    } else {
        Err("unable to identify client process".to_string())
    }
}

#[cfg(target_os = "macos")]
fn pid_path(pid: libc::pid_t) -> Result<String, String> {
    const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

    extern "C" {
        fn proc_pidpath(
            pid: libc::c_int,
            buffer: *mut libc::c_void,
            buffersize: u32,
        ) -> libc::c_int;
    }

    let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    let len = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if len <= 0 {
        return Err("unable to resolve client process path".to_string());
    }
    buf.truncate(len as usize);
    String::from_utf8(buf).map_err(|_| "client process path is not utf-8".to_string())
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

fn dispatch(json: &str) -> String {
    let _deadline = FirewallDeadline::begin();
    match serde_json::from_str::<Request>(json.trim()) {
        Ok(Request::Ping) => json_ok(),
        Ok(Request::Enable {
            ips,
            resolvers,
            token,
        }) => {
            let result = {
                #[cfg(target_os = "linux")]
                {
                    firewall_enable(&ips, &resolvers, &token)
                }
                #[cfg(not(target_os = "linux"))]
                {
                    let _ = (&token, &resolvers);
                    firewall_enable(&ips)
                }
            };
            match result {
                Ok(()) => json_ok(),
                Err(e) => json_err(&e),
            }
        }
        Ok(Request::Disable { token }) => {
            let result = {
                #[cfg(target_os = "linux")]
                {
                    firewall_disable(&token)
                }
                #[cfg(not(target_os = "linux"))]
                {
                    let _ = &token;
                    firewall_disable()
                }
            };
            match result {
                Ok(()) => json_ok(),
                Err(e) => json_err(&e),
            }
        }
        Err(e) => json_err(&format!("invalid request: {e}")),
    }
}

#[cfg(target_os = "macos")]
fn firewall_enable(ips: &[String]) -> Result<(), String> {
    let _guard = acquire_firewall(&FIREWALL_LOCK)?;
    let ips = validate_ipv4_allowlist(ips)?;
    pfctl_enable(&ips)
}

#[cfg(target_os = "macos")]
fn firewall_disable() -> Result<(), String> {
    let _guard = acquire_firewall(&FIREWALL_LOCK)?;
    pfctl_disable()
}

static FIREWALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn acquire_firewall(lock: &std::sync::Mutex<()>) -> Result<std::sync::MutexGuard<'_, ()>, String> {
    match lock.try_lock() {
        Ok(guard) => Ok(guard),
        Err(std::sync::TryLockError::WouldBlock) => Err("helper_busy".into()),
        // A prior worker panic must not permanently prevent explicit recovery.
        // Each transaction re-reads its durable marker and verifies OS results.
        Err(std::sync::TryLockError::Poisoned(error)) => Ok(error.into_inner()),
    }
}

/// Marker-first enable: persist intent, then apply. A crash between the two
/// leaves a marker → next startup re-applies (fail-closed). An apply failure
/// persists cleanup intent and retains the recovery capability.
#[cfg(target_os = "linux")]
fn firewall_enable(ips: &[String], resolvers: &[String], token: &str) -> Result<(), String> {
    let _guard = acquire_firewall(&FIREWALL_LOCK)?;
    let marker = Marker {
        disabling: false,
        token: token.to_string(),
        ips: ips.to_vec(),
        resolvers: resolvers.to_vec(),
    };
    write_marker(&marker).map_err(|e| format!("write marker: {e}"))?;

    // A resolver named in BOTH lists must not also get a full-access rule, or
    // the wide rule wins and the scoping is decorative. The client sends
    // resolvers in both so an older helper still resolves DNS; here they are
    // removed from the unrestricted set and re-added port-scoped below.
    let full: Vec<String> = ips
        .iter()
        .filter(|ip| !resolvers.contains(ip))
        .cloned()
        .collect();

    if let Err(e) = iptables_enable(&full, resolvers) {
        // The deadline may have stopped rollback midway. Preserve the token
        // and cleanup intent; never hide potentially surviving kernel rules.
        let mut cleanup = marker;
        cleanup.disabling = true;
        if let Err(journal) = write_marker(&cleanup) {
            return Err(format!("{e}; could not persist cleanup intent: {journal}"));
        }
        return Err(e);
    }
    Ok(())
}

/// Token-gated restore. Journal cleanup intent before mutation and clear the
/// marker only after verified teardown. Restart retries cleanup, never reapply.
#[cfg(target_os = "linux")]
fn firewall_disable(token: &str) -> Result<(), String> {
    let _guard = acquire_firewall(&FIREWALL_LOCK)?;
    let state = read_marker();
    let stored = match &state {
        MarkerState::Present(m) => Some(m),
        MarkerState::Absent => None,
        // Unreadable lock: cannot authorize, leave rules in place (fail-closed).
        MarkerState::Corrupt => return Err("disable refused: lock state unreadable".to_string()),
    };
    match authorize_disable(stored, token) {
        DisableDecision::NoOp => iptables_disable(),
        DisableDecision::Reject => Err("unauthorized disable: token mismatch".to_string()),
        DisableDecision::Proceed => {
            let mut cleanup = stored.expect("authorized marker exists").clone();
            cleanup.disabling = true;
            write_marker(&cleanup).map_err(|error| format!("persist cleanup intent: {error}"))?;
            finish_cleanup(iptables_disable, remove_marker)
        }
    }
}

#[cfg(target_os = "linux")]
fn finish_cleanup(
    cleanup: impl FnOnce() -> Result<(), String>,
    clear: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    cleanup()?;
    clear()
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn firewall_enable(_ips: &[String]) -> Result<(), String> {
    Err("network lockdown not supported on this platform".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn firewall_disable() -> Result<(), String> {
    Ok(())
}

fn json_ok() -> String {
    serde_json::to_string(&Response {
        ok: true,
        error: None,
    })
    .unwrap_or_else(|_| r#"{"ok":true}"#.to_string())
}

fn json_err(msg: &str) -> String {
    serde_json::to_string(&Response {
        ok: false,
        error: Some(msg),
    })
    .unwrap_or_else(|_| r#"{"ok":false,"error":"serialization failed"}"#.to_string())
}

// ── macOS firewall (pfctl) ────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn validate_ipv4_allowlist(ips: &[String]) -> Result<Vec<Ipv4Addr>, String> {
    let mut out = Vec::new();
    for raw in ips {
        match raw.parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) if !out.contains(&ip) => out.push(ip),
            Ok(IpAddr::V4(_)) => {}
            Ok(IpAddr::V6(_)) => {}
            Err(_) => return Err(format!("invalid allowed IP: {raw}")),
        }
    }

    if out.is_empty() {
        Err("no IPv4 addresses available for lockdown allowlist".to_string())
    } else {
        Ok(out)
    }
}

#[cfg(target_os = "macos")]
fn pfctl_load_anchor(anchor: &str, rules: &str) -> Result<(), String> {
    let out = command_output(
        Command::new(PFCTL).args(["-a", anchor, "-f", "-"]),
        Some(rules.as_bytes()),
    )
    .map_err(|e| format!("pfctl -f: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn pfctl_enable(ips: &[Ipv4Addr]) -> Result<(), String> {
    let enabled = command_output(Command::new(PFCTL).arg("-e"), None)
        .map_err(|error| format!("pfctl enable: {error}"))?;
    if !enabled.status.success()
        && !String::from_utf8_lossy(&enabled.stderr)
            .to_ascii_lowercase()
            .contains("already enabled")
    {
        return Err(format!(
            "pfctl enable failed: {}",
            String::from_utf8_lossy(&enabled.stderr).trim()
        ));
    }

    let ip_list = ips
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ");

    let rules = format!(
        "table <ams_allowed> persist {{ {ip_list} }}\n\
         pass out quick on lo0 all\n\
         pass out quick inet to <ams_allowed>\n\
         block out quick inet all\n\
         block out quick inet6 all\n"
    );

    // macOS' stock pf.conf evaluates com.apple/* anchors. Loading under that
    // namespace avoids editing /etc/pf.conf while still making the rules active.
    pfctl_load_anchor(ANCHOR, &rules)
}

#[cfg(target_os = "macos")]
fn pfctl_disable() -> Result<(), String> {
    let mut errors = Vec::new();
    for anchor in [ANCHOR, LEGACY_ANCHOR, "com.amsaccess.proctor6"] {
        let flushed = command_output(Command::new(PFCTL).args(["-a", anchor, "-F", "all"]), None);
        // A missing/empty anchor is harmless only when a read confirms it has
        // no filter rules. Error text mentioning "anchor" is not confirmation.
        let verified = command_output(Command::new(PFCTL).args(["-a", anchor, "-sr"]), None);
        let empty = verified.as_ref().is_ok_and(|out| {
            out.status.success() && out.stdout.iter().all(u8::is_ascii_whitespace)
        });
        if !empty {
            errors.push(format!(
                "could not verify restoration of {anchor}: flush={flushed:?}; verify={verified:?}"
            ));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

// ── Linux firewall (iptables + ip6tables) ─────────────────────────────────────

#[cfg(target_os = "linux")]
fn run_tables(bin: &str, args: &[&str]) -> Result<std::process::Output, String> {
    command_output(Command::new(bin).args(args), None)
        .map_err(|e| format!("{bin} {}: {e}", args.join(" ")))
}

/// Verify scoped chain removal. A failed command is not proof of absence.
#[cfg(target_os = "linux")]
fn teardown_chain(bin: &str) -> Result<(), String> {
    teardown_with(|args| run_tables(bin, args))
}

#[cfg(target_os = "linux")]
fn teardown_with(
    mut run: impl FnMut(&[&str]) -> Result<std::process::Output, String>,
) -> Result<(), String> {
    let initial = run(&["-S"])?;
    if !initial.status.success() {
        return Err("cannot inspect firewall rules".into());
    }
    let rules = String::from_utf8_lossy(&initial.stdout);
    let jumps = rules
        .lines()
        .filter(|line| *line == "-A OUTPUT -j AMS_PROCTOR")
        .count();
    if jumps > 64 {
        return Err("unexpected number of AMS firewall jumps; recovery required".into());
    }
    for _ in 0..jumps {
        let result = run(&["-D", "OUTPUT", "-j", CHAIN])?;
        if !result.status.success() {
            return Err("could not detach AMS firewall chain".into());
        }
    }
    if rules.lines().any(|line| line == "-N AMS_PROCTOR") {
        for operation in ["-F", "-X"] {
            let result = run(&[operation, CHAIN])?;
            if !result.status.success() {
                return Err(format!("firewall cleanup {operation} failed"));
            }
        }
    }
    let final_rules = run(&["-S"])?;
    if !final_rules.status.success() {
        return Err("cannot verify firewall restoration".into());
    }
    if String::from_utf8_lossy(&final_rules.stdout)
        .lines()
        .any(|line| {
            line == "-N AMS_PROCTOR"
                || line
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .windows(2)
                    .any(|pair| matches!(pair[0], "-j" | "-g") && pair[1] == CHAIN)
        })
    {
        return Err("AMS firewall rules remain; retry restoring system settings".into());
    }
    Ok(())
}

/// Build the AMS_PROCTOR chain in `bin` (iptables OR ip6tables), allowing only
/// the given same-family IP strings, and hook it into OUTPUT at position 1.
#[cfg(target_os = "linux")]
fn build_chain(bin: &str, allowed: &[&str], resolvers: &[&str]) -> Result<(), String> {
    // Fresh chain (teardown already ran).
    let out = run_tables(bin, &["-N", CHAIN])?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        if !msg.contains("Chain already exists") {
            return Err(format!("{bin} -N failed: {}", msg.trim()));
        }
    }

    // Loopback always passes.
    let out = run_tables(bin, &["-A", CHAIN, "-o", "lo", "-j", "ACCEPT"])?;
    if !out.status.success() {
        return Err(format!(
            "{bin} loopback rule failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // Keep already-established connections alive so the exam session does not
    // drop the instant the default-DROP rule lands. Use the modern `conntrack`
    // match (xt_conntrack), NOT the legacy `state` match (xt_state): on
    // nft-backend distros xt_state is typically neither loaded nor built-in, and
    // the helper's systemd unit drops CAP_SYS_MODULE, so iptables' lazy autoload
    // of xt_state fails ("Couldn't load match `state'") and the whole enable
    // aborts. xt_conntrack is already loaded wherever conntrack is in use.
    let out = run_tables(
        bin,
        &[
            "-A",
            CHAIN,
            "-m",
            "conntrack",
            "--ctstate",
            "ESTABLISHED,RELATED",
            "-j",
            "ACCEPT",
        ],
    )?;
    if !out.status.success() {
        return Err(format!(
            "{bin} established rule failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // Allow each same-family whitelisted IP.
    for ip in allowed {
        let out = run_tables(bin, &["-A", CHAIN, "-d", ip, "-j", "ACCEPT"])?;
        if !out.status.success() {
            return Err(format!(
                "{bin} allow {ip} failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    // Resolvers get DNS ports ONLY, never a bare `-d`.
    //
    // An unscoped `-d <resolver> -j ACCEPT` was a complete egress bypass. A
    // candidate installing at home is root on their own laptop: writing
    // `nameserver 203.0.113.7` into /etc/resolv.conf before launch allowlisted
    // an arbitrary internet host on *every port and protocol* — SSH, WireGuard,
    // a plain HTTP proxy — while the UI reported the lockdown engaged and the
    // readiness report recorded a pass. Every other defect here costs one
    // candidate their exam; that one cost the contest its integrity.
    //
    // 853 is DNS-over-TLS: omitting it would break resolution on hosts
    // configured for DoT, which is the failure mode that tempts someone to
    // widen this back out again.
    for ip in resolvers {
        for (proto, port) in [("udp", "53"), ("tcp", "53"), ("tcp", "853")] {
            let out = run_tables(
                bin,
                &[
                    "-A", CHAIN, "-d", ip, "-p", proto, "--dport", port, "-j", "ACCEPT",
                ],
            )?;
            if !out.status.success() {
                return Err(format!(
                    "{bin} allow resolver {ip} {proto}/{port} failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
        }
    }

    // Drop everything else.
    let out = run_tables(bin, &["-A", CHAIN, "-j", "DROP"])?;
    if !out.status.success() {
        return Err(format!(
            "{bin} DROP rule failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    // Hook into OUTPUT at position 1 (evaluated first).
    let out = run_tables(bin, &["-I", "OUTPUT", "1", "-j", CHAIN])?;
    if !out.status.success() {
        return Err(format!(
            "{bin} OUTPUT hook failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    Ok(())
}

/// Apply the outbound firewall for BOTH families. Each allowed IP string is
/// parsed and routed to iptables (v4) or ip6tables (v6); feeding a v6 literal to
/// the v4 binary errors, which is exactly the LX-4 bug we are fixing.
/// Split a mixed allowlist into (IPv4, IPv6) literals, deduping each family.
/// An unparseable entry is a hard error — never silently dropped, so a malformed
/// allowlist can't accidentally widen the firewall. Pure (no I/O) so it is unit
/// tested directly; `iptables_enable` is the only caller.
#[cfg(target_os = "linux")]
fn split_ip_families(ips: &[String]) -> Result<(Vec<String>, Vec<String>), String> {
    use std::net::IpAddr;

    let mut v4: Vec<String> = Vec::new();
    let mut v6: Vec<String> = Vec::new();
    for raw in ips {
        match raw.parse::<IpAddr>() {
            Ok(IpAddr::V4(_)) => {
                if !v4.contains(raw) {
                    v4.push(raw.clone());
                }
            }
            Ok(IpAddr::V6(_)) => {
                if !v6.contains(raw) {
                    v6.push(raw.clone());
                }
            }
            Err(_) => return Err(format!("invalid allowed IP: {raw}")),
        }
    }
    Ok((v4, v6))
}

/// True IFF the kernel IPv6 stack is loaded. `/proc/sys/net/ipv6` is created by
/// the kernel exactly when the `ipv6` module is present; it is absent on hosts
/// booted with `ipv6.disable=1` or built without IPv6. This is a robust, pure
/// (modulo the filesystem) signal — far more reliable than probing for the
/// `ip6tables` binary, which may exist while the stack itself is gone.
#[cfg(target_os = "linux")]
fn ipv6_stack_present() -> bool {
    std::path::Path::new("/proc/sys/net/ipv6").is_dir()
}

/// Pure decision: given whether the IPv6 stack is present, should we build the
/// v6 DROP chain? We build it whenever IPv6 is present — even with an empty v6
/// allow-list — so a dual-stack host that only allow-lists v4 IPs still blocks
/// all v6 egress. We skip ONLY when the stack is absent (nothing can leak).
/// Factored out so the branch logic is unit-testable without shelling out.
#[cfg(target_os = "linux")]
fn should_build_v6_chain(ipv6_present: bool) -> bool {
    ipv6_present
}

#[cfg(target_os = "linux")]
fn iptables_enable(ips: &[String], resolvers: &[String]) -> Result<(), String> {
    // Family-split first so a v6 literal can never reach the v4 binary (LX-4).
    let (v4, v6) = split_ip_families(ips)?;
    let (r4, r6) = split_ip_families(resolvers)?;
    let v4: Vec<&str> = v4.iter().map(String::as_str).collect();
    let v6: Vec<&str> = v6.iter().map(String::as_str).collect();
    let r4: Vec<&str> = r4.iter().map(String::as_str).collect();
    let r6: Vec<&str> = r6.iter().map(String::as_str).collect();

    // Refuse a degenerate allowlist: with no allowed destinations in either
    // family this would build a loopback+established+DROP chain — a near-total
    // egress block that also cuts the exam's own API. Almost certainly a caller
    // bug; fail closed with an error rather than silently applying it (parity
    // with the macOS validate_ipv4_allowlist empty-list rejection).
    // Resolvers count toward "not degenerate": they are now a separate list, so
    // checking only `v4`/`v6` would reject a legitimate DNS-only allowlist that
    // previously passed.
    if v4.is_empty() && v6.is_empty() && r4.is_empty() && r6.is_empty() {
        return Err("empty allowlist: refusing to apply a near-total egress block".to_string());
    }

    // Idempotent: clear any leftovers in both tables first.
    iptables_disable()?;

    // Build v4. If this fails, roll back so we never leave a half-applied
    // (and therefore unpredictable) firewall. v4 failure is ALWAYS fatal.
    if let Err(e) = build_chain(IPTABLES, &v4, &r4) {
        let _ = teardown_chain(IPTABLES);
        return Err(e);
    }

    // Build v6 — but only if the kernel actually has an IPv6 stack. On a host
    // booted `ipv6.disable=1` (or without `ip6_tables`), `ip6tables -N` exits
    // non-zero, which previously hard-blocked launch even though there is no
    // IPv6 egress to leak. We distinguish the two cases:
    //   * stack ABSENT  → skip the v6 chain entirely (nothing to leak), no error.
    //   * stack PRESENT → build it (even for an empty v6 allow-list, so a
    //     dual-stack host still blocks all v6 egress) and treat any genuine
    //     ip6tables rule failure as FATAL — we must not claim lockdown while
    //     IPv6 egress leaks. A v6 failure rolls back BOTH tables.
    if should_build_v6_chain(ipv6_stack_present()) {
        if let Err(e) = build_chain(IP6TABLES, &v6, &r6) {
            let _ = iptables_disable();
            return Err(e);
        }
    } else {
        eprintln!(
            "AMS helper: skipping IPv6 lockdown — no IPv6 stack present \
             (/proc/sys/net/ipv6 absent); no IPv6 egress to block"
        );
    }

    Ok(())
}

/// Remove the AMS_PROCTOR chain from BOTH tables.
#[cfg(target_os = "linux")]
fn iptables_disable() -> Result<(), String> {
    let v4 = teardown_chain(IPTABLES);
    let v6 = if ipv6_stack_present() {
        teardown_chain(IP6TABLES)
    } else {
        Ok(())
    };
    match (v4, v6) {
        (Err(first), Err(second)) => Err(format!("{first}; {second}")),
        (Err(error), _) | (_, Err(error)) => Err(error),
        _ => Ok(()),
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{
        authorize_disable, read_marker_at, remove_marker_at, should_build_v6_chain,
        split_ip_families, startup_action, write_marker_at, DisableDecision, Marker, MarkerState,
        StartupAction,
    };

    #[test]
    fn builds_v6_chain_only_when_stack_present() {
        // Stack present → build (even if the v6 allow-list is later empty, the
        // caller still constructs the DROP chain to block all v6 egress).
        assert!(should_build_v6_chain(true));
        // Stack absent → skip; there is no IPv6 egress to leak.
        assert!(!should_build_v6_chain(false));
    }

    #[test]
    fn splits_mixed_families_and_dedupes() {
        let ips = [
            "1.2.3.4".to_string(),
            "2606:4700::1111".to_string(),
            "1.2.3.4".to_string(), // dup v4
            "8.8.8.8".to_string(),
            "2606:4700::1111".to_string(), // dup v6
        ];
        let (v4, v6) = split_ip_families(&ips).expect("valid IPs");
        assert_eq!(v4, vec!["1.2.3.4".to_string(), "8.8.8.8".to_string()]);
        assert_eq!(v6, vec!["2606:4700::1111".to_string()]);
    }

    #[test]
    fn rejects_invalid_ip_instead_of_dropping_it() {
        // A malformed entry must error — never be silently skipped, which would
        // widen the firewall (LX-4 hardening).
        let ips = ["1.2.3.4".to_string(), "not-an-ip".to_string()];
        assert!(split_ip_families(&ips).is_err());
    }

    #[test]
    fn ipv6_literal_never_lands_in_the_v4_bucket() {
        let ips = ["::1".to_string()];
        let (v4, v6) = split_ip_families(&ips).expect("valid IP");
        assert!(v4.is_empty());
        assert_eq!(v6, vec!["::1".to_string()]);
    }

    #[test]
    fn startup_reapplies_when_marker_present() {
        let m = Marker {
            disabling: false,
            token: "t".into(),
            ips: vec!["1.2.3.4".into()],
            resolvers: vec![],
        };
        assert_eq!(
            startup_action(MarkerState::Present(m)),
            StartupAction::ReApply(vec!["1.2.3.4".into()], vec![])
        );
    }

    #[test]
    fn startup_reapply_keeps_resolvers_scoped() {
        // A helper restart mid-exam must re-apply the SAME rules. Losing the
        // resolver split here would silently widen every nameserver back to
        // full egress on every restart — the bypass returning by the back door.
        let m = Marker {
            disabling: false,
            token: "t".into(),
            ips: vec!["1.2.3.4".into(), "9.9.9.9".into()],
            resolvers: vec!["9.9.9.9".into()],
        };
        assert_eq!(
            startup_action(MarkerState::Present(m)),
            StartupAction::ReApply(
                vec!["1.2.3.4".into(), "9.9.9.9".into()],
                vec!["9.9.9.9".into()]
            )
        );
    }

    #[test]
    fn a_marker_without_resolvers_still_deserialises() {
        // Written by a pre-2.0.9 helper. It must not read as Corrupt: that
        // maps to LeaveAsIs, which would strand a live exam's rules.
        let old: Marker = serde_json::from_str(r#"{"token":"t","ips":["1.2.3.4"]}"#)
            .expect("legacy marker must still parse");
        assert_eq!(old.ips, vec!["1.2.3.4".to_string()]);
        assert!(old.resolvers.is_empty());
    }

    #[test]
    fn startup_flushes_when_marker_absent() {
        assert_eq!(startup_action(MarkerState::Absent), StartupAction::Flush);
    }

    #[test]
    fn startup_leaves_rules_when_marker_corrupt() {
        // Fail-closed: an unreadable lock must NOT flush a possibly-live firewall.
        assert_eq!(
            startup_action(MarkerState::Corrupt),
            StartupAction::LeaveAsIs
        );
    }

    #[test]
    fn disable_proceeds_only_on_exact_token_match() {
        let m = Marker {
            disabling: false,
            token: "secret".into(),
            ips: vec![],
            resolvers: vec![],
        };
        assert_eq!(
            authorize_disable(Some(&m), "secret"),
            DisableDecision::Proceed
        );
        assert_eq!(
            authorize_disable(Some(&m), "wrong"),
            DisableDecision::Reject
        );
        // An empty presented token never matches an active lockdown.
        assert_eq!(authorize_disable(Some(&m), ""), DisableDecision::Reject);
        // No active lockdown → nothing to do.
        assert_eq!(authorize_disable(None, "secret"), DisableDecision::NoOp);
    }

    #[test]
    fn marker_json_round_trips() {
        let m = Marker {
            disabling: false,
            token: "abc".into(),
            ips: vec!["10.0.0.1".into(), "::1".into()],
            resolvers: vec![],
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: Marker = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }

    #[test]
    fn marker_write_then_read_round_trips_on_disk() {
        let path = std::env::temp_dir().join(format!("ams-marker-rt-{}.lock", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let m = Marker {
            disabling: false,
            token: "tok".into(),
            ips: vec!["1.1.1.1".into()],
            resolvers: vec![],
        };
        write_marker_at(&path, &m).expect("write");
        assert_eq!(read_marker_at(&path), MarkerState::Present(m));
        remove_marker_at(&path).unwrap();
        assert_eq!(read_marker_at(&path), MarkerState::Absent);
    }

    #[test]
    fn unreadable_marker_contents_are_corrupt_not_absent() {
        let path = std::env::temp_dir().join(format!("ams-marker-bad-{}.lock", std::process::id()));
        std::fs::write(&path, b"not json").unwrap();
        assert_eq!(read_marker_at(&path), MarkerState::Corrupt);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn written_marker_is_owner_only_0600() {
        use std::os::unix::fs::PermissionsExt;
        let path =
            std::env::temp_dir().join(format!("ams-marker-perm-{}.lock", std::process::id()));
        let _ = std::fs::remove_file(&path);
        write_marker_at(
            &path,
            &Marker {
                disabling: false,
                token: "t".into(),
                ips: vec![],
                resolvers: vec![],
            },
        )
        .unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(&path);
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn admission_is_bounded_and_released_on_drop_and_panic() {
        let limit = Arc::new(ConnectionLimiter::new(2));
        let first = limit.try_acquire().unwrap();
        let second = limit.try_acquire().unwrap();
        assert!(limit.try_acquire().is_none());
        drop(first);
        let replacement = limit.try_acquire().unwrap();
        drop(second);
        let panic_permit = limit.try_acquire().unwrap();
        assert!(std::panic::catch_unwind(move || {
            let _permit = panic_permit;
            panic!("test worker unwind");
        })
        .is_err());
        assert!(limit.try_acquire().is_some());
        drop(replacement);
        assert_eq!(limit.active.load(Ordering::Acquire), 0);
    }
    #[test]
    fn idle_unauthorized_peers_never_take_recovery_worker_slots() {
        let limit = Arc::new(ConnectionLimiter::new(2));
        let mut clients = Vec::new();
        for _ in 0..16 {
            let (client, server) = UnixStream::pair().unwrap();
            clients.push(client); // No request bytes; peer remains connected.
            assert!(admit_client(&server, &limit, |_| Err("unauthorized".into())).is_none());
            assert_eq!(limit.active.load(Ordering::Acquire), 0);
        }
        let (_client, server) = UnixStream::pair().unwrap();
        assert!(admit_client(&server, &limit, |_| Ok(())).is_some());
    }

    #[test]
    fn admission_remains_bounded_under_concurrent_attempts() {
        let limit = Arc::new(ConnectionLimiter::new(2));
        let barrier = Arc::new(std::sync::Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let limit = limit.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let permit = limit.try_acquire();
                    barrier.wait();
                    permit.is_some()
                })
            })
            .collect();
        barrier.wait();
        let admitted = workers
            .into_iter()
            .map(|worker| worker.join().unwrap() as usize)
            .sum::<usize>();
        assert_eq!(admitted, 2);
        assert_eq!(limit.active.load(Ordering::Acquire), 0);
    }
    #[test]
    fn complete_requests_preserve_multiple_frames_and_crlf() {
        let (mut client, server) = UnixStream::pair().unwrap();
        client
            .write_all(b"{\"cmd\":\"ping\"}\r\n{\"cmd\":\"ping\"}\n")
            .unwrap();
        let mut reader = BufReader::new(server);
        for _ in 0..2 {
            assert_eq!(
                read_request(&mut reader, Duration::from_secs(1))
                    .unwrap()
                    .as_deref(),
                Some("{\"cmd\":\"ping\"}")
            );
        }
    }
    #[test]
    fn oversized_request_is_rejected_without_waiting_for_newline() {
        let (mut client, server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            let _ = client.write_all(&vec![b'x'; MAX_REQUEST_BYTES + 1]);
        });
        let error = read_request(&mut BufReader::new(server), Duration::from_secs(1)).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        writer.join().unwrap();
    }
    #[test]
    fn incomplete_eof_is_not_dispatched_as_a_request() {
        let (mut client, server) = UnixStream::pair().unwrap();
        client.write_all(b"{\"cmd\":\"ping\"}").unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        let error = read_request(&mut BufReader::new(server), Duration::from_secs(1)).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::UnexpectedEof);
    }
    #[test]
    fn idle_connection_times_out() {
        let (_client, server) = UnixStream::pair().unwrap();
        let start = Instant::now();
        let error =
            read_request(&mut BufReader::new(server), Duration::from_millis(30)).unwrap_err();
        assert!(matches!(
            error.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
        ));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn trickled_bytes_do_not_reset_total_request_deadline() {
        let (mut client, server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            for _ in 0..20 {
                if client.write_all(b"x").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        let error =
            read_request(&mut BufReader::new(server), Duration::from_millis(60)).unwrap_err();
        assert!(matches!(
            error.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
        ));
        writer.join().unwrap();
    }
    #[test]
    fn rejected_peer_never_reads_or_dispatches_request() {
        let (mut client, server) = UnixStream::pair().unwrap();
        serve_client(
            server,
            Duration::from_millis(30),
            |_| Err("unauthorized".into()),
            |_| panic!("must not dispatch"),
        );
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.contains("unauthorized"));
    }
    #[test]
    fn authorized_peer_receives_response_without_firewall_calls() {
        let (mut client, server) = UnixStream::pair().unwrap();
        client.write_all(b"{\"cmd\":\"ping\"}\n").unwrap();
        client.shutdown(std::net::Shutdown::Write).unwrap();
        serve_client(
            server,
            Duration::from_millis(30),
            |_| Ok(()),
            |line| {
                assert_eq!(line, "{\"cmd\":\"ping\"}");
                "{\"ok\":true}".into()
            },
        );
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert_eq!(response, "{\"ok\":true}\n");
    }
}

#[cfg(test)]
mod bounded_firewall_tests {
    use super::*;

    #[test]
    fn overload_returns_explicit_predispatch_busy_to_authorized_peer() {
        let limits = Arc::new(ConnectionLimiter::new(0));
        let (client, server) = UnixStream::pair().unwrap();
        assert!(admit_client(&server, &limits, |_| Ok(())).is_none());
        let mut line = String::new();
        BufReader::new(client).read_line(&mut line).unwrap();
        assert_eq!(line, "{\"ok\":false,\"error\":\"helper_busy\"}\n");
    }

    #[test]
    fn contention_is_busy_before_any_firewall_mutation() {
        let _held = FIREWALL_LOCK.lock().unwrap();
        assert!(
            dispatch(r#"{"cmd":"enable","ips":["127.0.0.1"],"token":"t"}"#).contains("helper_busy")
        );
        assert!(dispatch(r#"{"cmd":"disable","token":"t"}"#).contains("helper_busy"));
    }

    #[test]
    fn poisoned_transaction_lock_does_not_permanently_block_recovery() {
        let lock = std::sync::Mutex::new(());
        let _ = std::panic::catch_unwind(|| {
            let _held = lock.lock().unwrap();
            panic!("mock transaction panic");
        });
        assert!(acquire_firewall(&lock).is_ok());
    }

    #[test]
    fn aggregate_deadline_prevents_starting_another_command_and_restores_scope() {
        let before = FIREWALL_DEADLINE.with(|slot| slot.get());
        {
            let _scope = FirewallDeadline::begin();
            assert!(command_budget().unwrap() <= COMMAND_TIMEOUT);
            FIREWALL_DEADLINE
                .with(|slot| slot.set(Some(Instant::now() - Duration::from_millis(1))));
            assert_eq!(
                command_budget().unwrap_err().kind(),
                std::io::ErrorKind::TimedOut
            );
        }
        assert_eq!(FIREWALL_DEADLINE.with(|slot| slot.get()), before);
    }

    #[cfg(target_os = "linux")]
    fn output(success: bool, stdout: &str) -> std::process::Output {
        use std::os::unix::process::ExitStatusExt;
        std::process::Output {
            status: std::process::ExitStatus::from_raw(if success { 0 } else { 256 }),
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn teardown_checks_every_step_and_proves_absence() {
        let mut calls = Vec::new();
        let mut initial = true;
        teardown_with(|args| {
            calls.push(args.join(" "));
            if args == ["-S"] && initial {
                initial = false;
                Ok(output(
                    true,
                    "-N AMS_PROCTOR\n-A OUTPUT -j AMS_PROCTOR\n-A OUTPUT -j AMS_PROCTOR\n",
                ))
            } else {
                Ok(output(true, "-P OUTPUT ACCEPT\n"))
            }
        })
        .unwrap();
        assert_eq!(
            calls,
            [
                "-S",
                "-D OUTPUT -j AMS_PROCTOR",
                "-D OUTPUT -j AMS_PROCTOR",
                "-F AMS_PROCTOR",
                "-X AMS_PROCTOR",
                "-S"
            ]
        );
        assert!(teardown_with(|_| Err("command timed out".into())).is_err());
        assert!(teardown_with(|_| Ok(output(false, ""))).is_err());
        assert!(teardown_with(|args| Ok(output(
            true,
            if args == ["-S"] {
                "-N AMS_PROCTOR\n"
            } else {
                ""
            }
        )))
        .is_err());
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn failed_or_timed_out_restore_keeps_marker_and_restart_cleanup_intent() {
        let cleared = std::cell::Cell::new(false);
        assert!(finish_cleanup(
            || Err("deadline expired".into()),
            || {
                cleared.set(true);
                Ok(())
            }
        )
        .is_err());
        assert!(!cleared.get());
        finish_cleanup(
            || Ok(()),
            || {
                cleared.set(true);
                Ok(())
            },
        )
        .unwrap();
        assert!(cleared.get());
        let old: Marker = serde_json::from_str(r#"{"token":"t","ips":[],"resolvers":[]}"#).unwrap();
        assert!(!old.disabling);
        let cleanup = Marker {
            disabling: true,
            ..old
        };
        assert_eq!(
            startup_action(MarkerState::Present(cleanup)),
            StartupAction::Flush
        );
    }
}
