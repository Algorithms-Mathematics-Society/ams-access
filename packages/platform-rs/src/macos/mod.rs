//! macOS-specific lockdown implementation for AMS-Access-Proctor.
//!
//! Keyboard intercept: CGEventTap (requires Accessibility permission).
//! Sleep prevention: caffeinate subprocess.
//! Network lockdown: pfctl anchor (requires root).
//! Process scanning: `ps -axco comm`.
//! VM detection: `kern.hv_vmm_present` + `system_profiler SPHardwareDataType` + `ioreg`.

use crate::process_runner::{Budget, CommandDeadlineExt};
use block2::RcBlock;
use core_rs::exam::{CloseAppsResult, KeyboardInterceptResult, LockdownConfig, ProcessScanResult};
use std::ffi::c_void;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};

mod allowlist;
mod deferred_job;
mod displays;
pub mod instance;
mod keyboard_policy;
mod kiosk_window;
mod network_path;
mod power;
mod remote_access;
mod system_settings;
mod watchdog;

pub use allowlist::{enable_and_follow, resolve_allowlist};
pub use displays::{scan_displays, DisplayReport};
pub use kiosk_window::{
    apply_kiosk, engage_simple_fullscreen, reapply_kiosk_later, restore_kiosk_window,
    simple_fullscreen_engaged, top_safe_inset, wait_native_fullscreen_exit,
};
pub use network_path::network_path_warnings;
pub use power::{install_power_observers, set_power_event_callback};
pub use system_settings::{restore_status, RestoreStatus, UnrestoredSetting};
pub use watchdog::helper_mode_from_args;

pub fn battery_status() -> Option<crate::BatteryStatus> {
    let output = Command::new("pmset").args(["-g", "batt"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let percentage = text
        .split_whitespace()
        .find_map(|part| part.strip_suffix("%;"))?
        .parse::<u8>()
        .ok()?
        .min(100);
    // The state is the field after the percentage: `54%; discharging; 5:54
    // remaining`. It is compared whole, never searched for: "discharging"
    // contains "charging", and a substring test reported a Mac on battery as
    // charging. Other states are "charging", "finishing charge", "charged"
    // and "AC attached" (plugged in but holding, e.g. optimised charging).
    let state = text
        .lines()
        .find_map(|line| line.split_once("%;"))
        .and_then(|(_, rest)| rest.split(';').next())
        .map(str::trim)
        .unwrap_or_default();
    let charging = matches!(state, "charging" | "finishing charge");
    // The header names the source: `Now drawing from 'AC Power'` (or
    // 'Battery Power' / 'UPS Power'). Without it, fall back on the state.
    let plugged_in = if text.contains("'Battery Power'") {
        false
    } else {
        text.contains("'AC Power'") || charging || matches!(state, "charged" | "AC attached")
    };
    Some(crate::BatteryStatus {
        percentage,
        charging,
        plugged_in: Some(plugged_in),
    })
}

// ── Restricted process list ───────────────────────────────────────────────────

const RESTRICTED: &[&str] = &[
    "obs",
    "obs64",
    // Zoom is deliberately absent.
    //
    // It leaves helper processes that start and stop on their own, so a
    // candidate who never opened Zoom produced a started/resolved pair every
    // few seconds. One sitting filled the staff help queue with 200 of them,
    // which is how a queue stops being read and a real request gets missed.
    // Zoom *screen sharing* is the thing worth catching and is still caught
    // separately (`CptHost` in macos/remote_access.rs), because that one
    // means somebody else can see the paper.
    "TeamViewer",
    "TeamViewerAgent",
    "AnyDesk",
    "vncviewer",
    "Vine Server",
    "RealVNC",
    "Skype",
    "Microsoft Teams",
    "Teams",
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
    // The Screen Sharing and Remote Management daemons are reported by the
    // remote-access scan with a "turn it off in Sharing" hint. They are root
    // services: listing them here offered a Close button that could not work.
    // Screen recorders live in CAPTURE_TOOLS below, which scan_processes
    // also reads. They were listed here too, and the copies had already
    // drifted apart.
];

/// Chat apps: reported at readiness, never a reason to turn someone away.
/// They keep running after their window closes, so "I quit it" and "the scan
/// still sees it" are both true at once.
const ADVISORY: &[&str] = &[
    "discord", "Discord", "slack", "Slack", "WhatsApp", "Telegram",
];

/// Tools that can capture the screen.
///
/// One list with two readers: `scan_processes`, so they show up under
/// Restricted apps and the candidate is asked to close them, and
/// `detect_active_screen_share`, which treats a running one as an active
/// capture. Those kept separate copies and drifted, which is the only
/// reason this is a named constant rather than more entries above.
///
/// macOS's own tooling was missing from both. Every third-party recorder
/// was listed while the one every candidate already has was not:
/// Screenshot.app runs as `Screenshot`, and `screencapture` is the command
/// line it sits on. `screencaptureui` is not listed: macOS starts it on the
/// first screenshot and keeps it resident, so it was flagged on every scan
/// with nothing the candidate could close. The keyboard tap blocks the
/// shortcuts that would use it.
const CAPTURE_TOOLS: &[&str] = &[
    "QuickTime Player",
    "Kap",
    "CleanShot X",
    "Rottenwood",
    "ScreenFloat",
    "Recordit",
    "ScreenBrush",
    "obs",
    "OBS",
    "Screenshot",
    "screencapture",
    "Snagit",
    "Snagit 2024",
    "Loom",
    "ScreenFlow",
    "Camtasia",
];

// ── Thread-safe raw pointer wrapper ──────────────────────────────────────────

struct SendPtr(*mut c_void);
// SAFETY: CoreFoundation objects are thread-safe for CFRunLoopStop/Release calls.
unsafe impl Send for SendPtr {}
unsafe impl Sync for SendPtr {}

// ── Global state ──────────────────────────────────────────────────────────────

static INTERCEPT_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESCAPE_BLOCKED: AtomicBool = AtomicBool::new(true);
// True between lock_desktop and unlock_desktop. Distinct from INTERCEPT_ACTIVE:
// the readiness probe arms the tap without a lockdown, and a lockdown without
// Accessibility still owns the observers, the display monitor and the prefs.
static LOCKDOWN_ACTIVE: AtomicBool = AtomicBool::new(false);
// Invalidate deferred work even when exit and re-entry happen between two ticks.
static DESKTOP_GENERATION: AtomicU64 = AtomicU64::new(0);

fn desktop_generation() -> u64 {
    DESKTOP_GENERATION.load(Ordering::SeqCst)
}

fn owns_desktop(generation: u64) -> bool {
    desktop_generation() == generation && lockdown_active()
}
// Per-contest key policy, read by the tap callback without locking.
static CLIPBOARD_BLOCKED: AtomicBool = AtomicBool::new(false);
static FUNCTION_KEYS_BLOCKED: AtomicBool = AtomicBool::new(true);
static MEDIA_KEYS_BLOCKED: AtomicBool = AtomicBool::new(true);
// The live tap, so the callback can re-enable it the moment macOS disables it
// instead of leaving keys unguarded until the 2 s watchdog tick.
static LIVE_TAP: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());
// Set by the callback after such a re-enable; the watchdog reports it, since
// the callback must not do anything slow.
static TAP_REENABLED_IN_CALLBACK: AtomicBool = AtomicBool::new(false);
static LOCKDOWN_CONFIG: Mutex<Option<LockdownConfig>> = Mutex::new(None);
// Ensures the Accessibility consent dialog / System Settings deep-link fires at
// most once per app run — readiness rescans must not spam Settings windows.
static ACCESSIBILITY_PROMPTED: AtomicBool = AtomicBool::new(false);
// Monotonic id for each tap install. A dying tap thread (and its watchdog) may
// outlive a rapid disable→enable cycle; both compare their stamped generation
// against this counter so they never clobber or re-enable a newer tap's state.
static TAP_GENERATION: AtomicU64 = AtomicU64::new(0);
// True while a tap run-loop thread is spawning or alive. The 500 ms ready-wait
// in `enable_keyboard_intercept` can time out and report failure while the
// spawned thread goes on to install the tap anyway; a retry would then spawn a
// SECOND tap + run-loop thread. That race leaked a tap and a CFRunLoop thread
// on every readiness rescan (crash reports showed 7+ live run-loop threads),
// and the accumulating state is what eventually aborted the process. This flag
// makes spawning single-shot: only one tap thread can exist at a time.
static TAP_THREAD_PRESENT: AtomicBool = AtomicBool::new(false);
// Set by the tap thread when CGEventTapCreate refused both tap locations —
// the only case where a missing Input Monitoring grant is the likely cause.
static TAP_CREATE_REFUSED: AtomicBool = AtomicBool::new(false);
static TAP_RUNLOOP: OnceLock<Mutex<Option<SendPtr>>> = OnceLock::new();
// Serialises publishing a new tap with disabling it. See the tap thread.
static TAP_LIFECYCLE: Mutex<()> = Mutex::new(());
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
///
/// Called from background lockdown threads (the tap watchdog, the space
/// watchdog). The host callback ends up in Tauri's `emit` / event machinery,
/// which can panic (e.g. if the webview is gone). A panic that unwinds out of
/// this call on a spawned thread can escalate to a process `abort()` — the
/// SIGABRT crash seen in the field — so it is contained here and never allowed
/// to take down the exam app.
fn emit_lockdown_event(kind: &str, detail: &str) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = LOCKDOWN_EVENT_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(kind, detail)));
    }
}

