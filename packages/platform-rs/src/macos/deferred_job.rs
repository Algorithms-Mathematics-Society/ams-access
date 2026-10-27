//! A timed-out AppKit request must not begin changing the window later.
//! Cancellation only wins before execution; a running AppKit call cannot be interrupted.
use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Default)]
pub(super) struct DeferredJob(AtomicU8);

impl DeferredJob {
    pub fn start(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    pub fn cancel(&self) {
        let _ = self
            .0
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeout_prevents_late_window_mutation() {
        let job = DeferredJob::default();
        job.cancel();
        assert!(!job.start());
        job.cancel();
        assert!(!job.start());
    }
    #[test]
    fn running_job_is_never_executed_twice() {
        let job = DeferredJob::default();
        assert!(job.start());
        job.cancel();
        assert!(!job.start());
    }
    #[test]
    fn cancellation_races_have_one_winner() {
        for _ in 0..100 {
            let job = std::sync::Arc::new(DeferredJob::default());
            let other = job.clone();
            let start = std::thread::spawn(move || other.start());
            job.cancel();
            let _ = start.join().unwrap();
            assert!(!job.start());
        }
    }
}
