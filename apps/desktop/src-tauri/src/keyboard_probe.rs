//! Pure ownership wrapper for native keyboard capability probes.

pub(crate) fn probe_with_cleanup<T>(
    valid: impl Fn() -> bool,
    apply: impl FnOnce() -> T,
    restore: impl FnOnce() -> Result<(), String>,
) -> Result<T, String> {
    if !valid() {
        return Err("Keyboard probe was superseded before it started.".into());
    }

    let applied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(apply));
    let cleanup = restore();

    if let Err(error) = cleanup {
        return Err(format!(
            "Keyboard probe cleanup failed; recovery journal retained: {error}"
        ));
    }

    let value = applied.map_err(|_| "Keyboard probe panicked; cleanup completed.".to_string())?;
    if !valid() {
        return Err("Keyboard probe was superseded; cleanup completed.".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        rc::Rc,
    };

    #[test]
    fn stale_queued_probe_never_applies_or_restores() {
        let applied = Cell::new(false);
        let restored = Cell::new(false);
        let result = probe_with_cleanup(
            || false,
            || applied.set(true),
            || {
                restored.set(true);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("before it started"));
        assert!(!applied.get());
        assert!(!restored.get());
    }

    #[test]
    fn invalidation_during_apply_still_cleans_up() {
        let valid = Cell::new(true);
        let restored = Cell::new(false);
        let result = probe_with_cleanup(
            || valid.get(),
            || {
                valid.set(false);
                7
            },
            || {
                restored.set(true);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("superseded"));
        assert!(restored.get());
    }

    #[test]
    fn panic_still_cleans_up() {
        let restored = Cell::new(false);
        let result = probe_with_cleanup::<()>(
            || true,
            || panic!("fixture panic"),
            || {
                restored.set(true);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("panicked"));
        assert!(restored.get());
    }

    #[test]
    fn cleanup_failure_reports_retained_recovery_journal() {
        let result = probe_with_cleanup(
            || true,
            || "probe-result",
            || Err("one binding could not be restored".into()),
        );
        let error = result.unwrap_err();
        assert!(error.contains("recovery journal retained"));
        assert!(error.contains("one binding could not be restored"));
    }

    #[test]
    fn successful_probe_returns_value_after_cleanup_and_final_validation() {
        let order = Rc::new(RefCell::new(Vec::new()));
        let valid_calls = Cell::new(0);
        let result = probe_with_cleanup(
            || {
                valid_calls.set(valid_calls.get() + 1);
                order.borrow_mut().push("valid");
                true
            },
            || {
                order.borrow_mut().push("apply");
                42
            },
            || {
                order.borrow_mut().push("restore");
                Ok(())
            },
        );
        assert_eq!(result.unwrap(), 42);
        assert_eq!(valid_calls.get(), 2);
        assert_eq!(
            order.borrow().as_slice(),
            ["valid", "apply", "restore", "valid"]
        );
    }
}
