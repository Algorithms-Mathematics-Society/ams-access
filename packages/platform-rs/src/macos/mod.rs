//! macOS-specific lockdown implementation for AMS-Access-Proctor.
//!
//! Keyboard intercept: CGEventTap (requires Accessibility permission).
//! Sleep prevention: caffeinate subprocess.
//! Network lockdown: pfctl anchor (requires root).
//! Process scanning: `ps -axco comm`.
//! VM detection: `system_profiler SPHardwareDataType` + `ioreg`.

use core_rs::exam::{KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult};
use std::ffi::c_void;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

// ── Restricted process list ───────────────────────────────────────────────────

const RESTRICTED: &[&str] = &[
    "obs",
    "obs64",
    "zoom.us",
    "ZoomOpener",
    "zoom",
    "discord",
    "Discord",
    "TeamViewer",
    "TeamViewerAgent",
    "AnyDesk",
    "vncviewer",
    "Vine Server",
    "RealVNC",
    "Skype",
    "slack",
    "Slack",
    "Microsoft Teams",
    "Teams",
    "WhatsApp",
    "Telegram",
    "lldb",
    "gdb",
    "dtrace",
    "Instruments",
    "Terminal",
    "iTerm2",
    "iTerm",
    "xterm",
    "Wireshark",
    "Charles",
    "Proxyman",
    "mitmproxy",
    "Parallels Desktop",
    "VMware Fusion",
    "UTM",
    "scrcpy",
    "RustDesk",
    "Screen Sharing",
    "screensharingd",
    "RemoteDesktopAgent",
];

// ── Thread-safe raw pointer wrapper ──────────────────────────────────────────

struct SendPtr(*mut c_void);
// SAFETY: CoreFoundation objects are thread-safe for CFRunLoopStop/Release calls.
unsafe impl Send for SendPtr {}
unsafe impl Sync for SendPtr {}

// ── Global state ──────────────────────────────────────────────────────────────

static INTERCEPT_ACTIVE: AtomicBool = AtomicBool::new(false);
static TAP_RUNLOOP: OnceLock<Mutex<Option<SendPtr>>> = OnceLock::new();
static CAFFEINATE_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn tap_runloop() -> &'static Mutex<Option<SendPtr>> {
    TAP_RUNLOOP.get_or_init(|| Mutex::new(None))
}

fn caffeinate_pid() -> &'static Mutex<Option<u32>> {
    CAFFEINATE_PID.get_or_init(|| Mutex::new(None))
}

// ── macOS framework FFI ───────────────────────────────────────────────────────

// CGEventField numeric constants
const CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;

// CGEventType numeric values
const CG_EVENT_KEY_DOWN: u32 = 10;
const CG_EVENT_KEY_UP: u32 = 11;
const CG_EVENT_FLAGS_CHANGED: u32 = 12;

// CGEventTapLocation — intercept events at the HID driver level
const K_CG_HID_EVENT_TAP: u32 = 0;
// CGEventTapPlacement — insert at head of filter chain
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
// CGEventTapOptions — 0 = active intercepting tap (not passive observer)
const K_CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
// CGEventMask bits for keyboard events
const KB_EVENT_MASK: u64 =
    (1u64 << CG_EVENT_KEY_DOWN) | (1u64 << CG_EVENT_KEY_UP) | (1u64 << CG_EVENT_FLAGS_CHANGED);

// CGEventFlags modifier masks
const FLAG_CMD: u64 = 0x0010_0000;
const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_CTRL: u64 = 0x0004_0000;
const FLAG_OPT: u64 = 0x0008_0000;

// macOS virtual key codes (from <Carbon/Carbon.h> HIToolbox/Events.h)
const VK_TAB: i64 = 48;
const VK_SPACE: i64 = 49;
const VK_BACKTICK: i64 = 50; // ` / ~ — Cmd+` cycles windows
const VK_ESCAPE: i64 = 53;
const VK_H: i64 = 4;
const VK_M: i64 = 46;
const VK_Q: i64 = 12;
const VK_W: i64 = 13;
const VK_3: i64 = 20; // Cmd+Shift+3 screenshot
const VK_4: i64 = 21; // Cmd+Shift+4 screenshot
const VK_5: i64 = 23; // Cmd+Shift+5 screenshot
const VK_F3: i64 = 99; // Mission Control (default binding)
const VK_F4: i64 = 118; // Launchpad
const VK_UP: i64 = 126; // Ctrl+Up = Mission Control

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: unsafe extern "C" fn(*mut c_void, u32, *mut c_void, *mut c_void) -> *mut c_void,
        user_info: *mut c_void,
    ) -> *mut c_void;
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
    fn CGEventGetFlags(event: *mut c_void) -> u64;
}

#[allow(non_upper_case_globals)]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopDefaultMode: *const c_void;
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: *mut c_void,
        order: i64,
    ) -> *mut c_void;
    fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: *mut c_void);
    fn CFRelease(cf: *mut c_void);
}