/// Sink for proctoring notices: things worth recording that are not the
/// candidate's doing (a tap re-enabled, a restore completed, a display change
/// under a log-only policy). Same rules as the violation callback.
static LOCKDOWN_NOTICE_CALLBACK: OnceLock<LockdownEventCallback> = OnceLock::new();

pub fn set_lockdown_notice_callback<F>(callback: F)
where
    F: Fn(&str, &str) + Send + Sync + 'static,
{
    let _ = LOCKDOWN_NOTICE_CALLBACK.set(Box::new(callback));
}

fn emit_lockdown_notice(kind: &str, detail: &str) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = LOCKDOWN_NOTICE_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(kind, detail)));
    }
}

fn lockdown_active() -> bool {
    LOCKDOWN_ACTIVE.load(Ordering::SeqCst)
}

/// Set the contest's lockdown settings. Takes effect at the next lock_desktop.
pub fn set_lockdown_config(config: LockdownConfig) {
    *LOCKDOWN_CONFIG
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(config);
}

fn lockdown_config() -> LockdownConfig {
    LOCKDOWN_CONFIG
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
        .unwrap_or_default()
}

fn tap_lifecycle() -> &'static Mutex<()> {
    &TAP_LIFECYCLE
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
// NX_SYSDEFINED: media, brightness, volume and power keys arrive as this type,
// not as key-downs.
const CG_EVENT_SYSTEM_DEFINED: u32 = 14;
// Not real events: macOS calls the tap with these when it has disabled it.
const CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

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
const FULL_LOCK_MASK: u64 = KB_EVENT_MASK
    | (1u64 << CG_EVENT_GESTURE)
    | (1u64 << CG_EVENT_SWIPE)
    | (1u64 << CG_EVENT_SYSTEM_DEFINED);

use keyboard_policy::{FLAG_CTRL, VK_FN};

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
    fn CFRunLoopRemoveSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
    fn CFMachPortInvalidate(port: *mut c_void);
    fn CFRunLoopGetCurrent() -> *mut c_void;
    fn CFRunLoopRunInMode(
        mode: *const c_void,
        seconds: f64,
        return_after_source_handled: u8,
    ) -> i32;
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
    // Input Monitoring (kTCCServiceListenEvent), macOS 10.15+.
    fn CGPreflightListenEventAccess() -> bool;
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

/// FFI entry point for the CGEventTap. Returns `null` to block the event or
/// `event` to pass it through.
///
/// Called by CoreGraphics across an FFI boundary on the tap's run-loop thread.
/// A Rust panic must NEVER unwind into C — that is undefined behaviour and
/// aborts the whole process with SIGABRT. So this is a thin panic-guarded
/// wrapper around `kb_tap_should_block`; on the (unexpected) panic path it
/// fails OPEN — passing the event through rather than killing the exam app or
/// leaving the candidate with a frozen keyboard.
unsafe extern "C" fn kb_tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: *mut c_void,
    _user_info: *mut c_void,
) -> *mut c_void {
    // macOS disables a tap whose callback was slow or that the user's input
    // overrode, and says so through the callback itself. Re-enable on the spot:
    // waiting for the watchdog would leave every shortcut live for up to 2 s.
    if event_type == CG_EVENT_TAP_DISABLED_BY_TIMEOUT
        || event_type == CG_EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        let tap = LIVE_TAP.load(Ordering::SeqCst);
        if !tap.is_null() && INTERCEPT_ACTIVE.load(Ordering::Relaxed) {
            unsafe { CGEventTapEnable(tap, true) };
            TAP_REENABLED_IN_CALLBACK.store(true, Ordering::Relaxed);
        }
        return event;
    }
    let decision = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        kb_tap_should_block(event_type, event)
    }));
    match decision {
        Ok(true) => std::ptr::null_mut(),
        Ok(false) | Err(_) => event,
    }
}

