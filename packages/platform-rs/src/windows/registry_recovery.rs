//! Crash-safe HKCU lockdown. The caller holds the named instance mutex across
//! processes; this module serializes its own calls within the process.
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_JOURNAL: u64 = 64 * 1024;
const MAX_VALUE: usize = 4096;
const SETTINGS: [(&str, &str, u32); 6] = [
    (
        r"Software\Microsoft\Windows\CurrentVersion\Policies\System",
        "DisableTaskMgr",
        1,
    ),
    (
        r"Software\Microsoft\Windows\CurrentVersion\GameDVR",
        "AppCaptureEnabled",
        0,
    ),
    (r"System\GameConfigStore", "GameDVR_Enabled", 0),
    (
        r"Software\Microsoft\GameBar",
        "UseNexusForGameBarEnabled",
        0,
    ),
    (
        r"Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad",
        "ThreeFingerSlideEnabled",
        0,
    ),
    (
        r"Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad",
        "FourFingerSlideEnabled",
        0,
    ),
];
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistryLockdownStatus {
    Applied,
    SkippedUnelevated,
    NotApplicablePackaged,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawValue {
    kind: u32,
    bytes: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    key: String,
    name: String,
    applied: u32,
    original: Option<RawValue>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    version: u32,
    entries: Vec<Entry>,
}

fn applied(value: u32) -> RawValue {
    RawValue {
        kind: 4,
        bytes: value.to_le_bytes().to_vec(),
    }
}

fn validate(journal: &Journal) -> Result<(), String> {
    if journal.version != 1 || journal.entries.len() != SETTINGS.len() {
        return Err("Unsupported or incomplete registry journal".into());
    }
    for (entry, &(key, name, desired)) in journal.entries.iter().zip(SETTINGS.iter()) {
        if entry.key != key
            || entry.name != name
            || entry.applied != desired
            || entry
                .original
                .as_ref()
                .is_some_and(|v| v.bytes.len() > MAX_VALUE)
        {
            return Err("Invalid registry journal setting or value".into());
        }
    }
    Ok(())
}

trait Registry {
    fn read(&mut self, key: &str, name: &str) -> Result<Option<RawValue>, String>;
    fn write(&mut self, key: &str, name: &str, value: Option<&RawValue>) -> Result<(), String>;
}

trait Storage {
    fn load(&mut self) -> Result<Option<Journal>, String>;
    fn publish(&mut self, journal: &Journal) -> Result<(), String>;
    fn remove(&mut self) -> Result<(), String>;
}

fn engage_for_privilege_with(
    registry: &mut impl Registry,
    storage: &mut impl Storage,
    elevated: bool,
) -> Result<RegistryLockdownStatus, String> {
    if elevated {
        engage_with(registry, storage)?;
        Ok(RegistryLockdownStatus::Applied)
    } else {
        // Never leave a previous session's changes behind or replace its
        // snapshot. With no journal this performs no registry reads or writes.
        restore_with(registry, storage)?;
        Ok(RegistryLockdownStatus::SkippedUnelevated)
    }
}

fn engage_with(registry: &mut impl Registry, storage: &mut impl Storage) -> Result<(), String> {
    // A previous session's original state must never be replaced by a new snapshot.
    restore_with(registry, storage)?;
    let mut entries = Vec::with_capacity(SETTINGS.len());
    for &(key, name, desired) in &SETTINGS {
        let original = registry.read(key, name)?;
        if original.as_ref().is_some_and(|v| v.bytes.len() > MAX_VALUE) {
            return Err(format!(
                "Registry value too large to snapshot: {key}\\{name}"
            ));
        }
        entries.push(Entry {
            key: key.into(),
            name: name.into(),
            applied: desired,
            original,
        });
    }
    let journal = Journal {
        version: 1,
        entries,
    };
    storage.publish(&journal)?;
    for entry in &journal.entries {
        let desired = applied(entry.applied);
        let current = registry.read(&entry.key, &entry.name)?;
        if current.as_ref() == Some(&desired) {
            continue;
        }
        if current != entry.original {
            return Err(format!(
                "Registry changed during engagement: {}\\{}",
                entry.key, entry.name
            ));
        }
        registry.write(&entry.key, &entry.name, Some(&desired))?;
        if registry.read(&entry.key, &entry.name)? != Some(desired) {
            return Err(format!(
                "Registry engagement verification failed: {}\\{}",
                entry.key, entry.name
            ));
        }
    }
    Ok(())
}

fn restore_with(registry: &mut impl Registry, storage: &mut impl Storage) -> Result<(), String> {
    let Some(journal) = storage.load()? else {
        return Ok(());
    };
    validate(&journal)?;
    let mut errors = Vec::new();
    for entry in &journal.entries {
        let attempt = (|| {
            let current = registry.read(&entry.key, &entry.name)?;
            if current == entry.original {
                return Ok(());
            }
            if current != Some(applied(entry.applied)) {
                return Err("external edit conflicts with applied value".to_string());
            }
            registry.write(&entry.key, &entry.name, entry.original.as_ref())?;
            if registry.read(&entry.key, &entry.name)? != entry.original {
                return Err("restore verification failed".to_string());
            }
            Ok(())
        })();
        if let Err(error) = attempt {
            errors.push(format!("{}\\{}: {error}", entry.key, entry.name));
        }
    }
    if !errors.is_empty() {
        return Err(format!(
            "Registry restore incomplete: {}",
            errors.join("; ")
        ));
    }
    storage.remove()
}

struct FileStorage(PathBuf);

impl FileStorage {
    fn local() -> Result<Self, String> {
        let root = std::env::var_os("LOCALAPPDATA")
            .filter(|s| !s.is_empty())
            .ok_or("LOCALAPPDATA is unavailable; registry lockdown refused")?;
        Ok(Self(
            PathBuf::from(root)
                .join("AMSAccess")
                .join("windows-lockdown.json"),
        ))
    }
}

impl Storage for FileStorage {
    fn load(&mut self) -> Result<Option<Journal>, String> {
        use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

        // LOCALAPPDATA is expected to be a private, per-user directory. Treat
        // the journal file itself as untrusted: open the link, not its target,
        // then reject reparse points before parsing or touching the registry.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&self.0)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Cannot open registry journal: {e}")),
        };
        let metadata = file.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("Registry journal is not a regular file".into());
        }
        if metadata.len() > MAX_JOURNAL {
            return Err("Registry journal exceeds size limit".into());
        }
        let mut bytes = Vec::new();
        file.take(MAX_JOURNAL + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_JOURNAL {
            return Err("Registry journal exceeds size limit".into());
        }
        let journal: Journal =
            serde_json::from_slice(&bytes).map_err(|e| format!("Invalid registry journal: {e}"))?;
        validate(&journal)?;
        Ok(Some(journal))
    }

    fn publish(&mut self, journal: &Journal) -> Result<(), String> {
        validate(journal)?;
        let bytes = serde_json::to_vec(journal).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_JOURNAL {
            return Err("Registry journal exceeds size limit".into());
        }
        let dir = self.0.parent().ok_or("Invalid registry journal path")?;
        fs::create_dir_all(dir)
            .map_err(|e| format!("Cannot create registry journal directory: {e}"))?;
        // The temporary file is in the same directory, and the hard link is an
        // atomic, no-clobber publication of the fully synced contents.
        for i in 0..100 {
            let temp = dir.join(format!(".windows-lockdown-{}-{i}.tmp", std::process::id()));
            let mut file = match OpenOptions::new().write(true).create_new(true).open(&temp) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Cannot create registry journal temp file: {e}")),
            };
            let result = (|| {
                file.write_all(&bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| format!("Cannot sync registry journal: {e}"))?;
                fs::hard_link(&temp, &self.0).map_err(|e| {
                    format!("Cannot publish registry journal (existing journal is preserved): {e}")
                })
            })();
            drop(file);
            let _ = fs::remove_file(&temp);
            return result;
        }
        Err("No free registry journal temporary filename".into())
    }

    fn remove(&mut self) -> Result<(), String> {
        fs::remove_file(&self.0).map_err(|e| format!("Cannot remove registry journal: {e}"))
    }
}

