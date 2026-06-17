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
//!             {"cmd":"enable","ips":["1.2.3.4","2606:4700::1111"]}
//!             {"cmd":"disable"}
//!   Response: {"ok":true}
//!             {"ok":false,"error":"<message>"}

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::Command;

#[cfg(target_os = "macos")]
use std::net::{IpAddr, Ipv4Addr};
#[cfg(target_os = "macos")]
use std::process::Stdio;

#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;

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
#[allow(dead_code)] // consumed in Task 2/3
const MARKER_PATH: &str = "/run/ams-proctor.lock";

/// Persisted lockdown state. Lives in /run (tmpfs) so it shares the iptables
/// rules' boot-scoped lifetime: a reboot clears both; a same-boot helper
/// restart preserves both.
#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct Marker {
    token: String,
    ips: Vec<String>,
}

#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
#[derive(Debug, PartialEq)]
enum MarkerState {
    Absent,
    Present(Marker),
    Corrupt,
}

#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
#[derive(Debug, PartialEq)]
enum StartupAction {
    ReApply(Vec<String>),
    Flush,
    LeaveAsIs,
}

#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
#[derive(Debug, PartialEq)]
enum DisableDecision {
    Proceed,
    Reject,
    NoOp,
}

/// Decide what a starting daemon should do with the firewall. Fail-closed:
/// only a confidently-absent marker permits a flush.
#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
fn startup_action(state: MarkerState) -> StartupAction {
    match state {
        MarkerState::Present(m) => StartupAction::ReApply(m.ips),
        MarkerState::Absent => StartupAction::Flush,
        MarkerState::Corrupt => StartupAction::LeaveAsIs,
    }
}