/// Decide whether to swallow this event. Split out from `kb_tap_callback` so
/// the FFI entry point stays a thin panic-guarded shim. Uses only atomics —
/// no locking — so it is safe to run on the tap's run-loop thread.
#[allow(non_upper_case_globals)]
unsafe fn kb_tap_should_block(event_type: u32, event: *mut c_void) -> bool {
    // Shortcuts are blocked only while a test lockdown is engaged. Onboarding
    // starts the tap early to check Accessibility, and a candidate who left
    // onboarding kept a tap that swallowed Cmd+Q and the rest with no test
    // running. Outside a lockdown the tap passes everything through.
    if !INTERCEPT_ACTIVE.load(Ordering::Relaxed) || !LOCKDOWN_ACTIVE.load(Ordering::Relaxed) {
        return false;
    }
    // Layer 2: swallow 3/4-finger swipe and gesture events so WindowServer
    // never sees them and cannot switch spaces or open Mission Control.
    if event_type == CG_EVENT_SWIPE || event_type == CG_EVENT_GESTURE {
        return false;
    }
    // Media, brightness, volume and power keys. All of them, rather than
    // decoding the subtype: the callback must stay cheap and lock-free.
    // Except with Control held: Control+Command+Power (restart) and
    // Control+Option+Command+Power (shut down) are the way out of an exam
    // that cannot reach the server. Both end the app through its restoring
    // exit (the quit request or SIGTERM), never a hard power-off.
    if event_type == CG_EVENT_SYSTEM_DEFINED {
        return MEDIA_KEYS_BLOCKED.load(Ordering::Relaxed)
            && CGEventGetFlags(event) & FLAG_CTRL == 0;
    }
    // The Globe (fn) key on its own: emoji picker, dictation or input source,
    // whichever the candidate chose. It arrives as a modifier change, not a
    // key-down, so it is matched here rather than in should_block_key.
    if event_type == CG_EVENT_FLAGS_CHANGED {
        return FUNCTION_KEYS_BLOCKED.load(Ordering::Relaxed)
            && CGEventGetIntegerValueField(event, CG_KEYBOARD_EVENT_KEYCODE) == VK_FN;
    }
    if event_type != CG_EVENT_KEY_DOWN && event_type != CG_EVENT_KEY_UP {
        return false;
    }

    let kc = CGEventGetIntegerValueField(event, CG_KEYBOARD_EVENT_KEYCODE);
    let flags = CGEventGetFlags(event);
    keyboard_policy::should_block_key(
        kc,
        flags,
        keyboard_policy::Policy {
            function_keys_blocked: FUNCTION_KEYS_BLOCKED.load(Ordering::Relaxed),
            escape_blocked: ESCAPE_BLOCKED.load(Ordering::Relaxed),
            clipboard_blocked: CLIPBOARD_BLOCKED.load(Ordering::Relaxed),
        },
    )
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
            let mut event = None;
            unsafe {
                if !CGEventTapIsEnabled(tap.0) {
                    CGEventTapEnable(tap.0, true);
                    if CGEventTapIsEnabled(tap.0) {
                        event = Some((
                            "keyboard_tap_reenabled",
                            "CGEventTap was disabled by the OS and has been re-enabled",
                        ));
                        revocation_reported = false;
                        reenable_failure_reported = false;
                    } else if trusted && !reenable_failure_reported {
                        reenable_failure_reported = true;
                        event = Some((
                            "keyboard_lockdown_lost",
                            "CGEventTap was disabled and could not be re-enabled",
                        ));
                    }
                } else {
                    reenable_failure_reported = false;
                    if trusted && revocation_reported {
                        revocation_reported = false;
                        event = Some((
                            "keyboard_lockdown_restored",
                            "Accessibility permission restored; keyboard intercept active",
                        ));
                    }
                }
            }
            // Keep the pointer protected only while calling CoreGraphics.
            // Event recording/notification must not delay tap teardown.
            drop(cell);
            if TAP_REENABLED_IN_CALLBACK.swap(false, Ordering::Relaxed) {
                emit_lockdown_notice(
                    "keyboard_tap_reenabled",
                    "macOS disabled the keyboard tap (timeout or user input); it was re-enabled immediately",
                );
            }
            if let Some((kind, detail)) = event {
                emit_lockdown_event(kind, detail);
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
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    if !check_accessibility_permission() {
        // First denial in this run: fire the system consent dialog (which also
        // registers the app in the Accessibility list) and open System Settings
        // → Privacy & Security → Accessibility so the user lands on the toggle.
        // Subsequent rescans stay silent — no Settings-window spam.
        if !ACCESSIBILITY_PROMPTED.swap(true, Ordering::SeqCst) {
            let granted = prompt_accessibility_permission();
            if !granted {
                let _ = std::process::Command::new("/usr/bin/open")
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

    // A tap thread is already spawning or running (INTERCEPT_ACTIVE may not be
    // set true yet because the run-loop thread sets it just before signalling
    // ready). Refuse to spawn a second one — that is the race that leaked taps
    // and CFRunLoop threads on every rescan until the process aborted. The
    // running thread clears this flag when it exits.
    //
    // A thread that is present but inactive is one a disable has already
    // superseded; it leaves within one run-loop slice. Wait for it rather
    // than report the probe as pending.
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
    while TAP_THREAD_PRESENT.load(Ordering::SeqCst)
        && !INTERCEPT_ACTIVE.load(Ordering::SeqCst)
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if TAP_THREAD_PRESENT.swap(true, Ordering::SeqCst) {
        let active = INTERCEPT_ACTIVE.load(Ordering::SeqCst);
        let method = if active {
            "cgeventtap"
        } else {
            "cgeventtap_pending"
        };
        return KeyboardInterceptResult {
            active,
            method: method.to_string(),
            platform: "macos".to_string(),
        };
    }

    {
        let (lock, _) = &**tap_started();
        if let Ok(mut started) = lock.lock() {
            *started = false;
        }
    }

    TAP_CREATE_REFUSED.store(false, Ordering::SeqCst);
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
                TAP_CREATE_REFUSED.store(true, Ordering::SeqCst);
                signal_ready();
                TAP_THREAD_PRESENT.store(false, Ordering::SeqCst);
                return;
            }

            let source = CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0);
            if source.is_null() {
                CFRelease(tap);
                signal_ready();
                TAP_THREAD_PRESENT.store(false, Ordering::SeqCst);
                return;
            }

            let rl = CFRunLoopGetCurrent();
            CFRunLoopAddSource(rl, source, kCFRunLoopDefaultMode);
            CGEventTapEnable(tap, true);

            // Publish only if no disable has superseded this install while the
            // tap was being created. Under the same lock as
            // `disable_keyboard_intercept`, so a stop can never land between
            // the check and the store and leave a tap active that its owner
            // already released.
            let superseded = {
                let _lifecycle = tap_lifecycle()
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let current = TAP_GENERATION.load(Ordering::SeqCst) == generation;
                if current {
                    LIVE_TAP.store(tap, Ordering::SeqCst);
                    INTERCEPT_ACTIVE.store(true, Ordering::SeqCst);
                    if let Ok(mut guard) = tap_runloop().lock() {
                        *guard = Some(SendPtr(rl));
                    }
                }
                !current
            };

            signal_ready();
            let tap_cell = Arc::new(Mutex::new(Some(SendPtr(tap))));
            if !superseded {
                start_tap_watchdog(tap_cell.clone(), generation);
            }
            // Run in short slices rather than one CFRunLoopRun. The readiness
            // probe enables and immediately disables the tap, and a
            // CFRunLoopStop that arrives before the loop has started running
            // is silently dropped: the thread then ran forever, inactive, and
            // every later enable — including the real one at contest entry —
            // was refused as "cgeventtap_pending". The generation check makes
            // a missed stop cost at most one slice.
            while TAP_GENERATION.load(Ordering::SeqCst) == generation {
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, 0);
            }

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
                    // Only clear the callback's pointer if it is still ours; a
                    // newer tap may already have replaced it.
                    let _ = LIVE_TAP.compare_exchange(
                        tap,
                        std::ptr::null_mut(),
                        Ordering::SeqCst,
                        Ordering::SeqCst,
                    );
                    CGEventTapEnable(tap, false);
                    // Invalidate, not just release: the run-loop source holds
                    // its own reference, and a tap that is only disabled
                    // stays registered with the window server until the app
                    // quits — one more for every readiness rescan.
                    CFMachPortInvalidate(tap);
                    CFRelease(tap);
                }
            }
            CFRunLoopRemoveSource(rl, source, kCFRunLoopDefaultMode);
            CFRelease(source);
        }
        // This tap thread is exiting — allow a future enable to spawn a new one.
        TAP_THREAD_PRESENT.store(false, Ordering::SeqCst);
    });

    // Tap creation is usually instant but can take noticeably longer right
    // after a permission grant. A short wait reported a tap that went live a
    // moment later as failed, and contest entry recorded a false advisory.
    let (lock, cvar) = &**tap_started();
    if let Ok(ready) = lock.lock() {
        let _wait_result =
            cvar.wait_timeout_while(ready, std::time::Duration::from_secs(2), |ready| !*ready);
    }

    let active = INTERCEPT_ACTIVE.load(Ordering::SeqCst);
    // Active taps need Accessibility (checked above), not Input Monitoring.
    // Only when the system refused to create the tap at all is a missing
    // Input Monitoring grant worth sending the candidate to; any other
    // failure would point them at the wrong pane.
    let method = if active {
        "cgeventtap"
    } else if TAP_CREATE_REFUSED.load(Ordering::SeqCst) && !check_input_monitoring_permission() {
        "input_monitoring_denied"
    } else {
        "tap_create_failed"
    };
    KeyboardInterceptResult {
        active,
        method: method.to_string(),
        platform: "macos".to_string(),
    }
}

