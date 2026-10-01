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

/// A failed read is not evidence that an original preference was absent.
/// These gesture keys are integer preferences; decline entry if their original
/// type cannot be restored by our integer writer.
pub(super) fn snapshot_value(
    success: bool,
    stdout: &[u8],
    stderr: &[u8],
    domain: &str,
    key: &str,
) -> Result<Option<String>, String> {
    if !success {
        return if explicitly_absent(stderr, domain, key) {
            Ok(None)
        } else {
            Err(format!(
                "Could not read original desktop preference {domain}/{key}"
            ))
        };
    }
    let value = std::str::from_utf8(stdout)
        .map_err(|_| "Desktop preference is not valid UTF-8")?
        .trim();
    value
        .parse::<i64>()
        .map_err(|_| "Desktop preference is not an integer")?;
    Ok(Some(value.to_owned()))
}

/// Publish a complete, private recovery journal before changing preferences.
/// Linking the synced temporary file refuses to replace an existing journal,
/// including a symlink or one created by another app instance.
pub(super) fn save(path: &Path, state: &LockdownState) -> std::io::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("Missing journal directory"))?;
    // Capture missing directories before creation so every new directory entry
    // is durably linked from its parent, not just the final journal entry.
    let mut missing = Vec::new();
    let mut directory = parent;
    while !directory.try_exists()? {
        missing.push(directory);
        directory = directory
            .parent()
            .ok_or_else(|| std::io::Error::other("Missing journal ancestor"))?;
    }
    std::fs::create_dir_all(parent)?;
    #[cfg(unix)]
    for directory in missing.iter().rev() {
        std::fs::File::open(
            directory
                .parent()
                .ok_or_else(|| std::io::Error::other("Missing journal ancestor"))?,
        )?
        .sync_all()?;
    }
    let temporary = parent.join(format!(
        ".lockdown-state-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| {
        serde_json::to_writer(&mut file, state)?;
        file.flush()?;
        file.sync_all()?;
        std::fs::hard_link(&temporary, path)?;
        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    drop(file);
    let _ = std::fs::remove_file(temporary);
    result
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
    fn snapshot_only_accepts_integer_or_explicitly_missing_original() {
        assert_eq!(
            snapshot_value(true, b"2\n", b"", "test", "one"),
            Ok(Some("2".into()))
        );
        assert_eq!(
            snapshot_value(
                false,
                b"",
                b"The domain/default pair of (test, one) does not exist",
                "test",
                "one"
            ),
            Ok(None)
        );
        assert!(snapshot_value(false, b"", b"permission denied", "test", "one").is_err());
        assert!(snapshot_value(
            false,
            b"",
            b"The domain/default pair of (test, two) does not exist",
            "test",
            "one"
        )
        .is_err());
        assert!(snapshot_value(true, b"not an integer", b"", "test", "one").is_err());
    }

    #[test]
    fn journal_publication_is_complete_private_and_never_overwrites_originals() {
        let fixture = Fixture::new();
        let state = LockdownState {
            gestures: vec![GesturePref {
                domain: "test".into(),
                key: "one".into(),
                value: Some("2".into()),
            }],
            caffeinate_pid: None,
        };
        save(&fixture.path(), &state).unwrap();
        let original = std::fs::read(fixture.path()).unwrap();
        let parsed: LockdownState = serde_json::from_slice(&original).unwrap();
        assert_eq!(parsed.gestures[0].value.as_deref(), Some("2"));
        assert_eq!(
            save(
                &fixture.path(),
                &LockdownState {
                    gestures: vec![],
                    caffeinate_pid: None
                }
            )
            .unwrap_err()
            .kind(),
            std::io::ErrorKind::AlreadyExists
        );
        assert_eq!(std::fs::read(fixture.path()).unwrap(), original);
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(fixture.path())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn failed_journal_creation_does_not_publish_partial_state() {
        let fixture = Fixture::new();
        std::fs::write(fixture.path(), b"directory blocked").unwrap();
        let nested = fixture.path().join("journal.json");
        assert!(save(
            &nested,
            &LockdownState {
                gestures: vec![],
                caffeinate_pid: None
            }
        )
        .is_err());
        assert!(!nested.exists());
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
