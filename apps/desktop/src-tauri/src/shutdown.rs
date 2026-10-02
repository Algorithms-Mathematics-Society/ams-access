//! Orderly shutdown coordination. Signal handlers only publish an atomic flag;
//! all allocation, locking, platform recovery and disk work runs on a worker.
use std::sync::OnceLock;

pub struct Coordinator(OnceLock<()>);

impl Coordinator {
    pub const fn new() -> Self {
        Self(OnceLock::new())
    }

    pub fn run(&self, cleanup: impl FnOnce()) {
        // Unlike an atomic "already started" flag, concurrent exit paths wait
        // for the winning cleanup to FINISH before returning to process exit.
        self.0.get_or_init(cleanup);
    }
}

#[cfg(unix)]
mod signals {
    use std::os::raw::c_int;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    static REQUESTED: AtomicI32 = AtomicI32::new(0);
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    const SIGNALS: [c_int; 4] = [2, 15, 3, 1]; // INT, TERM, QUIT, HUP
    extern "C" {
        fn signal(sig: c_int, handler: usize) -> usize;
    }

    extern "C" fn notify_shutdown(sig: c_int) {
        // AtomicI32 is lock-free on supported Unix targets. No logging,
        // allocation, locking, unwinding, or cleanup is allowed in this handler.
        REQUESTED.store(sig, Ordering::Relaxed);
    }

    pub fn install(worker_cleanup: impl FnOnce() + Send + 'static) -> Result<(), String> {
        if INSTALLED.swap(true, Ordering::AcqRel) {
            return Err("Signal shutdown is already installed".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = Arc::clone(&cancelled);
        // Start the ordinary-context coordinator before intercepting signals.
        // It also works before the GUI event loop has started (or if it stalls).
        if let Err(error) = std::thread::Builder::new()
            .name("ams-signal-shutdown".into())
            .spawn(move || loop {
                if worker_cancelled.load(Ordering::Acquire) {
                    break;
                }
                if REQUESTED.load(Ordering::Relaxed) != 0 {
                    worker_cleanup();
                    break;
                }
                std::thread::sleep(Duration::from_millis(25));
            })
        {
            INSTALLED.store(false, Ordering::Release);
            return Err(format!("Cannot start signal shutdown worker: {error}"));
        }
        let mut previous = Vec::new();
        for sig in SIGNALS {
            let old = unsafe { signal(sig, notify_shutdown as *const () as usize) };
            if old == usize::MAX {
                let error = std::io::Error::last_os_error();
                for (sig, old) in previous {
                    unsafe { signal(sig, old) };
                }
                cancelled.store(true, Ordering::Release);
                // Fail startup rather than run without reliable recovery.
                return Err(format!("Cannot install shutdown signal {sig}: {error}"));
            }
            previous.push((sig, old));
        }
        Ok(())
    }
}

#[cfg(unix)]
pub use signals::install as install_signal_handler;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn concurrent_exit_waits_for_cleanup_completion() {
        let coordinator = Arc::new(Coordinator::new());
        let (started, ready) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let first = Arc::clone(&coordinator);
        let first = std::thread::spawn(move || {
            first.run(|| {
                started.send(()).unwrap();
                wait.recv_timeout(Duration::from_secs(2)).unwrap();
            });
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        let (entered, entry) = mpsc::channel();
        let (finished, completion) = mpsc::channel();
        let second = std::thread::spawn(move || {
            entered.send(()).unwrap();
            coordinator.run(|| panic!("cleanup must not run twice"));
            finished.send(()).unwrap();
        });
        entry.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(completion.recv_timeout(Duration::from_millis(50)).is_err());
        release.send(()).unwrap();
        completion.recv_timeout(Duration::from_secs(1)).unwrap();
        first.join().unwrap();
        second.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn sigterm_drains_accepted_events() {
        use crate::event_recorder::Recorder;
        use std::io::Write;
        use std::path::PathBuf;
        use std::process::{Child, Command, Stdio};
        use std::time::{Instant, SystemTime, UNIX_EPOCH};

        const FIXTURE: &str = "AMS_SIGNAL_SHUTDOWN_TEST_DIR";
        if let Some(dir) = std::env::var_os(FIXTURE) {
            // This branch runs only in the dedicated subprocess. All cleanup
            // is fake: never call desktop, keyboard, or firewall APIs in tests.
            let dir = PathBuf::from(dir);
            let recorder = Recorder::start(8, |_| {}).unwrap();
            let (release, wait) = mpsc::channel();
            recorder.try_record(move || {
                wait.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            });
            for index in 0..4 {
                let path = dir.join("events");
                recorder.try_record(move || {
                    let mut file = std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(path)
                        .map_err(|e| e.to_string())?;
                    writeln!(file, "event {index}").map_err(|e| e.to_string())?;
                    file.sync_all().map_err(|e| e.to_string())
                });
            }
            let cleanup_dir = dir.clone();
            install_signal_handler(move || {
                Coordinator::new().run(|| {
                    std::fs::write(cleanup_dir.join("draining"), b"yes").unwrap();
                    let deadline = Instant::now() + Duration::from_secs(3);
                    while !cleanup_dir.join("continue").exists() {
                        assert!(Instant::now() < deadline, "parent did not release cleanup");
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    release.send(()).unwrap();
                    recorder.drain_on_exit(Duration::from_secs(2)).unwrap();
                    std::fs::write(cleanup_dir.join("restored"), b"yes").unwrap();
                });
                std::process::exit(0);
            })
            .unwrap();
            std::fs::write(dir.join("ready"), b"yes").unwrap();
            std::thread::sleep(Duration::from_secs(6));
            panic!("signal shutdown never completed");
        }

        struct Fixture {
            child: Child,
            dir: PathBuf,
        }
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self.child.kill();
                let _ = self.child.wait();
                let _ = std::fs::remove_dir_all(&self.dir);
            }
        }
        let dir = std::env::temp_dir().join(format!(
            "ams-shutdown-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "shutdown::tests::sigterm_drains_accepted_events"])
            .env(FIXTURE, &dir)
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let mut fixture = Fixture { child, dir };
        let deadline = Instant::now() + Duration::from_secs(5);
        while !fixture.dir.join("ready").exists() {
            assert!(
                fixture.child.try_wait().unwrap().is_none(),
                "child exited before ready"
            );
            assert!(Instant::now() < deadline, "child did not become ready");
            std::thread::sleep(Duration::from_millis(5));
        }
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        assert_eq!(unsafe { kill(fixture.child.id() as i32, 15) }, 0);
        // Ensure the second signal arrives after cleanup starts while accepted
        // recorder work is still blocked, rather than coalescing before dispatch.
        while !fixture.dir.join("draining").exists() {
            assert!(fixture.child.try_wait().unwrap().is_none());
            assert!(Instant::now() < deadline, "cleanup did not start");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(unsafe { kill(fixture.child.id() as i32, 15) }, 0);
        std::fs::write(fixture.dir.join("continue"), b"yes").unwrap();
        loop {
            if let Some(status) = fixture.child.try_wait().unwrap() {
                assert!(status.success(), "signal child failed: {status}");
                break;
            }
            assert!(Instant::now() < deadline, "child failed to exit");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(
            std::fs::read_to_string(fixture.dir.join("events")).unwrap(),
            "event 0\nevent 1\nevent 2\nevent 3\n"
        );
        assert_eq!(std::fs::read(fixture.dir.join("restored")).unwrap(), b"yes");
    }
}
