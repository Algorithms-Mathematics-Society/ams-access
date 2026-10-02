//! One FIFO worker for durable event records and configuration barriers.
//! Native hooks only try admission; they never wait on disk, a response, or a
//! worker-held lock. Async IPC acknowledges completion only after work returns.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};

type Work = Box<dyn FnOnce() -> Result<(), String> + Send>;
struct Job {
    work: Work,
    completion: Option<oneshot::Sender<Result<(), String>>>,
    pending: Pending,
    shutdown: Option<std::sync::mpsc::Sender<()>>,
}
struct Pending(Arc<AtomicU64>);
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
pub struct Recorder {
    sender: mpsc::Sender<Job>,
    rejected: AtomicU64,
    pending: Arc<AtomicU64>,
}
impl Recorder {
    pub fn start(capacity: usize, on_failure: fn(&str)) -> Result<Self, String> {
        let (sender, mut receiver) = mpsc::channel::<Job>(capacity);
        std::thread::Builder::new()
            .name("ams-event-recorder".into())
            .spawn(move || {
                let mut shutdown_complete = None;
                while let Some(job) = receiver.blocking_recv() {
                    if let Some(done) = job.shutdown {
                        // Seal admission, then consume every accepted job,
                        // including callbacks queued behind this marker.
                        receiver.close();
                        shutdown_complete = Some(done);
                    }
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job.work))
                        .unwrap_or_else(|_| Err("Event recorder operation panicked".into()));
                    if let Err(error) = &result {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            on_failure(error)
                        }));
                    }
                    drop(job.pending);
                    if let Some(completion) = job.completion {
                        let _ = completion.send(result);
                    }
                }
                if let Some(done) = shutdown_complete {
                    let _ = done.send(());
                }
            })
            .map_err(|error| format!("Cannot start event recorder: {error}"))?;
        Ok(Self {
            sender,
            rejected: AtomicU64::new(0),
            pending: Arc::new(AtomicU64::new(0)),
        })
    }
    fn pending_guard(&self) -> Pending {
        self.pending.fetch_add(1, Ordering::Relaxed);
        Pending(Arc::clone(&self.pending))
    }
    fn enqueue(&self, job: Job) -> Result<(), String> {
        self.sender.try_send(job).map_err(|error| {
            self.rejected.fetch_add(1, Ordering::Relaxed);
            match error {
                mpsc::error::TrySendError::Full(_) => {
                    "Event recorder is busy; event was not persisted"
                }
                mpsc::error::TrySendError::Closed(_) => {
                    "Event recorder is unavailable; event was not persisted"
                }
            }
            .into()
        })
    }
    pub fn try_record(&self, work: impl FnOnce() -> Result<(), String> + Send + 'static) {
        let _ = self.enqueue(Job {
            work: Box::new(work),
            completion: None,
            pending: self.pending_guard(),
            shutdown: None,
        });
    }
    pub async fn submit(
        &self,
        work: impl FnOnce() -> Result<(), String> + Send + 'static,
    ) -> Result<(), String> {
        let (completion, wait) = oneshot::channel();
        // Async callers wait for FIFO capacity instead of dropping config
        // barriers or audit records when a native-event burst fills the queue.
        self.sender
            .send(Job {
                work: Box::new(work),
                completion: Some(completion),
                pending: self.pending_guard(),
                shutdown: None,
            })
            .await
            .map_err(|_| "Event recorder is unavailable".to_string())?;
        wait.await
            .map_err(|_| "Event recorder stopped before confirming persistence".to_string())?
    }
    pub fn pending(&self) -> u64 {
        self.pending.load(Ordering::Relaxed)
    }
    /// Terminal drain on orderly process exit, after native lockdown teardown.
    /// Seals admission and acknowledges only after all accepted work completes.
    /// Never called by a hook. Bounded so a failed disk cannot hang app exit.
    pub fn drain_on_exit(&self, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let (done, wait) = std::sync::mpsc::channel();
        let mut job = Job {
            work: Box::new(|| Ok(())),
            completion: None,
            pending: self.pending_guard(),
            shutdown: Some(done),
        };
        loop {
            match self.sender.try_send(job) {
                Ok(()) => break,
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    return Err("Event recorder stopped during shutdown".into())
                }
                Err(mpsc::error::TrySendError::Full(returned)) => {
                    job = returned;
                    if Instant::now() >= deadline {
                        return Err("Event recorder did not drain before shutdown deadline".into());
                    }
                    std::thread::sleep(Duration::from_millis(1));
                }
            }
        }
        wait.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .map_err(|_| "Event recorder did not drain before shutdown deadline".into())
    }
    pub fn rejected(&self) -> u64 {
        self.rejected.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    #[test]
    fn slow_disk_does_not_block_hook_and_overload_is_explicit() {
        let recorder = Recorder::start(1, |_| {}).unwrap();
        let (started, ready) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        recorder.try_record(move || {
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(())
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        recorder.try_record(|| Ok(()));
        let start = std::time::Instant::now();
        recorder.try_record(|| panic!("rejected operation must not execute"));
        assert!(start.elapsed() < Duration::from_millis(100));
        assert_eq!(recorder.rejected(), 1);
        release.send(()).unwrap();
    }
    #[test]
    fn configuration_and_events_stay_in_fifo_order() {
        runtime().block_on(async {
            let recorder = Recorder::start(8, |_| {}).unwrap();
            let result = Arc::new(Mutex::new(Vec::new()));
            for value in ["configure A", "event A", "configure B", "event B"] {
                let result = Arc::clone(&result);
                recorder.try_record(move || {
                    result.lock().unwrap().push(value);
                    Ok(())
                });
            }
            recorder.submit(|| Ok(())).await.unwrap();
            assert_eq!(
                *result.lock().unwrap(),
                ["configure A", "event A", "configure B", "event B"]
            );
        });
    }
    #[test]
    fn configuration_waits_for_full_queue_without_being_dropped() {
        runtime().block_on(async {
            let recorder = Arc::new(Recorder::start(1, |_| {}).unwrap());
            let (started, ready) = oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            recorder.try_record(move || {
                started.send(()).unwrap();
                wait.recv_timeout(Duration::from_secs(3)).unwrap();
                Ok(())
            });
            ready.await.unwrap();
            recorder.try_record(|| Ok(()));
            let task_recorder = Arc::clone(&recorder);
            let task = tokio::spawn(async move { task_recorder.submit(|| Ok(())).await });
            tokio::task::yield_now().await;
            assert!(!task.is_finished());
            assert_eq!(recorder.rejected(), 0);
            release.send(()).unwrap();
            task.await.unwrap().unwrap();
            assert_eq!(recorder.pending(), 0);
        });
    }
    #[test]
    fn orderly_exit_barrier_drains_accepted_records() {
        let recorder = Recorder::start(8, |_| {}).unwrap();
        let recorded = Arc::new(AtomicU64::new(0));
        for _ in 0..4 {
            let recorded = Arc::clone(&recorded);
            recorder.try_record(move || {
                recorded.fetch_add(1, Ordering::Relaxed);
                Ok(())
            });
        }
        recorder.drain_on_exit(Duration::from_secs(1)).unwrap();
        assert_eq!(recorded.load(Ordering::Relaxed), 4);
    }
    #[test]
    fn terminal_drain_includes_jobs_behind_marker_and_closes_admission() {
        let recorder = Arc::new(Recorder::start(8, |_| {}).unwrap());
        let (started, ready) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        recorder.try_record(move || {
            started.send(()).unwrap();
            wait.recv_timeout(Duration::from_secs(3)).unwrap();
            Ok(())
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        let shutdown = Arc::clone(&recorder);
        let shutdown = std::thread::spawn(move || shutdown.drain_on_exit(Duration::from_secs(2)));
        let deadline = Instant::now() + Duration::from_secs(1);
        while recorder.sender.capacity() == 8 {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        let recorded = Arc::new(AtomicU64::new(0));
        let result = Arc::clone(&recorded);
        recorder.try_record(move || {
            result.fetch_add(1, Ordering::Relaxed);
            Ok(())
        });
        release.send(()).unwrap();
        shutdown.join().unwrap().unwrap();
        assert_eq!(recorded.load(Ordering::Relaxed), 1);
        assert_eq!(recorder.pending(), 0);
        recorder.try_record(|| panic!("late native producer must be rejected"));
        assert_eq!(recorder.rejected(), 1);
        assert!(runtime().block_on(recorder.submit(|| Ok(()))).is_err());
    }

    #[test]
    fn stalled_worker_does_not_block_shutdown_past_deadline() {
        let recorder = Recorder::start(2, |_| {}).unwrap();
        let (release, wait) = std::sync::mpsc::channel();
        recorder.try_record(move || {
            wait.recv_timeout(Duration::from_secs(2)).unwrap();
            Ok(())
        });
        let start = Instant::now();
        assert!(recorder.drain_on_exit(Duration::from_millis(25)).is_err());
        assert!(start.elapsed() < Duration::from_secs(1));
        release.send(()).unwrap();
    }

    #[test]
    fn acknowledgement_waits_for_work_and_returns_persistence_error() {
        runtime().block_on(async {
            let recorder = Arc::new(Recorder::start(8, |_| {}).unwrap());
            let (started, ready) = oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let task_recorder = Arc::clone(&recorder);
            let task = tokio::spawn(async move {
                task_recorder
                    .submit(move || {
                        started.send(()).unwrap();
                        wait.recv_timeout(Duration::from_secs(3)).unwrap();
                        Err("disk full".into())
                    })
                    .await
            });
            ready.await.unwrap();
            assert!(!task.is_finished());
            release.send(()).unwrap();
            assert_eq!(task.await.unwrap(), Err("disk full".into()));
        });
    }
    #[test]
    fn caller_cancellation_does_not_discard_an_accepted_event() {
        runtime().block_on(async {
            let recorder = Arc::new(Recorder::start(8, |_| {}).unwrap());
            let (started, ready) = oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let persisted = Arc::new(AtomicU64::new(0));
            let persisted_worker = Arc::clone(&persisted);
            let task_recorder = Arc::clone(&recorder);
            let task = tokio::spawn(async move {
                task_recorder
                    .submit(move || {
                        started.send(()).unwrap();
                        wait.recv_timeout(Duration::from_secs(3)).unwrap();
                        persisted_worker.store(1, Ordering::Relaxed);
                        Ok(())
                    })
                    .await
            });
            ready.await.unwrap();
            task.abort();
            release.send(()).unwrap();
            recorder.submit(|| Ok(())).await.unwrap();
            assert_eq!(persisted.load(Ordering::Relaxed), 1);
        });
    }
    #[test]
    fn panic_is_contained_and_next_job_still_runs() {
        runtime().block_on(async {
            let recorder = Recorder::start(8, |_| {}).unwrap();
            assert!(recorder
                .submit(|| panic!("mock worker failure"))
                .await
                .unwrap_err()
                .contains("panicked"));
            recorder.submit(|| Ok(())).await.unwrap();
        });
    }
}
