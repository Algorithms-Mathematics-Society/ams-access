//! System sleep and wake during an exam.
//!
//! `caffeinate` only holds off idle sleep: closing the lid, the power key or
//! an Apple-menu Sleep still put the Mac to sleep, and until now the only
//! trace was the network dropping, indistinguishable from a Wi-Fi outage.
//! NSWorkspace posts will-sleep before the machine sleeps and lets observers
//! delay it while they run, so the violation is handed to the host from inside
//! that window, while the disk is still there; it uploads after wake.
//!
//! The observers live for the whole app and check the lockdown themselves, so
//! the lock and unlock paths stay untouched. Nothing is reported outside one.

use super::kiosk_window::{guarded, on_main};
use crate::process_runner::CommandDeadlineExt;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use std::panic::catch_unwind;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[link(name = "AppKit", kind = "framework")]
extern "C" {
    static NSWorkspaceWillSleepNotification: *mut AnyObject;
    static NSWorkspaceDidWakeNotification: *mut AnyObject;
}

/// `callback(kind, detail, payload)`: `system_sleep` is a violation,
/// `system_woke` the notice that follows it with the time asleep.
type PowerEventCallback = Box<dyn Fn(&str, &str, serde_json::Value) + Send + Sync>;
static POWER_EVENT_CALLBACK: OnceLock<PowerEventCallback> = OnceLock::new();
static INSTALLED: AtomicBool = AtomicBool::new(false);
// Wall-clock seconds at will-sleep; 0 when no exam sleep is outstanding.
// Wall clock, because the monotonic clock on macOS stops while asleep.
static SLEPT_AT: AtomicU64 = AtomicU64::new(0);

/// Register the host sink for sleep/wake events. Called on the main thread
/// while the system waits to sleep, so the host may block briefly to persist.
/// Only the first registration per process wins.
pub fn set_power_event_callback<F>(callback: F)
where
    F: Fn(&str, &str, serde_json::Value) + Send + Sync + 'static,
{
    let _ = POWER_EVENT_CALLBACK.set(Box::new(callback));
}

fn emit(kind: &str, detail: &str, payload: serde_json::Value) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = POWER_EVENT_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            callback(kind, detail, payload)
        }));
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// Read at will-sleep, the lid is still reported closed when it caused it.
/// Bounded: this runs on the main thread with the system waiting on us.
fn lid_closed() -> bool {
    Command::new("/usr/sbin/ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "1"])
        .bounded_output_with_timeout(Duration::from_secs(1))
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|line| line.contains("\"AppleClamshellState\" = Yes"))
        })
        .unwrap_or(false)
}

fn will_sleep() {
    if !super::lockdown_active() {
        return;
    }
    SLEPT_AT.store(now_secs().max(1), Ordering::SeqCst);
    let (cause, detail) = if lid_closed() {
        (
            "lid_closed",
            "The lid was closed and the Mac went to sleep during the exam",
        )
    } else {
        ("system_sleep", "The Mac went to sleep during the exam")
    };
    emit(
        "system_sleep",
        detail,
        serde_json::json!({ "cause": cause }),
    );
}

fn did_wake() {
    // Only a sleep that was recorded during the exam gets a wake record.
    let slept_at = SLEPT_AT.swap(0, Ordering::SeqCst);
    if slept_at == 0 {
        return;
    }
    let slept_secs = now_secs().saturating_sub(slept_at);
    emit(
        "system_woke",
        &format!("The Mac woke after {slept_secs}s asleep"),
        serde_json::json!({ "slept_secs": slept_secs }),
    );
    if super::lockdown_active() {
        super::refocus_our_app();
    }
}

/// Observe will-sleep and did-wake for the rest of the process. Idempotent.
/// The tokens are never removed, so they are simply kept (+1) for good.
pub fn install_power_observers() {
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = on_main(Duration::from_secs(2), || {
        let registrations: [(*mut AnyObject, fn()); 2] = unsafe {
            [
                (NSWorkspaceWillSleepNotification, will_sleep),
                (NSWorkspaceDidWakeNotification, did_wake),
            ]
        };
        for (name, action) in registrations {
            // Runs on the main queue as an Objective-C block: contain panics.
            let block = RcBlock::new(move |_notification: *mut AnyObject| {
                let _ = catch_unwind(action);
            });
            guarded(|| unsafe {
                let shared: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
                let center: *mut AnyObject = msg_send![shared, notificationCenter];
                let queue: *mut AnyObject = msg_send![class!(NSOperationQueue), mainQueue];
                if center.is_null() || queue.is_null() || name.is_null() {
                    return;
                }
                // The center copies the block; the +0 token is retained forever.
                let token: *mut AnyObject = msg_send![
                    center,
                    addObserverForName: name,
                    object: std::ptr::null_mut::<AnyObject>(),
                    queue: queue,
                    usingBlock: &*block
                ];
                if let Some(token) = Retained::retain(token) {
                    std::mem::forget(token);
                }
            });
        }
    });
}
