//! macOS-specific lockdown implementation for AMS-Access-Proctor.
//!
//! Keyboard intercept: CGEventTap (requires Accessibility permission).
//! Sleep prevention: caffeinate subprocess.
//! Network lockdown: pfctl anchor (requires root).
//! Process scanning: `ps -axco comm`.
//! VM detection: `system_profiler SPHardwareDataType` + `ioreg`.

use block2::RcBlock;
use core_rs::exam::{
    CloseAppsResult, KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult,
};
use std::ffi::c_void;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
// Ensures the Accessibility consent dialog / System Settings deep-link fires at
// most once per app run — readiness rescans must not spam Settings windows.
static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);
// Monotonic id for each tap install. A dying tap thread (and its watchdog) may
// outlive a rapid disable→enable cycle; both compare their stamped generation
// against this counter so they never clobber or re-enable a newer tap's state.
static TAP_GENERATION: AtomicU64 = AtomicU64::new(0);
static TAP_RUNLOOP: OnceLock<Mutex<Option<SendPtr>>> = OnceLock::new();
static TAP_STARTED: OnceLock<Arc<(Mutex<bool>, Condvar)>> = OnceLock::new();
static CAFFEINATE_PID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();
// Retained NSNotificationCenter observer token for the space-switch observer.
static SPACE_OBSERVER: OnceLock<Mutex<Option<SendPtr>>> = OnceLock::new();
// Host-app sink for security events raised from background lockdown threads
// (Accessibility revoked mid-exam, screen sharing detected, …). platform-rs
// must not depend on tauri, so the desktop shell registers a closure here.
type LockdownEventCallback = Box<dyn Fn(&str, &str) + Send + Sync>;
static LOCKDOWN_EVENT_CALLBACK: OnceLock<LockdownEventCallback> = OnceLock::new();

/// Register the host-application sink for lockdown security events.
///
/// `callback(kind, detail)` is invoked from background threads (tap watchdog,
/// scan paths) — it must be cheap and non-blocking. Only the first
/// registration per process wins; later calls are ignored.
pub fn set_lockdown_event_callback<F>(callback: F)
where
    F: Fn(&str, &str) + Send + Sync + 'static,
{
    let _ = LOCKDOWN_EVENT_CALLBACK.set(Box::new(callback));
}

/// Raise a security event to the host app (and stderr as a fallback trail).
fn emit_lockdown_event(kind: &str, detail: &str) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = LOCKDOWN_EVENT_CALLBACK.get() {
        callback(kind, detail);
    }
}

fn tap_runloop() -> &'static Mutex<Option<SendPtr>> {
    TAP_RUNLOOP.get_or_init(|| Mutex::new(None))
}

fn space_observer() -> &'static Mutex<Option<SendPtr>> {
    SPACE_OBSERVER.get_or_init(|| Mutex::new(None))
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
// CGEventTapLocation — fallback at the login-session level; some macOS
// configurations refuse active HID-level taps for non-root processes
const K_CG_SESSION_EVENT_TAP: u32 = 1;
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

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    // NSString constants for media types
    static AVMediaTypeVideo: *mut c_void;
    static AVMediaTypeAudio: *mut c_void;
    // AVCaptureDevice class method: requestAccessForMediaType:completionHandler:
    // Called as +[AVCaptureDevice requestAccessForMediaType:completionHandler:]
}

#[allow(non_upper_case_globals)]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    // CFStringRef option key for AXIsProcessTrustedWithOptions — when paired with
    // kCFBooleanTrue the call registers this app in System Settings → Privacy &
    // Security → Accessibility and shows the system consent dialog.
    static kAXTrustedCheckOptionPrompt: *const c_void;
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
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
    static kCFBooleanTrue: *const c_void;
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
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        c_str: *const i8,
        encoding: u32,
    ) -> *mut c_void;
    fn CFDictionaryGetValue(dict: *mut c_void, key: *const c_void) -> *const c_void;
    fn CFBooleanGetValue(boolean: *const c_void) -> bool;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    // Returns a retained CFDictionaryRef describing the current WindowServer
    // session, or null when there is no session (e.g. SSH-only login).
    fn CGSessionCopyCurrentDictionary() -> *mut c_void;
}