/// Whether Input Monitoring (kTCCServiceListenEvent) is granted.
fn check_input_monitoring_permission() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

/// Open the System Settings pane the candidate needs for `section`.
pub fn open_privacy_pane(section: &str) -> Result<(), String> {
    let url = match section {
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "input_monitoring" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
        }
        "screen_recording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "sharing" => "x-apple.systempreferences:com.apple.Sharing-Settings.extension",
        other => return Err(format!("unknown settings section: {other}")),
    };
    Command::new("/usr/bin/open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open System Settings: {error}"))
}

/// Stop the CGEventTap run loop and deactivate keyboard intercept.
pub fn disable_keyboard_intercept() {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let _lifecycle = tap_lifecycle()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // Stop the run loop BEFORE superseding the generation. The tap thread
    // cannot exit while its generation is current, so its CFRunLoop is still
    // alive here; bumping first let the thread finish its slice, exit and
    // free the run loop before this CFRunLoopStop reached it. A stop consumed
    // between slices costs one extra slice, nothing more.
    if let Ok(mut guard) = tap_runloop().lock() {
        if let Some(SendPtr(rl)) = guard.take() {
            unsafe { CFRunLoopStop(rl) };
        }
    }
    // Superseding the generation is what actually ends the tap thread.
    TAP_GENERATION.fetch_add(1, Ordering::SeqCst);
    INTERCEPT_ACTIVE.store(false, Ordering::SeqCst);
}

// ── Crash-safe lockdown state ─────────────────────────────────────────────────
//
// Desktop preferences are written with `defaults write`, which persists across
// app crashes and reboots. system_settings.rs owns the current snapshot and its
// restore; the watchdog process, the login agent and the next launch each
// restore it if this process cannot.
//
// lockdown_recovery.rs is the journal format of earlier releases, which only
// covered two gesture keys. Nothing writes it any more, but a journal left by
// an older version must still be restored, so its reader stays. Its writer is
// kept for the journal tests, hence the allow.

#[allow(dead_code)]
mod lockdown_recovery;

fn lockdown_state_path() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join("Library/Application Support/AMS Access/lockdown-state.json"))
}

/// Kill `pid` only if it is still a caffeinate process — guards against pid
/// reuse when restoring from a stale state file.
fn kill_if_caffeinate(pid: u32) {
    let is_caffeinate = Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .bounded_output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .ends_with("caffeinate")
        })
        .unwrap_or(false);
    if is_caffeinate {
        let _ = Command::new("/bin/kill")
            .arg(pid.to_string())
            .bounded_output();
    }
}

/// Restore gesture prefs and reap caffeinate from the state file.
///
/// Returns false only when the journal is positively absent. A failed restore
/// must retain the originals and must not trigger force-enabling preferences.
fn restore_lockdown_state() -> bool {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let Some(path) = lockdown_state_path() else {
        return true;
    };
    lockdown_recovery::restore(
        &path,
        |pref| match &pref.value {
            Some(value) => Command::new("/usr/bin/defaults")
                .args(["write", &pref.domain, &pref.key, "-int", value])
                .bounded_output()
                .is_ok_and(|output| output.status.success()),
            None => {
                // A previous partial restore may already have deleted this
                // originally absent key. Read first to distinguish that case
                // from a failed deletion or a failed/expired command.
                let Ok(current) = Command::new("/usr/bin/defaults")
                    .args(["read", &pref.domain, &pref.key])
                    .bounded_output()
                else {
                    return false;
                };
                if !current.status.success() {
                    return lockdown_recovery::explicitly_absent(
                        &current.stderr,
                        &pref.domain,
                        &pref.key,
                    );
                }
                Command::new("/usr/bin/defaults")
                    .args(["delete", &pref.domain, &pref.key])
                    .bounded_output()
                    .is_ok_and(|output| output.status.success())
            }
        },
        |pid| {
            let _ = Command::new("/usr/bin/killall")
                .arg("cfprefsd")
                .bounded_output();
            if let Some(pid) = pid {
                kill_if_caffeinate(pid);
            }
        },
    )
}

