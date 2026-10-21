//! Bounded CLI writes and explicit GSettings user-value snapshots. No desktop mutation in tests.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const PREFIX: &str = "ams-gsettings-v1:";
#[derive(Debug, Serialize, Deserialize)]
struct Snapshot {
    user: Option<String>,
    effective: String,
    applied: String,
}

fn path(schema: &str, key: &str) -> Option<String> {
    let prefix = match schema {
        "org.gnome.desktop.wm.keybindings" => "/org/gnome/desktop/wm/keybindings/",
        "org.gnome.desktop.wm.preferences" => "/org/gnome/desktop/wm/preferences/",
        "org.gnome.desktop.interface" => "/org/gnome/desktop/interface/",
        "org.gnome.desktop.peripherals.touchpad" => "/org/gnome/desktop/peripherals/touchpad/",
        "org.gnome.shell.keybindings" => "/org/gnome/shell/keybindings/",
        "org.gnome.mutter" => "/org/gnome/mutter/",
        "org.gnome.mutter.wayland.keybindings" => "/org/gnome/mutter/wayland/keybindings/",
        "org.gnome.settings-daemon.plugins.media-keys" => {
            "/org/gnome/settings-daemon/plugins/media-keys/"
        }
        "org.gnome.shell.extensions.dash-to-dock" => "/org/gnome/shell/extensions/dash-to-dock/",
        "org.gnome.shell.extensions.dash-to-panel" => "/org/gnome/shell/extensions/dash-to-panel/",
        _ => return None,
    };
    if key.is_empty() || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
        return None;
    }
    Some(format!("{prefix}{key}"))
}
fn equivalent(a: &str, b: &str) -> bool {
    super::normalize_gvariant(a) == super::normalize_gvariant(b)
}
fn same_user(a: &Option<String>, b: &Option<String>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => equivalent(a, b),
        _ => false,
    }
}

pub(super) struct Settings<R> {
    run: R,
    schemas: HashSet<String>,
    keys: HashMap<String, HashSet<String>>,
}
impl<R: FnMut(&str, &[&str]) -> Option<String>> Settings<R> {
    pub(super) fn new(mut run: R) -> Self {
        let schemas = run("gsettings", &["list-schemas"])
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect();
        Self {
            run,
            schemas,
            keys: HashMap::new(),
        }
    }
    fn supported(&mut self, schema: &str, key: &str) -> bool {
        if !self.schemas.contains(schema) || path(schema, key).is_none() {
            return false;
        }
        if !self.keys.contains_key(schema) {
            let keys = (self.run)("gsettings", &["list-keys", schema])
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect();
            self.keys.insert(schema.to_owned(), keys);
        }
        self.keys[schema].contains(key)
            && (self.run)("gsettings", &["writable", schema, key])
                .is_some_and(|s| s.trim() == "true")
    }
    fn effective(&mut self, schema: &str, key: &str) -> Option<String> {
        (self.run)("gsettings", &["get", schema, key]).map(|s| s.trim().to_owned())
    }
    fn user(&mut self, schema: &str, key: &str) -> Option<Option<String>> {
        path(schema, key)?;
        let value = (self.run)("ams-gsettings-user-value", &[schema, key])?;
        let value = value.trim();
        Some((!value.is_empty()).then(|| value.to_owned()))
    }
    pub(super) fn snapshot(&mut self, schema: &str, key: &str, applied: &str) -> Option<String> {
        if !self.supported(schema, key) {
            return None;
        }
        let effective = self.effective(schema, key)?;
        let user = self.user(schema, key)?;
        Some(format!(
            "{PREFIX}{}",
            serde_json::to_string(&Snapshot {
                user,
                effective,
                applied: applied.into()
            })
            .ok()?
        ))
    }
    pub(super) fn apply(&mut self, schema: &str, key: &str, saved: &str) -> bool {
        let Some(snapshot) = saved
            .strip_prefix(PREFIX)
            .and_then(|s| serde_json::from_str::<Snapshot>(s).ok())
        else {
            return false;
        };
        if !self.supported(schema, key) {
            return false;
        }
        let Some(user) = self.user(schema, key) else {
            return false;
        };
        let Some(effective) = self.effective(schema, key) else {
            return false;
        };
        let applied = Some(snapshot.applied.clone());
        if !same_user(&user, &snapshot.user) && !same_user(&user, &applied) {
            return false;
        }
        if !equivalent(&effective, &snapshot.effective)
            && !equivalent(&effective, &snapshot.applied)
        {
            return false;
        }
        if (self.run)("gsettings", &["set", schema, key, &snapshot.applied]).is_none() {
            return false;
        }
        self.effective(schema, key)
            .is_some_and(|s| equivalent(&s, &snapshot.applied))
            && self
                .user(schema, key)
                .is_some_and(|s| same_user(&s, &applied))
    }
    pub(super) fn restore(&mut self, schema: &str, key: &str, saved: &str) -> bool {
        let Some(raw) = saved.strip_prefix(PREFIX) else {
            // Legacy snapshots did not distinguish absent overrides; preserve
            // their effective value without pretending this restores absence.
            if !self.supported(schema, key) {
                return false;
            }
            return (self.run)("gsettings", &["set", schema, key, saved]).is_some()
                && self
                    .effective(schema, key)
                    .is_some_and(|s| equivalent(&s, saved));
        };
        let Ok(snapshot) = serde_json::from_str::<Snapshot>(raw) else {
            return false;
        };
        if !self.supported(schema, key) {
            return false;
        }
        let Some(user) = self.user(schema, key) else {
            return false;
        };
        if same_user(&user, &snapshot.user) {
            return true;
        }
        // An external/user edit wins. Retain the journal for explicit recovery;
        // do not overwrite it with an old preference on repeated cleanup.
        if !same_user(&user, &Some(snapshot.applied.clone())) {
            return false;
        }
        let wrote = match &snapshot.user {
            Some(value) => (self.run)("gsettings", &["set", schema, key, value]),
            None => (self.run)("gsettings", &["reset", schema, key]),
        };
        wrote.is_some()
            && self
                .user(schema, key)
                .is_some_and(|s| same_user(&s, &snapshot.user))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, rc::Rc};