#[allow(non_upper_case_globals)]
#[link(name = "AppKit", kind = "framework")]
extern "C" {
    // NSNotificationName posted by NSWorkspace the moment any app becomes
    // frontmost — drives the event-driven space/focus watchdog.
    static NSWorkspaceDidActivateApplicationNotification: *mut c_void;
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
/// the tap if that happens. It also distinguishes that benign timeout from the
/// hostile case — the user revoking Accessibility mid-exam, after which
/// re-enabling fails and keys would silently flow again — and reports both
/// through `emit_lockdown_event` so the violation/proctoring logs capture them.
///
/// The tap pointer is shared with the run-loop thread through a mutex-guarded
/// cell: the cleanup path takes the pointer out under the lock before releasing
/// it, so this thread can never touch a freed CFMachPort. The generation stamp
/// makes the watchdog exit when a newer tap supersedes this one — checked
/// before `INTERCEPT_ACTIVE`, which may already be true again for the new tap.
fn start_tap_watchdog(tap_cell: Arc<Mutex<Option<SendPtr>>>, generation: u64) {
    std::thread::spawn(move || {
        // Edge-triggered reporting: one event per state change, not per tick.
        let mut revocation_reported = false;
        let mut reenable_failure_reported = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            if TAP_GENERATION.load(Ordering::SeqCst) != generation
                || !INTERCEPT_ACTIVE.load(Ordering::SeqCst)
            {
                break;
            }

            let trusted = unsafe { AXIsProcessTrusted() };
            if !trusted && !revocation_reported {
                revocation_reported = true;
                emit_lockdown_event(
                    "keyboard_lockdown_lost",
                    "Accessibility permission was revoked mid-session; \
                     keyboard intercept cannot be re-enabled until it is restored",
                );
            }

            let Ok(cell) = tap_cell.lock() else {
                break;
            };
            let Some(tap) = cell.as_ref() else {
                break;
            };
            unsafe {
                if !CGEventTapIsEnabled(tap.0) {
                    CGEventTapEnable(tap.0, true);
                    if CGEventTapIsEnabled(tap.0) {
                        emit_lockdown_event(
                            "keyboard_tap_reenabled",
                            "CGEventTap was disabled by the OS and has been re-enabled",
                        );
                        revocation_reported = false;
                        reenable_failure_reported = false;
                    } else if trusted && !reenable_failure_reported {
                        reenable_failure_reported = true;
                        emit_lockdown_event(
                            "keyboard_lockdown_lost",
                            "CGEventTap was disabled and could not be re-enabled",
                        );
                    }
                } else {
                    reenable_failure_reported = false;
                    if trusted && revocation_reported {
                        revocation_reported = false;
                        emit_lockdown_event(
                            "keyboard_lockdown_restored",
                            "Accessibility permission restored; keyboard intercept active",
                        );
                    }
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

/// Request Accessibility permission with the system consent dialog.
///
/// `AXIsProcessTrusted()` only *reads* the current state — it never registers
/// the app in System Settings → Privacy & Security → Accessibility. Until the
/// app is registered there is no row for the user to toggle, so deep-linking
/// into the pane alone looks broken. `AXIsProcessTrustedWithOptions` with
/// `kAXTrustedCheckOptionPrompt = true` both registers the app in the list and
/// shows the standard "would like to control this computer" dialog.
///
/// Returns the current trust state (false until the user grants and the grant
/// propagates).
fn prompt_accessibility_permission() -> bool {
    unsafe {
        let cls = objc_getClass(c"NSDictionary".as_ptr());
        if cls.is_null() {
            return AXIsProcessTrusted();
        }
        let sel = sel_registerName(c"dictionaryWithObject:forKey:".as_ptr());
        // +[NSDictionary dictionaryWithObject:forKey:] — kCFBooleanTrue and
        // kAXTrustedCheckOptionPrompt are toll-free bridged to NSNumber/NSString.
        type FnDict = unsafe extern "C" fn(
            *mut c_void,
            *const c_void,
            *const c_void,
            *const c_void,
        ) -> *mut c_void;
        let make_dict: FnDict = std::mem::transmute(objc_msgSend as *const ());
        let options = make_dict(cls, sel, kCFBooleanTrue, kAXTrustedCheckOptionPrompt);
        if options.is_null() {
            return AXIsProcessTrusted();
        }
        AXIsProcessTrustedWithOptions(options)
    }
}

/// Install a CGEventTap that blocks exam-escape key combos.
///
/// Requires Accessibility permission in System Preferences → Privacy & Security.
/// Spawns a dedicated thread that runs the CoreFoundation run loop.
pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    if !check_accessibility_permission() {
        // First denial in this run: fire the system consent dialog (which also
        // registers the app in the Accessibility list) and open System Settings
        // → Privacy & Security → Accessibility so the user lands on the toggle.
        // Subsequent rescans stay silent — no Settings-window spam.
        if !ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst) {
            let granted = prompt_accessibility_permission();
            if !granted {
                let _ = std::process::Command::new("open")
                    .arg(
                        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                    )
                    .spawn();
            }
        }
        if !check_accessibility_permission() {
            return KeyboardInterceptResult {
                active: false,
                method: "accessibility_denied".to_string(),
                platform: "macos".to_string(),
            };
        }
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
    // Stamp this install BEFORE spawning so any straggler cleanup/watchdog from
    // a previous generation immediately sees itself superseded.
    let generation = TAP_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // Spawn the run loop thread that hosts the event tap.
    std::thread::spawn(move || {
        unsafe {
            let mut tap = CGEventTapCreate(
                K_CG_HID_EVENT_TAP,
                K_CG_HEAD_INSERT_EVENT_TAP,
                K_CG_EVENT_TAP_OPTION_DEFAULT,
                FULL_LOCK_MASK, // includes gesture/swipe bits for space-switch prevention
                kb_tap_callback,
                std::ptr::null_mut(),
            );
            if tap.is_null() {
                // Some configurations refuse active HID-level taps for non-root
                // processes even with Accessibility granted; the session-level
                // tap still sees all keyboard events before app dispatch.
                tap = CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_DEFAULT,
                    FULL_LOCK_MASK,
                    kb_tap_callback,
                    std::ptr::null_mut(),
                );
            }

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
            let tap_cell = Arc::new(Mutex::new(Some(SendPtr(tap))));
            start_tap_watchdog(tap_cell.clone(), generation);
            CFRunLoopRun(); // blocks until CFRunLoopStop is called

            // Cleanup after stop. Guarded by generation: if a rapid
            // disable→enable already installed a newer tap, this dying thread
            // must not clear the new tap's active flag.
            if TAP_GENERATION.load(Ordering::SeqCst) == generation {
                INTERCEPT_ACTIVE.store(false, Ordering::SeqCst);
            }
            // Take the pointer out under the lock so the watchdog can never
            // observe (and re-enable) a tap that is about to be freed.
            if let Ok(mut cell) = tap_cell.lock() {
                if let Some(SendPtr(tap)) = cell.take() {
                    CGEventTapEnable(tap, false);
                    CFRelease(tap);
                }
            }
            CFRelease(source);
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

const GESTURE_DOMAINS: [&str; 2] = [
    "com.apple.AppleMultitouchTrackpad",
    "com.apple.driver.AppleBluetoothMultitouch.trackpad",
];
const GESTURE_KEYS: [&str; 2] = [
    "TrackpadThreeFingerHorizSwipeGesture",
    "TrackpadFourFingerHorizSwipeGesture",
];

/// Write trackpad prefs to disable (or restore) 3-finger and 4-finger
/// horizontal swipes used for Mission Control space switching.
/// `killall cfprefsd` flushes the pref cache so the change takes effect
/// immediately without requiring a logout.
fn set_swipe_gesture_enabled(enabled: bool) {
    let value = if enabled { "2" } else { "0" };
    for domain in GESTURE_DOMAINS {
        for key in GESTURE_KEYS {
            let _ = Command::new("defaults")
                .args(["write", domain, key, "-int", value])
                .output();
        }
    }
    // Flush the preferences daemon so the new values are read by the Dock.
    let _ = Command::new("killall").arg("cfprefsd").output();
}

// ── Crash-safe lockdown state ─────────────────────────────────────────────────
//
// Gesture prefs are written with `defaults write`, which persists across app
// crashes and reboots. Without a journal, a crash mid-exam leaves the
// candidate's trackpad gestures disabled forever and the caffeinate child
// running orphaned. The state file records the original pref values (and the
// caffeinate pid) before lockdown touches them; unlock — or crash recovery on
// the next launch — restores from it.

#[derive(serde::Serialize, serde::Deserialize)]
struct GesturePref {
    domain: String,
    key: String,
    /// Original value as printed by `defaults read`; None = key was unset.
    value: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct LockdownState {
    gestures: Vec<GesturePref>,
    caffeinate_pid: Option<u32>,
}

fn lockdown_state_path() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join("Library/Application Support/AMS Access/lockdown-state.json"))
}

fn read_default(domain: &str, key: &str) -> Option<String> {
    let out = Command::new("defaults")
        .args(["read", domain, key])
        .output()
        .ok()?;
    if !out.status.success() {
        // Non-zero exit means the key is not set in this domain.
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Snapshot the pre-lockdown gesture prefs and caffeinate pid.
///
/// If a state file already exists (previous crash, re-entrant lock), it is kept
/// — it holds the *original* user values and must not be overwritten with our
/// own lockdown values.
fn save_lockdown_state(caffeinate_pid: Option<u32>) {
    let Some(path) = lockdown_state_path() else {
        return;
    };
    if path.exists() {
        return;
    }
    let gestures = GESTURE_DOMAINS
        .iter()
        .flat_map(|domain| {
            GESTURE_KEYS.iter().map(move |key| GesturePref {
                domain: (*domain).to_string(),
                key: (*key).to_string(),
                value: read_default(domain, key),
            })
        })
        .collect();
    let state = LockdownState {
        gestures,
        caffeinate_pid,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = std::fs::write(&path, json);
    }
}

/// Kill `pid` only if it is still a caffeinate process — guards against pid
/// reuse when restoring from a stale state file.
fn kill_if_caffeinate(pid: u32) {
    let is_caffeinate = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .ends_with("caffeinate")
        })
        .unwrap_or(false);
    if is_caffeinate {
        let _ = Command::new("kill").arg(pid.to_string()).output();
    }
}

/// Restore gesture prefs and reap caffeinate from the state file.
///
/// Returns true if a state file was found and processed.
fn restore_lockdown_state() -> bool {
    let Some(path) = lockdown_state_path() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    if let Ok(state) = serde_json::from_str::<LockdownState>(&raw) {
        for pref in &state.gestures {
            match &pref.value {
                Some(value) => {
                    let _ = Command::new("defaults")
                        .args(["write", &pref.domain, &pref.key, "-int", value])
                        .output();
                }
                None => {
                    let _ = Command::new("defaults")
                        .args(["delete", &pref.domain, &pref.key])
                        .output();
                }
            }
        }
        let _ = Command::new("killall").arg("cfprefsd").output();
        if let Some(pid) = state.caffeinate_pid {
            kill_if_caffeinate(pid);
        }
    }
    let _ = std::fs::remove_file(&path);
    true
}

/// Run once at app startup, before any lockdown call: if a state file is
/// present the previous session crashed mid-lockdown — restore the user's
/// gesture prefs and kill the orphaned caffeinate.
pub fn recover_lockdown_if_crashed() {
    restore_lockdown_state();
}

// ── Layer 3: space watchdog ───────────────────────────────────────────────────

/// If our app is no longer the frontmost application (e.g. the user managed to
/// switch spaces), activate it immediately.
///
/// Uses NSRunningApplication via raw Objective-C message sends so we don't
/// need an extra crate dependency. NSRunningApplication is documented as
/// thread-safe, so this may be called from any thread.
unsafe fn refocus_our_app() {
    let our_pid = std::process::id() as i32;
    let cls = objc_getClass(c"NSRunningApplication".as_ptr());
    if cls.is_null() {
        return;
    }
    let sel_for_pid = sel_registerName(c"runningApplicationWithProcessIdentifier:".as_ptr());
    let sel_frontmost = sel_registerName(c"isFrontmost".as_ptr());
    let sel_activate = sel_registerName(c"activateWithOptions:".as_ptr());

    // +[NSRunningApplication runningApplicationWithProcessIdentifier:pid]
    type FnForPid = unsafe extern "C" fn(*mut c_void, *const c_void, i32) -> *mut c_void;
    let send_for_pid: FnForPid = std::mem::transmute(objc_msgSend as *const ());
    let app = send_for_pid(cls, sel_for_pid, our_pid);
    if app.is_null() {
        return;
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

/// Layer 3a (primary, event-driven): refocus the instant ANY app becomes
/// frontmost. NSWorkspace posts `didActivateApplicationNotification`
/// immediately on activation, so there is no polling-interval escape window
/// and no battery cost while nothing changes. Idempotent — a second install
/// while an observer is registered is a no-op.
fn install_space_observer() {
    let Ok(mut guard) = space_observer().lock() else {
        return;
    };
    if guard.is_some() {
        return;
    }

    // The notification center copies the block on registration, so the
    // RcBlock may drop when this function returns. Built outside the unsafe
    // block below so its body carries its own explicit unsafe scope.
    let handler = RcBlock::new(|_notification: *mut c_void| {
        if INTERCEPT_ACTIVE.load(Ordering::SeqCst) {
            unsafe { refocus_our_app() };
        }
    });

    unsafe {
        let ws_cls = objc_getClass(c"NSWorkspace".as_ptr());
        let queue_cls = objc_getClass(c"NSOperationQueue".as_ptr());
        if ws_cls.is_null() || queue_cls.is_null() {
            return;
        }

        type FnObj = unsafe extern "C" fn(*mut c_void, *const c_void) -> *mut c_void;
        let send_obj: FnObj = std::mem::transmute(objc_msgSend as *const ());
        let workspace = send_obj(ws_cls, sel_registerName(c"sharedWorkspace".as_ptr()));
        let main_queue = send_obj(queue_cls, sel_registerName(c"mainQueue".as_ptr()));
        if workspace.is_null() || main_queue.is_null() {
            return;
        }
        let center = send_obj(workspace, sel_registerName(c"notificationCenter".as_ptr()));
        if center.is_null() {
            return;
        }

        // -[NSNotificationCenter addObserverForName:object:queue:usingBlock:]
        type FnAddObserver = unsafe extern "C" fn(
            *mut c_void,
            *const c_void,
            *mut c_void,
            *mut c_void,
            *mut c_void,
            &block2::Block<dyn Fn(*mut c_void)>,
        ) -> *mut c_void;
        let add_observer: FnAddObserver = std::mem::transmute(objc_msgSend as *const ());
        let token = add_observer(
            center,
            sel_registerName(c"addObserverForName:object:queue:usingBlock:".as_ptr()),
            NSWorkspaceDidActivateApplicationNotification,
            std::ptr::null_mut(),
            main_queue,
            &handler,
        );
        if token.is_null() {
            return;
        }
        // The token is autoreleased — retain it so it survives until removal.
        let retained = send_obj(token, sel_registerName(c"retain".as_ptr()));
        *guard = Some(SendPtr(retained));
    }
}

/// Remove and release the space observer registered by `install_space_observer`.
fn remove_space_observer() {
    let Ok(mut guard) = space_observer().lock() else {
        return;
    };
    let Some(SendPtr(token)) = guard.take() else {
        return;
    };
    unsafe {
        type FnObj = unsafe extern "C" fn(*mut c_void, *const c_void) -> *mut c_void;
        let send_obj: FnObj = std::mem::transmute(objc_msgSend as *const ());
        let ws_cls = objc_getClass(c"NSWorkspace".as_ptr());
        if !ws_cls.is_null() {
            let workspace = send_obj(ws_cls, sel_registerName(c"sharedWorkspace".as_ptr()));
            if !workspace.is_null() {
                let center = send_obj(workspace, sel_registerName(c"notificationCenter".as_ptr()));
                if !center.is_null() {
                    // -[NSNotificationCenter removeObserver:]
                    type FnRemove = unsafe extern "C" fn(*mut c_void, *const c_void, *mut c_void);
                    let remove: FnRemove = std::mem::transmute(objc_msgSend as *const ());
                    remove(center, sel_registerName(c"removeObserver:".as_ptr()), token);
                }
            }
        }
        send_obj(token, sel_registerName(c"release".as_ptr()));
    }
}

/// Layer 3b (fallback poller): catches anything the activation notification
/// misses (e.g. a space switch that never activates another app). 2 s interval
/// — the event-driven observer handles the fast path.
fn spawn_space_watchdog() {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if !INTERCEPT_ACTIVE.load(Ordering::SeqCst) {
            break;
        }
        unsafe { refocus_our_app() };
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
    // Journal the user's original gesture prefs (and caffeinate pid) BEFORE
    // touching them, so unlock or crash recovery can restore them faithfully.
    let caffeinate = caffeinate_pid().lock().ok().and_then(|guard| *guard);
    save_lockdown_state(caffeinate);
    // Layer 1: disable the OS-level gesture so Dock never sees the swipe.
    set_swipe_gesture_enabled(false);
    let result = enable_keyboard_intercept();
    if result.active {
        // Layer 3: bring us back if the user still manages to switch away —
        // event-driven observer first, slow poller as the safety net.
        install_space_observer();
        spawn_space_watchdog();
    }
    result.active
}

/// Release keyboard intercept, restore space-switching gestures, and allow
/// display sleep again.
pub fn unlock_desktop() {
    disable_keyboard_intercept();
    remove_space_observer();
    // Layer 1: restore the user's original gesture prefs from the journal;
    // fall back to force-enabling if no journal exists (e.g. lock never ran).
    if !restore_lockdown_state() {
        set_swipe_gesture_enabled(true);
    }
    // The journal restore already reaped caffeinate; this clears the in-memory
    // guard and covers the no-journal path.
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if let Some(pid) = pid_guard.take() {
            kill_if_caffeinate(pid);
        }
    }
}

/// Scan running processes for restricted applications.
///
/// Uses `ps -axo comm=` — the full executable path with NO arguments and no
/// header. Crucially this means spaces in the path belong to the path itself,
/// so taking the basename of the whole line correctly yields multi-word names:
/// `/Applications/QuickTime Player.app/Contents/MacOS/QuickTime Player`
/// → "QuickTime Player". (The previous `command=` + first-whitespace-token
/// approach truncated that to "QuickTime" and never matched. `-axco comm=`
/// is also wrong: `-c` reports p_comm, which macOS truncates to 16 chars.)
pub fn scan_processes() -> ProcessScanResult {
    let output = Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Basename of each executable path (everything after the final '/');
    // lines without '/' are already bare names.
    let running: Vec<String> = stdout
        .lines()
        .map(|line| {
            let line = line.trim();
            line.rsplit('/').next().unwrap_or(line).to_string()
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

/// True while the WindowServer session reports the screen as shared.
///
/// `CGSessionCopyCurrentDictionary()` exposes `CGSSessionScreenIsShared`,
/// which macOS sets whenever the login session's screen is being mirrored or
/// shared (built-in Screen Sharing, AirPlay mirroring, remote-control tools
/// that use the system path). This is a positive OS-level signal — it does not
/// depend on recognising the capturing app's process name. Note this is NOT
/// `SCShareableContent`: that API would require AMS Access itself to hold the
/// Screen Recording TCC permission, which we deliberately never request.
fn session_screen_is_shared() -> bool {
    unsafe {
        let session = CGSessionCopyCurrentDictionary();
        if session.is_null() {
            return false;
        }
        let key = CFStringCreateWithCString(
            std::ptr::null(),
            c"CGSSessionScreenIsShared".as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        );
        let mut shared = false;
        if !key.is_null() {
            let value = CFDictionaryGetValue(session, key);
            if !value.is_null() {
                shared = CFBooleanGetValue(value);
            }
            CFRelease(key);
        }
        CFRelease(session);
        shared
    }
}

/// Cross-reference TCC screen-capture grants against the live process list.
///
/// `apps_with_screen_capture_permission()` yields TCC client identifiers
/// (bundle ids like "com.obsproject.obs-studio" or absolute binary paths).
/// If any such app is currently RUNNING, the candidate has a process on the
/// machine that is *allowed* to capture the screen right now — treated as a
/// violation signal, not a warning, because an unknown recorder would defeat
/// the name blacklist entirely. Matching is a containment heuristic between
/// the id's last component and running executable basenames.
fn running_app_with_screen_capture_grant(running_basenames: &[String]) -> Option<String> {
    for client in apps_with_screen_capture_permission() {
        let tail = client
            .rsplit(['.', '/'])
            .next()
            .unwrap_or(&client)
            .to_ascii_lowercase();
        // Too-short tails ("tv", "ui") over-match; require something namelike.
        if tail.len() < 3 {
            continue;
        }
        for basename in running_basenames {
            let lower = basename.to_ascii_lowercase();
            if lower.contains(&tail) || (lower.len() >= 3 && tail.contains(&lower)) {
                return Some(format!("{client} (running process: {basename})"));
            }
        }
    }
    None
}

/// Basenames of every running executable (`ps -axo comm=`, full path, no args).
fn running_process_basenames() -> Vec<String> {
    Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|line| {
                    let line = line.trim();
                    line.rsplit('/').next().unwrap_or(line).to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Detect whether a local screen-recording/sharing session is active or likely.
///
/// Distinct from `detect_remote_desktop` (inbound remote-control sessions).
/// Three layers, strongest signal first:
///   1. WindowServer's `CGSSessionScreenIsShared` flag — the screen IS being
///      shared/mirrored right now, regardless of which app does it.
///   2. Known local recorder process names (blacklist).
///   3. TCC cross-reference — an app holding the ScreenCapture grant is
///      running, so it *could* capture silently (defeats name blacklists).
///
/// Every positive raises a lockdown event so the violation/proctoring logs
/// capture what fired, with which process.
pub fn detect_active_screen_share() -> bool {
    if session_screen_is_shared() {
        emit_lockdown_event(
            "screen_share_detected",
            "WindowServer reports this session's screen is currently shared or mirrored",
        );
        return true;
    }

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

    let running = running_process_basenames();

    if let Some(recorder) = LOCAL_RECORDERS.iter().find(|name| {
        running
            .iter()
            .any(|basename| basename.eq_ignore_ascii_case(name))
    }) {
        emit_lockdown_event(
            "screen_recorder_running",
            &format!("known screen-recording app is running: {recorder}"),
        );
        return true;
    }

    if let Some(detail) = running_app_with_screen_capture_grant(&running) {
        emit_lockdown_event(
            "screen_capture_capable_app_running",
            &format!("app with macOS screen-capture permission is running: {detail}"),
        );
        return true;
    }

    false
}

/// Returns true if `name` appears in the macOS RESTRICTED process list.
pub fn is_restricted_name(name: &str) -> bool {
    RESTRICTED.iter().any(|&r| r.eq_ignore_ascii_case(name))
}

/// All pids whose executable basename matches `name` exactly (case-insensitive).
///
/// Built on `ps -axo pid=,comm=` for the same reason as `scan_processes`:
/// `comm` is the full executable path with no arguments, so multi-word app
/// names survive, and matching the exact basename cannot hit an unrelated
/// process the way a `pkill -f` command-line regex can.
fn pids_by_basename(name: &str) -> Vec<u32> {
    let own_pid = std::process::id();
    Command::new("ps")
        .args(["-axo", "pid=,comm="])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|line| {
                    // "  123 /Applications/QuickTime Player.app/.../QuickTime Player"
                    let (pid, comm) = line.trim_start().split_once(char::is_whitespace)?;
                    let pid = pid.parse::<u32>().ok()?;
                    let comm = comm.trim();
                    let basename = comm.rsplit('/').next().unwrap_or(comm);
                    (pid != own_pid && basename.eq_ignore_ascii_case(name)).then_some(pid)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Send `signal` to every process whose executable basename is `name`.
fn signal_by_basename(name: &str, signal: &str) {
    for pid in pids_by_basename(name) {
        let _ = Command::new("kill")
            .args([signal, &pid.to_string()])
            .output();
    }
}

/// Gracefully quit then force-kill each named restricted app.
///
/// Step 1: osascript graceful quit (honours Cocoa quit delegate, no data loss).
/// Step 2: wait up to 800 ms for process to exit.
/// Step 3: SIGTERM, then SIGKILL, delivered to exact pids resolved by
///         executable basename — never `pkill -f`, whose command-line regex
///         can kill unrelated processes that merely mention the name in an
///         argument (e.g. an editor with "Teams.txt" open).
/// Returns which apps were closed and which could not be terminated.
pub fn close_apps(names: &[String]) -> CloseAppsResult {
    let mut closed = Vec::new();
    let mut failed = Vec::new();

    for name in names {
        // Graceful quit via AppleScript.
        let _ = Command::new("osascript")
            .args(["-e", &format!("tell application {:?} to quit", name)])
            .output();

        // Wait up to 800 ms for the process to exit (80 ms polling).
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(800);
        loop {
            if !process_alive_by_name(name) {
                break;
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(80));
        }

        // Escalate if still alive: SIGTERM to exact pids, brief grace, SIGKILL.
        if process_alive_by_name(name) {
            signal_by_basename(name, "-TERM");
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
            while process_alive_by_name(name) && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            if process_alive_by_name(name) {
                signal_by_basename(name, "-KILL");
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }

        if process_alive_by_name(name) {
            failed.push(name.clone());
        } else {
            closed.push(name.clone());
        }
    }

    CloseAppsResult { closed, failed }
}

/// Returns true if any process with this exact basename is currently alive.
///
/// Deliberately not `pgrep -x`: pgrep matches against p_comm, which macOS
/// truncates to 16 chars, so names like "Parallels Desktop" would never match
/// and close_apps would falsely report them closed.
fn process_alive_by_name(name: &str) -> bool {
    Command::new("ps")
        .args(["-axo", "comm="])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout).lines().any(|line| {
                let line = line.trim();
                let basename = line.rsplit('/').next().unwrap_or(line);
                basename.eq_ignore_ascii_case(name)
            })
        })
        .unwrap_or(false)
}

/// Request macOS TCC (Privacy) permission for camera and microphone.
///
/// WKWebView's `getUserMedia()` auto-grants at the WebKit level but does NOT
/// trigger the macOS system permission dialog — that only happens when the
/// native app itself calls `+[AVCaptureDevice requestAccessForMediaType:completionHandler:]`.
/// This function fires those requests so macOS shows the "AMS Access wants to
/// use the camera/microphone" system dialog and registers the app in
/// System Settings → Privacy & Security → Camera / Microphone.
///
/// Safe to call multiple times — a no-op if permission is already granted.
pub fn request_av_permissions() {
    unsafe {
        let cls = objc_getClass(c"AVCaptureDevice".as_ptr());
        if cls.is_null() {
            return;
        }

        let sel = sel_registerName(c"requestAccessForMediaType:completionHandler:".as_ptr());

        // Fire-and-forget completion handler — we only care that the dialog appears.
        // The argument must be objc2's Bool (ObjC BOOL ABI), not Rust bool —
        // Rust bool does not implement Encode, so RcBlock::new rejects it.
        let video_block = RcBlock::new(|_granted: objc2::runtime::Bool| {});
        let audio_block = RcBlock::new(|_granted: objc2::runtime::Bool| {});

        type FnReqAccess = unsafe extern "C" fn(
            *mut c_void,
            *const c_void,
            *mut c_void,
            &block2::Block<dyn Fn(objc2::runtime::Bool)>,
        );
        let req: FnReqAccess = std::mem::transmute(objc_msgSend as *const ());

        // Request video (camera).
        req(cls, sel, AVMediaTypeVideo, &video_block);
        // Request audio (microphone).
        req(cls, sel, AVMediaTypeAudio, &audio_block);
    }
}
