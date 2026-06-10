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
use std::sync::{Arc, Condvar, Mutex, OnceLock};

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
    // local screen recording apps
    "QuickTime Player",
    "Kap",
    "CleanShot X",
    "Rottenwood",
    "ScreenFloat",
    "Recordit",
    "ScreenBrush",
    "OBS",
];

// ── Thread-safe raw pointer wrapper ──────────────────────────────────────────

struct SendPtr(*mut c_void);
// SAFETY: CoreFoundation objects are thread-safe for CFRunLoopStop/Release calls.
unsafe impl Send for SendPtr {}
unsafe impl Sync for SendPtr {}

// ── Global state ──────────────────────────────────────────────────────────────

static INTERCEPT_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESCAPE_BLOCKED: AtomicBool = AtomicBool::new(true);
static TAP_RUNLOOP: OnceLock<Mutex<Option<SendPtr>>> = OnceLock::new();
static TAP_STARTED: OnceLock<Arc<(Mutex<bool>, Condvar)>> = OnceLock::new();
static CAFFEINATE_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn tap_runloop() -> &'static Mutex<Option<SendPtr>> {
    TAP_RUNLOOP.get_or_init(|| Mutex::new(None))
}

fn tap_started() -> &'static Arc<(Mutex<bool>, Condvar)> {
    TAP_STARTED.get_or_init(|| Arc::new((Mutex::new(false), Condvar::new())))
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
// CGEventType values for trackpad gesture events (matches NSEventType* values)
const CG_EVENT_GESTURE: u32 = 29; // NSEventTypeGesture  — begin/end of any gesture
const CG_EVENT_SWIPE: u32 = 31; // NSEventTypeSwipe    — 3/4-finger space-switch swipe

// CGEventMask bits — keyboard + gesture/swipe (so the tap sees swipes too)
const KB_EVENT_MASK: u64 =
    (1u64 << CG_EVENT_KEY_DOWN) | (1u64 << CG_EVENT_KEY_UP) | (1u64 << CG_EVENT_FLAGS_CHANGED);
const FULL_LOCK_MASK: u64 = KB_EVENT_MASK | (1u64 << CG_EVENT_GESTURE) | (1u64 << CG_EVENT_SWIPE);

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
const VK_F: i64 = 3; // f key — Ctrl+Cmd+F toggles fullscreen
const VK_F3: i64 = 99; // Mission Control (default binding)
const VK_F4: i64 = 118; // Launchpad
const VK_F11: i64 = 103; // Show Desktop
const VK_UP: i64 = 126; // Ctrl+Up = Mission Control

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn CGEventTapIsEnabled(tap: *mut c_void) -> bool;
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

// Objective-C runtime — for NSRunningApplication space watchdog
extern "C" {
    fn objc_getClass(name: *const i8) -> *mut c_void;
    fn sel_registerName(name: *const i8) -> *const c_void;
    // Declared with no args; callers transmute to the right signature per call.
    fn objc_msgSend();
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
    // Layer 2: swallow 3/4-finger swipe and gesture events so WindowServer
    // never sees them and cannot switch spaces or open Mission Control.
    if event_type == CG_EVENT_SWIPE || event_type == CG_EVENT_GESTURE {
        return std::ptr::null_mut();
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
        // Ctrl+Cmd+Q (lock screen) — must come before plain Cmd+Q
        VK_Q if cmd && ctrl => true,
        // Cmd+Q (quit) — also covers any other Cmd+Q modifier combo
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
        // Bare Escape — skipped when Monaco is focused so editor can dismiss suggestions
        VK_ESCAPE if !cmd && !ctrl && !opt && !shift && ESCAPE_BLOCKED.load(Ordering::Relaxed) => {
            true
        }
        // Cmd+Shift+3/4/5 (screenshots)
        VK_3 | VK_4 | VK_5 if cmd && shift => true,
        // Ctrl+Up (Mission Control)
        VK_UP if ctrl => true,
        // F3 (Mission Control) and F4 (Launchpad) — blocked unconditionally
        // including Cmd+F3 (Show Desktop alternate binding)
        VK_F3 | VK_F4 => true,
        // F11 bare (Show Desktop on MacBook fn+F11)
        VK_F11 if !cmd && !ctrl && !opt && !shift => true,
        // Ctrl+Cmd+F (fullscreen toggle — would exit AMS fullscreen)
        VK_F if cmd && ctrl => true,
        _ => false,
    };

    if block {
        std::ptr::null_mut()
    } else {
        event
    }
}

