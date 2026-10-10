//! Kiosk presentation for the exam window: the app-wide presentation options
//! that hide the Dock and menu bar and switch off process switching, force
//! quit and session termination; the window's level and Spaces behaviour; and
//! the focus observers that record whatever still gets past all of that.
//!
//! All of it is process-local and dies with the app, so a crash needs no
//! recovery; only the normal exit path has to put it back.
//!
//! Every AppKit call runs on the main thread inside an Objective-C exception
//! guard: AppKit raises for option combinations it dislikes, and an exception
//! unwinding into Rust aborts the process.

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send, MainThreadMarker};
use std::ffi::c_void;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

// NSApplicationPresentationOptions
const AUTO_HIDE_DOCK: usize = 1 << 0;
const HIDE_DOCK: usize = 1 << 1;
const AUTO_HIDE_MENU_BAR: usize = 1 << 2;
const HIDE_MENU_BAR: usize = 1 << 3;
const DISABLE_APPLE_MENU: usize = 1 << 4;
const DISABLE_PROCESS_SWITCHING: usize = 1 << 5;
const DISABLE_FORCE_QUIT: usize = 1 << 6;
const DISABLE_SESSION_TERMINATION: usize = 1 << 7;
const DISABLE_HIDE_APPLICATION: usize = 1 << 8;
const FULL_SCREEN: usize = 1 << 10;

const KIOSK_OPTIONS: usize = HIDE_DOCK
    | HIDE_MENU_BAR
    | DISABLE_APPLE_MENU
    | DISABLE_PROCESS_SWITCHING
    | DISABLE_FORCE_QUIT
    | DISABLE_SESSION_TERMINATION
    | DISABLE_HIDE_APPLICATION;
// Fallbacks if AppKit rejects the full set on some release.
const REDUCED_OPTIONS: usize =
    HIDE_DOCK | HIDE_MENU_BAR | DISABLE_PROCESS_SWITCHING | DISABLE_FORCE_QUIT;
const MINIMAL_OPTIONS: usize = HIDE_DOCK | HIDE_MENU_BAR;
// Bits only kiosk mode sets; nothing else in the app uses them.
const KIOSK_ONLY: usize = DISABLE_APPLE_MENU
    | DISABLE_PROCESS_SWITCHING
    | DISABLE_FORCE_QUIT
    | DISABLE_SESSION_TERMINATION
    | DISABLE_HIDE_APPLICATION;

// NSWindowCollectionBehavior, by the mutually exclusive groups AppKit
// enforces: two members of one group raise.
const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const SPACE_BITS: usize = (1 << 0) | (1 << 1);
const STATIONARY: usize = 1 << 4;
const EXPOSE_BITS: usize = (1 << 2) | (1 << 3) | (1 << 4);
const IGNORES_CYCLE: usize = 1 << 6;
const CYCLE_BITS: usize = (1 << 5) | (1 << 6);
const FULL_SCREEN_NONE: usize = 1 << 9;
const FULL_SCREEN_BITS: usize = (1 << 7) | (1 << 8) | (1 << 9);
const TILING_BITS: usize = (1 << 11) | (1 << 12);

// NSStatusWindowLevel: above the Dock (20), below pop-up menus (101) so the
// exam's own dropdowns and context menus stay visible.
const KIOSK_WINDOW_LEVEL: isize = 25;

// NSWindowStyleMask
const STYLE_TITLED: usize = 1 << 0;
const STYLE_FULL_SCREEN: usize = 1 << 14;

// Options in force before the first apply; a re-apply never overwrites them.
static PRESENTATION: Mutex<Option<usize>> = Mutex::new(None);
// (NSWindow pointer, original level, original collection behaviour).
static WINDOW: Mutex<Option<(usize, isize, usize)>> = Mutex::new(None);
// (notification center, +1 observer token) as raw addresses.
static OBSERVERS: Mutex<Vec<(usize, usize)>> = Mutex::new(Vec::new());

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

// ── Main-thread dispatch ──────────────────────────────────────────────────────

#[repr(C)]
struct DispatchQueue {
    _private: [u8; 0],
}