    #[derive(Debug)]
    struct Fake {
        user: Option<String>,
        default: String,
        writable: bool,
        fail_write: bool,
        ignore_write: bool,
        calls: Vec<(String, Vec<String>)>,
    }
    impl Default for Fake {
        fn default() -> Self {
            Self {
                user: None,
                default: "'default'".into(),
                writable: true,
                fail_write: false,
                ignore_write: false,
                calls: Vec::new(),
            }
        }
    }

    fn adapter(state: Rc<RefCell<Fake>>) -> Settings<impl FnMut(&str, &[&str]) -> Option<String>> {
        Settings::new(move |program, args| {
            let mut fake = state.borrow_mut();
            fake.calls.push((
                program.to_owned(),
                args.iter().map(|arg| (*arg).to_owned()).collect(),
            ));
            match (program, args) {
                ("gsettings", ["list-schemas"]) => {
                    Some("org.gnome.desktop.wm.keybindings\n".into())
                }
                ("gsettings", ["list-keys", "org.gnome.desktop.wm.keybindings"]) => {
                    Some("close\n".into())
                }
                ("gsettings", ["writable", _, _]) => Some(fake.writable.to_string()),
                ("gsettings", ["get", _, _]) => {
                    Some(fake.user.clone().unwrap_or_else(|| fake.default.clone()))
                }
                ("ams-gsettings-user-value", [_, _]) => Some(fake.user.clone().unwrap_or_default()),
                ("gsettings", ["set", _, _, value]) => {
                    if fake.fail_write {
                        fake.fail_write = false;
                        None
                    } else {
                        if !fake.ignore_write {
                            fake.user = Some((*value).to_owned());
                        }
                        Some(String::new())
                    }
                }
                ("gsettings", ["reset", _, _]) => {
                    if fake.fail_write {
                        fake.fail_write = false;
                        None
                    } else {
                        if !fake.ignore_write {
                            fake.user = None;
                        }
                        Some(String::new())
                    }
                }
                _ => None,
            }
        })
    }

    const SCHEMA: &str = "org.gnome.desktop.wm.keybindings";
    const KEY: &str = "close";