// ── CGEventTap watchdog ───────────────────────────────────────────────────────

/// macOS silently disables a CGEventTap when its callback is slow enough that
/// the HID event queue overflows. This watchdog polls every 2 s and re-enables
/// the tap if that happens, also printing a line so the violation log can capture it.
fn start_tap_watchdog(tap: *mut c_void) {
    let tap_ptr = SendPtr(tap);
    std::thread::spawn(move || {
        // Rebind so Rust 2021 closure captures the whole SendPtr (which is Send),
        // not just the inner *mut c_void field (which is !Send).
        let tap_ptr = tap_ptr;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if !INTERCEPT_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            unsafe {
                if !CGEventTapIsEnabled(tap_ptr.0) {
                    CGEventTapEnable(tap_ptr.0, true);
                    eprintln!("AMS Access: CGEventTap was disabled by OS — re-enabling");
                }
            }
        }
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Allow bare Escape through when Monaco editor is focused so the editor can
/// dismiss autocomplete/suggestions without triggering the intercept.
pub fn set_escape_blocked(blocked: bool) {
    ESCAPE_BLOCKED.store(blocked, Ordering::SeqCst);
}

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
        // Open System Settings → Privacy & Security → Accessibility so the user
        // can grant the permission without searching for it manually.
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
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

    {
        let (lock, _) = &**tap_started();
        if let Ok(mut started) = lock.lock() {
            *started = false;
        }
    }

    let started = tap_started().clone();

    // Spawn the run loop thread that hosts the event tap.
    std::thread::spawn(move || {
        unsafe {
            let tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_DEFAULT,
                FULL_LOCK_MASK, // includes gesture/swipe bits for space-switch prevention
                kb_tap_callback,
                std::ptr::null_mut(),
            );

            let signal_ready = || {
                let (lock, cvar) = &*started;
                if let Ok(mut ready) = lock.lock() {
                    *ready = true;
                    cvar.notify_one();
                }
            };

            if tap.is_null() {
                signal_ready();
                return;
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap);
                signal_ready();
                return;
            }

            let rl = CFRunLoopGetCurrent();
            CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
            CGEventTapEnable(tap, true);

            INTERCEPT_ACTIVE.store(true, Ordering::SeqCst);
            if let Ok(mut guard) = tap_runloop().lock() {
                *guard = Some(SendPtr(rl));
            }

            signal_ready();
            start_tap_watchdog(tap);
            CFRunLoopRun(); // blocks until CFRunLoopStop is called

            // Cleanup after stop
            INTERCEPT_ACTIVE.store(false, Ordering::SeqCst);
            CGEventTapEnable(tap, false);
            CFRelease(source);
            CFRelease(tap);
        }
    });

    let (lock, cvar) = &**tap_started();
    if let Ok(ready) = lock.lock() {
        let _wait_result =
            cvar.wait_timeout_while(ready, std::time::Duration::from_millis(500), |ready| {
                !*ready
            });
    }

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

// ── Layer 1: disable/restore trackpad space-switching gesture ────────────────