extern "C" {
    static _dispatch_main_q: DispatchQueue;
    fn dispatch_async_f(
        queue: *const DispatchQueue,
        context: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
}

type Job = Box<dyn FnOnce() + Send>;

extern "C" fn run_job(context: *mut c_void) {
    // SAFETY: `context` is the Box<Job> leaked by `on_main`, delivered once.
    let job = unsafe { Box::from_raw(context as *mut Job) };
    // A panic must not unwind into libdispatch.
    let _ = catch_unwind(AssertUnwindSafe(job));
}

/// Run `f` on the main thread and wait up to `timeout` for its result. On the
/// main thread it runs inline.
///
/// Asynchronous dispatch plus a bounded wait, never `dispatch_sync`: the main
/// thread may itself be waiting on the caller during shutdown. On timeout the
/// job may still run later; callers treat `None` as "not done".
pub(super) fn on_main<R: Send + 'static>(
    timeout: Duration,
    f: impl FnOnce() -> R + Send + 'static,
) -> Option<R> {
    if MainThreadMarker::new().is_some() {
        return catch_unwind(AssertUnwindSafe(f)).ok();
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    let job: Job = Box::new(move || {
        let _ = sender.send(f());
    });
    let context = Box::into_raw(Box::new(job)) as *mut c_void;
    // SAFETY: the main queue lives for the whole process; `run_job` takes
    // ownership of `context` exactly once.
    unsafe { dispatch_async_f(std::ptr::addr_of!(_dispatch_main_q), context, run_job) };
    receiver.recv_timeout(timeout).ok()
}

/// Run an AppKit call behind a panic guard and an Objective-C exception
/// guard. `None` means it raised.
pub(super) fn guarded<R>(f: impl FnOnce() -> R) -> Option<R> {
    match catch_unwind(AssertUnwindSafe(|| {
        objc2::exception::catch(AssertUnwindSafe(f))
    })) {
        Ok(Ok(value)) => Some(value),
        _ => None,
    }
}

fn shared_app() -> Option<*mut AnyObject> {
    guarded(|| unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        app as usize
    })
    .filter(|app| *app != 0)
    .map(|app| app as *mut AnyObject)
}

fn set_presentation(app: *mut AnyObject, options: usize) -> bool {
    guarded(|| unsafe {
        let _: () = msg_send![app, setPresentationOptions: options];
    })
    .is_some()
}

// ── Kiosk presentation ────────────────────────────────────────────────────────

/// Hide the Dock and menu bar, disable process switching, force quit, session
/// termination, Hide and the Apple menu, and pin the exam window above other
/// windows on every Space.
///
/// Partial success applies what it can and reports the rest as an error for
/// the caller to record; the keyboard tap remains the backstop.
pub fn apply_kiosk(ns_window: usize) -> Result<(), String> {
    if ns_window == 0 {
        return Err("Exam window handle unavailable".into());
    }
    on_main(Duration::from_secs(3), move || {
        // A job that timed out can still run after unlock; it must not lock
        // the desktop again then.
        if !super::lockdown_active() {
            return Err("Lockdown is no longer active".to_string());
        }
        apply_on_main(ns_window)
    })
    .unwrap_or_else(|| Err("The main thread did not apply the kiosk presentation in time".into()))
}

fn apply_on_main(ns_window: usize) -> Result<(), String> {
    let app = shared_app().ok_or("NSApplication is unavailable")?;
    let current: usize = guarded(|| unsafe { msg_send![app, presentationOptions] })
        .ok_or("Could not read the current presentation options")?;
    lock(&PRESENTATION).get_or_insert(current);

    // A window in native fullscreen must keep the FullScreen bit, and AppKit
    // only accepts the auto-hide Dock and menu bar options alongside it.
    let native_fullscreen = current & FULL_SCREEN != 0;
    let adapt = |options: usize| {
        if native_fullscreen {
            (options & !(HIDE_DOCK | HIDE_MENU_BAR))
                | AUTO_HIDE_DOCK
                | AUTO_HIDE_MENU_BAR
                | FULL_SCREEN
        } else {
            options
        }
    };

    let mut problems = Vec::new();
    match [KIOSK_OPTIONS, REDUCED_OPTIONS, MINIMAL_OPTIONS]
        .into_iter()
        .find(|options| set_presentation(app, adapt(*options)))
    {
        Some(KIOSK_OPTIONS) => {}
        Some(_) => problems.push("only part of the kiosk presentation was accepted"),
        None => problems.push("the kiosk presentation options were rejected"),
    }

    let window = ns_window as *mut AnyObject;
    let original = guarded(|| unsafe {
        let level: isize = msg_send![window, level];
        let behavior: usize = msg_send![window, collectionBehavior];
        (level, behavior)
    });
    if let Some((level, behavior)) = original {
        {
            let mut saved = lock(&WINDOW);
            if !matches!(*saved, Some((saved_window, _, _)) if saved_window == ns_window) {
                *saved = Some((ns_window, level, behavior));
            }
        }
        if guarded(|| unsafe {
            let _: () = msg_send![window, setLevel: KIOSK_WINDOW_LEVEL];
        })
        .is_none()
        {
            problems.push("the exam window could not be raised");
        }
        // Follow the candidate to any Space, stay out of Exposé and window
        // cycling, and refuse native fullscreen, which is a Space of its own.
        let base = behavior & !(SPACE_BITS | EXPOSE_BITS | CYCLE_BITS);
        let pinned = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE;
        let preferred = if native_fullscreen {
            base | pinned
        } else {
            (base & !(FULL_SCREEN_BITS | TILING_BITS)) | pinned | FULL_SCREEN_NONE
        };
        let set_behavior = |value: usize| {
            guarded(|| unsafe {
                let _: () = msg_send![window, setCollectionBehavior: value];
            })
            .is_some()
        };
        if !set_behavior(preferred) && (preferred == base | pinned || !set_behavior(base | pinned))
        {
            problems.push("the exam window could not be pinned to every Space");
        }
    } else {
        problems.push("the exam window could not be read");
    }

    if guarded(|| unsafe {
        let _: () = msg_send![app, activateIgnoringOtherApps: Bool::YES];
    })
    .is_none()
    {
        problems.push("the exam could not be brought to the front");
    }

    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("Kiosk mode incomplete: {}", problems.join("; ")))
    }
}

