use base64::Engine as _;
use core_rs::exam::{
    KeyboardInterceptResult, NetworkCheckResult, ProcessScanResult, VirtDetectionResult,
};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

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

// ── Tauri commands ────────────────────────────────────────────────────────────

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
        confidence: "unknown",
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
        method: "none",
        platform: "unknown",
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

/// Measure TCP round-trip to a host to assess network stability.
#[tauri::command]
async fn check_network_stability(host: String) -> NetworkCheckResult {
    let addr = format!("{}:443", host);
    let samples = 3u32;
    let mut latencies = Vec::new();

    for _ in 0..samples {
        let start = Instant::now();
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            latencies.push(start.elapsed().as_millis() as u64);
        }
    }

    if latencies.is_empty() {
        return NetworkCheckResult {
            reachable: false,
            latency_ms: None,
            jitter_ms: None,
            quality: "unreachable",
        };
    }

    let avg = latencies.iter().sum::<u64>() / latencies.len() as u64;
    let jitter = if latencies.len() > 1 {
        let max = *latencies.iter().max().unwrap();
        let min = *latencies.iter().min().unwrap();
        Some(max - min)
    } else {
        Some(0)
    };

    let quality = match avg {
        0..=80 => "excellent",
        81..=200 => "good",
        201..=500 => "fair",
        _ => "poor",
    };

    NetworkCheckResult {
        reachable: true,
        latency_ms: Some(avg),
        jitter_ms: jitter,
        quality,
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

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_processes,
            detect_virtualization,
            enable_keyboard_intercept,
            disable_keyboard_intercept,
            lock_desktop,
            unlock_desktop,
            get_violation_log,
            log_violation,
            check_network_stability,
            get_platform,
            get_security_environment,
            save_face_image,
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
                    .ok();
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
                #[cfg(target_os = "macos")]
                platform_rs::macos::disable_keyboard_intercept();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running AMS Access");
}
