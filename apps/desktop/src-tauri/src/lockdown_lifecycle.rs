//! Serialized by the caller; pure lifecycle decisions are testable without changing a desktop.
#[derive(Default)]
pub(crate) struct Lifecycle {
    pub active: bool,
    pub generation: u64,
    recovery_required: bool,
}

pub(crate) trait Operations {
    fn engage(&mut self) -> Result<(), String>;
    fn rollback(&mut self) -> Result<(), String>;
    fn release(&mut self) -> Result<(), String>;
}

impl Lifecycle {
    pub fn start(&mut self, operations: &mut impl Operations) -> Result<bool, String> {
        if self.active {
            return Ok(false);
        }
        if self.recovery_required {
            return Err(
                "Previous cleanup is incomplete. In Settings, select Restore system settings before starting again.".into(),
            );
        }
        self.generation = self.generation.wrapping_add(1);
        match operations.engage() {
            Ok(()) => {
                self.active = true;
                Ok(true)
            }
            Err(error) => {
                self.recovery_required = true;
                match operations.rollback() {
                    Ok(()) => {
                        self.recovery_required = false;
                        Err(error)
                    }
                    Err(cleanup) => Err(format!("{error}; cleanup also failed: {cleanup}")),
                }
            }
        }
    }

    pub fn stop(&mut self, operations: &mut impl Operations) -> Result<(), String> {
        // Explicit recovery also restores onboarding/crash leftovers that were
        // applied outside this in-memory lifecycle. Never skip an idle unlock.
        self.generation = self.generation.wrapping_add(1);
        self.active = false;
        self.recovery_required = true;
        operations.release()?;
        self.recovery_required = false;
        Ok(())
    }
}

pub(crate) fn combine_cleanup(
    native: Result<(), String>,
    window: Result<(), String>,
) -> Result<(), String> {
    match (native, window) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(a), Err(b)) => Err(format!("{a}; {b}")),
        (Err(error), _) | (_, Err(error)) => Err(error),
    }
}

pub(crate) fn keyboard_required(
    policy: &core_rs::exam::SessionPolicy,
    device: &core_rs::exam::DeviceState,
) -> bool {
    use core_rs::exam::{BlockingSeverity, CheckKind};
    let unsupported = device
        .keyboard
        .as_ref()
        .is_some_and(|keyboard| keyboard.method == "unsupported");
    policy.checks.iter().any(|check| {
        check.kind == CheckKind::KeyboardLockdown
            && check.required
            && (if unsupported {
                &check.unsupported_severity
            } else {
                &check.severity
            }) == &BlockingSeverity::Block
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct Fake {
        calls: Vec<&'static str>,
        start_fails: bool,
        cleanup_fails: bool,
    }
    impl Operations for Fake {
        fn engage(&mut self) -> Result<(), String> {
            self.calls.push("start");
            if self.start_fails {
                Err("platform failed".into())
            } else {
                Ok(())
            }
        }
        fn rollback(&mut self) -> Result<(), String> {
            self.calls.push("rollback");
            if self.cleanup_fails {
                Err("restore failed".into())
            } else {
                Ok(())
            }
        }
        fn release(&mut self) -> Result<(), String> {
            self.calls.push("release");
            if self.cleanup_fails {
                Err("restore failed".into())
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn repeated_start_and_stop_are_idempotent() {
        let mut state = Lifecycle::default();
        let mut ops = Fake::default();
        assert_eq!(state.start(&mut ops), Ok(true));
        let generation = state.generation;
        assert_eq!(state.start(&mut ops), Ok(false));
        assert_eq!(state.generation, generation);
        state.stop(&mut ops).unwrap();
        state.stop(&mut ops).unwrap();
        assert_eq!(ops.calls, vec!["start", "release", "release"]);
        assert!(!state.active);
    }
    #[test]
    fn failed_start_rolls_back_and_never_becomes_active() {
        let mut state = Lifecycle::default();
        let mut ops = Fake {
            start_fails: true,
            ..Fake::default()
        };
        assert!(state.start(&mut ops).is_err());
        assert!(!state.active);
        assert_eq!(ops.calls, vec!["start", "rollback"]);
        ops.start_fails = false;
        assert_eq!(state.start(&mut ops), Ok(true));
    }
    #[test]
    fn failed_cleanup_requires_retry_before_reentry() {
        let mut state = Lifecycle::default();
        let mut ops = Fake {
            start_fails: true,
            cleanup_fails: true,
            ..Fake::default()
        };
        assert!(state
            .start(&mut ops)
            .unwrap_err()
            .contains("cleanup also failed"));
        ops.start_fails = false;
        assert!(state.start(&mut ops).is_err());
        assert_eq!(ops.calls.len(), 2);
        assert!(state.stop(&mut ops).is_err());
        ops.cleanup_fails = false;
        state.stop(&mut ops).unwrap();
        assert_eq!(state.start(&mut ops), Ok(true));
    }
    #[test]
    fn new_session_invalidates_old_monitor_generation() {
        let mut state = Lifecycle::default();
        let mut ops = Fake::default();
        state.start(&mut ops).unwrap();
        let first = state.generation;
        state.stop(&mut ops).unwrap();
        state.start(&mut ops).unwrap();
        assert!(state.generation > first);
        assert!(state.active);
    }
    #[test]
    fn explicit_idle_recovery_runs_cleanup() {
        let mut state = Lifecycle::default();
        let mut ops = Fake::default();
        state.stop(&mut ops).unwrap();
        assert_eq!(ops.calls, vec!["release"]);
    }
    #[test]
    fn cleanup_reports_both_independent_failures() {
        assert_eq!(
            combine_cleanup(Err("native".into()), Err("window".into())),
            Err("native; window".into())
        );
    }
    #[test]
    fn keyboard_gate_preserves_advisory_and_unsupported_policy() {
        use core_rs::exam::*;
        let mut device = DeviceState {
            platform: Some("macos".into()),
            camera_available: None,
            microphone_available: None,
            network: None,
            keyboard: Some(KeyboardInterceptResult {
                active: false,
                method: "accessibility_denied".into(),
                platform: "macos".into(),
            }),
            restricted_processes: None,
            virtualization: None,
            external_displays: None,
            rdp_server: None,
            network_helper_ready: None,
        };
        let mac = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("macos"),
        );
        assert!(!keyboard_required(&mac, &device));
        let linux = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("linux"),
        );
        assert!(keyboard_required(&linux, &device));
        device.keyboard.as_mut().unwrap().method = "unsupported".into();
        assert!(!keyboard_required(&linux, &device));
        let windows = SessionPolicy::for_profile_with_platform(
            EnforcementProfile::StrictContest,
            Some("windows"),
        );
        assert!(keyboard_required(&windows, &device));
        let mut waived = linux;
        waived
            .checks
            .iter_mut()
            .find(|c| c.kind == CheckKind::KeyboardLockdown)
            .unwrap()
            .required = false;
        assert!(!keyboard_required(&waived, &device));
    }
}
