//! Machine-wide ownership for the application instance.
//!
//! The mutex is global because firewall rules are shared across users. The
//! handle must remain alive for the app lifetime, and the guard must be dropped
//! on the thread that acquired it (as required by Win32 mutex ownership).

use std::marker::PhantomData;
use std::rc::Rc;
use std::time::Duration;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{
    CloseHandle, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows::Win32::System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject};

const INSTANCE_MUTEX_NAME: &str = "Global\\AMS_ACCESS_INSTANCE_OWNER";

/// A held named mutex. Deliberately neither `Send` nor `Sync`: Windows mutex
/// release must occur on the same thread that acquired ownership.
pub struct InstanceGuard {
    handle: HANDLE,
    production: bool,
    _same_thread: PhantomData<Rc<()>>,
}

/// Attempt to own the machine-wide application instance for up to `wait`.
///
/// An abandoned mutex is acquired successfully, allowing recovery after a
/// previous owner crashed. A timeout or any Win32 failure fails closed.
pub fn acquire(wait: Duration) -> Result<InstanceGuard, String> {
    if PRODUCTION_OWNERSHIP
        .compare_exchange(
            0,
            1,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return Err("This process already owns the application instance".into());
    }
    match acquire_named(INSTANCE_MUTEX_NAME, wait, true) {
        Ok(guard) => {
            PRODUCTION_OWNERSHIP.store(2, std::sync::atomic::Ordering::SeqCst);
            Ok(guard)
        }
        Err(error) => {
            PRODUCTION_OWNERSHIP.store(0, std::sync::atomic::Ordering::SeqCst);
            Err(error)
        }
    }
}

/// Show a startup failure before the webview exists.
pub fn show_startup_error(error: &str) {
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    let message = HSTRING::from(format!(
        "AMS Access could not start: {error}. Close the other instance before trying again."
    ));
    unsafe {
        MessageBoxW(None, &message, w!("AMS Access"), MB_OK | MB_ICONINFORMATION);
    }
}

/// Whether this process currently has the instance guard, for optional
/// mutation gating. The parent should retain the returned guard for app life.
pub fn owns_instance() -> bool {
    PRODUCTION_OWNERSHIP.load(std::sync::atomic::Ordering::SeqCst) == 2
}

// 0 = unclaimed, 1 = waiting for the kernel mutex, 2 = owned.
static PRODUCTION_OWNERSHIP: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

fn acquire_named(name: &str, wait: Duration, production: bool) -> Result<InstanceGuard, String> {
    let name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let handle = unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) }
        .map_err(|e| format!("Could not create instance mutex: {e}"))?;
    let millis = wait.as_millis().min((u32::MAX - 1) as u128) as u32;
    let result = unsafe { WaitForSingleObject(handle, millis) };
    if result == WAIT_OBJECT_0 || result == WAIT_ABANDONED {
        Ok(InstanceGuard {
            handle,
            production,
            _same_thread: PhantomData,
        })
    } else {
        unsafe { CloseHandle(handle) }
            .map_err(|e| format!("Could not close unused instance mutex handle: {e}"))?;
        if result == WAIT_TIMEOUT {
            Err("Another application instance is already running".into())
        } else {
            Err(format!("Waiting for instance mutex failed ({})", result.0))
        }
    }
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        if self.production {
            PRODUCTION_OWNERSHIP.store(0, std::sync::atomic::Ordering::SeqCst);
        }
        unsafe {
            let _ = ReleaseMutex(self.handle);
            let _ = CloseHandle(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_runner::CommandDeadlineExt;
    use std::process::Command;
    use std::sync::mpsc;
    use std::time::Instant;

    fn unique_name() -> String {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        format!(
            "Local\\AMS_INSTANCE_TEST_{}_{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        )
    }

    #[test]
    fn ownership_rejects_contender_and_releases_for_next_owner() {
        let name = unique_name();
        let first = acquire_named(&name, Duration::ZERO, false).unwrap();
        let contender_name = name.clone();
        let (tx, rx) = mpsc::channel();
        let contender = std::thread::spawn(move || {
            tx.send(acquire_named(&contender_name, Duration::from_millis(80), false).is_err())
                .unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_secs(2)).unwrap());
        contender.join().unwrap();
        drop(first);
        assert!(acquire_named(&name, Duration::from_secs(1), false).is_ok());
    }

    #[test]
    fn mutex_child_probe() {
        let Ok(name) = std::env::var("AMS_INSTANCE_TEST_MUTEX") else {
            return;
        };
        let expect_owned = std::env::var("AMS_INSTANCE_TEST_EXPECT_OWNED")
            .map(|value| value == "1")
            .unwrap_or(false);
        let acquired = acquire_named(&name, Duration::from_millis(100), false);
        assert_eq!(acquired.is_ok(), expect_owned);
        drop(acquired);
    }

    fn run_mutex_child(name: &str, expect_owned: bool) {
        let executable = std::env::current_exe().unwrap();
        let output = Command::new(executable)
            .args([
                "--exact",
                "windows::instance::tests::mutex_child_probe",
                "--nocapture",
            ])
            .env("AMS_INSTANCE_TEST_MUTEX", name)
            .env(
                "AMS_INSTANCE_TEST_EXPECT_OWNED",
                if expect_owned { "1" } else { "0" },
            )
            .bounded_output_with_timeout(Duration::from_secs(10))
            .expect("mutex child test should finish within its deadline");
        assert!(
            output.status.success(),
            "mutex child failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn ownership_is_exclusive_across_processes() {
        let name = unique_name();
        let guard = acquire_named(&name, Duration::ZERO, false).unwrap();
        run_mutex_child(&name, false);
        drop(guard);
        run_mutex_child(&name, true);
    }

    #[test]
    fn abandoned_mutex_is_recovered() {
        let name = unique_name();
        let worker_name = name.clone();
        let (handle_tx, handle_rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let guard = acquire_named(&worker_name, Duration::from_secs(1), false).unwrap();
            let raw_handle = guard.handle.0 as isize;
            handle_tx.send(raw_handle).unwrap();
            std::mem::forget(guard);
        });
        worker.join().unwrap();

        let started = Instant::now();
        let guard = acquire_named(&name, Duration::from_secs(1), false).unwrap();
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(guard);
        let leaked_handle = HANDLE(handle_rx.recv().unwrap() as *mut _);
        unsafe { CloseHandle(leaked_handle).unwrap() };
    }
}