// ── CGEventTap callback ───────────────────────────────────────────────────────

/// Returns `null` to block the event or `event` to pass it through.
///
/// Called on the tap's run loop thread. Uses only atomics — no locking.
#[allow(non_upper_case_globals)]
unsafe extern "C" fn kb_tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: *mut c_void,
    _user_info: *mut c_void,
) -> *mut c_void {
    if !INTERCEPT_ACTIVE.load(Ordering::Relaxed) {
        return event;
    }
    if event_type != CG_EVENT_KEY_DOWN && event_type != CG_EVENT_KEY_UP {
        return event;
    }

    let kc = CGEventGetIntegerValueField(event, CG_KEYBOARD_EVENT_KEYCODE);
    let flags = CGEventGetFlags(event);
    let cmd = (flags & FLAG_CMD) != 0;
    let shift = (flags & FLAG_SHIFT) != 0;
    let ctrl = (flags & FLAG_CTRL) != 0;
    let opt = (flags & FLAG_OPT) != 0;

    let block = match kc {
        // Cmd+Tab (app switcher)
        VK_TAB if cmd => true,
        // Cmd+` (in-app window switcher)
        VK_BACKTICK if cmd => true,
        // Cmd+Q (quit)
        VK_Q if cmd => true,
        // Cmd+W (close window)
        VK_W if cmd => true,
        // Cmd+H (hide)
        VK_H if cmd => true,
        // Cmd+M (minimize)
        VK_M if cmd => true,
        // Cmd+Space (Spotlight)
        VK_SPACE if cmd && !ctrl && !opt => true,
        // Cmd+Option+Esc (Force Quit dialog)
        VK_ESCAPE if cmd && opt => true,
        // Bare Escape
        VK_ESCAPE if !cmd && !ctrl && !opt && !shift => true,
        // Cmd+Shift+3/4/5 (screenshots)
        VK_3 | VK_4 | VK_5 if cmd && shift => true,
        // Ctrl+Up (Mission Control)
        VK_UP if ctrl => true,
        // F3 (Mission Control default key)
        VK_F3 => true,
        // F4 (Launchpad)
        VK_F4 => true,
        _ => false,
    };

    if block {
        std::ptr::null_mut()
    } else {
        event
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Check whether the Accessibility permission is granted for this process.
///
/// CGEventTap requires Accessibility. If not granted, `enable_keyboard_intercept`
/// returns `active: false` with `method: "accessibility_denied"`.
pub fn check_accessibility_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Install a CGEventTap that blocks exam-escape key combos.
///
/// Requires Accessibility permission in System Preferences → Privacy & Security.
/// Spawns a dedicated thread that runs the CoreFoundation run loop.
pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    if !check_accessibility_permission() {
        return KeyboardInterceptResult {
            active: false,
            method: "accessibility_denied".to_string(),
            platform: "macos".to_string(),
        };
    }

    // If already active, return success immediately.
    if INTERCEPT_ACTIVE.load(Ordering::SeqCst) {
        return KeyboardInterceptResult {
            active: true,
            method: "cgeventtap".to_string(),
            platform: "macos".to_string(),
        };
    }

    // Spawn the run loop thread that hosts the event tap.
    std::thread::spawn(|| {
        unsafe {
            let tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_DEFAULT,
                KB_EVENT_MASK,
                kb_tap_callback,
                std::ptr::null_mut(),
            );
            if tap.is_null() {
                return;
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap);
                return;
            }

            let rl = CFRunLoopGetCurrent();
            CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
            CGEventTapEnable(tap, true);

            INTERCEPT_ACTIVE.store(true, Ordering::SeqCst);
            if let Ok(mut guard) = tap_runloop().lock() {
                *guard = Some(SendPtr(rl));
            }

            CFRunLoopRun(); // blocks until CFRunLoopStop is called

            // Cleanup after stop
            INTERCEPT_ACTIVE.store(false, Ordering::SeqCst);
            CGEventTapEnable(tap, false);
            CFRelease(source);
            CFRelease(tap);
        }
    });

    // Give the thread a moment to start and set the flag.
    std::thread::sleep(std::time::Duration::from_millis(80));

    let active = INTERCEPT_ACTIVE.load(Ordering::SeqCst);
    KeyboardInterceptResult {
        active,
        method: if active {
            "cgeventtap".to_string()
        } else {
            "tap_create_failed".to_string()
        },
        platform: "macos".to_string(),
    }
}

/// Stop the CGEventTap run loop and deactivate keyboard intercept.
pub fn disable_keyboard_intercept() {
    INTERCEPT_ACTIVE.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = tap_runloop().lock() {
        if let Some(SendPtr(rl)) = guard.take() {
            unsafe { CFRunLoopStop(rl) };
        }
    }
}

