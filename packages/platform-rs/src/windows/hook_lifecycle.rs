//! Hook ownership and periodic renewal, independent of native input for tests.
use std::sync::atomic::{AtomicBool, Ordering};

// shortcut: renewal cannot prove delivery; qualify latency on supported Windows builds.
pub(super) const RENEW_INTERVAL_MS: u64 = 5_000;

pub(super) struct Session {
    pub generation: u64,
    pub active: AtomicBool,
    pub installed: AtomicBool,
    pub starting: AtomicBool,
    pub failed: AtomicBool,
    pub alive: AtomicBool,
    has_installed: AtomicBool,
}

impl Session {
    pub fn new(generation: u64) -> Self {
        Self {
            generation,
            active: AtomicBool::new(true),
            installed: AtomicBool::new(false),
            starting: AtomicBool::new(true),
            failed: AtomicBool::new(false),
            alive: AtomicBool::new(false),
            has_installed: AtomicBool::new(false),
        }
    }

    pub fn ready(&self) -> bool {
        self.active.load(Ordering::SeqCst)
            && self.alive.load(Ordering::SeqCst)
            && self.installed.load(Ordering::SeqCst)
    }

    pub fn cancel(&self) {
        self.active.store(false, Ordering::SeqCst);
        self.installed.store(false, Ordering::SeqCst);
    }
}

pub(super) trait HookApi {
    type Handle;
    fn install(&mut self) -> Result<Self::Handle, String>;
    fn retire(&mut self, handle: Self::Handle);
    /// Pump a bounded batch and wait briefly. False means the owner must exit.
    fn pump(&mut self) -> bool;
    fn now_ms(&self) -> u64;
    fn report_failure(&mut self, error: &str);
}