struct WindowsRegistry;

impl Registry for WindowsRegistry {
    fn read(&mut self, key: &str, name: &str) -> Result<Option<RawValue>, String> {
        use windows::Win32::Foundation::{
            ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS,
        };
        use windows::Win32::System::Registry::{
            RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
            REG_VALUE_TYPE,
        };
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let mut handle = HKEY::default();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                windows::core::PCWSTR(wide(key).as_ptr()),
                None,
                KEY_QUERY_VALUE,
                &mut handle,
            )
        };
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(format!("Open HKCU\\{key}: {status:?}"));
        }
        let _guard = Key(handle);
        let name = wide(name);
        // Retry when the value changes between sizing and reading; never accept
        // a truncated value as an original snapshot.
        for _ in 0..4 {
            let mut kind = REG_VALUE_TYPE::default();
            let mut len = 0u32;
            let status = unsafe {
                RegQueryValueExW(
                    handle,
                    windows::core::PCWSTR(name.as_ptr()),
                    None,
                    Some(&mut kind),
                    None,
                    Some(&mut len),
                )
            };
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            if status != ERROR_SUCCESS && status != ERROR_MORE_DATA {
                return Err(format!("Query registry value: {status:?}"));
            }
            if len as usize > MAX_VALUE {
                return Err("Registry value too large to snapshot".into());
            }
            let mut bytes = vec![0; len as usize];
            let status = unsafe {
                RegQueryValueExW(
                    handle,
                    windows::core::PCWSTR(name.as_ptr()),
                    None,
                    Some(&mut kind),
                    Some(bytes.as_mut_ptr()),
                    Some(&mut len),
                )
            };
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            if status == ERROR_MORE_DATA {
                continue;
            }
            if status != ERROR_SUCCESS {
                return Err(format!("Read registry value: {status:?}"));
            }
            bytes.truncate(len as usize);
            return Ok(Some(RawValue {
                kind: kind.0,
                bytes,
            }));
        }
        Err("Registry value changed repeatedly while reading".into())
    }

    fn write(&mut self, key: &str, name: &str, value: Option<&RawValue>) -> Result<(), String> {
        use windows::Win32::Foundation::{
            ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS,
        };
        use windows::Win32::System::Registry::{
            RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
            HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_VALUE_TYPE,
        };
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let mut handle = HKEY::default();
        let path = wide(key);
        let status = if value.is_some() {
            unsafe {
                RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    windows::core::PCWSTR(path.as_ptr()),
                    None,
                    windows::core::PWSTR::null(),
                    REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE,
                    None,
                    &mut handle,
                    None,
                )
            }
        } else {
            unsafe {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    windows::core::PCWSTR(path.as_ptr()),
                    None,
                    KEY_SET_VALUE,
                    &mut handle,
                )
            }
        };
        if value.is_none() && (status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND) {
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            return Err(format!("Open HKCU\\{key} for writing: {status:?}"));
        }
        let _guard = Key(handle);
        let name = wide(name);
        let status = match value {
            Some(raw) => unsafe {
                RegSetValueExW(
                    handle,
                    windows::core::PCWSTR(name.as_ptr()),
                    None,
                    REG_VALUE_TYPE(raw.kind),
                    Some(&raw.bytes),
                )
            },
            None => unsafe { RegDeleteValueW(handle, windows::core::PCWSTR(name.as_ptr())) },
        };
        if value.is_none() && status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            return Err(format!("Write registry value: {status:?}"));
        }
        Ok(())
    }
}