/// Authorize a disable request against the stored marker. Only the owning
/// session's exact, non-empty token may lift an active lockdown.
#[cfg(target_os = "linux")]
#[allow(dead_code)] // consumed in Task 2/3
fn authorize_disable(stored: Option<&Marker>, presented_token: &str) -> DisableDecision {
    match stored {
        None => DisableDecision::NoOp,
        Some(m) if !presented_token.is_empty() && m.token == presented_token => {
            DisableDecision::Proceed
        }
        Some(_) => DisableDecision::Reject,
    }
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Request {
    Ping,
    Enable { ips: Vec<String> },
    Disable,
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

    // A starting daemon implies there is NO active exam, so any AMS_PROCTOR chain
    // still present in the kernel is a leftover from a crashed/rebooted session.
    // The app-side recovery only flushes when it can reach a *running* helper, so
    // if we don't clear it here a post-reboot candidate is stranded offline behind
    // stale DROP rules. Flush both tables before accepting any client. teardown_chain
    // swallows all errors (incl. ip6tables being absent), so this is safe.
    #[cfg(target_os = "linux")]
    {
        teardown_chain(IPTABLES);
        teardown_chain(IP6TABLES);
    }

    eprintln!("AMS network helper ready on {socket_path}");

    for stream in listener.incoming() {
        match stream {
            // Spawn per connection — firewall calls can block for tens of ms
            // under a kernel lock; a single-threaded loop would stall accept.
            Ok(s) => {
                std::thread::spawn(move || handle_client(s));
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
        let _ = Command::new("/usr/sbin/chown")
            .args(["root:staff", socket_path])
            .output();
    }
    #[cfg(target_os = "linux")]
    {
        // 0600, root-owned. The helper runs as root, so it already owns the
        // socket; SO_PEERCRED then authorizes the connecting user-session app.
        // 0600 is intentionally strict — the peer-credential check is the real
        // gate, the mode is defense-in-depth so a non-root local user cannot
        // even open the socket.
        let _ = std::fs::set_permissions(socket_path, PermissionsExt::from_mode(0o600));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = std::fs::set_permissions(socket_path, PermissionsExt::from_mode(0o600));
    }
}

fn handle_client(stream: UnixStream) {
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(e) => {
            eprintln!("AMS helper stream clone error: {e}");
            return;
        }
    };

    if let Err(e) = authorize_client(&stream) {
        let _ = writeln!(writer, "{}", json_err(&e));
        return;
    }

    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let response = dispatch(&line);
        let _ = writeln!(writer, "{response}");
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
/// impersonate the client. The mode-0600 root-owned socket still blocks non-root
/// users at the filesystem layer, and the strong mode removes the weakness
/// entirely whenever a stable path was pinned at install time.
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
    match serde_json::from_str::<Request>(json.trim()) {
        Ok(Request::Ping) => json_ok(),
        Ok(Request::Enable { ips }) => match firewall_enable(&ips) {
            Ok(()) => json_ok(),
            Err(e) => json_err(&e),
        },
        Ok(Request::Disable) => match firewall_disable() {
            Ok(()) => json_ok(),
            Err(e) => json_err(&e),
        },
        Err(e) => json_err(&format!("invalid request: {e}")),
    }
}

#[cfg(target_os = "macos")]
fn firewall_enable(ips: &[String]) -> Result<(), String> {
    let ips = validate_ipv4_allowlist(ips)?;
    pfctl_enable(&ips)
}

#[cfg(target_os = "macos")]
fn firewall_disable() -> Result<(), String> {
    pfctl_disable()
}

#[cfg(target_os = "linux")]
fn firewall_enable(ips: &[String]) -> Result<(), String> {
    iptables_enable(ips)
}

#[cfg(target_os = "linux")]
fn firewall_disable() -> Result<(), String> {
    iptables_disable()
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
    let mut child = Command::new(PFCTL)
        .args(["-a", anchor, "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pfctl -f: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "pfctl stdin unavailable".to_string())?
        .write_all(rules.as_bytes())
        .map_err(|e| format!("write pf rules: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("pfctl wait: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn pfctl_enable(ips: &[Ipv4Addr]) -> Result<(), String> {
    let _ = Command::new(PFCTL).arg("-e").output();

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
    for anchor in [ANCHOR, LEGACY_ANCHOR, "com.amsaccess.proctor6"] {
        let out = Command::new(PFCTL)
            .args(["-a", anchor, "-F", "all"])
            .output()
            .map_err(|e| format!("pfctl flush: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.to_lowercase().contains("anchor") {
                return Err(stderr.trim().to_string());
            }
        }
    }
    Ok(())
}

// ── Linux firewall (iptables + ip6tables) ─────────────────────────────────────

#[cfg(target_os = "linux")]
fn run_tables(bin: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| format!("{bin} {}: {e}", args.join(" ")))
}

/// Tear down any leftover AMS_PROCTOR chain in `bin`'s OUTPUT table. Best-effort
/// and idempotent — every step is allowed to fail (e.g. chain absent).
#[cfg(target_os = "linux")]
fn teardown_chain(bin: &str) {
    let _ = run_tables(bin, &["-D", "OUTPUT", "-j", CHAIN]);
    let _ = run_tables(bin, &["-F", CHAIN]);
    let _ = run_tables(bin, &["-X", CHAIN]);
}

/// Build the AMS_PROCTOR chain in `bin` (iptables OR ip6tables), allowing only
/// the given same-family IP strings, and hook it into OUTPUT at position 1.
#[cfg(target_os = "linux")]
fn build_chain(bin: &str, allowed: &[&str]) -> Result<(), String> {
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
    // drop the instant the default-DROP rule lands.
    let out = run_tables(
        bin,
        &[
            "-A",
            CHAIN,
            "-m",
            "state",
            "--state",
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
fn iptables_enable(ips: &[String]) -> Result<(), String> {
    // Family-split first so a v6 literal can never reach the v4 binary (LX-4).
    let (v4, v6) = split_ip_families(ips)?;
    let v4: Vec<&str> = v4.iter().map(String::as_str).collect();
    let v6: Vec<&str> = v6.iter().map(String::as_str).collect();

    // Refuse a degenerate allowlist: with no allowed destinations in either
    // family this would build a loopback+established+DROP chain — a near-total
    // egress block that also cuts the exam's own API. Almost certainly a caller
    // bug; fail closed with an error rather than silently applying it (parity
    // with the macOS validate_ipv4_allowlist empty-list rejection).
    if v4.is_empty() && v6.is_empty() {
        return Err("empty allowlist: refusing to apply a near-total egress block".to_string());
    }

    // Idempotent: clear any leftovers in both tables first.
    teardown_chain(IPTABLES);
    teardown_chain(IP6TABLES);

    // Build v4. If this fails, roll back so we never leave a half-applied
    // (and therefore unpredictable) firewall. v4 failure is ALWAYS fatal.
    if let Err(e) = build_chain(IPTABLES, &v4) {
        teardown_chain(IPTABLES);
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
        if let Err(e) = build_chain(IP6TABLES, &v6) {
            teardown_chain(IPTABLES);
            teardown_chain(IP6TABLES);
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
    teardown_chain(IPTABLES);
    teardown_chain(IP6TABLES);
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{
        authorize_disable, should_build_v6_chain, split_ip_families, startup_action,
        DisableDecision, Marker, MarkerState, StartupAction,
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
            token: "t".into(),
            ips: vec!["1.2.3.4".into()],
        };
        assert_eq!(
            startup_action(MarkerState::Present(m)),
            StartupAction::ReApply(vec!["1.2.3.4".into()])
        );
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
            token: "secret".into(),
            ips: vec![],
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
            token: "abc".into(),
            ips: vec!["10.0.0.1".into(), "::1".into()],
        };
        let json = serde_json::to_string(&m).unwrap();
        let back: Marker = serde_json::from_str(&json).unwrap();
        assert_eq!(m, back);
    }
}