/// Apply the kiosk presentation again once the relaunched Dock is up.
///
/// `lock_desktop` ends by restarting the Dock, which is what honours HideDock
/// and DisableProcessSwitching; options set while it relaunches may never
/// reach the new instance. The checks run on the main thread after the
/// restore functions have taken their saved state, so a teardown that has
/// started is never undone.
pub fn reapply_kiosk_later(ns_window: usize) {
    if ns_window == 0 {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("ams-kiosk-reapply".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            let _ = on_main(Duration::from_secs(3), move || {
                let window_saved = matches!(*lock(&WINDOW), Some((w, _, _)) if w == ns_window);
                if super::lockdown_active() && lock(&PRESENTATION).is_some() && window_saved {
                    let _ = apply_on_main(ns_window);
                }
            });
        });
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Rect {
    origin: Point,
    size: Size,
}

// SAFETY: identical layout and encoding to CGPoint / CGSize / CGRect.
unsafe impl objc2::Encode for Point {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::Encode for Size {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}
unsafe impl objc2::Encode for Rect {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGRect", &[Point::ENCODING, Size::ENCODING]);
}

/// Wait until native fullscreen has really ended.
///
/// tao's `is_fullscreen()` turns false as soon as an exit is requested, while
/// the exit animation runs later; engaging simple fullscreen before it ends
/// let the animation restore the title bar and level. AppKit's own style and
/// presentation bits clear only when the transition is complete.
pub fn wait_native_fullscreen_exit(ns_window: usize, timeout: Duration) -> bool {
    if ns_window == 0 {
        return false;
    }
    let deadline = Instant::now() + timeout;
    loop {
        let cleared = on_main(Duration::from_millis(500), move || {
            let app = shared_app()?;
            let window = ns_window as *mut AnyObject;
            guarded(|| unsafe {
                let style: usize = msg_send![window, styleMask];
                let options: usize = msg_send![app, presentationOptions];
                style & STYLE_FULL_SCREEN == 0 && options & FULL_SCREEN == 0
            })
        })
        .flatten();
        if cleared == Some(true) {
            // Let `windowDidExitFullScreen` handlers run.
            std::thread::sleep(Duration::from_millis(300));
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Whether simple fullscreen actually took: no title bar, and the window
/// covers its screen. tao reports nothing when it declines the request.
pub fn simple_fullscreen_engaged(ns_window: usize) -> bool {
    if ns_window == 0 {
        return false;
    }
    on_main(Duration::from_secs(1), move || {
        let window = ns_window as *mut AnyObject;
        guarded(|| unsafe {
            let style: usize = msg_send![window, styleMask];
            if style & (STYLE_TITLED | STYLE_FULL_SCREEN) != 0 {
                return false;
            }
            let screen: *mut AnyObject = msg_send![window, screen];
            if screen.is_null() {
                return false;
            }
            let frame: Rect = msg_send![window, frame];
            let screen_frame: Rect = msg_send![screen, frame];
            let close = |a: f64, b: f64| (a - b).abs() <= 1.0;
            close(frame.origin.x, screen_frame.origin.x)
                && close(frame.origin.y, screen_frame.origin.y)
                && close(frame.size.width, screen_frame.size.width)
                && close(frame.size.height, screen_frame.size.height)
        })
        .unwrap_or(false)
    })
    .unwrap_or(false)
}

/// Put the exam window's level and Spaces behaviour back. Only touches the
/// saved window: a different pointer means the saved one may be gone.
pub fn restore_kiosk_window(ns_window: usize) {
    let Some((window, level, behavior)) = lock(&WINDOW).take() else {
        return;
    };
    if ns_window == 0 || window != ns_window {
        return;
    }
    let _ = on_main(Duration::from_secs(2), move || {
        let window = ns_window as *mut AnyObject;
        guarded(|| unsafe {
            let _: () = msg_send![window, setCollectionBehavior: behavior];
        });
        guarded(|| unsafe {
            let _: () = msg_send![window, setLevel: level];
        });
    });
}

/// Restore the presentation options in force before the first apply. Never
/// touches the window, which may be destroyed by now.
///
/// Process switching, force quit and the rest are cleared whatever was saved:
/// while this app is frontmost they also switch off trackpad Spaces swipes,
/// and a saved value can carry them when a teardown ran out of order (tao
/// restores its own copy when simple fullscreen ends). Runs even when nothing
/// was saved, for the same reason.
pub(super) fn restore_kiosk_presentation() {
    let saved = lock(&PRESENTATION).take();
    let _ = on_main(Duration::from_secs(2), move || {
        let Some(app) = shared_app() else {
            return;
        };
        let current: Option<usize> = guarded(|| unsafe { msg_send![app, presentationOptions] });
        let Some(options) = saved.or(current) else {
            return;
        };
        let options = options & !KIOSK_ONLY;
        // The fullscreen state may have changed since the save, which makes
        // the original set invalid.
        let _ = set_presentation(app, options)
            || set_presentation(app, options & !FULL_SCREEN)
            || set_presentation(app, 0);
    });
}

// ── Focus observers ───────────────────────────────────────────────────────────

#[link(name = "AppKit", kind = "framework")]
extern "C" {
    static NSApplicationDidResignActiveNotification: *mut AnyObject;
    static NSWorkspaceActiveSpaceDidChangeNotification: *mut AnyObject;
    static NSWorkspaceSessionDidResignActiveNotification: *mut AnyObject;
}

type Handler = RcBlock<dyn Fn(*mut AnyObject)>;

/// A notification handler that records `kind` during lockdown. Runs on the
/// main queue as an Objective-C block, so a panic is contained here.
fn handler(kind: &'static str, detail: &'static str, refocus: bool) -> Handler {
    RcBlock::new(move |_notification: *mut AnyObject| {
        let _ = catch_unwind(|| {
            if !super::lockdown_active() {
                return;
            }
            super::emit_lockdown_event(kind, detail);
            if refocus {
                super::refocus_our_app();
            }
        });
    })
}

/// Record focus loss, Space changes and session switches during lockdown —
/// the fallback for whatever the presentation options and keyboard tap could
/// not block. Idempotent while installed. NSNotificationCenter is
/// thread-safe, and the handlers run on the main queue.
pub(super) fn install_focus_observers() {
    let mut observers = lock(&OBSERVERS);
    if !observers.is_empty() {
        return;
    }
    let registrations = [
        (
            false,
            unsafe { NSApplicationDidResignActiveNotification },
            handler(
                "focus_loss",
                "AMS Access lost focus to another app or system window during the exam",
                true,
            ),
        ),
        (
            true,
            unsafe { NSWorkspaceActiveSpaceDidChangeNotification },
            handler(
                "space_changed",
                "The active desktop Space changed during the exam",
                true,
            ),
        ),
        (
            true,
            unsafe { NSWorkspaceSessionDidResignActiveNotification },
            handler(
                "session_switched",
                "The Mac was locked or switched to another user during the exam",
                false,
            ),
        ),
    ];
    for (workspace, name, block) in registrations {
        let registered = guarded(|| unsafe {
            let center: *mut AnyObject = if workspace {
                let shared: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
                msg_send![shared, notificationCenter]
            } else {
                msg_send![class!(NSNotificationCenter), defaultCenter]
            };
            let queue: *mut AnyObject = msg_send![class!(NSOperationQueue), mainQueue];
            if center.is_null() || queue.is_null() || name.is_null() {
                return None;
            }
            // The center copies the block. The returned token is +0; retain it
            // until removal.
            let token: *mut AnyObject = msg_send![
                center,
                addObserverForName: name,
                object: std::ptr::null_mut::<AnyObject>(),
                queue: queue,
                usingBlock: &*block
            ];
            let token = Retained::retain(token)?;
            Some((center as usize, Retained::into_raw(token) as usize))
        })
        .flatten();
        if let Some(entry) = registered {
            observers.push(entry);
        }
    }
}

/// Remove and release every observer `install_focus_observers` registered.
pub(super) fn remove_focus_observers() {
    let observers = std::mem::take(&mut *lock(&OBSERVERS));
    for (center, token) in observers {
        guarded(|| unsafe {
            let center = center as *mut AnyObject;
            let token = token as *mut AnyObject;
            let _: () = msg_send![center, removeObserver: token];
            // Balances the retain in `install_focus_observers`.
            drop(Retained::from_raw(token));
        });
    }
}