/// Write trackpad prefs to disable (or restore) 3-finger and 4-finger
/// horizontal swipes used for Mission Control space switching.
/// `killall cfprefsd` flushes the pref cache so the change takes effect
/// immediately without requiring a logout.
fn set_swipe_gesture_enabled(enabled: bool) {
    let value = if enabled { "2" } else { "0" };
    let domains = [
        "com.apple.AppleMultitouchTrackpad",
        "com.apple.driver.AppleBluetoothMultitouch.trackpad",
    ];
    let keys = [
        "TrackpadThreeFingerHorizSwipeGesture",
        "TrackpadFourFingerHorizSwipeGesture",
    ];
    for domain in domains {
        for key in keys {
            let _ = Command::new("defaults")
                .args(["write", domain, key, "-int", value])
                .output();
        }
    }
    // Flush the preferences daemon so the new values are read by the Dock.
    let _ = Command::new("killall").arg("cfprefsd").output();
}

// ── Layer 3: space watchdog ───────────────────────────────────────────────────

/// Poll every 400 ms; if our app is no longer the frontmost application
/// (e.g. the user managed to switch spaces), activate it immediately.
///
/// Uses NSRunningApplication via raw Objective-C message sends so we don't
/// need an extra crate dependency.
fn spawn_space_watchdog() {
    let our_pid = std::process::id() as i32;
    std::thread::spawn(move || {
        // Pre-cache selectors — sel_registerName is thread-safe.
        let sel_for_pid = unsafe {
            sel_registerName(b"runningApplicationWithProcessIdentifier:\0".as_ptr() as *const i8)
        };
        let sel_frontmost = unsafe { sel_registerName(b"isFrontmost\0".as_ptr() as *const i8) };
        let sel_activate =
            unsafe { sel_registerName(b"activateWithOptions:\0".as_ptr() as *const i8) };

        loop {
            std::thread::sleep(std::time::Duration::from_millis(400));
            if !INTERCEPT_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            unsafe {
                let cls = objc_getClass(b"NSRunningApplication\0".as_ptr() as *const i8);
                if cls.is_null() {
                    continue;
                }

                // +[NSRunningApplication runningApplicationWithProcessIdentifier:pid]
                type FnForPid =
                    unsafe extern "C" fn(*mut c_void, *const c_void, i32) -> *mut c_void;
                let send_for_pid: FnForPid = std::mem::transmute(objc_msgSend as *const ());
                let app = send_for_pid(cls, sel_for_pid, our_pid);
                if app.is_null() {
                    continue;
                }

                // -[app isFrontmost]  →  BOOL (u8)
                type FnBool = unsafe extern "C" fn(*mut c_void, *const c_void) -> u8;
                let send_bool: FnBool = std::mem::transmute(objc_msgSend as *const ());
                let frontmost = send_bool(app, sel_frontmost);

                if frontmost == 0 {
                    // -[app activateWithOptions:NSApplicationActivateIgnoringOtherApps]
                    // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
                    type FnActivate = unsafe extern "C" fn(*mut c_void, *const c_void, u64) -> u8;
                    let send_act: FnActivate = std::mem::transmute(objc_msgSend as *const ());
                    send_act(app, sel_activate, 2u64);
                }
            }
        }
    });
}

/// Engage keyboard intercept and prevent display sleep during exam.
/// Also disables trackpad space-switching gestures (Layer 1) and starts
/// the space watchdog (Layer 3). Layer 2 (CGEventTap swipe intercept) is
/// active as soon as the tap is installed with FULL_LOCK_MASK.
pub fn lock_desktop() -> bool {
    // Prevent display and system sleep via caffeinate -d (display) -i (idle)
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if pid_guard.is_none() {
            if let Ok(child) = Command::new("caffeinate").args(["-d", "-i"]).spawn() {
                *pid_guard = Some(child.id());
            }
        }
    }
    // Layer 1: disable the OS-level gesture so Dock never sees the swipe.
    set_swipe_gesture_enabled(false);
    let result = enable_keyboard_intercept();
    if result.active {
        // Layer 3: watchdog brings us back if user still manages to switch.
        spawn_space_watchdog();
    }
    result.active
}