/// Whether saved desktop preferences still need restoration. Unknown access
/// failures count as pending rather than claiming the desktop was restored.
pub fn desktop_recovery_pending() -> bool {
    lockdown_state_path().is_none_or(|path| lockdown_recovery::pending(&path))
        || system_settings::pending()
}

/// Run once at app startup, before any UI and before any lockdown call: a
/// snapshot still on disk means the previous session ended without restoring
/// (crash, force quit, power loss). Put the candidate's settings back and kill
/// the orphaned caffeinate. A snapshot whose owner is still alive belongs to
/// a running exam in another instance and is left alone.
pub fn recover_lockdown_if_crashed() {
    restore_lockdown_state();
    if system_settings::pending() && !system_settings::owner_alive_elsewhere() {
        if let system_settings::RestoreOutcome::Failed(_) = system_settings::restore() {
            system_settings::ensure_retry();
        }
    }
}

/// Run the restore now — the Restore system settings action — and report
/// what, if anything, is still changed.
pub fn retry_restore() -> RestoreStatus {
    if system_settings::pending() && !system_settings::owner_alive_elsewhere() {
        if let system_settings::RestoreOutcome::Failed(_) =
            system_settings::restore_unless_lockdown_active()
        {
            system_settings::ensure_retry();
        }
    }
    restore_status()
}

// ── Layer 3: space watchdog ───────────────────────────────────────────────────

/// Bring the exam back to the front.
///
/// Activation is AppKit, and AppKit is main-thread-only. The space poller
/// used to call this from its own thread; on current macOS that raises an
/// Objective-C exception, which `catch_unwind` cannot catch, and the app
/// aborted two seconds into every contest. So the work always runs on the
/// main thread, behind an exception guard. Observers already on the main
/// thread run it inline.
fn refocus_our_app() {
    refocus_for_generation(desktop_generation());
}

fn refocus_for_generation(generation: u64) {
    let _ = kiosk_window::on_main(std::time::Duration::from_millis(500), move || {
        if owns_desktop(generation) {
            kiosk_window::guarded(|| unsafe { refocus_on_main(std::process::id()) });
        }
    });
}

/// Bring another running app forward, best effort. A second launch calls this
/// on its main thread, before it starts any UI, to show the instance that
/// already owns the exam.
pub fn activate_process(pid: u32) {
    let _ = kiosk_window::guarded(|| unsafe { refocus_on_main(pid) });
}

unsafe fn refocus_on_main(pid: u32) {
    let cls = objc_getClass(c"NSRunningApplication".as_ptr());
    if cls.is_null() {
        return;
    }
    let sel_for_pid = sel_registerName(c"runningApplicationWithProcessIdentifier:".as_ptr());
    let sel_responds = sel_registerName(c"respondsToSelector:".as_ptr());
    let sel_active = sel_registerName(c"isActive".as_ptr());
    let sel_activate = sel_registerName(c"activateWithOptions:".as_ptr());

    // +[NSRunningApplication runningApplicationWithProcessIdentifier:pid]
    type FnForPid = unsafe extern "C" fn(*mut c_void, *const c_void, i32) -> *mut c_void;
    let send_for_pid: FnForPid = std::mem::transmute(objc_msgSend as *const ());
    let app = send_for_pid(cls, sel_for_pid, pid as i32);
    if app.is_null() {
        return;
    }

    // -[app respondsToSelector:@selector(isActive)]  →  BOOL (u8)
    type FnResponds = unsafe extern "C" fn(*mut c_void, *const c_void, *const c_void) -> u8;
    let send_responds: FnResponds = std::mem::transmute(objc_msgSend as *const ());
    // -[app isActive]  →  BOOL (u8). The documented getter; `isFrontmost` is
    // not an NSRunningApplication selector (unrecognized-selector exception).
    type FnBool = unsafe extern "C" fn(*mut c_void, *const c_void) -> u8;
    let send_bool: FnBool = std::mem::transmute(objc_msgSend as *const ());
    let active =
        send_responds(app, sel_responds, sel_active) != 0 && send_bool(app, sel_active) != 0;

    if !active {
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
        // Invoked as an Objective-C block on the main queue. A panic here would
        // unwind into AppKit/ObjC and abort the process — contain it.
        if lockdown_active() {
            refocus_our_app();
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
    let generation = desktop_generation();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        if !owns_desktop(generation) {
            break;
        }
        if lockdown_config().disable_siri {
            quit_siri();
        }
        // Re-check ownership when the main queue actually executes this work.
        refocus_for_generation(generation);
    });
}

/// The Siri panel. Matched by full path: the basename lookup skips anything
/// under /System so a restricted-app name never hits an OS component.
const SIRI_UI: &str = "/System/Library/CoreServices/Siri.app/Contents/MacOS/Siri";

/// Siri is kept closed for the test instead of switched off in its saved
/// settings, which would outlive a power cut. The tap already drops its
/// keyboard triggers; this ends a voice-invoked Siri within the 2 s poll,
/// and the focus observers record that it came up.
fn quit_siri() {
    let Ok(output) = Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .bounded_output()
    else {
        return;
    };
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((pid, comm)) = line.trim_start().split_once(char::is_whitespace) else {
            continue;
        };
        if comm.trim() == SIRI_UI {
            let _ = Command::new("/bin/kill")
                .args(["-TERM", pid])
                .bounded_output();
        }
    }
}

/// Engage the full macOS lockdown for a contest.
///
/// Order matters. The lockdown is recorded on disk and the watchdog process
/// is running before anything a crash could strand. No desktop preference is
/// changed: everything below ends with this process. The keyboard tap is what needs Accessibility; nothing
/// else depends on it, so the rest engages even when it is refused and the
/// return value reports only the tap (the policy decides whether that blocks).
pub fn lock_desktop() -> bool {
    DESKTOP_GENERATION.fetch_add(1, Ordering::SeqCst);
    let config = lockdown_config();
    CLIPBOARD_BLOCKED.store(!config.allow_clipboard, Ordering::SeqCst);
    FUNCTION_KEYS_BLOCKED.store(config.block_function_keys, Ordering::SeqCst);
    MEDIA_KEYS_BLOCKED.store(config.block_media_keys, Ordering::SeqCst);

    // Prevent display and system sleep via caffeinate -d (display) -i (idle).
    // -w ties it to this process, so a crash before the pid is persisted
    // cannot leave an assertion nobody can find.
    if let Ok(mut pid_guard) = caffeinate_pid().lock() {
        if pid_guard.is_none() {
            let own_pid = std::process::id().to_string();
            if let Ok(mut child) = Command::new("/usr/bin/caffeinate")
                .args(["-d", "-i", "-w", &own_pid])
                .spawn()
            {
                *pid_guard = Some(child.id());
                // Collect it once it is killed, so it never stays a zombie.
                let _ = std::thread::Builder::new()
                    .name("ams-caffeinate-reaper".into())
                    .spawn(move || {
                        let _ = child.wait();
                    });
            }
        }
    }
    let caffeinate = caffeinate_pid().lock().ok().and_then(|guard| *guard);
    // Marked active BEFORE the snapshot is written: a background restore
    // retry that is already waiting for the snapshot lock re-checks this
    // flag once it gets the lock, and must see the new lockdown then.
    LOCKDOWN_ACTIVE.store(true, Ordering::SeqCst);
    // Err means the snapshot could not be persisted, or an older release's
    // changed settings could not be put back: refuse rather than run an exam
    // the watchdog cannot recover.
    if let Err(error) = system_settings::engage(caffeinate) {
        LOCKDOWN_ACTIVE.store(false, Ordering::SeqCst);
        // Refused: nothing will ever reap the caffeinate spawned above.
        if let Ok(mut pid_guard) = caffeinate_pid().lock() {
            if let Some(pid) = pid_guard.take() {
                kill_if_caffeinate(pid);
            }
        }
        crate::process_runner::record_failure(error);
        return false;
    }
    watchdog::spawn();
    if config.disable_siri {
        quit_siri();
    }

    let result = enable_keyboard_intercept();
    // Bring us back if the candidate still manages to switch away — the
    // event-driven observers first, the slow poller as the safety net — and
    // record every focus loss.
    install_space_observer();
    kiosk_window::install_focus_observers();
    spawn_space_watchdog();
    displays::start_monitoring(config.display_policy);
    result.active
}