/// Engage keyboard intercept and prevent display sleep during exam.
pub fn lock_desktop() -> bool {
    // Prevent display and system sleep via caffeinate -d (display) -i (idle)
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if pid_guard.is_none() {
            if let Ok(child) = Command::new("caffeinate").args(["-d", "-i"]).spawn() {
                *pid_guard = Some(child.id());
            }
        }
    }
    let result = enable_keyboard_intercept();
    result.active
}

/// Release keyboard intercept and allow display sleep again.
pub fn unlock_desktop() {
    disable_keyboard_intercept();
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if let Some(pid) = pid_guard.take() {
            let _ = Command::new("kill").arg(pid.to_string()).output();
        }
    }
}

/// Scan running processes for restricted applications.
///
/// Uses `ps -axco comm` which lists only the basename of each process executable.
pub fn scan_processes() -> ProcessScanResult {
    let output = Command::new("ps")
        .args(["-axco", "comm"])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });

    let stdout = String::from_utf8_lossy(&output.stdout);
    let running: Vec<&str> = stdout.lines().map(str::trim).collect();

    let found: Vec<String> = RESTRICTED
        .iter()
        .filter(|&&name| running.iter().any(|p| p.eq_ignore_ascii_case(name)))
        .map(|s| s.to_string())
        .collect();

    ProcessScanResult {
        clean: found.is_empty(),
        found,
    }
}

/// Detect whether the process is running inside a VM or hypervisor.
///
/// Checks `system_profiler SPHardwareDataType` model name and
/// `ioreg -l` for hypervisor markers.
pub fn detect_virtualization() -> VirtDetectionResult {
    let hw_output = Command::new("system_profiler")
        .arg("SPHardwareDataType")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    let ioreg_output = Command::new("ioreg")
        .args(["-l"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    let combined = format!("{hw_output}{ioreg_output}");

    let vm_markers: &[(&str, &str)] = &[
        ("vmware", "VMware"),
        ("parallels", "Parallels"),
        ("virtualbox", "VirtualBox"),
        ("qemu", "QEMU"),
        ("hyperv", "Hyper-V"),
        ("xen", "Xen"),
        ("utm ", "UTM"),
        ("apple virtualization", "Apple Virtualization"),
    ];

    for (marker, platform) in vm_markers {
        if combined.contains(marker) {
            return VirtDetectionResult {
                detected: true,
                platform: Some(platform.to_string()),
                confidence: "high".to_string(),
            };
        }
    }

    // Check sysctl for hypervisor bit
    let sysctl_out = Command::new("sysctl")
        .arg("kern.hv_support")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    if sysctl_out.contains(": 1") {
        return VirtDetectionResult {
            detected: true,
            platform: Some("hypervisor".to_string()),
            confidence: "medium".to_string(),
        };
    }

    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high".to_string(),
    }
}

/// Check whether the current desktop session has an active screen-sharing connection.
pub fn detect_remote_desktop() -> bool {
    // screensharingd is present when someone is viewing this screen remotely
    let output = Command::new("ps")
        .args(["-axco", "comm"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    let text = output.to_string();
    text.contains("screensharingd")
        || text.contains("remotedesktopagent")
        || text.contains("applescreencontrol")
}

/// Restrict outbound network traffic to `allowed_ips` using pfctl.
///
/// Requires root. Creates a pf anchor `com.amsaccess.proctor` with outbound
/// block-all rules except for the supplied IP list and loopback.
///
/// Rules persist across process crashes by design — call `disable_network_lockdown`
/// explicitly to restore normal access.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    // Enable pf (idempotent — already on = no-op exit code 1, harmless)
    let _ = Command::new("pfctl").arg("-e").output();

    let ip_list = allowed_ips.join(", ");
    let rules = format!(
        "table <ams_allowed> persist {{ {ip_list} }}\n\
         pass out quick on lo0 all\n\
         pass out quick to <ams_allowed>\n\
         block out all\n"
    );

    let rules_path = "/tmp/ams_pf_anchor.conf";
    std::fs::write(rules_path, &rules).map_err(|e| format!("write pf rules: {e}"))?;

    let out = Command::new("pfctl")
        .args(["-a", "com.amsaccess.proctor", "-f", rules_path])
        .output()
        .map_err(|e| format!("pfctl -f: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "pfctl anchor load failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(())
}

/// Remove the AMS pf anchor and restore unrestricted outbound access.
pub fn disable_network_lockdown() -> Result<(), String> {
    let out = Command::new("pfctl")
        .args(["-a", "com.amsaccess.proctor", "-F", "all"])
        .output()
        .map_err(|e| format!("pfctl flush: {e}"))?;

    if !out.status.success() {
        return Err(format!(
            "pfctl anchor flush failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    let _ = std::fs::remove_file("/tmp/ams_pf_anchor.conf");
    Ok(())
}
