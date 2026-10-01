//! Journal handling is independent of native commands so failure paths can be
//! verified without changing any desktop preferences.
use std::path::Path;

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct GesturePref {
    pub domain: String,
    pub key: String,
    /// None means the key was originally absent.
    pub value: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct LockdownState {
    pub gestures: Vec<GesturePref>,
    pub caffeinate_pid: Option<u32>,
}

pub(super) fn pending(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

/// `defaults read` distinguishes an absent original from command failure.
pub(super) fn explicitly_absent(stderr: &[u8], domain: &str, key: &str) -> bool {
    String::from_utf8_lossy(stderr).contains(&format!(
        "The domain/default pair of ({domain}, {key}) does not exist"
    ))
}

/// False means the journal is positively absent. All failures retain the
/// journal and return true, preventing the caller's no-journal fallback from
/// overwriting the user's saved preferences.
pub(super) fn restore(
    path: &Path,
    mut apply: impl FnMut(&GesturePref) -> bool,
    finish: impl FnOnce(Option<u32>),
) -> bool {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return pending(path),
    };
    let Ok(state) = serde_json::from_str::<LockdownState>(&raw) else {
        return true;
    };
    let mut restored = true;
    for pref in &state.gestures {
        // Attempt each original preference even when an earlier one failed.
        restored &= apply(pref);
    }
    if restored {
        finish(state.caffeinate_pid);
        // A deletion failure naturally leaves recovery pending for next time.
        let _ = std::fs::remove_file(path);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "ams-mac-recovery-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> std::path::PathBuf {
            self.0.join("journal.json")
        }
        fn write(&self) {
            std::fs::write(self.path(), r#"{"gestures":[{"domain":"test","key":"one","value":"1"},{"domain":"test","key":"two","value":null}],"caffeinate_pid":null}"#).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_journal_allows_legacy_fallback() {
        let fixture = Fixture::new();
        assert!(!pending(&fixture.path()));
        assert!(!restore(
            &fixture.path(),
            |_| panic!("no commands"),
            |_| panic!("no cleanup")
        ));
    }

    #[test]
    fn malformed_or_unreadable_journal_prevents_fallback_and_survives() {
        let fixture = Fixture::new();
        std::fs::write(fixture.path(), "malformed").unwrap();
        assert!(restore(
            &fixture.path(),
            |_| panic!("no commands"),
            |_| panic!("no cleanup")
        ));
        assert!(pending(&fixture.path()));
        std::fs::remove_file(fixture.path()).unwrap();
        std::fs::create_dir(fixture.path()).unwrap();
        assert!(restore(
            &fixture.path(),
            |_| panic!("no commands"),
            |_| panic!("no cleanup")
        ));
        assert!(pending(&fixture.path()));
    }

    #[test]
    fn partial_failure_retains_originals_and_can_retry() {
        let fixture = Fixture::new();
        fixture.write();
        let before = std::fs::read(fixture.path()).unwrap();
        let mut attempts = 0;
        assert!(restore(
            &fixture.path(),
            |_| {
                attempts += 1;
                attempts != 1
            },
            |_| panic!("unfinished")
        ));
        assert_eq!(attempts, 2);
        assert_eq!(std::fs::read(fixture.path()).unwrap(), before);
        let mut finished = false;
        assert!(restore(&fixture.path(), |_| true, |_| finished = true));
        assert!(finished);
        assert!(!pending(&fixture.path()));
    }

    #[test]
    fn missing_preference_diagnostic_is_specific_to_requested_key() {
        assert!(explicitly_absent(
            b"The domain/default pair of (test.domain, one) does not exist",
            "test.domain",
            "one"
        ));
        assert!(!explicitly_absent(
            b"The domain/default pair of (test.domain, two) does not exist",
            "test.domain",
            "one"
        ));
        assert!(!explicitly_absent(
            b"file does not exist",
            "test.domain",
            "one"
        ));
        assert!(!explicitly_absent(
            b"permission denied",
            "test.domain",
            "one"
        ));
    }

    #[cfg(unix)]
    #[test]
    fn dangling_journal_does_not_trigger_fallback() {
        let fixture = Fixture::new();
        std::os::unix::fs::symlink(fixture.0.join("absent"), fixture.path()).unwrap();
        assert!(restore(
            &fixture.path(),
            |_| panic!("no commands"),
            |_| panic!("no cleanup")
        ));
        assert!(pending(&fixture.path()));
    }

    #[test]
    fn all_failed_commands_preserve_journal() {
        let fixture = Fixture::new();
        fixture.write();
        assert!(restore(
            &fixture.path(),
            |_| false,
            |_| panic!("unfinished")
        ));
        assert!(pending(&fixture.path()));
    }
}