    #[test]
    fn absent_override_resets_to_absence_even_if_default_changes() {
        let state = Rc::new(RefCell::new(Fake::default()));
        let mut settings = adapter(state.clone());
        let saved = settings.snapshot(SCHEMA, KEY, "@as []").unwrap();
        assert!(settings.apply(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user.as_deref(), Some("@as []"));

        state.borrow_mut().default = "'new-default'".into();
        assert!(settings.restore(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user, None);
        assert_eq!(
            settings.effective(SCHEMA, KEY).as_deref(),
            Some("'new-default'")
        );
    }

    #[test]
    fn explicit_override_is_restored_exactly() {
        let state = Rc::new(RefCell::new(Fake {
            user: Some("['<Alt>F4']".into()),
            ..Fake::default()
        }));
        let mut settings = adapter(state.clone());
        let saved = settings.snapshot(SCHEMA, KEY, "@as []").unwrap();
        assert!(settings.apply(SCHEMA, KEY, &saved));
        assert!(settings.restore(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user.as_deref(), Some("['<Alt>F4']"));
    }

    #[test]
    fn external_edit_wins_and_restore_remains_retryable() {
        let state = Rc::new(RefCell::new(Fake::default()));
        let mut settings = adapter(state.clone());
        let saved = settings.snapshot(SCHEMA, KEY, "@as []").unwrap();
        assert!(settings.apply(SCHEMA, KEY, &saved));
        state.borrow_mut().user = Some("['external']".into());
        assert!(!settings.restore(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user.as_deref(), Some("['external']"));
    }

    #[test]
    fn failed_restore_can_succeed_on_retry() {
        let state = Rc::new(RefCell::new(Fake::default()));
        let mut settings = adapter(state.clone());
        let saved = settings.snapshot(SCHEMA, KEY, "@as []").unwrap();
        assert!(settings.apply(SCHEMA, KEY, &saved));
        state.borrow_mut().fail_write = true;
        assert!(!settings.restore(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user.as_deref(), Some("@as []"));
        assert!(settings.restore(SCHEMA, KEY, &saved));
        assert_eq!(state.borrow().user, None);
    }

    #[test]
    fn write_success_without_readback_change_is_failure() {
        let state = Rc::new(RefCell::new(Fake {
            ignore_write: true,
            ..Fake::default()
        }));
        let mut settings = adapter(state);
        let saved = settings.snapshot(SCHEMA, KEY, "@as []").unwrap();
        assert!(!settings.apply(SCHEMA, KEY, &saved));
    }

    #[test]
    fn legacy_and_malformed_snapshots_are_handled_conservatively() {
        let state = Rc::new(RefCell::new(Fake::default()));
        let mut settings = adapter(state.clone());
        assert!(!settings.restore(SCHEMA, KEY, "ams-gsettings-v1:{bad"));
        assert_eq!(state.borrow().user, None);
        assert!(settings.restore(SCHEMA, KEY, "['legacy']"));
        assert_eq!(state.borrow().user.as_deref(), Some("['legacy']"));
    }

    #[test]
    fn gio_user_value_distinguishes_default_override_and_reset_in_memory() {
        use gio::prelude::SettingsExt;
        use std::os::unix::fs::DirBuilderExt;

        struct TempSchema(std::path::PathBuf);
        impl Drop for TempSchema {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        let directory = std::env::temp_dir().join(format!(
            "ams-gio-schema-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&directory)
            .unwrap();
        let directory = TempSchema(directory);
        std::fs::write(
            directory.0.join("org.ams.test.gschema.xml"),
            "<?xml version=\"1.0\"?><schemalist><schema id=\"org.ams.test\" path=\"/org/ams/test/\"><key name=\"mode\" type=\"s\"><default>'default-value'</default></key></schema></schemalist>",
        ).unwrap();
        assert!(std::process::Command::new("glib-compile-schemas")
            .arg(&directory.0)
            .status()
            .unwrap()
            .success());

        let source = gio::SettingsSchemaSource::from_directory(&directory.0, None, false).unwrap();
        let schema = source.lookup("org.ams.test", false).unwrap();
        let backend = gio::memory_settings_backend_new();
        let settings = gio::Settings::new_full(&schema, Some(&backend), None);

        assert_eq!(settings.string("mode"), "default-value");
        assert!(settings.user_value("mode").is_none());
        settings.set_string("mode", "explicit-value").unwrap();
        assert_eq!(settings.string("mode"), "explicit-value");
        assert_eq!(
            settings
                .user_value("mode")
                .and_then(|value| value.str().map(str::to_owned))
                .as_deref(),
            Some("explicit-value")
        );
        settings.reset("mode");
        assert_eq!(settings.string("mode"), "default-value");
        assert!(settings.user_value("mode").is_none());
    }

    #[test]
    fn read_only_key_is_not_snapshotted_and_key_discovery_is_cached() {
        let state = Rc::new(RefCell::new(Fake {
            writable: false,
            ..Fake::default()
        }));
        let mut settings = adapter(state.clone());
        assert!(settings.snapshot(SCHEMA, KEY, "@as []").is_none());
        assert!(settings.snapshot(SCHEMA, KEY, "@as []").is_none());
        let list_keys = state
            .borrow()
            .calls
            .iter()
            .filter(|(program, args)| {
                program == "gsettings" && args.first().is_some_and(|arg| arg == "list-keys")
            })
            .count();
        assert_eq!(list_keys, 1);
    }
}
