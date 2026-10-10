//! Display topology for the Extra monitors check, and hot-plug detection
//! while a contest is running.
//!
//! Counting is CoreGraphics only, so it is cheap enough for the
//! reconfiguration callback. Names and the wireless classification come from
//! `system_profiler`, which is far too slow for a callback and only runs in
//! the readiness scan or on a background thread.

use crate::process_runner::CommandDeadlineExt;
use core_rs::exam::{DisplayScan, LockdownPolicy};
use std::ffi::c_void;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

type CGDirectDisplayID = u32;
type CGError = i32;

const MAX_DISPLAYS: u32 = 32;
// CGDisplayChangeSummaryFlags: the first notification of every change,
// before anything has actually changed. The completion call follows.
const K_CG_DISPLAY_BEGIN_CONFIGURATION_FLAG: u32 = 1;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetOnlineDisplayList(
        max: u32,
        displays: *mut CGDirectDisplayID,
        count: *mut u32,
    ) -> CGError;
    fn CGDisplayIsBuiltin(display: CGDirectDisplayID) -> u32;
    fn CGDisplayIsInMirrorSet(display: CGDirectDisplayID) -> u32;
    fn CGDisplayMirrorsDisplay(display: CGDirectDisplayID) -> CGDirectDisplayID;
    fn CGDisplayRegisterReconfigurationCallback(
        callback: extern "C" fn(CGDirectDisplayID, u32, *mut c_void),
        user_info: *mut c_void,
    ) -> CGError;
}

/// What the readiness dialog and the proctoring log say about the displays.
#[derive(serde::Serialize, Clone, Debug)]
pub struct DisplayReport {
    /// Online displays, mirrors included. Zero means the probe failed:
    /// macOS always has at least one display online, even in clamshell.
    pub count: u32,
    pub names: Vec<String>,
    pub mirrored: bool,
    /// AirPlay, Sidecar or another virtual output.
    pub wireless: bool,
    /// The lid is closed and an external display is in use.
    pub clamshell: bool,
}

impl DisplayReport {
    pub fn to_scan(&self) -> DisplayScan {
        DisplayScan {
            count: self.count,
            // A mirror set is two displays showing the same picture: one of
            // them can be facing someone else.
            has_extra: self.count > 1 || self.mirrored,
            has_wireless: self.wireless,
        }
    }

    pub fn describe(&self) -> String {
        if self.count == 0 {
            return "Could not read the display list".to_string();
        }
        let mut text = if self.count == 1 {
            "1 display detected".to_string()
        } else {
            format!("{} displays detected", self.count)
        };
        if !self.names.is_empty() {
            text.push_str(": ");
            text.push_str(&self.names.join(", "));
        }
        let mut notes = Vec::new();
        if self.mirrored {
            notes.push("mirrored");
        }
        if self.wireless {
            notes.push("AirPlay or Sidecar");
        }
        if self.clamshell {
            notes.push("lid closed");
        }
        if !notes.is_empty() {
            text.push_str(&format!(" ({})", notes.join(", ")));
        }
        text
    }
}

/// Every connected display, including mirrors and ones that are not drawing
/// (the active list is a subset of this). CoreGraphics only, so safe inside
/// the reconfiguration callback.
fn online_displays() -> Option<Vec<CGDirectDisplayID>> {
    let mut ids = [0u32; MAX_DISPLAYS as usize];
    let mut count = 0u32;
    // SAFETY: the buffer holds MAX_DISPLAYS entries and CoreGraphics writes
    // at most that many, reporting how many it wrote in `count`.
    let error = unsafe { CGGetOnlineDisplayList(MAX_DISPLAYS, ids.as_mut_ptr(), &mut count) };
    (error == 0).then(|| ids[..count.min(MAX_DISPLAYS) as usize].to_vec())
}

fn any_mirrored(ids: &[CGDirectDisplayID]) -> bool {
    // SAFETY: plain queries on display ids CoreGraphics just returned.
    ids.iter()
        .any(|&id| unsafe { CGDisplayIsInMirrorSet(id) != 0 || CGDisplayMirrorsDisplay(id) != 0 })
}

/// The display count and whether any display is mirrored, packed into one
/// word (`count << 1 | mirrored`) so the callback can swap it without a lock.
fn online_state() -> u32 {
    online_displays().map_or(0, |ids| {
        ((ids.len() as u32) << 1) | u32::from(any_mirrored(&ids))
    })
}

/// What `system_profiler` knows that CoreGraphics does not: names, and
/// whether a display arrives over AirPlay or Sidecar.
struct ProfilerDisplays {
    names: Vec<String>,
    wireless: bool,
}

