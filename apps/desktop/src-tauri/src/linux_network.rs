//! Order network mutations independently of UI deadlines. DNS may outlive its
//! caller, but cannot apply rules after cancellation or shutdown invalidates it.
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

pub(crate) struct Coordinator {
    epoch: AtomicU64,
    closed: AtomicBool,
    mutation: Mutex<()>,
    recovery_required: AtomicBool,
    cleanups: AtomicUsize,
}

impl Coordinator {
    pub const fn new() -> Self {
        Self {
            epoch: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            mutation: Mutex::new(()),
            recovery_required: AtomicBool::new(false),
            cleanups: AtomicUsize::new(0),
        }
    }

    pub fn recovery_pending(&self) -> bool {
        self.recovery_required.load(Ordering::SeqCst) || self.cleanups.load(Ordering::SeqCst) != 0
    }

    pub fn ticket(&self) -> Result<u64, String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err("Network protection is shutting down".into());
        }
        if self.recovery_required.load(Ordering::SeqCst)
            || self.cleanups.load(Ordering::SeqCst) != 0
        {
            return Err("Network recovery is still pending".into());
        }
        Ok(self.epoch.load(Ordering::SeqCst))
    }

    pub fn apply<T>(
        &self,
        ticket: u64,
        deadline: Instant,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _guard = self.mutation.lock().unwrap_or_else(|e| e.into_inner());
        if self.closed.load(Ordering::SeqCst)
            || self.recovery_required.load(Ordering::SeqCst)
            || self.cleanups.load(Ordering::SeqCst) != 0
            || ticket != self.epoch.load(Ordering::SeqCst)
        {
            return Err("Network protection attempt was cancelled".into());
        }
        if Instant::now() >= deadline {
            return Err("Network protection preparation timed out".into());
        }
        // A rejected or panicked helper transaction may have applied rules.
        // Keep admission closed until explicit recovery verifies cleanup.
        self.recovery_required.store(true, Ordering::SeqCst);
        let result = operation();
        if result.is_ok() {
            self.recovery_required.store(false, Ordering::SeqCst);
        }
        result
    }

    // Invalidate before waiting: an older DNS request must not get admitted
    // after this cleanup. An already-admitted helper operation finishes first.
    pub fn invalidate(&self) {
        self.cleanups.fetch_add(1, Ordering::SeqCst);
        self.recovery_required.store(true, Ordering::SeqCst);
        self.epoch.fetch_add(1, Ordering::SeqCst);
    }

    pub fn restore<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let _guard = self.mutation.lock().unwrap_or_else(|e| e.into_inner());
        let result = operation();
        self.recovery_required
            .store(result.is_err(), Ordering::SeqCst);
        let _ = self
            .cleanups
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                count.checked_sub(1)
            });
        result
    }

    pub fn close(&self, operation: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        self.closed.store(true, Ordering::SeqCst);
        self.invalidate();
        self.restore(operation)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn late_dns_cannot_apply_after_restore() {
        let state = Coordinator::new();
        let ticket = state.ticket().unwrap();
        state.invalidate();
        state.restore(|| Ok(())).unwrap();
        assert!(state
            .apply(
                ticket,
                Instant::now() + Duration::from_secs(1),
                || -> Result<(), String> { panic!("stale mutation") }
            )
            .is_err());
    }

    #[test]
    fn rejected_mutation_requires_verified_cleanup_before_another_enable() {
        let state = Coordinator::new();
        let result: Result<(), String> = state.apply(
            state.ticket().unwrap(),
            Instant::now() + Duration::from_secs(1),
            || Err("partial helper failure".into()),
        );
        assert!(result.is_err());
        assert!(state.recovery_pending());
        assert!(state.ticket().is_err());
        state.invalidate();
        state.restore(|| Ok(())).unwrap();
        assert!(!state.recovery_pending());
        assert!(state.ticket().is_ok());
    }

    #[test]
    fn expired_preparation_never_mutates() {
        let state = Coordinator::new();
        assert!(state
            .apply(
                state.ticket().unwrap(),
                Instant::now(),
                || -> Result<(), String> { panic!("expired mutation") }
            )
            .is_err());
    }

    #[test]
    fn cleanup_follows_already_admitted_mutation() {
        let state = Arc::new(Coordinator::new());
        let ticket = state.ticket().unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker_state = Arc::clone(&state);
        let apply = std::thread::spawn(move || {
            worker_state.apply(ticket, Instant::now() + Duration::from_secs(2), || {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        started_rx.recv().unwrap();
        state.invalidate();
        assert!(state.mutation.try_lock().is_err());
        release_tx.send(()).unwrap();
        state.restore(|| Ok(())).unwrap();
        apply.join().unwrap().unwrap();
        assert!(state
            .apply(ticket, Instant::now() + Duration::from_secs(1), || Ok(()))
            .is_err());
    }

    #[test]
    fn shutdown_rejects_new_and_old_requests_even_when_cleanup_fails() {
        let state = Coordinator::new();
        let ticket = state.ticket().unwrap();
        assert!(state.close(|| Err("retain recovery token".into())).is_err());
        assert!(state.ticket().is_err());
        assert!(state
            .apply(ticket, Instant::now() + Duration::from_secs(1), || Ok(()))
            .is_err());
    }

    #[test]
    fn failed_restore_requires_a_successful_retry_before_new_work() {
        let state = Coordinator::new();
        state.invalidate();
        assert!(state
            .restore(|| Err::<(), _>("helper unavailable".into()))
            .is_err());
        assert!(
            state.ticket().is_err(),
            "a failed cleanup must keep recovery latched"
        );
        state.invalidate();
        state.restore(|| Ok(())).unwrap();
        let ticket = state
            .ticket()
            .expect("a successful retry should clear recovery");
        state
            .apply(ticket, Instant::now() + Duration::from_secs(1), || Ok(()))
            .unwrap();
    }

    #[test]
    fn overlapping_cleanup_requests_block_admission_until_both_finish() {
        let state = Coordinator::new();
        state.invalidate();
        state.invalidate();
        state.restore(|| Ok(())).unwrap();
        assert!(
            state.ticket().is_err(),
            "one completed cleanup must not admit work while another is pending"
        );
        state.restore(|| Ok(())).unwrap();
        let ticket = state.ticket().expect("all requested cleanups completed");
        state
            .apply(ticket, Instant::now() + Duration::from_secs(1), || Ok(()))
            .unwrap();
    }
}