/// The same owner installs, renews and retires every handle. Renewal is a
/// mitigation for silent Windows removal, not a test of delivery or idle input.
pub(super) fn run(session: &Session, api: &mut impl HookApi) {
    session.alive.store(true, Ordering::SeqCst);
    let mut hook = None;
    let mut renew_at = 0;
    while session.active.load(Ordering::SeqCst) {
        if api.now_ms() >= renew_at {
            match api.install() {
                Ok(replacement) => {
                    // Cancellation may happen while SetWindowsHookExW runs.
                    if !session.active.load(Ordering::SeqCst) {
                        api.retire(replacement);
                        break;
                    }
                    if let Some(previous) = hook.replace(replacement) {
                        api.retire(previous);
                    }
                    session.failed.store(false, Ordering::SeqCst);
                    session.has_installed.store(true, Ordering::SeqCst);
                    session.installed.store(true, Ordering::SeqCst);
                }
                Err(error) => {
                    api.report_failure(&error);
                    session.installed.store(false, Ordering::SeqCst);
                    session.failed.store(true, Ordering::SeqCst);
                    // Preserve any prior handle as best-effort protection, but
                    // surface degradation and retry only at the next interval.
                    if !session.has_installed.load(Ordering::SeqCst) {
                        session.cancel();
                    }
                }
            }
            session.starting.store(false, Ordering::SeqCst);
            renew_at = api.now_ms().saturating_add(RENEW_INTERVAL_MS);
        }
        if !session.active.load(Ordering::SeqCst) || !api.pump() {
            break;
        }
    }
    session.installed.store(false, Ordering::SeqCst);
    if let Some(hook) = hook {
        api.retire(hook);
    }
    session.starting.store(false, Ordering::SeqCst);
    session.alive.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    struct Fake<'a> {
        session: &'a Session,
        now: u64,
        installs: usize,
        live: HashSet<usize>,
        retired: Vec<usize>,
        failures: Vec<String>,
        fail_install: usize,
        cancel_install: usize,
        on_pump: fn(&mut Fake<'_>) -> bool,
    }

    impl<'a> Fake<'a> {
        fn new(session: &'a Session, on_pump: fn(&mut Fake<'_>) -> bool) -> Self {
            Self {
                session,
                now: 0,
                installs: 0,
                live: HashSet::new(),
                retired: vec![],
                failures: vec![],
                fail_install: 0,
                cancel_install: 0,
                on_pump,
            }
        }
    }

    impl HookApi for Fake<'_> {
        type Handle = usize;
        fn install(&mut self) -> Result<usize, String> {
            self.installs += 1;
            if self.installs == self.cancel_install {
                self.session.cancel();
            }
            if self.installs == self.fail_install {
                return Err("mock denied".into());
            }
            self.live.insert(self.installs);
            Ok(self.installs)
        }
        fn retire(&mut self, handle: usize) {
            self.live.remove(&handle);
            self.retired.push(handle);
        }
        fn pump(&mut self) -> bool {
            (self.on_pump)(self)
        }
        fn now_ms(&self) -> u64 {
            self.now
        }
        fn report_failure(&mut self, error: &str) {
            self.failures.push(error.into());
        }
    }

    #[test]
    fn silently_removed_hook_is_renewed_while_owner_is_alive() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |api| {
            if api.installs == 1 {
                // Exact timeout-removal state: OS no longer owns the hook,
                // while the process still has a handle and a live owner.
                api.live.clear();
                assert!(api.session.ready());
                assert!(api.session.alive.load(Ordering::SeqCst));
                api.now = RENEW_INTERVAL_MS;
                true
            } else {
                assert!(api.live.contains(&2));
                api.session.cancel();
                false
            }
        });
        run(&session, &mut api);
        assert_eq!(api.installs, 2);
        assert_eq!(api.retired, [1, 2]);
        assert!(api.live.is_empty());
    }

    #[test]
    fn idle_does_not_imply_failure_but_renewal_still_runs() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |api| {
            assert!(api.session.ready());
            assert!(!api.session.failed.load(Ordering::SeqCst));
            if api.installs == 1 {
                api.now += RENEW_INTERVAL_MS / 2;
                true
            } else {
                api.session.cancel();
                false
            }
        });
        run(&session, &mut api);
        assert_eq!(api.installs, 2);
        assert!(api.failures.is_empty());
    }

    #[test]
    fn failed_renewal_is_visible_preserves_old_handle_and_retries_boundedly() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |api| {
            match api.installs {
                1 => api.now = RENEW_INTERVAL_MS,
                2 => {
                    assert!(api.live.contains(&1));
                    assert!(!api.session.ready());
                    assert!(api.session.failed.load(Ordering::SeqCst));
                    api.now += RENEW_INTERVAL_MS / 2;
                }
                3 => {
                    assert!(api.session.ready());
                    assert!(!api.session.failed.load(Ordering::SeqCst));
                    api.session.cancel();
                    return false;
                }
                _ => panic!("unbounded retry"),
            }
            true
        });
        api.fail_install = 2;
        run(&session, &mut api);
        assert_eq!(api.failures, ["mock denied"]);
        assert_eq!(api.retired, [1, 3]);
    }

    #[test]
    fn cancellation_during_startup_or_renewal_retires_all_handles() {
        for cancel_install in [1, 2] {
            let session = Session::new(1);
            let mut api = Fake::new(&session, |api| {
                api.now += RENEW_INTERVAL_MS;
                true
            });
            api.cancel_install = cancel_install;
            run(&session, &mut api);
            assert!(!session.ready());
            assert!(!session.alive.load(Ordering::SeqCst));
            assert!(api.live.is_empty());
            assert_eq!(api.installs, cancel_install);
        }
    }

    #[test]
    fn initial_install_failure_never_reports_ready_or_retries() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |_| panic!("failed startup pumped"));
        api.fail_install = 1;
        run(&session, &mut api);
        assert!(!session.ready());
        assert!(session.failed.load(Ordering::SeqCst));
        assert!(!session.active.load(Ordering::SeqCst));
        assert_eq!(api.installs, 1);
        assert!(api.live.is_empty());
    }

    #[test]
    fn owner_exit_is_visible_and_can_restart_only_its_active_lifecycle() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |_| false);
        run(&session, &mut api);
        assert!(session.active.load(Ordering::SeqCst));
        assert!(!session.ready());
        assert!(!session.alive.load(Ordering::SeqCst));
        assert!(!session.starting.load(Ordering::SeqCst));
        // A watchdog restart after teardown must not install again.
        session.cancel();
        run(&session, &mut api);
        assert_eq!(api.installs, 1);
    }

    #[test]
    fn failed_watchdog_reinstall_keeps_retrying_after_prior_success() {
        let session = Session::new(1);
        let mut api = Fake::new(&session, |_| false);
        run(&session, &mut api);
        assert_eq!(api.installs, 1);
        api.fail_install = 2;
        api.on_pump = |api| {
            if api.installs == 2 {
                assert!(api.session.active.load(Ordering::SeqCst));
                assert!(!api.session.ready());
                assert!(api.session.failed.load(Ordering::SeqCst));
                api.now += RENEW_INTERVAL_MS / 2;
                true
            } else {
                assert_eq!(api.installs, 3);
                assert!(api.session.ready());
                api.session.cancel();
                false
            }
        };
        run(&session, &mut api);
        assert_eq!(api.failures, ["mock denied"]);
        assert_eq!(api.retired, [1, 3]);
    }

    #[test]
    fn retired_owner_cannot_publish_or_clear_replacement_state() {
        let old = Session::new(1);
        let current = Session::new(2);
        current.alive.store(true, Ordering::SeqCst);
        current.installed.store(true, Ordering::SeqCst);
        old.cancel();
        let mut api = Fake::new(&old, |_| panic!("cancelled owner pumped"));
        run(&old, &mut api);
        assert_eq!(api.installs, 0);
        assert!(!old.active.load(Ordering::SeqCst));
        assert!(current.ready());
        assert_eq!(current.generation, 2);
    }
}
