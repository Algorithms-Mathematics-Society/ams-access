use serde::Serialize;
const OBSERVED_RECENTLY_MS: u64 = 30_000;
#[cfg(target_os = "windows")]
const COUNTER_MASK: u64 = u32::MAX as u64;

/// Callback-delivery evidence for one hook session. It deliberately does not
/// treat elapsed time without callbacks as evidence that Windows removed a hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    Inactive,
    Starting,
    InstallFailed,
    ThreadDead,
    InstalledUnverified,
    CallbackObservedRecently,
    CallbackObservedStale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DeliverySnapshot {
    pub callback_count: u64,
    /// Milliseconds since this process-local monotonic clock began.
    pub last_callback_ms: Option<u64>,
    /// Elapsed monotonic milliseconds since the last callback, when observed.
    pub last_callback_age_ms: Option<u64>,
    pub status: DeliveryStatus,
}

#[derive(Debug, Default, Clone, Copy)]
struct DeliveryState {
    callback_count: u64,
    last_callback_ms: Option<u64>,
}

impl DeliveryState {
    #[cfg(test)]
    fn observe(&mut self, now_ms: u64) {
        self.callback_count = self.callback_count.saturating_add(1);
        self.last_callback_ms = Some(now_ms);
    }

    fn snapshot(
        self,
        active: bool,
        installed: bool,
        thread_alive: bool,
        starting: bool,
        install_failed: bool,
        now_ms: u64,
    ) -> DeliverySnapshot {
        let age = self
            .last_callback_ms
            .map(|last| now_ms.saturating_sub(last));
        let status = if install_failed {
            DeliveryStatus::InstallFailed
        } else if !active {
            DeliveryStatus::Inactive
        } else if starting {
            DeliveryStatus::Starting
        } else if !thread_alive {
            DeliveryStatus::ThreadDead
        } else if !installed {
            DeliveryStatus::InstalledUnverified
        } else {
            match age {
                None => DeliveryStatus::InstalledUnverified,
                Some(age) if age <= OBSERVED_RECENTLY_MS => {
                    DeliveryStatus::CallbackObservedRecently
                }
                Some(_) => DeliveryStatus::CallbackObservedStale,
            }
        };
        DeliverySnapshot {
            callback_count: self.callback_count,
            last_callback_ms: self.last_callback_ms,
            last_callback_age_ms: age,
            status,
        }
    }
}

#[cfg(target_os = "windows")]
mod runtime {
    use super::{DeliverySnapshot, DeliveryState, COUNTER_MASK};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::Instant;

    static SESSION_STARTED: OnceLock<Instant> = OnceLock::new();
    static SESSION_GENERATION: AtomicU64 = AtomicU64::new(0);
    // Generation occupies the high 32 bits; callback count/elapsed ms use the low 32.
    static CALLBACK_COUNT: AtomicU64 = AtomicU64::new(0);
    static LAST_CALLBACK: AtomicU64 = AtomicU64::new(0);

    fn monotonic_ms() -> u32 {
        SESSION_STARTED
            .get()
            .expect("hook delivery clock initialized before hook install")
            .elapsed()
            .as_millis()
            .min(u32::MAX as u128 - 1) as u32
    }

    pub(crate) fn reset_session() -> u64 {
        SESSION_STARTED.get_or_init(Instant::now);
        let generation = SESSION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let tag = generation << 32;
        CALLBACK_COUNT.store(tag, Ordering::SeqCst);
        LAST_CALLBACK.store(tag, Ordering::SeqCst);
        generation
    }

    pub(crate) fn record_callback(generation: u64) {
        let generation_tag = generation << 32;
        let mut current = CALLBACK_COUNT.load(Ordering::Relaxed);
        loop {
            if current & !COUNTER_MASK != generation_tag {
                return;
            }
            let count = current & COUNTER_MASK;
            let next = generation_tag | count.saturating_add(1).min(COUNTER_MASK);
            match CALLBACK_COUNT.compare_exchange_weak(
                current,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current = observed,
            }
        }

        let time = monotonic_ms().saturating_add(1) as u64;
        let mut last = LAST_CALLBACK.load(Ordering::Relaxed);
        loop {
            if last & !COUNTER_MASK != generation_tag {
                return;
            }
            let next = generation_tag | time;
            if next <= last {
                return;
            }
            match LAST_CALLBACK.compare_exchange_weak(
                last,
                next,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return,
                Err(observed) => last = observed,
            }
        }
    }

