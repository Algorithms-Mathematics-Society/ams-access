//! Separate admission for entry readiness and informational device scans.
//! Cancelling an async caller never frees capacity while its native work is
//! still running: the actual blocking worker owns the permit.
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Semaphore;

#[derive(Clone, Copy)]
pub(crate) enum Priority {
    Readiness,
    Informational,
}

struct Pools {
    readiness: Arc<Semaphore>,
    informational: Arc<Semaphore>,
}

impl Pools {
    fn new() -> Self {
        Self {
            readiness: Arc::new(Semaphore::new(1)),
            informational: Arc::new(Semaphore::new(2)),
        }
    }

    fn admission(&self, priority: Priority) -> (Arc<Semaphore>, Duration, &'static str) {
        match priority {
            Priority::Readiness => (
                Arc::clone(&self.readiness),
                Duration::from_secs(20),
                "A setup check is still finishing. Wait a moment and retry setup.",
            ),
            Priority::Informational => (
                Arc::clone(&self.informational),
                Duration::from_secs(2),
                "Device checks are busy. Retry shortly.",
            ),
        }
    }
}

async fn run_in<T: Send + 'static>(
    pools: &Pools,
    priority: Priority,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (pool, wait, busy) = pools.admission(priority);
    let permit = tokio::time::timeout(wait, pool.acquire_owned())
        .await
        .map_err(|_| busy.to_string())?
        .map_err(|_| {
            "Device checks are unavailable. Restart the app and retry setup.".to_string()
        })?;
    // Use the caller's Tokio runtime. Tauri supplies one in production; tests
    // provide an isolated runtime without constructing native app state.
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        work()
    })
    .await
    .map_err(|error| format!("Device check could not complete: {error}"))
}

pub(crate) async fn run<T: Send + 'static>(
    priority: Priority,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    static POOLS: OnceLock<Pools> = OnceLock::new();
    run_in(POOLS.get_or_init(Pools::new), priority, work).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn saturated_informational_workers_do_not_block_entry_readiness() {
        runtime().block_on(async {
            let pools = Arc::new(Pools::new());
            let mut tasks = Vec::new();
            let mut releases = Vec::new();
            for _ in 0..2 {
                let (started, ready) = tokio::sync::oneshot::channel();
                let (release, wait) = std::sync::mpsc::channel();
                let worker_pools = Arc::clone(&pools);
                tasks.push(tokio::spawn(async move {
                    run_in(&worker_pools, Priority::Informational, move || {
                        started.send(()).unwrap();
                        wait.recv_timeout(Duration::from_secs(3)).unwrap();
                    })
                    .await
                }));
                releases.push(release);
                ready.await.unwrap();
            }
            assert_eq!(pools.informational.available_permits(), 0);
            let ready = tokio::time::timeout(
                Duration::from_secs(1),
                run_in(&pools, Priority::Readiness, || "ready"),
            )
            .await
            .expect("entry must not wait for informational workers")
            .unwrap();
            assert_eq!(ready, "ready");
            assert_eq!(pools.informational.available_permits(), 0);
            for release in releases {
                release.send(()).unwrap();
            }
            for task in tasks {
                task.await.unwrap().unwrap();
            }
        });
    }

    #[test]
    fn cancelled_caller_keeps_capacity_until_blocking_work_finishes() {
        runtime().block_on(async {
            let pools = Arc::new(Pools::new());
            let (started, ready) = tokio::sync::oneshot::channel();
            let (release, wait) = std::sync::mpsc::channel();
            let worker_pools = Arc::clone(&pools);
            let task = tokio::spawn(async move {
                run_in(&worker_pools, Priority::Readiness, move || {
                    started.send(()).unwrap();
                    wait.recv_timeout(Duration::from_secs(3)).unwrap();
                })
                .await
            });
            ready.await.unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert_eq!(pools.readiness.available_permits(), 0);
            // Informational requests still have their independent allocation.
            assert_eq!(run_in(&pools, Priority::Informational, || 7).await, Ok(7));
            release.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while pools.readiness.available_permits() == 0 {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(run_in(&pools, Priority::Readiness, || 9).await, Ok(9));
        });
    }

    #[test]
    fn worker_panic_reports_failure_and_releases_its_permit() {
        runtime().block_on(async {
            let pools = Pools::new();
            assert!(run_in(&pools, Priority::Readiness, || panic!(
                "mock native failure"
            ))
            .await
            .is_err());
            assert_eq!(pools.readiness.available_permits(), 1);
            assert_eq!(run_in(&pools, Priority::Readiness, || true).await, Ok(true));
        });
    }

    #[test]
    fn readiness_has_a_longer_bounded_wait_than_informational_scans() {
        let pools = Pools::new();
        assert_eq!(
            pools.admission(Priority::Readiness).1,
            Duration::from_secs(20)
        );
        assert_eq!(
            pools.admission(Priority::Informational).1,
            Duration::from_secs(2)
        );
    }
}