fn profiler_displays() -> ProfilerDisplays {
    // Unchecked on purpose: names are decoration. A slow or failing
    // system_profiler must not turn the whole readiness scan into an error.
    let json = Command::new("system_profiler")
        .args(["SPDisplaysDataType", "-json"])
        .bounded_output_with_timeout(Duration::from_secs(4))
        .ok()
        .filter(|out| out.status.success())
        .and_then(|out| serde_json::from_slice::<serde_json::Value>(&out.stdout).ok());
    let mut names = Vec::new();
    let mut wireless = false;
    let gpus = json
        .as_ref()
        .and_then(|value| value.get("SPDisplaysDataType"))
        .and_then(|value| value.as_array());
    for gpu in gpus.into_iter().flatten() {
        let displays = gpu.get("spdisplays_ndrvs").and_then(|v| v.as_array());
        for display in displays.into_iter().flatten() {
            let name = display
                .get("_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let connection = display
                .get("spdisplays_connection_type")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let marker = format!("{name} {connection}").to_ascii_lowercase();
            if ["airplay", "sidecar", "virtual"]
                .iter()
                .any(|word| marker.contains(word))
            {
                wireless = true;
            }
            if !name.is_empty() {
                names.push(name.to_string());
            }
        }
    }
    ProfilerDisplays { names, wireless }
}

fn lid_closed() -> bool {
    Command::new("ioreg")
        .args(["-r", "-k", "AppleClamshellState", "-d", "4"])
        .bounded_output()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .any(|line| line.contains("\"AppleClamshellState\" = Yes"))
        })
        .unwrap_or(false)
}

/// Every display attached to this Mac, including mirrored ones, AirPlay and
/// Sidecar, with clamshell setups called out.
pub fn scan_displays() -> DisplayReport {
    let Some(online) = online_displays() else {
        return DisplayReport {
            count: 0,
            names: vec![],
            mirrored: false,
            wireless: false,
            clamshell: false,
        };
    };
    // SAFETY: plain query on display ids CoreGraphics just returned.
    let builtin_online = online
        .iter()
        .any(|&id| unsafe { CGDisplayIsBuiltin(id) != 0 });
    let profiler = profiler_displays();
    // No built-in panel online means a desktop or a closed laptop; only then
    // ask the registry which.
    let clamshell = !builtin_online && lid_closed();
    DisplayReport {
        count: online.len() as u32,
        names: profiler.names,
        mirrored: any_mirrored(&online),
        wireless: profiler.wireless,
        clamshell,
    }
}

// ── Hot-plug during the contest ──────────────────────────────────────────────

static MONITORING: AtomicBool = AtomicBool::new(false);
// Registered once per process and gated on MONITORING: a per-lockdown
// registration that timed out on a busy main thread still ran later and was
// never removed, so the next lockdown added a second copy.
static REGISTERED: AtomicBool = AtomicBool::new(false);
static LAST_STATE: AtomicU32 = AtomicU32::new(0);
// Block and Warn both record a violation mid-contest; LogOnly a notice.
static LOG_ONLY: AtomicBool = AtomicBool::new(false);

extern "C" fn on_reconfigure(_display: CGDirectDisplayID, flags: u32, _user: *mut c_void) {
    // Called by CoreGraphics on the main run loop; a panic must not unwind
    // into C.
    let _ = std::panic::catch_unwind(|| {
        if flags & K_CG_DISPLAY_BEGIN_CONFIGURATION_FLAG != 0 || !MONITORING.load(Ordering::SeqCst)
        {
            return;
        }
        // One physical change produces a callback per display; report a
        // change in the count or in mirroring once.
        let state = online_state();
        let previous_state = LAST_STATE.swap(state, Ordering::SeqCst);
        if state == previous_state {
            return;
        }
        let (previous, count) = (previous_state >> 1, state >> 1);
        // system_profiler takes a second or more; never on the main thread.
        std::thread::spawn(move || {
            let report = scan_displays();
            if !MONITORING.load(Ordering::SeqCst) {
                return;
            }
            let detail = format!(
                "Display configuration changed during the contest ({previous} → {count}): {}",
                report.describe()
            );
            if LOG_ONLY.load(Ordering::SeqCst) {
                super::emit_lockdown_notice("display_configuration_changed", &detail);
            } else {
                super::emit_lockdown_event("display_configuration_changed", &detail);
            }
        });
    });
}

/// Watch for displays being connected, disconnected or mirrored until
/// `stop_monitoring`. Idempotent.
pub(super) fn start_monitoring(policy: LockdownPolicy) {
    LOG_ONLY.store(matches!(policy, LockdownPolicy::LogOnly), Ordering::SeqCst);
    LAST_STATE.store(online_state(), Ordering::SeqCst);
    MONITORING.store(true, Ordering::SeqCst);
    if REGISTERED.swap(true, Ordering::SeqCst) {
        return;
    }
    // Callbacks are delivered through the main run loop; register there.
    let registered = super::kiosk_window::on_main(Duration::from_secs(2), || {
        // SAFETY: a static callback with no user data, registered once per
        // process and never removed; it does nothing while not monitoring.
        unsafe { CGDisplayRegisterReconfigurationCallback(on_reconfigure, std::ptr::null_mut()) }
    });
    match registered {
        Some(0) => {}
        // Timed out: the queued registration will still run, so it stays
        // marked as registered rather than risk a second copy.
        None => super::emit_lockdown_notice(
            "display_monitoring_delayed",
            "Display-change monitoring is starting late; the main thread was busy",
        ),
        Some(_) => {
            REGISTERED.store(false, Ordering::SeqCst);
            super::emit_lockdown_notice(
                "display_monitoring_unavailable",
                "Could not watch for display changes during the contest",
            );
        }
    }
}

pub(super) fn stop_monitoring() {
    // The registration stays; the callback checks this flag first.
    MONITORING.store(false, Ordering::SeqCst);
}