/// Release keyboard intercept, restore space-switching gestures, and allow
/// display sleep again.
pub fn unlock_desktop() {
    disable_keyboard_intercept();
    // Layer 1: restore gesture so the user can use their trackpad normally.
    set_swipe_gesture_enabled(true);
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if let Some(pid) = pid_guard.take() {
            let _ = Command::new("kill").arg(pid.to_string()).output();
        }
    }
}

/// Scan running processes for restricted applications.
///
/// Uses `ps -axo command=` (full command path, no header) to avoid the 15-char
/// truncation that `ps -axco comm` applies.  We extract the basename for matching
/// so "QuickTime Player" in the RESTRICTED list matches
/// `/Applications/QuickTime Player.app/Contents/MacOS/QuickTime Player`.
pub fn scan_processes() -> ProcessScanResult {
    let output = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Extract the last path component of each line (everything after the final '/').
    // Also keep the raw line so multi-word names that don't contain '/' still match.
    let running: Vec<String> = stdout
        .lines()
        .map(|line| {
            let line = line.trim();
            // Strip any CLI arguments (first word only for path-based processes)
            let cmd = line.split_whitespace().next().unwrap_or(line);
            cmd.rsplit('/').next().unwrap_or(cmd).to_string()
        })
        .collect();

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
/// Checks CPUID hypervisor leaf first (cannot be spoofed without paravirt config),
/// then `system_profiler SPHardwareDataType` and `ioreg -l` for hypervisor markers.
pub fn detect_virtualization() -> VirtDetectionResult {
    // CPUID leaf 0x40000000 — x86/x86_64 only; ARM Macs skip this path
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        let cpuid = raw_cpuid::CpuId::with_cpuid_fn(raw_cpuid::CpuIdReaderNative);
        if let Some(hv) = cpuid.get_hypervisor_info() {
            let platform = match hv.identify() {
                raw_cpuid::Hypervisor::VMware => "vmware",
                raw_cpuid::Hypervisor::KVM => "kvm",
                raw_cpuid::Hypervisor::Xen => "xen",
                raw_cpuid::Hypervisor::HyperV => "hyperv",
                raw_cpuid::Hypervisor::Bhyve => "bhyve",
                _ => "unknown_hypervisor",
            };
            return VirtDetectionResult {
                detected: true,
                platform: Some(platform.to_string()),
                confidence: "high".to_string(),
            };
        }
    }

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

    // Use specific substrings that only appear in actual VM environments.
    // "xen" alone is too broad — ioreg -l is enormous and can contain "xen" in
    // unrelated device or property names on real hardware. kern.hv_support is
    // always 1 on Apple Silicon (native CPU capability), not a VM indicator.
    let vm_markers: &[(&str, &str)] = &[
        ("vmware", "VMware"),
        ("parallels", "Parallels"),
        ("virtualbox", "VirtualBox"),
        ("qemu", "QEMU"),
        ("hyperv", "Hyper-V"),
        // Require xen-specific driver/vendor strings, not just "xen" substring
        ("xenbus", "Xen"),
        ("xensource", "Xen"),
        ("xen hypervisor", "Xen"),
        ("utm ", "UTM"),
        ("apple virtualization framework", "Apple Virtualization"),
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

    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high".to_string(),
    }
}

/// Check whether any remote desktop or screen-sharing session is active.
pub fn detect_remote_desktop() -> bool {
    let ps = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default()
        .to_string();

    // Built-in macOS Screen Sharing (VNC server daemon)
    if ps.contains("screensharingd") {
        return true;
    }
    // Apple Remote Desktop agent
    if ps.contains("remotedesktopagent") {
        return true;
    }
    // macOS 12+ Screen Sharing controller
    if ps.contains("applescreencontrol") {
        return true;
    }
    // Third-party remote-access tools
    if ps.contains("teamvieweragent") {
        return true;
    }
    if ps.contains("anydesk") {
        return true;
    }
    if ps.contains("rustdesk") {
        return true;
    }
    if ps.contains("jump desktop connect") {
        return true;
    }

    // SSH session with X11 forwarding — the remote peer can see the display
    if std::env::var("SSH_CONNECTION").is_ok() && std::env::var("DISPLAY").is_ok() {
        return true;
    }

    false
}

