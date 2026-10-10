//! A separate process that puts the desktop back when the app dies.
//!
//! SIGKILL, a force quit or a hard crash cannot be caught inside the app, so
//! the app re-executes itself as a small watchdog that waits on the app's
//! pid. It touches no AppKit — it only replays the on-disk snapshot — and it
//! leaves on its own as soon as the app has restored cleanly.
//!
//! Each lockdown gets its own watchdog, bound to that lockdown's snapshot by
//! owner pid and creation time. A watchdog never restores a snapshot it was
//! not started for: after a crash the student may relaunch and re-enter
//! within seconds, and the old watchdog must not unlock the new exam.

use super::system_settings::{self, RestoreOutcome};
use std::ffi::c_void;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const WATCHDOG_FLAG: &str = "--lockdown-watchdog";

#[repr(C)]
struct KEvent {
    ident: usize,
    filter: i16,
    flags: u16,
    fflags: u32,
    data: isize,
    udata: *mut c_void,
}

#[repr(C)]
struct Timespec {
    tv_sec: i64,
    tv_nsec: i64,
}

const EVFILT_PROC: i16 = -5;
const EV_ADD: u16 = 0x0001;
const EV_ONESHOT: u16 = 0x0010;
const NOTE_EXIT: u32 = 0x8000_0000;
const SIGHUP: i32 = 1;
const SIGINT: i32 = 2;
const SIGKILL: i32 = 9;
const SIGTERM: i32 = 15;
const SIG_IGN: usize = 1;
const ESRCH: i32 = 3;

extern "C" {
    fn kqueue() -> i32;
    fn kevent(
        kq: i32,
        changelist: *const KEvent,
        nchanges: i32,
        eventlist: *mut KEvent,
        nevents: i32,
        timeout: *const Timespec,
    ) -> i32;
    fn kill(pid: i32, sig: i32) -> i32;
    fn signal(sig: i32, handler: usize) -> usize;
    fn close(fd: i32) -> i32;
}

static TERM_REQUESTED: AtomicBool = AtomicBool::new(false);
/// Pid of this app's live watchdog child; 0 once its reaper has collected it.
static CHILD_PID: AtomicI32 = AtomicI32::new(0);
static SPAWN_LOCK: Mutex<()> = Mutex::new(());

extern "C" fn on_term(_signal: i32) {
    // Async-signal-safe: an atomic store and nothing else.
    TERM_REQUESTED.store(true, Ordering::Relaxed);
}

/// Start a watchdog for the lockdown whose snapshot was just written.
///
/// A previous watchdog is stopped first rather than reused: it is bound to
/// the previous snapshot and would exit (or, worse, keep guarding the wrong
/// one) the moment this lockdown replaced it.
pub(super) fn spawn() {
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    stop_locked();
    let Some((owner, created_at_ms)) = system_settings::snapshot_identity() else {
        return;
    };
    if owner != std::process::id() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(exe);
    command
        .arg(WATCHDOG_FLAG)
        .arg(owner.to_string())
        .arg(created_at_ms.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Its own process group: a Ctrl+C in a dev terminal, or a group kill,
        // must not take the watchdog down along with the app.
        .process_group(0);
    let Ok(mut child) = command.spawn() else {
        return;
    };
    let pid = child.id() as i32;
    CHILD_PID.store(pid, Ordering::SeqCst);
    // Reap it so a finished watchdog never lingers as a zombie. Clearing the
    // slot only after the wait means a pid in it is never a reused one.
    let _ = std::thread::Builder::new()
        .name("ams-lockdown-watchdog-reaper".into())
        .spawn(move || {
            let _ = child.wait();
            let _ = CHILD_PID.compare_exchange(pid, 0, Ordering::SeqCst, Ordering::SeqCst);
        });
}

/// Stop this app's watchdog after a verified restore: nothing is left to guard.
pub(super) fn stop() {
    let _guard = SPAWN_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    stop_locked();
}

fn stop_locked() {
    let pid = CHILD_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return;
    }
    // SIGKILL, not SIGTERM: a terminated watchdog waits for its parent to
    // exit before deciding anything, and the parent here is us.
    unsafe { kill(pid, SIGKILL) };
    let deadline = Instant::now() + Duration::from_secs(1);
    while CHILD_PID.load(Ordering::SeqCst) == pid && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn process_alive(pid: i32) -> bool {
    if unsafe { kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(ESRCH)
}

/// Run a helper mode selected by argv, before any GUI exists. `None` means
/// this is an ordinary app launch.
pub fn helper_mode_from_args() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some(WATCHDOG_FLAG) => Some(
            match (
                args.get(2).and_then(|pid| pid.parse::<i32>().ok()),
                args.get(3).and_then(|created| created.parse::<u64>().ok()),
            ) {
                (Some(parent), Some(created_at_ms)) if parent > 1 => {
                    run_watchdog(parent, created_at_ms)
                }
                _ => 2,
            },
        ),
        Some(system_settings::LOGIN_RESTORE_FLAG) => Some(run_login_restore()),
        _ => None,
    }
}