struct Key(windows::Win32::System::Registry::HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        let _ = unsafe { windows::Win32::System::Registry::RegCloseKey(self.0) };
    }
}

pub(super) fn engage(elevated: bool) -> Result<RegistryLockdownStatus, String> {
    let _lock = LOCK
        .lock()
        .map_err(|_| "Registry transaction lock poisoned")?;
    engage_for_privilege_with(&mut WindowsRegistry, &mut FileStorage::local()?, elevated)
}

pub(super) fn restore() -> Result<(), String> {
    let _lock = LOCK
        .lock()
        .map_err(|_| "Registry transaction lock poisoned")?;
    restore_with(&mut WindowsRegistry, &mut FileStorage::local()?)
}

/// Fail closed on an inaccessible journal or an unavailable app-data directory.
pub(super) fn pending() -> bool {
    let Ok(_lock) = LOCK.lock() else {
        return true;
    };
    let Ok(mut storage) = FileStorage::local() else {
        return true;
    };
    !matches!(storage.load(), Ok(None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct Fake {
        values: HashMap<(String, String), RawValue>,
        writes: usize,
        fail_at: Option<usize>,
        fail_read: Option<String>,
        silent_write: bool,
    }
    impl Registry for Fake {
        fn read(&mut self, key: &str, name: &str) -> Result<Option<RawValue>, String> {
            if self.fail_read.as_deref() == Some(name) {
                return Err("injected read failure".into());
            }
            Ok(self.values.get(&(key.into(), name.into())).cloned())
        }
        fn write(&mut self, key: &str, name: &str, value: Option<&RawValue>) -> Result<(), String> {
            self.writes += 1;
            if self.fail_at == Some(self.writes) {
                return Err("injected write failure".into());
            }
            if self.silent_write {
                return Ok(());
            }
            let slot = (key.into(), name.into());
            if let Some(value) = value {
                self.values.insert(slot, value.clone());
            } else {
                self.values.remove(&slot);
            }
            Ok(())
        }
    }
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct TestStore {
        storage: FileStorage,
        dir: PathBuf,
    }
    impl TestStore {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "ams-registry-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            Self {
                storage: FileStorage(dir.join("windows-lockdown.json")),
                dir,
            }
        }
    }
    impl Drop for TestStore {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.dir).unwrap();
        }
    }

    struct RejectPublish(FileStorage);
    impl Storage for RejectPublish {
        fn load(&mut self) -> Result<Option<Journal>, String> {
            self.0.load()
        }
        fn publish(&mut self, _: &Journal) -> Result<(), String> {
            Err("injected publish failure".into())
        }
        fn remove(&mut self) -> Result<(), String> {
            self.0.remove()
        }
    }

    #[test]
    fn unelevated_entry_skips_registry_without_probing_protected_values() {
        let mut store = TestStore::new();
        let mut reg = Fake {
            fail_read: Some("DisableTaskMgr".into()),
            fail_at: Some(1),
            ..Default::default()
        };
        let before = reg.values.clone();
        assert_eq!(
            engage_for_privilege_with(&mut reg, &mut store.storage, false).unwrap(),
            RegistryLockdownStatus::SkippedUnelevated
        );
        assert_eq!(reg.writes, 0);
        assert_eq!(reg.values, before);
        assert!(store.storage.load().unwrap().is_none());
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert_eq!(reg.writes, 0);
    }

    #[test]
    fn unelevated_entry_restores_existing_owned_changes_without_reapplying() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        let (key, name, _) = SETTINGS[0];
        reg.values.insert((key.into(), name.into()), applied(0));
        let before = reg.values.clone();
        engage_with(&mut reg, &mut store.storage).unwrap();
        assert_eq!(
            engage_for_privilege_with(&mut reg, &mut store.storage, false).unwrap(),
            RegistryLockdownStatus::SkippedUnelevated
        );
        assert_eq!(reg.values, before);
        assert!(store.storage.load().unwrap().is_none());
    }

    #[test]
    fn unelevated_entry_cannot_waive_failed_recovery_or_corrupt_journals() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        engage_with(&mut reg, &mut store.storage).unwrap();
        reg.fail_at = Some(reg.writes + 1);
        assert!(engage_for_privilege_with(&mut reg, &mut store.storage, false).is_err());
        assert!(store.storage.load().unwrap().is_some());
        reg.fail_at = None;
        assert_eq!(
            engage_for_privilege_with(&mut reg, &mut store.storage, false).unwrap(),
            RegistryLockdownStatus::SkippedUnelevated
        );
        assert!(reg.values.is_empty());
        assert!(store.storage.load().unwrap().is_none());
        fs::write(&store.storage.0, b"broken").unwrap();
        let writes = reg.writes;
        assert!(engage_for_privilege_with(&mut reg, &mut store.storage, false).is_err());
        assert_eq!(reg.writes, writes);
        assert_eq!(fs::read(&store.storage.0).unwrap(), b"broken");
    }

    #[test]
    fn unelevated_entry_preserves_external_edits_and_their_recovery_journal() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        engage_with(&mut reg, &mut store.storage).unwrap();
        let (key, name, _) = SETTINGS[0];
        reg.values.insert((key.into(), name.into()), applied(42));
        assert!(engage_for_privilege_with(&mut reg, &mut store.storage, false).is_err());
        assert_eq!(
            reg.values.get(&(key.into(), name.into())),
            Some(&applied(42))
        );
        assert!(store.storage.load().unwrap().is_some());
    }

    #[test]
    fn elevated_entry_still_applies_registry_and_propagates_write_failures() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        assert_eq!(
            engage_for_privilege_with(&mut reg, &mut store.storage, true).unwrap(),
            RegistryLockdownStatus::Applied
        );
        assert!(store.storage.load().unwrap().is_some());
        restore_with(&mut reg, &mut store.storage).unwrap();
        reg.fail_at = Some(reg.writes + 1);
        assert!(engage_for_privilege_with(&mut reg, &mut store.storage, true).is_err());
        assert!(store.storage.load().unwrap().is_some());
    }

    #[test]
    fn idle_restore_and_publish_failure_never_write_registry() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert_eq!(reg.writes, 0);
        assert!(engage_with(
            &mut reg,
            &mut RejectPublish(FileStorage(store.storage.0.clone()))
        )
        .is_err());
        assert_eq!(reg.writes, 0);
        assert!(store.storage.load().unwrap().is_none());
    }

    #[test]
    fn failed_read_and_corrupt_journal_never_mutate_registry() {
        let mut store = TestStore::new();
        let mut reg = Fake {
            fail_read: Some(SETTINGS[2].1.into()),
            ..Default::default()
        };
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(reg.writes, 0);
        assert!(store.storage.load().unwrap().is_none());
        fs::write(&store.storage.0, b"broken").unwrap();
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(reg.writes, 0);
        assert_eq!(fs::read(&store.storage.0).unwrap(), b"broken");
    }

    #[test]
    fn round_trip_raw_values_and_absences() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        let (key, name, _) = SETTINGS[0];
        let original = RawValue {
            kind: 7,
            bytes: vec![0, 255, 12, 0],
        };
        reg.values
            .insert((key.into(), name.into()), original.clone());
        engage_with(&mut reg, &mut store.storage).unwrap();
        assert!(store.storage.load().unwrap().is_some());
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert_eq!(reg.values.get(&(key.into(), name.into())), Some(&original));
        assert_eq!(reg.values.len(), 1);
        assert!(store.storage.load().unwrap().is_none());
        restore_with(&mut reg, &mut store.storage).unwrap();
    }

    #[test]
    fn mixed_original_values_are_restored_byte_for_byte() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        for (i, raw) in [
            applied(0),
            applied(1),
            RawValue {
                kind: 7,
                bytes: vec![0, 255, 12, 0],
            },
        ]
        .into_iter()
        .enumerate()
        {
            let (key, name, _) = SETTINGS[i];
            reg.values.insert((key.into(), name.into()), raw);
        }
        let before = reg.values.clone();
        engage_with(&mut reg, &mut store.storage).unwrap();
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert_eq!(reg.values, before);
    }

    #[test]
    fn silent_engagement_write_is_detected_and_journal_retained() {
        let mut store = TestStore::new();
        let mut reg = Fake {
            silent_write: true,
            ..Default::default()
        };
        assert!(engage_with(&mut reg, &mut store.storage)
            .unwrap_err()
            .contains("verification"));
        assert_eq!(reg.writes, 1);
        assert!(store.storage.load().unwrap().is_some());
    }

    #[test]
    fn partial_failure_recovers_and_existing_journal_cannot_be_replaced() {
        let mut store = TestStore::new();
        let mut reg = Fake {
            fail_at: Some(3),
            ..Default::default()
        };
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert!(store.storage.load().unwrap().is_some());
        reg.fail_at = None;
        engage_with(&mut reg, &mut store.storage).unwrap();
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert!(reg.values.is_empty());
    }

    #[test]
    fn conflict_and_corruption_preserve_journal() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        engage_with(&mut reg, &mut store.storage).unwrap();
        let (key, name, _) = SETTINGS[0];
        reg.values.insert((key.into(), name.into()), applied(42));
        assert!(restore_with(&mut reg, &mut store.storage)
            .unwrap_err()
            .contains("conflict"));
        // The first value conflicts, but the remaining independent values
        // must still be restored in this attempt.
        assert_eq!(reg.values.len(), 1);
        assert_eq!(
            reg.values.get(&(key.into(), name.into())),
            Some(&applied(42))
        );
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert!(store.storage.load().unwrap().is_some());
        fs::write(&store.storage.0, b"broken").unwrap();
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert!(store.storage.0.exists());
    }

    #[test]
    fn external_edit_is_never_overwritten_and_restore_can_retry() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        engage_with(&mut reg, &mut store.storage).unwrap();
        let (key, name, _) = SETTINGS[3];
        reg.values.insert((key.into(), name.into()), applied(98));
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(
            reg.values.get(&(key.into(), name.into())),
            Some(&applied(98))
        );
        assert!(store.storage.load().unwrap().is_some());
        reg.values.insert((key.into(), name.into()), applied(0));
        reg.fail_at = Some(reg.writes + 1);
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert!(store.storage.load().unwrap().is_some());
        reg.fail_at = None;
        restore_with(&mut reg, &mut store.storage).unwrap();
        assert!(reg.values.is_empty());
    }

    #[test]
    fn journal_symlink_is_not_followed() {
        use std::os::windows::fs::symlink_file;

        let mut store = TestStore::new();
        let target = store.dir.join("other.json");
        fs::write(&target, b"outside journal").unwrap();
        // Creating symlinks requires Developer Mode or a privilege on some
        // Windows machines. Only skip when the OS refuses to create one.
        if let Err(error) = symlink_file(&target, &store.storage.0) {
            assert!(
                error.kind() == std::io::ErrorKind::PermissionDenied
                    || error.raw_os_error() == Some(1314), // ERROR_PRIVILEGE_NOT_HELD
                "unexpected symlink creation failure: {error}"
            );
            return;
        }
        let mut reg = Fake::default();
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(reg.writes, 0);
        assert_eq!(fs::read(&target).unwrap(), b"outside journal");
    }

    #[test]
    fn valid_journal_publication_never_clobbers_existing_bytes() {
        let mut store = TestStore::new();
        let journal = Journal {
            version: 1,
            entries: SETTINGS
                .iter()
                .map(|&(key, name, desired)| Entry {
                    key: key.into(),
                    name: name.into(),
                    applied: desired,
                    original: None,
                })
                .collect(),
        };
        store.storage.publish(&journal).unwrap();
        let bytes = fs::read(&store.storage.0).unwrap();
        assert!(store.storage.publish(&journal).is_err());
        assert_eq!(fs::read(&store.storage.0).unwrap(), bytes);
    }

    #[test]
    fn reject_invalid_journals_and_no_clobber_publication() {
        let mut store = TestStore::new();
        let mut reg = Fake::default();
        let bad = Journal {
            version: 1,
            entries: vec![Entry {
                key: "NoWinKeys".into(),
                name: "NoWinKeys".into(),
                applied: 1,
                original: None,
            }],
        };
        fs::write(&store.storage.0, serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert!(engage_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(reg.writes, 0);
        assert!(store.storage.publish(&bad).is_err());
        assert!(store.storage.0.exists());
        fs::remove_file(&store.storage.0).unwrap();
        let mut entries = SETTINGS
            .iter()
            .map(|&(key, name, desired)| Entry {
                key: key.into(),
                name: name.into(),
                applied: desired,
                original: None,
            })
            .collect::<Vec<_>>();
        entries[0].applied = 0;
        let wrong = Journal {
            version: 1,
            entries,
        };
        fs::write(&store.storage.0, serde_json::to_vec(&wrong).unwrap()).unwrap();
        assert!(restore_with(&mut reg, &mut store.storage).is_err());
        assert_eq!(reg.writes, 0);
    }
}