// ── Privileged helper client ──────────────────────────────────────────────────
//
// All pfctl operations are delegated to com.ams.access.networkhelper, a root
// LaunchDaemon installed under /Library/LaunchDaemons.  The main app connects
// over a Unix domain socket at HELPER_SOCKET.  This avoids every pfctl call
// requiring root in the main process.

const HELPER_SOCKET: &str = "/private/var/run/ams-proctor.sock";
const HELPER_BINARY_DEST: &str = "/Library/PrivilegedHelperTools/com.ams.access.networkhelper";
const HELPER_PLIST_DEST: &str = "/Library/LaunchDaemons/com.ams.access.networkhelper.plist";
const HELPER_CLIENT_CONFIG_DEST: &str =
    "/Library/Application Support/AMS Access/network-helper-client.conf";
const HELPER_CONFIG_DIR: &str = "/Library/Application Support/AMS Access";

/// Check whether the helper daemon socket is reachable and accepts this app.
pub fn network_helper_running() -> bool {
    helper_send(r#"{"cmd":"ping"}"#).is_ok()
}

/// Install the helper binary and LaunchDaemon plist, then bootstrap the daemon.
///
/// `helper_binary` — path to the compiled `com.ams.access.networkhelper` binary
///   (typically inside the .app bundle at Contents/MacOS/).
/// `plist_source`  — path to the bundled `.plist` file.
///
/// Both copy operations and `launchctl bootstrap` require root, so this function
/// uses `osascript` to request administrator credentials via the standard macOS
/// auth dialog. The dialog shows the reason string so the candidate understands
/// why elevation is needed.
pub fn install_network_helper(
    helper_binary: &str,
    plist_source: &str,
    client_binary: &str,
) -> Result<(), String> {
    let helper_binary = applescript_string(helper_binary);
    let plist_source = applescript_string(plist_source);
    let client_binary = applescript_string(client_binary);

    let script = format!(
        r#"set helperBinary to "{helper_binary}"
set plistSource to "{plist_source}"
set clientBinary to "{client_binary}"
set helperDest to "{HELPER_BINARY_DEST}"
set plistDest to "{HELPER_PLIST_DEST}"
set configDir to "{HELPER_CONFIG_DIR}"
set clientConfig to "{HELPER_CLIENT_CONFIG_DEST}"
do shell script "/bin/mkdir -p " & quoted form of configDir & " && (/bin/launchctl bootout system " & quoted form of plistDest & " 2>/dev/null || true) && /usr/bin/install -o root -g wheel -m 755 " & quoted form of helperBinary & " " & quoted form of helperDest & " && /usr/bin/install -o root -g wheel -m 644 " & quoted form of plistSource & " " & quoted form of plistDest & " && /usr/bin/printf '%s\n' " & quoted form of clientBinary & " > " & quoted form of clientConfig & " && /usr/sbin/chown root:wheel " & quoted form of clientConfig & " && /bin/chmod 644 " & quoted form of clientConfig & " && /bin/launchctl bootstrap system " & quoted form of plistDest with administrator privileges with prompt "AMS Access needs to install a network component to restrict internet access during the exam. Enter your Mac password to continue.""#
    );

    let out = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // Exit code 1 from osascript when the user cancels the auth dialog.
        if stderr.contains("cancelled") || stderr.contains("(-128)") {
            return Err("admin_auth_cancelled".to_string());
        }
        return Err(stderr.trim().to_string());
    }

    // Give the daemon up to 3 s to create its socket before we return.
    for _ in 0..30 {
        if network_helper_running() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Err("helper installed but socket not ready within 3 s".to_string())
}

fn applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Uninstall the helper — stop the daemon and remove its files.
///
/// Requires admin privileges (osascript elevation).
pub fn uninstall_network_helper() -> Result<(), String> {
    let script = format!(
        r#"do shell script "
            /bin/launchctl bootout system '{HELPER_PLIST_DEST}' 2>/dev/null || true &&
            /bin/rm -f '{HELPER_BINARY_DEST}' '{HELPER_PLIST_DEST}' '{HELPER_CLIENT_CONFIG_DEST}'
        " with administrator privileges"#
    );
    let out = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/// Send a JSON command to the helper and return its response.
fn helper_send(json: &str) -> Result<(), String> {
    use std::io::{BufRead, BufReader, Write};

    let stream = std::os::unix::net::UnixStream::connect(HELPER_SOCKET)
        .map_err(|e| format!("connect to helper: {e}"))?;

    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();

    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    writeln!(writer, "{json}").map_err(|e| format!("send: {e}"))?;

    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    reader
        .read_line(&mut response)
        .map_err(|e| format!("read response: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(response.trim())
        .map_err(|e| format!("invalid helper response: {e}"))?;

    if parsed.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(parsed
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("helper command failed")
            .to_string())
    }
}

/// Restrict outbound network traffic via the privileged helper.
///
/// The helper runs pfctl as root — this function needs no elevated privileges.
/// If the helper is not installed, returns `Err("helper_not_installed")`.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    if !network_helper_running() {
        return Err("helper_not_installed".to_string());
    }

    let request = serde_json::json!({
        "cmd": "enable",
        "ips": allowed_ips,
    })
    .to_string();

    helper_send(&request)
}

/// Lift the network lockdown via the privileged helper.
pub fn disable_network_lockdown() -> Result<(), String> {
    if !network_helper_running() {
        // Nothing to flush — helper isn't running, rules can't be active.
        return Ok(());
    }
    helper_send(r#"{"cmd":"disable"}"#)
}

// ── Screen recording detection ────────────────────────────────────────────────

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(std::path::PathBuf::from)
}

/// Query the TCC database for apps that have been granted `kTCCServiceScreenCapture`.
///
/// Returns bundle IDs / process names of every app the user previously allowed to
/// capture the screen. The caller cross-references this against RESTRICTED and the
/// live process list to decide whether to block entry.
///
/// Returns an empty vec if the database cannot be opened (sandboxed builds without
/// FDA will silently fail here — treat as unknown, not clean).
pub fn apps_with_screen_capture_permission() -> Vec<String> {
    let Some(path) = home_dir().map(|h| h.join("Library/Application Support/com.apple.TCC/TCC.db"))
    else {
        return vec![];
    };
    if !path.exists() {
        return vec![];
    }

    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) else {
        return vec![];
    };

    let Ok(mut stmt) = conn.prepare(
        "SELECT client FROM access \
         WHERE service = 'kTCCServiceScreenCapture' \
         AND auth_value = 2",
    ) else {
        return vec![];
    };

    stmt.query_map([], |row| row.get::<_, String>(0))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

/// Detect whether a local screen-recording session is actively running.
///
/// Distinct from `detect_remote_desktop` (inbound remote-control sessions).
/// This checks for local tools the candidate might use to stream their screen
/// to another device.
///
/// Strategy: scan the live process list for known recording-app executables.
/// The ScreenCaptureKit `SCContentSharingSession` API (macOS 14.2+ for
/// programmatic detection) will be the production-grade path once
/// objc2-screencapturekit crate bindings stabilise.
pub fn detect_active_screen_share() -> bool {
    const LOCAL_RECORDERS: &[&str] = &[
        "QuickTime Player",
        "Kap",
        "CleanShot X",
        "Rottenwood",
        "ScreenFloat",
        "Recordit",
        "ScreenBrush",
        "obs",
        "OBS",
    ];

    let ps = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    LOCAL_RECORDERS.iter().any(|name| {
        ps.lines().any(|line| {
            let basename = line
                .trim()
                .split_whitespace()
                .next()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("");
            basename.eq_ignore_ascii_case(name)
        })
    })
}