/// Release the lockdown and put every changed setting back.
///
/// Safe to call when nothing is locked: restore only acts on a snapshot on
/// disk, so an idle Restore action never writes guessed defaults.
pub fn unlock_desktop() {
    DESKTOP_GENERATION.fetch_add(1, Ordering::SeqCst);
    LOCKDOWN_ACTIVE.store(false, Ordering::SeqCst);
    disable_keyboard_intercept();
    remove_space_observer();
    kiosk_window::remove_focus_observers();
    displays::stop_monitoring();
    kiosk_window::restore_kiosk_presentation();
    // A journal from an older release, if one is still on disk.
    restore_lockdown_state();
    // A snapshot owned by another live instance is that instance's exam (this
    // call can be the rollback of an entry refused for exactly that reason).
    if !system_settings::owner_alive_elsewhere() {
        match system_settings::restore() {
            system_settings::RestoreOutcome::Failed(settings) => {
                emit_lockdown_event(
                    "lockdown_restore_failed",
                    &format!(
                        "These settings are still changed and will be retried: {}",
                        settings.join(", ")
                    ),
                );
                system_settings::ensure_retry();
            }
            // Verified: the watchdog has nothing left to guard. On failure it
            // stays, so a crash before the retry succeeds is still covered.
            _ => watchdog::stop(),
        }
    }
    // The snapshot restore already reaped caffeinate; this clears the
    // in-memory guard and covers the no-snapshot path.
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
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let running = ps_basenames_checked();
    restricted_in(&running, _budget.failure().is_none())
}

/// Restricted apps and remote access from ONE `ps` snapshot, so the two
/// readiness rows cannot disagree about what was running.
pub fn scan_processes_and_remote() -> (ProcessScanResult, Vec<String>) {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let running = ps_basenames_checked();
    let restricted = restricted_in(&running, _budget.failure().is_none());
    let remote = remote_access::scan_remote_access(&running);
    (restricted, remote)
}

/// Listed names that macOS itself ships from its protected system folders.
/// Only these may match a process that lives there.
const APPLE_SHIPPED: &[&str] = &[
    "Screen Sharing",
    "screensharingd",
    "AppleVNCServer",
    "ARDAgent",
    "RemoteDesktopAgent",
    "sshd",
    "sshd-session",
    "Terminal",
    "QuickTime Player",
    "Screenshot",
    "screencapture",
    "dtrace",
    "lldb",
    "gdb",
];

/// Basename of a `ps -o comm=` path, or `None` for an OS component that only
/// shares its name with a listed app.
///
/// Matching on the basename alone flagged Apple's own
/// `/System/Library/PrivateFrameworks/CoreParsec.framework/parsecd` — the
/// Spotlight suggestions daemon, running on every Mac — as the Parsec
/// remote-desktop host, whose binary is also `parsecd`. SIP-protected system
/// folders cannot contain third-party software, so a process there matches
/// only a name macOS itself ships. `/usr/local` is user-writable (Homebrew's
/// x11vnc lives there) and stays in scope.
fn listed_basename(comm: &str) -> Option<&str> {
    let comm = comm.trim();
    let basename = comm.rsplit('/').next().unwrap_or(comm);
    let os_owned = comm.starts_with("/System/")
        || (comm.starts_with("/usr/") && !comm.starts_with("/usr/local/"))
        || comm.starts_with("/bin/")
        || comm.starts_with("/sbin/");
    if os_owned
        && !APPLE_SHIPPED
            .iter()
            .any(|name| name.eq_ignore_ascii_case(basename))
    {
        return None;
    }
    Some(basename)
}

/// Basename of each executable path (everything after the final '/'); lines
/// without '/' are already bare names. A failed `ps` records a budget failure
/// so the scan is reported as incomplete rather than clean.
fn ps_basenames_checked() -> Vec<String> {
    let output = Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .bounded_checked_output()
        .unwrap_or_else(|_| std::process::Output {
            status: std::process::ExitStatus::default(),
            stdout: vec![],
            stderr: vec![],
        });
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(listed_basename)
        .map(str::to_string)
        .collect()
}

fn restricted_in(running: &[String], scan_complete: bool) -> ProcessScanResult {
    // Deduped case-insensitively, because the lists match that way and a
    // program can therefore match twice under different spellings -- "obs"
    // and "OBS" are one application. Listing it twice would read as two
    // things to close.
    let mut found: Vec<String> = Vec::new();
    for &name in RESTRICTED
        .iter()
        .chain(CAPTURE_TOOLS.iter())
        .chain(remote_access::REMOTE_APPS.iter())
    {
        if running.iter().any(|p| p.eq_ignore_ascii_case(name))
            && !found.iter().any(|seen| seen.eq_ignore_ascii_case(name))
        {
            found.push(name.to_string());
        }
    }

    // Chat apps are listed separately and never affect `clean`.
    let mut advisory: Vec<String> = Vec::new();
    for &name in ADVISORY.iter() {
        if running.iter().any(|p| p.eq_ignore_ascii_case(name))
            && !advisory.iter().any(|seen| seen.eq_ignore_ascii_case(name))
        {
            advisory.push(name.to_string());
        }
    }

    ProcessScanResult {
        clean: found.is_empty() && scan_complete,
        found,
        advisory,
    }
}