    pub(crate) fn snapshot(
        active: bool,
        installed: bool,
        thread_alive: bool,
        starting: bool,
        install_failed: bool,
    ) -> DeliverySnapshot {
        let generation_tag = SESSION_GENERATION.load(Ordering::SeqCst) << 32;
        let packed_count = CALLBACK_COUNT.load(Ordering::Relaxed);
        let packed_last = LAST_CALLBACK.load(Ordering::Relaxed);
        let encoded_last = packed_last & COUNTER_MASK;
        let last = (packed_last & !COUNTER_MASK == generation_tag && encoded_last != 0)
            .then_some(encoded_last.saturating_sub(1));
        let now = SESSION_STARTED
            .get()
            .map(|start| start.elapsed().as_millis().min(u32::MAX as u128) as u64)
            .unwrap_or(0);
        DeliveryState {
            callback_count: if packed_count & !COUNTER_MASK == generation_tag {
                packed_count & COUNTER_MASK
            } else {
                0
            },
            last_callback_ms: last,
        }
        .snapshot(
            active,
            installed,
            thread_alive,
            starting,
            install_failed,
            now,
        )
    }

    #[cfg(test)]
    pub(super) fn test_snapshot() -> DeliverySnapshot {
        snapshot(true, true, true, false, false)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::windows::hook_delivery::OBSERVED_RECENTLY_MS;

        static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

        #[test]
        fn production_counter_records_and_resets_without_a_hook() {
            let _owner = TEST_LOCK.lock().unwrap();
            let generation = reset_session();
            record_callback(generation);
            let observed = test_snapshot();
            assert_eq!(observed.callback_count, 1);
            assert!(observed.last_callback_ms.is_some());
            assert!(observed.last_callback_age_ms.is_some());

            reset_session();
            let reset = test_snapshot();
            assert_eq!(reset.callback_count, 0);
            assert_eq!(reset.last_callback_ms, None);
            assert_eq!(
                reset.status,
                super::super::super::DeliveryStatus::InstalledUnverified
            );
        }

        #[test]
        fn old_generation_callbacks_cannot_contaminate_a_new_session() {
            let _owner = TEST_LOCK.lock().unwrap();
            let old_generation = reset_session();
            let new_generation = reset_session();
            record_callback(old_generation);
            assert_eq!(test_snapshot().callback_count, 0);
            record_callback(new_generation);
            assert_eq!(test_snapshot().callback_count, 1);
        }

        #[test]
        fn timestamp_counter_has_bounded_age() {
            let _owner = TEST_LOCK.lock().unwrap();
            let generation = reset_session();
            record_callback(generation);
            let snapshot = test_snapshot();
            assert!(snapshot.last_callback_age_ms.unwrap() < OBSERVED_RECENTLY_MS);
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use runtime::{record_callback, reset_session, snapshot};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_callback_is_not_a_dead_hook() {
        let mut state = DeliveryState::default();
        state.observe(1);
        let snapshot = state.snapshot(true, true, true, false, false, OBSERVED_RECENTLY_MS + 2);
        assert_eq!(snapshot.status, DeliveryStatus::CallbackObservedStale);
        assert_eq!(
            snapshot.last_callback_age_ms,
            Some(OBSERVED_RECENTLY_MS + 1)
        );
    }

    #[test]
    fn dead_thread_and_install_failure_are_distinguished() {
        let state = DeliveryState::default();
        assert_eq!(
            state.snapshot(true, true, false, false, false, 0).status,
            DeliveryStatus::ThreadDead
        );
        assert_eq!(
            state.snapshot(true, false, false, false, true, 0).status,
            DeliveryStatus::InstallFailed
        );
    }

    #[test]
    fn idle_installed_hook_remains_unverified() {
        let state = DeliveryState::default();
        assert_eq!(
            state
                .snapshot(true, true, true, false, false, u64::MAX)
                .status,
            DeliveryStatus::InstalledUnverified
        );
    }

    #[test]
    fn snapshot_serializes_status_and_age_for_parent_ipc() {
        let state = DeliveryState {
            callback_count: 2,
            last_callback_ms: Some(10),
        };
        let snapshot = state.snapshot(true, true, true, false, false, 15);
        let json = serde_json::to_value(snapshot).unwrap();
        assert_eq!(json["status"], "callback_observed_recently");
        assert_eq!(json["last_callback_age_ms"], 5);
    }

    #[test]
    fn inactive_and_starting_states_are_distinct_from_thread_death() {
        let state = DeliveryState::default();
        assert_eq!(
            state.snapshot(false, false, false, false, false, 0).status,
            DeliveryStatus::Inactive
        );
        assert_eq!(
            state.snapshot(true, false, false, true, false, 0).status,
            DeliveryStatus::Starting
        );
    }
}
