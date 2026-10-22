//! Explicit recovery abandonment must not erase a live session's snapshot or
//! silently clear failures in other native/window cleanup.
use crate::lockdown_lifecycle::{Lifecycle, Operations};

pub(crate) fn discard_when_idle(
    lifecycle: &mut Lifecycle,
    engaged: bool,
    discard: impl FnOnce() -> Result<(), String>,
    operations: &mut impl Operations,
) -> Result<(), String> {
    if lifecycle.active || engaged {
        return Err(
            "Finish or exit the active session before discarding saved keyboard settings.".into(),
        );
    }
    discard()?;
    lifecycle.stop(operations)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake {
        releases: usize,
        fail: bool,
    }
    impl Operations for Fake {
        fn engage(&mut self) -> Result<(), String> {
            Ok(())
        }
        fn rollback(&mut self) -> Result<(), String> {
            self.release()
        }
        fn release(&mut self) -> Result<(), String> {
            self.releases += 1;
            if self.fail {
                Err("window cleanup failed".into())
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn active_or_engaged_session_never_discards() {
        for (active, engaged) in [(true, false), (false, true)] {
            let mut state = Lifecycle::default();
            state.active = active;
            let mut ops = Fake::default();
            assert!(discard_when_idle(
                &mut state,
                engaged,
                || panic!("must not archive"),
                &mut ops
            )
            .is_err());
            assert_eq!(ops.releases, 0);
        }
    }
    #[test]
    fn failed_archive_does_not_mutate_desktop() {
        let mut state = Lifecycle::default();
        let mut ops = Fake::default();
        assert!(
            discard_when_idle(&mut state, false, || Err("unsafe journal".into()), &mut ops)
                .is_err()
        );
        assert_eq!(ops.releases, 0);
    }
    #[test]
    fn other_cleanup_failure_still_blocks_entry() {
        let mut state = Lifecycle::default();
        let mut ops = Fake {
            fail: true,
            ..Fake::default()
        };
        assert!(discard_when_idle(&mut state, false, || Ok(()), &mut ops).is_err());
        ops.fail = false;
        assert!(state.start(&mut ops).is_err());
    }
    #[test]
    fn successful_cleanup_after_discard_releases_failed_recovery_latch() {
        let mut state = Lifecycle::default();
        let mut ops = Fake {
            fail: true,
            ..Fake::default()
        };
        assert!(state.stop(&mut ops).is_err());
        ops.fail = false;
        discard_when_idle(&mut state, false, || Ok(()), &mut ops).unwrap();
        assert_eq!(ops.releases, 2);
        assert_eq!(state.start(&mut ops), Ok(true));
    }
}