/// Check whether any remote desktop or screen-sharing session is active.
pub fn detect_remote_desktop() -> bool {
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    !remote_access::scan_remote_access(&running_process_basenames()).is_empty()
        // SSH session with X11 forwarding — the remote peer can see the display
        || (std::env::var("SSH_CONNECTION").is_ok() && std::env::var("DISPLAY").is_ok())
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

/// Whether this copy of the app runs from a path the helper cannot pin. The
/// helper authorizes its client by executable path, and a copy run from the
/// mounted disk image or translocated by Gatekeeper (a random path on every
/// launch) would ask for the admin password again each time, or fail lockdown.
/// shortcut: any bundle under /Volumes counts, including an install on an
/// external drive; check that the volume is read-only if labs need that.
pub fn unstable_bundle_path(exe: &std::path::Path) -> bool {
    let path = exe.to_string_lossy();
    path.contains(".app/Contents/MacOS/")
        && (path.contains("/AppTranslocation/") || path.starts_with("/Volumes/"))
}

/// Check whether the helper daemon socket is reachable and accepts this app.
pub fn network_helper_running() -> bool {
    helper_send(r#"{"cmd":"ping"}"#).is_ok()
}

/// An installed helper from before on-demand start: launchd keeps it running
/// all the time. Setup reinstalls it once so it runs only while needed.
pub fn network_helper_outdated() -> bool {
    std::fs::read_to_string(HELPER_PLIST_DEST)
        .is_ok_and(|plist| !plist.contains("<key>Sockets</key>"))
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
set helperSocket to "{HELPER_SOCKET}"
do shell script "/bin/mkdir -p " & quoted form of configDir & " && (/bin/launchctl bootout system " & quoted form of plistDest & " 2>/dev/null || true) && /bin/rm -f " & quoted form of helperSocket & " && /usr/bin/install -o root -g wheel -m 755 " & quoted form of helperBinary & " " & quoted form of helperDest & " && /usr/bin/install -o root -g wheel -m 644 " & quoted form of plistSource & " " & quoted form of plistDest & " && /usr/bin/printf '%s\n' " & quoted form of clientBinary & " > " & quoted form of clientConfig & " && /usr/sbin/chown root:wheel " & quoted form of clientConfig & " && /bin/chmod 644 " & quoted form of clientConfig & " && /bin/launchctl bootstrap system " & quoted form of plistDest with administrator privileges with prompt "AMS Access needs to install a network component to restrict internet access during the exam. Enter your Mac password to continue.""#
    );

    let out = Command::new("osascript")
        .args(["-e", &script])
        .bounded_output_with_timeout(std::time::Duration::from_secs(120))
        .map_err(|e| format!("osascript: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // Exit code 1 from osascript when the user cancels the auth dialog.
        if stderr.contains("cancelled") || stderr.contains("(-128)") {
            return Err("admin_auth_cancelled".to_string());
        }
        return Err(stderr.trim().to_string());
    }

    // Give the daemon up to 3 s to create its socket before we return. A
    // ping can itself block for ~12 s, so the bound is a deadline, not a
    // retry count.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if network_helper_running() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    Err("helper installed but socket not ready within 3 s".to_string())
}

/// A native alert before any window exists, for problems that stop startup.
/// osascript draws it without the app's run loop, as `install_network_helper`
/// already relies on, and it gives up after five minutes so a candidate who
/// walks away does not leave a stuck process behind.
pub fn show_startup_message(title: &str, message: &str) {
    let script = format!(
        r#"display alert "{}" message "{}" as critical buttons {{"OK"}} default button "OK" giving up after 300"#,
        applescript_string(title),
        applescript_string(message)
    );
    let _ = Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .bounded_output_with_timeout(std::time::Duration::from_secs(310));
}

fn applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Uninstall the helper — stop the daemon and remove its files.
///
/// Requires admin privileges (osascript elevation).
pub fn uninstall_network_helper() -> Result<(), String> {
    // The helper owns the scoped PF anchor. Clear it while the service still
    // exists; deleting the daemon first can strand rules across app restarts.
    // If recorded rules cannot be cleared, retain the helper for recovery.
    disable_network_lockdown()?;
    let script = format!(
        r#"do shell script "
            /bin/launchctl bootout system '{HELPER_PLIST_DEST}' 2>/dev/null || true &&
            /bin/rm -f '{HELPER_BINARY_DEST}' '{HELPER_PLIST_DEST}' '{HELPER_CLIENT_CONFIG_DEST}'
        " with administrator privileges"#
    );
    let out = Command::new("osascript")
        .args(["-e", &script])
        .bounded_output_with_timeout(std::time::Duration::from_secs(120))
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

/// Send a JSON command to the helper and return its response.
fn helper_send(json: &str) -> Result<(), String> {
    crate::helper_client::send(json, || {
        crate::helper_client::connect(std::path::Path::new(HELPER_SOCKET))
            .map_err(|e| format!("connect to helper: {e}"))
    })
}

/// Restrict outbound network traffic via the privileged helper.
///
/// The helper runs pfctl as root — this function needs no elevated privileges.
/// If the helper is not installed, returns `Err("helper_not_installed")`.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    if !network_helper_running() {
        return Err("helper_not_installed".to_string());
    }

    // Marker-first: if the app or helper dies after the rules land, the
    // marker is what lets a later restore know the firewall may be active.
    write_lockdown_marker().map_err(|e| format!("write lockdown marker: {e}"))?;

    let request = serde_json::json!({
        "cmd": "enable",
        "ips": allowed_ips,
    })
    .to_string();

    helper_send(&request)
}

/// Lift the network lockdown via the privileged helper.
pub fn disable_network_lockdown() -> Result<(), String> {
    allowlist::forget();
    if !network_helper_running() {
        // pf rules outlive the helper, so an unreachable helper only means
        // "nothing to flush" when no lockdown was recorded this boot.
        return if lockdown_marker_may_exist() {
            Err(format!(
                "{HELPER_RULES_MAY_PERSIST}: network helper is not reachable"
            ))
        } else {
            Ok(())
        };
    }
    helper_send(r#"{"cmd":"disable"}"#)?;
    clear_lockdown_marker().map_err(|e| format!("network restored but marker cleanup failed: {e}"))
}

/// Error prefix when the helper is down but a lockdown was recorded.
const HELPER_RULES_MAY_PERSIST: &str = "helper_unreachable_rules_may_persist";

/// Written by the app (not the root helper) so it can be read without
/// privileges. Holds the boot time: pf rules do not survive a reboot, so a
/// marker from an earlier boot is stale.
fn lockdown_marker_path() -> Option<std::path::PathBuf> {
    home_dir().map(|h| h.join("Library/Application Support/AMS Access/network-lockdown.marker"))
}

fn boot_time() -> Option<String> {
    Command::new("sysctl")
        .args(["-n", "kern.boottime"])
        .bounded_output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_lockdown_marker() -> std::io::Result<()> {
    let path = lockdown_marker_path().ok_or_else(|| std::io::Error::other("HOME is not set"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, boot_time().unwrap_or_default())
}

fn clear_lockdown_marker() -> std::io::Result<()> {
    let Some(path) = lockdown_marker_path() else {
        return Ok(());
    };
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Fail-closed: only a definite absence, or a marker from a previous boot,
/// permits treating the firewall as clear. Anything unreadable counts as active.
fn lockdown_marker_may_exist() -> bool {
    let Some(path) = lockdown_marker_path() else {
        return true;
    };
    match std::fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => true,
        Ok(recorded) => {
            let stale = matches!(boot_time(), Some(now) if !recorded.is_empty() && recorded != now);
            if stale {
                let _ = clear_lockdown_marker();
            }
            !stale
        }
    }
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
    Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .bounded_output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(listed_basename)
                .map(str::to_string)
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

    let running = running_process_basenames();

    if let Some(recorder) = CAPTURE_TOOLS.iter().find(|name| {
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
    // Of the names macOS ships, only real apps a candidate can quit are
    // closable. Daemons (sshd, screencapture, …) belong to the system or to
    // Settings, and asking AppleScript to quit them shows a chooser dialog.
    const QUITTABLE_APPLE_APPS: [&str; 4] = [
        "Terminal",
        "QuickTime Player",
        "Screenshot",
        "Screen Sharing",
    ];
    if APPLE_SHIPPED.iter().any(|n| n.eq_ignore_ascii_case(name))
        && !QUITTABLE_APPLE_APPS
            .iter()
            .any(|n| n.eq_ignore_ascii_case(name))
    {
        return false;
    }
    RESTRICTED
        .iter()
        .chain(remote_access::REMOTE_APPS.iter())
        .any(|&r| r.eq_ignore_ascii_case(name))
}

/// Whether `name` is an installed app bundle AppleScript can address. For a
/// bare process name `tell application` shows a "Where is …?" chooser.
fn app_bundle_exists(name: &str) -> bool {
    [
        "/Applications",
        "/Applications/Utilities",
        "/System/Applications",
        "/System/Applications/Utilities",
    ]
    .iter()
    .any(|dir| {
        std::path::Path::new(dir)
            .join(format!("{name}.app"))
            .exists()
    }) || home_dir().is_some_and(|home| {
        home.join("Applications")
            .join(format!("{name}.app"))
            .exists()
    })
}

/// All pids whose executable basename matches `name` exactly (case-insensitive).
///
/// Built on `ps -axo pid=,comm=` for the same reason as `scan_processes`:
/// `comm` is the full executable path with no arguments, so multi-word app
/// names survive, and matching the exact basename cannot hit an unrelated
/// process the way a `pkill -f` command-line regex can.
fn pids_by_basename(name: &str) -> Vec<u32> {
    let own_pid = std::process::id();
    Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .bounded_output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|line| {
                    // "  123 /Applications/QuickTime Player.app/.../QuickTime Player"
                    let (pid, comm) = line.trim_start().split_once(char::is_whitespace)?;
                    let pid = pid.parse::<u32>().ok()?;
                    // Never signal an OS component that only shares a name.
                    let basename = listed_basename(comm)?;
                    (pid != own_pid && basename.eq_ignore_ascii_case(name)).then_some(pid)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Send `signal` to every process whose executable basename is `name`.
fn signal_by_basename(name: &str, signal: &str) {
    for pid in pids_by_basename(name) {
        let _ = Command::new("/bin/kill")
            .args([signal, &pid.to_string()])
            .bounded_output();
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
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let mut closed = Vec::new();
    let mut failed = Vec::new();

    for name in names {
        // Graceful quit via AppleScript, only for a real app bundle; anything
        // else goes straight to the signals below.
        if app_bundle_exists(name) {
            let _ = Command::new("/usr/bin/osascript")
                .args(["-e", &format!("tell application {:?} to quit", name)])
                .bounded_output();
        }

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
///
/// If `ps` itself fails or times out the answer is unknown, and unknown is
/// reported as alive: calling a restricted app closed on no evidence is worse
/// than asking the candidate to close it again.
fn process_alive_by_name(name: &str) -> bool {
    Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .bounded_checked_output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(listed_basename)
                .any(|basename| basename.eq_ignore_ascii_case(name))
        })
        .unwrap_or(true)
}

/// Register camera permission before WKWebView first requests video.
/// Microphone is optional and requested only when the candidate reaches its check.
pub fn request_av_permissions() {
    request_media_permission(false, |_| {});
}

/// Called on a blocking worker, never AppKit's main thread. A late response after
/// timeout is harmless: it does not acquire a stream or advance onboarding.
pub fn request_microphone_permission() -> Result<(), String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    request_media_permission(true, move |granted| {
        let _ = sender.try_send(granted);
    });
    match receiver.recv_timeout(std::time::Duration::from_secs(60)) {
        Ok(true) => Ok(()),
        Ok(false) => Err("Microphone access was not granted. You may continue without it.".into()),
        Err(_) => Err("Microphone permission is still unanswered. Check the system prompt or continue without it.".into()),
    }
}

fn request_media_permission(audio: bool, completion: impl Fn(bool) + Send + 'static) {
    unsafe {
        let cls = objc_getClass(c"AVCaptureDevice".as_ptr());
        if cls.is_null() {
            completion(false);
            return;
        }
        let sel = sel_registerName(c"requestAccessForMediaType:completionHandler:".as_ptr());
        let block =
            RcBlock::new(move |granted: objc2::runtime::Bool| completion(granted.as_bool()));
        type FnReqAccess = unsafe extern "C" fn(
            *mut c_void,
            *const c_void,
            *mut c_void,
            &block2::Block<dyn Fn(objc2::runtime::Bool)>,
        );
        let req: FnReqAccess = std::mem::transmute(objc_msgSend as *const ());
        req(
            cls,
            sel,
            if audio {
                AVMediaTypeAudio
            } else {
                AVMediaTypeVideo
            },
            &block,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_image_and_translocated_copies_are_unstable() {
        let unstable = |path: &str| unstable_bundle_path(std::path::Path::new(path));
        assert!(unstable(
            "/Volumes/AMS Access/AMS Access.app/Contents/MacOS/ams-access"
        ));
        assert!(unstable("/private/var/folders/x/T/AppTranslocation/1A2B/d/AMS Access.app/Contents/MacOS/ams-access"));
        assert!(!unstable(
            "/Applications/AMS Access.app/Contents/MacOS/ams-access"
        ));
        assert!(!unstable(
            "/Users/me/Applications/AMS Access.app/Contents/MacOS/ams-access"
        ));
        // A dev build is not a bundle, wherever the checkout lives.
        assert!(!unstable(
            "/Volumes/Work/ams-access/target/debug/ams-access"
        ));
    }
}