/// Restore until it verifies, for at most `attempts` tries 2 s apart.
fn restore_with_retries(attempts: u32, restore: impl Fn() -> RestoreOutcome) -> bool {
    for attempt in 0..attempts {
        match restore() {
            RestoreOutcome::Restored
            | RestoreOutcome::NothingToRestore
            | RestoreOutcome::Deferred => return true,
            RestoreOutcome::Failed(items) => {
                eprintln!(
                    "AMS Access watchdog: restore incomplete ({})",
                    items.join(", ")
                );
            }
        }
        if attempt + 1 < attempts {
            std::thread::sleep(Duration::from_secs(2));
        }
    }
    false
}

fn run_watchdog(parent: i32, created_at_ms: u64) -> i32 {
    let owner = parent as u32;
    unsafe {
        signal(SIGINT, SIG_IGN);
        signal(SIGHUP, SIG_IGN);
        signal(SIGTERM, on_term as *const () as usize);
    }

    let kq = unsafe { kqueue() };
    let mut parent_gone = false;
    if kq >= 0 {
        let change = KEvent {
            ident: parent as usize,
            filter: EVFILT_PROC,
            flags: EV_ADD | EV_ONESHOT,
            fflags: NOTE_EXIT,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        let registered =
            unsafe { kevent(kq, &change, 1, std::ptr::null_mut(), 0, std::ptr::null()) };
        if registered < 0 && std::io::Error::last_os_error().raw_os_error() == Some(ESRCH) {
            parent_gone = true;
        }
    }

    while !parent_gone && !TERM_REQUESTED.load(Ordering::Relaxed) {
        // Nothing left to guard: the app restored, or a newer lockdown
        // replaced this one's snapshot.
        if !system_settings::guards(owner, created_at_ms) {
            if kq >= 0 {
                unsafe { close(kq) };
            }
            return 0;
        }
        if kq >= 0 {
            let mut event = KEvent {
                ident: 0,
                filter: 0,
                flags: 0,
                fflags: 0,
                data: 0,
                udata: std::ptr::null_mut(),
            };
            let timeout = Timespec {
                tv_sec: 1,
                tv_nsec: 0,
            };
            let fired = unsafe { kevent(kq, std::ptr::null(), 0, &mut event, 1, &timeout) };
            if fired > 0 && event.filter == EVFILT_PROC && event.fflags & NOTE_EXIT != 0 {
                parent_gone = true;
            }
        } else {
            // No kqueue: fall back to polling the pid.
            std::thread::sleep(Duration::from_secs(1));
        }
        if !parent_gone && !process_alive(parent) {
            parent_gone = true;
        }
    }
    if kq >= 0 {
        unsafe { close(kq) };
    }

    if !parent_gone {
        // SIGTERM while the app is alive. At logout or shutdown the app gets
        // the same signal and exits after restoring itself; wait for that.
        // Anything else that terminates only the watchdog must not unlock a
        // contest that is still running, so if the app outlives the wait the
        // watchdog leaves without touching anything.
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline && process_alive(parent) {
            if !system_settings::guards(owner, created_at_ms) {
                return 0;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        if process_alive(parent) || !system_settings::guards(owner, created_at_ms) {
            return 0;
        }
    }

    let restored = restore_with_retries(60, || {
        system_settings::restore_owned_by(owner, created_at_ms)
    });
    // A dead app cannot lift its own egress rules.
    let _ = super::disable_network_lockdown();
    if restored {
        0
    } else {
        1
    }
}

/// Run by the login agent after a restart or power loss mid-exam.
fn run_login_restore() -> i32 {
    if system_settings::owner_alive_elsewhere() {
        return 0;
    }
    let restored = restore_with_retries(30, system_settings::restore);
    if restored {
        system_settings::remove_login_agent();
        0
    } else {
        1
    }
}
