use base64::Engine as _;
use core_rs::exam::{
    evaluate_readiness, DeviceState, EnforcementDecision, KeyboardInterceptResult,
    NetworkCheckResult, ProcessScanResult, ReadinessReport, SessionPolicy, VirtDetectionResult,
};
use serde::{Deserialize, Serialize};
use std::net::ToSocketAddrs;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// ── Violation log ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct ViolationEntry {
    kind: String,
    detail: String,
    ts: u64,
}

static VIOLATION_LOG: OnceLock<Mutex<Vec<ViolationEntry>>> = OnceLock::new();

fn violation_log() -> &'static Mutex<Vec<ViolationEntry>> {
    VIOLATION_LOG.get_or_init(|| Mutex::new(Vec::new()))
}

fn push_violation(kind: &str, detail: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if let Ok(mut log) = violation_log().lock() {
        log.push(ViolationEntry {
            kind: kind.to_string(),
            detail: detail.to_string(),
            ts,
        });
    }
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
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    let restricted_processes = Some(ProcessScanResult {
        found: vec![],
        clean: true,
    });

    #[cfg(target_os = "linux")]
    let virtualization = Some(platform_rs::linux::detect_virtualization());
    #[cfg(target_os = "windows")]
    let virtualization = Some(platform_rs::windows::detect_virtualization());
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    ProcessScanResult {
        found: vec![],
        clean: true,
    }
}

/// Detect virtualisation / VM environment.
#[tauri::command]
fn detect_virtualization() -> VirtDetectionResult {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::detect_virtualization();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::detect_virtualization();
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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

/// Full exam lockdown — always-on-top + keyboard intercept + sleep prevention.
#[tauri::command]
async fn lock_desktop(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(true);
        let _ = win.set_fullscreen(true);
    }
    #[cfg(target_os = "linux")]
    return platform_rs::linux::lock_desktop();
    #[cfg(target_os = "windows")]
    return platform_rs::windows::lock_desktop();
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
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
}

/// Return all recorded violations for this session.
#[tauri::command]
fn get_violation_log() -> Vec<ViolationEntry> {
    violation_log()
        .lock()
        .ok()
        .map(|v| v.clone())
        .unwrap_or_default()
}

/// Record a violation from the frontend (blocked app opened during exam, focus lost, etc).
#[tauri::command]
fn log_violation(kind: String, detail: String) {
    push_violation(&kind, &detail);
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

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    Err("Network lockdown not supported on this platform".to_string())
}

/// Remove all AMS firewall rules and restore normal internet access.
#[tauri::command]
async fn disable_network_lockdown() -> Result<bool, String> {
    #[cfg(target_os = "linux")]
    return platform_rs::linux::disable_network_lockdown().map(|_| true);
    #[cfg(target_os = "windows")]
    return platform_rs::windows::disable_network_lockdown().map(|_| true);

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    Err("Network lockdown not supported on this platform".to_string())
}

/// Save a base64-encoded face image to the faces directory.
#[tauri::command]
async fn save_face_image(image_data: String, index: u8) -> Result<String, String> {
    let b64 = image_data.split(',').nth(1).unwrap_or(image_data.as_str());
    let bytes = base64::prelude::BASE64_STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;

    let dir = if cfg!(target_os = "windows") {
        format!(
            "{}\\ams_faces",
            std::env::var("TEMP").unwrap_or_else(|_| "C:\\Windows\\Temp".into())
        )
    } else {
        "/tmp/ams_faces".to_string()
    };

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = format!("{}/face_{}.png", dir, index);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
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
            unix_signal::signal(unix_signal::SIGINT, handle_sigterm as usize);
            unix_signal::signal(unix_signal::SIGTERM, handle_sigterm as usize);
            unix_signal::signal(unix_signal::SIGQUIT, handle_sigterm as usize);
            unix_signal::signal(unix_signal::SIGHUP, handle_sigterm as usize);
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

    // Restore keyboard shortcuts left behind by a previous crashed session.
    // Runs BEFORE Tauri/GTK initializes so it can't block the GTK main thread
    // (which would delay webkit2gtk's IPC handshake and break camera permissions)
    // and BEFORE any enable_keyboard_intercept can fire (which would otherwise
    // race the recovery and undo the lockdown).
    #[cfg(target_os = "linux")]
    platform_rs::linux::recover_keyboard_if_crashed();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            collect_device_state,
            evaluate_session_readiness,
            start_secure_session,
            scan_processes,
            detect_virtualization,
            enable_keyboard_intercept,
            disable_keyboard_intercept,
            lock_desktop,
            unlock_desktop,
            get_violation_log,
            log_violation,
            check_network_stability,
            get_full_telemetry,
            get_platform,
            get_security_environment,
            save_face_image,
            enable_network_lockdown,
            disable_network_lockdown,
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
            Ok(())
        })
        .on_window_event(|_win, event| {
            if let tauri::WindowEvent::Destroyed = event {
                #[cfg(target_os = "linux")]
                platform_rs::linux::disable_keyboard_intercept();
                #[cfg(target_os = "windows")]
                platform_rs::windows::disable_keyboard_intercept();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running AMS Access");
}
