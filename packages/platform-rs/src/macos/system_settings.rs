//! Desktop preferences a lockdown changes, and their guaranteed restore.
//!
//! Every original value is read and published to disk before the first
//! change — including "this key did not exist", so restore deletes it rather
//! than writing a guessed default. The snapshot is removed only after every
//! value has been written back AND read back. Whatever survives a crash, a
//! force quit or a restart is restored by the watchdog process, the login
//! agent, or the next launch, whichever runs first.
//!
//! Absent-key reads are ordinary here, so every command uses `bounded_output`:
//! a nonzero `defaults` exit must never be recorded as a readiness failure.

use crate::process_runner::CommandDeadlineExt;
use core_rs::exam::LockdownConfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const DEFAULTS: &str = "/usr/bin/defaults";
const KILLALL: &str = "/usr/bin/killall";

const TRACKPADS: [&str; 2] = [
    "com.apple.AppleMultitouchTrackpad",
    "com.apple.driver.AppleBluetoothMultitouch.trackpad",
];
const TRACKPAD_GESTURES: [&str; 7] = [
    "TrackpadThreeFingerHorizSwipeGesture",
    "TrackpadThreeFingerVertSwipeGesture",
    "TrackpadFourFingerHorizSwipeGesture",
    "TrackpadFourFingerVertSwipeGesture",
    "TrackpadFourFingerPinchGesture",
    "TrackpadFiveFingerPinchGesture",
    "TrackpadTwoFingerFromRightEdgeSwipeGesture",
];
const MOUSE: &str = "com.apple.driver.AppleBluetoothMultitouch.mouse";
const MOUSE_GESTURES: [&str; 2] = [
    "MouseTwoFingerHorizSwipeGesture",
    "MouseTwoFingerDoubleTapGesture",
];
const GLOBAL: &str = "NSGlobalDomain";
// What System Settings itself writes for the trackpad, per host.
const GLOBAL_TRACKPAD_GESTURES: [&str; 7] = [
    "com.apple.trackpad.threeFingerHorizSwipeGesture",
    "com.apple.trackpad.threeFingerVertSwipeGesture",
    "com.apple.trackpad.fourFingerHorizSwipeGesture",
    "com.apple.trackpad.fourFingerVertSwipeGesture",
    "com.apple.trackpad.fourFingerPinchSwipeGesture",
    "com.apple.trackpad.fiveFingerPinchSwipeGesture",
    "com.apple.trackpad.twoFingerFromRightEdgeSwipeGesture",
];
const DOCK: &str = "com.apple.dock";
const DOCK_GESTURES: [&str; 4] = [
    "showMissionControlGestureEnabled",
    "showAppExposeGestureEnabled",
    "showDesktopGestureEnabled",
    "showLaunchpadGestureEnabled",
];
const HOT_CORNERS: [&str; 4] = [
    "wvous-tl-corner",
    "wvous-tr-corner",
    "wvous-bl-corner",
    "wvous-br-corner",
];
const HOT_CORNER_MODIFIERS: [&str; 4] = [
    "wvous-tl-modifier",
    "wvous-tr-modifier",
    "wvous-bl-modifier",
    "wvous-br-modifier",
];

// Keyboard shortcuts (Spotlight, screenshots, Mission Control, Spaces) are
// not changed here: the keyboard tap drops them before the system sees them.
// Disabling them in com.apple.symbolichotkeys could not be undone reliably —
// re-importing a domain that never listed a shortcut leaves the hotkey server
// holding it disabled until the next login.

const LOGIN_AGENT_LABEL: &str = "com.ams.access.lockdown-restore";
pub(super) const LOGIN_RESTORE_FLAG: &str = "--lockdown-restore";

/// A preference value as `defaults` stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
enum Value {
    Integer(i64),
    Boolean(bool),
    /// Kept as text so restore writes back exactly what was read.
    Float(String),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedPref {
    domain: String,
    key: String,
    current_host: bool,
    label: String,
    /// `None` means the key did not exist before lockdown.
    original: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Reload {
    dock: bool,
    siri: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Snapshot {
    version: u32,
    active: bool,
    owner_pid: u32,
    created_at_ms: u64,
    prefs: Vec<SavedPref>,
    reload: Reload,
    caffeinate_pid: Option<u32>,
    /// Labels and fix commands of values the last restore could not verify.
    #[serde(default)]
    unrestored: Vec<UnrestoredSetting>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UnrestoredSetting {
    pub label: String,
    pub fix_command: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct RestoreStatus {
    pub pending: bool,
    pub items: Vec<UnrestoredSetting>,
}

pub(super) enum RestoreOutcome {
    Restored,
    NothingToRestore,
    /// Not restored on purpose: a live lockdown owns the snapshot, or it
    /// belongs to a different app instance than the caller guards.
    Deferred,
    Failed(Vec<String>),
}

/// Which snapshot a caller is entitled to restore.
enum Guard {
    Any,
    /// Background retries: never while a lockdown is live in this process.
    UnlessLockdownActive,
    /// The watchdog: only the snapshot its own app instance wrote.
    OwnedBy {
        pid: u32,
        created_at_ms: u64,
    },
}

/// One planned scalar change.
struct Change {
    domain: &'static str,
    key: &'static str,
    current_host: bool,
    value: Value,
    label: &'static str,
}

fn change(
    domain: &'static str,
    key: &'static str,
    current_host: bool,
    value: Value,
    label: &'static str,
) -> Change {
    Change {
        domain,
        key,
        current_host,
        value,
        label,
    }
}

/// What this contest's config asks to change, and which services must reload.
fn plan(config: &LockdownConfig) -> (Vec<Change>, Reload) {
    let mut changes = Vec::new();
    let mut reload = Reload::default();
    if config.disable_gestures {
        for domain in TRACKPADS {
            for key in TRACKPAD_GESTURES {
                changes.push(change(
                    domain,
                    key,
                    false,
                    Value::Integer(0),
                    "Trackpad gestures",
                ));
            }
        }
        for key in MOUSE_GESTURES {
            changes.push(change(
                MOUSE,
                key,
                false,
                Value::Integer(0),
                "Magic Mouse gestures",
            ));
        }
        for key in GLOBAL_TRACKPAD_GESTURES {
            changes.push(change(
                GLOBAL,
                key,
                true,
                Value::Integer(0),
                "Trackpad gestures",
            ));
        }
        for key in [
            "AppleEnableSwipeNavigateWithScrolls",
            "AppleEnableMouseSwipeNavigateWithScrolls",
        ] {
            changes.push(change(
                GLOBAL,
                key,
                false,
                Value::Boolean(false),
                "Swipe between pages",
            ));
        }
        for key in DOCK_GESTURES {
            changes.push(change(
                DOCK,
                key,
                false,
                Value::Boolean(false),
                "Dock gestures",
            ));
        }
        reload.dock = true;
    }
    if config.disable_mission_control {
        changes.push(change(
            DOCK,
            "mcx-expose-disabled",
            false,
            Value::Boolean(true),
            "Mission Control",
        ));
        reload.dock = true;
    }
    if config.disable_hot_corners {
        for key in HOT_CORNERS {
            changes.push(change(DOCK, key, false, Value::Integer(1), "Hot corners"));
        }
        for key in HOT_CORNER_MODIFIERS {
            changes.push(change(DOCK, key, false, Value::Integer(0), "Hot corners"));
        }
        reload.dock = true;
    }
    if config.disable_siri {
        changes.push(change(
            "com.apple.assistant.support",
            "Assistant Enabled",
            false,
            Value::Boolean(false),
            "Siri",
        ));
        changes.push(change(
            "com.apple.Siri",
            "VoiceTriggerUserEnabled",
            false,
            Value::Boolean(false),
            "Siri",
        ));
        reload.siri = true;
    }
    if config.block_function_keys {
        changes.push(change(
            "com.apple.HIToolbox",
            "AppleFnUsageType",
            false,
            Value::Integer(0),
            "Globe (fn) key action",
        ));
    }
    (changes, reload)
}

// ── defaults(1) wrappers ─────────────────────────────────────────────────────

fn defaults(current_host: bool) -> Command {
    let mut command = Command::new(DEFAULTS);
    if current_host {
        command.arg("-currentHost");
    }
    command
}

/// Absent keys and domains. Older macOS says "does not exist"; current
/// releases say "Could not find key" and "Domain ... not found".
fn is_absent(stderr: &[u8]) -> bool {
    let text = String::from_utf8_lossy(stderr);
    text.contains("does not exist")
        || text.contains("Could not find key")
        || text.contains("not found")
}

/// Ok(None) only when `defaults` positively says the key is absent. Any other
/// failure, or a type we cannot write back faithfully, is an Err: such a key
/// is left untouched rather than changed without a usable original.
fn read_value(domain: &str, key: &str, current_host: bool) -> Result<Option<Value>, String> {
    let unreadable = || format!("could not read {domain} {key}");
    let kind = defaults(current_host)
        .args(["read-type", domain, key])
        .bounded_output()
        .map_err(|_| unreadable())?;
    if !kind.status.success() {
        return if is_absent(&kind.stderr) {
            Ok(None)
        } else {
            Err(unreadable())
        };
    }
    let kind = String::from_utf8_lossy(&kind.stdout)
        .trim()
        .trim_start_matches("Type is ")
        .to_string();
    let raw = defaults(current_host)
        .args(["read", domain, key])
        .bounded_output()
        .map_err(|_| unreadable())?;
    if !raw.status.success() {
        return if is_absent(&raw.stderr) {
            Ok(None)
        } else {
            Err(unreadable())
        };
    }
    let text = String::from_utf8_lossy(&raw.stdout);
    let text = text.strip_suffix('\n').unwrap_or(&text).to_string();
    match kind.as_str() {
        "integer" => text
            .trim()
            .parse::<i64>()
            .map(|value| Some(Value::Integer(value)))
            .map_err(|_| unreadable()),
        "boolean" => Ok(Some(Value::Boolean(text.trim() == "1"))),
        "float" => Ok(Some(Value::Float(text.trim().to_string()))),
        "string" => Ok(Some(Value::String(text))),
        other => Err(format!("{domain} {key} has unsupported type {other}")),
    }
}

fn write_value(domain: &str, key: &str, current_host: bool, value: &Value) -> bool {
    let mut command = defaults(current_host);
    command.args(["write", domain, key]);
    match value {
        Value::Integer(value) => command.args(["-int", &value.to_string()]),
        Value::Boolean(value) => command.args(["-bool", if *value { "true" } else { "false" }]),
        Value::Float(value) => command.args(["-float", value]),
        Value::String(value) => command.args(["-string", value]),
    };
    command
        .bounded_output()
        .is_ok_and(|output| output.status.success())
}

/// True when the key is gone afterwards, including when it already was.
fn delete_value(domain: &str, key: &str, current_host: bool) -> bool {
    match read_value(domain, key, current_host) {
        Ok(None) => return true,
        Err(_) => return false,
        Ok(Some(_)) => {}
    }
    defaults(current_host)
        .args(["delete", domain, key])
        .bounded_output()
        .is_ok_and(|output| output.status.success())
}

fn same_value(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Float(a), Value::Float(b)) => match (a.parse::<f64>(), b.parse::<f64>()) {
            (Ok(a), Ok(b)) => (a - b).abs() < 1e-9,
            _ => a == b,
        },
        (Value::Integer(a), Value::Boolean(b)) | (Value::Boolean(b), Value::Integer(a)) => {
            *a == i64::from(*b)
        }
        _ => actual == expected,
    }
}

fn value_matches(domain: &str, key: &str, current_host: bool, expected: Option<&Value>) -> bool {
    match (read_value(domain, key, current_host), expected) {
        (Ok(None), None) => true,
        (Ok(Some(actual)), Some(expected)) => same_value(&actual, expected),
        _ => false,
    }
}

/// Make written preferences take effect. cfprefsd first, so every reader —
/// including the restarted Dock — starts from what is on disk.
fn reload_services(reload: &Reload, applying: bool) {
    let _ = Command::new(KILLALL).arg("cfprefsd").bounded_output();
    if reload.dock {
        let _ = Command::new(KILLALL).arg("Dock").bounded_output();
    }
    // Siri relaunches on demand, so only a running one needs to be stopped
    // for the disabled setting to hold.
    if reload.siri && applying {
        let _ = Command::new(KILLALL).arg("Siri").bounded_output();
    }
}

// ── Snapshot storage ─────────────────────────────────────────────────────────

fn state_dir() -> Option<PathBuf> {
    super::home_dir().map(|home| home.join("Library/Application Support/AMS Access"))
}

fn snapshot_path() -> Option<PathBuf> {
    state_dir().map(|dir| dir.join("lockdown-snapshot.json"))
}

fn login_agent_path() -> Option<PathBuf> {
    super::home_dir().map(|home| {
        home.join("Library/LaunchAgents")
            .join(format!("{LOGIN_AGENT_LABEL}.plist"))
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Publish atomically: a reader sees the old snapshot or the new one, never a
/// torn file, and the rename is durable before any preference is touched.
fn store(path: &Path, snapshot: &Snapshot) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("Missing snapshot directory"))?;
    std::fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(
        ".lockdown-snapshot-{}-{}.tmp",
        std::process::id(),
        now_ms()
    ));
    let bytes = serde_json::to_vec_pretty(snapshot).map_err(std::io::Error::other)?;
    let result = write_private(&temporary, &bytes)
        .and_then(|()| std::fs::rename(&temporary, path))
        .and_then(|()| std::fs::File::open(parent)?.sync_all());
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

/// Ok(None) when no snapshot exists. A snapshot that exists but cannot be
/// parsed is an Err: it may hold the only record of the user's settings.
fn load(path: &Path) -> std::io::Result<Option<Snapshot>> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(std::io::Error::other),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub(super) fn pending() -> bool {
    let Some(path) = snapshot_path() else {
        return true;
    };
    match std::fs::symlink_metadata(&path) {
        Ok(_) => true,
        Err(error) => error.kind() != std::io::ErrorKind::NotFound,
    }
}

/// The owner pid and creation time of the snapshot on disk, for the watchdog
/// to tell its own app's snapshot from one a relaunched instance wrote.
pub(super) fn snapshot_identity() -> Option<(u32, u64)> {
    let snapshot = snapshot_path().and_then(|path| load(&path).ok().flatten())?;
    Some((snapshot.owner_pid, snapshot.created_at_ms))
}

/// Whether the watchdog for (`owner`, `created_at_ms`) still has something to
/// guard: its snapshot is on disk and active. An unreadable snapshot is kept
/// under guard rather than abandoned.
pub(super) fn guards(owner: u32, created_at_ms: u64) -> bool {
    let Some(path) = snapshot_path() else {
        return false;
    };
    match load(&path) {
        Ok(Some(snapshot)) => {
            snapshot.active
                && snapshot.owner_pid == owner
                && snapshot.created_at_ms == created_at_ms
        }
        Ok(None) => false,
        Err(_) => true,
    }
}

/// Exclusive cross-process lock on the state directory, released on drop.
/// `None` when the lock file cannot be opened; callers then proceed under the
/// in-process mutex only, which is no worse than before.
fn lock_state() -> Option<std::fs::File> {
    extern "C" {
        fn flock(fd: i32, operation: i32) -> i32;
    }
    const LOCK_EX: i32 = 2;
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;
    let dir = state_dir()?;
    std::fs::create_dir_all(&dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(dir.join(".lockdown.lock"))
        .ok()?;
    // Blocks until the other process finishes its restore or engage.
    (unsafe { flock(file.as_raw_fd(), LOCK_EX) } == 0).then_some(file)
}

fn process_alive(pid: u32) -> bool {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    if unsafe { kill(pid as i32, 0) } == 0 {
        return true;
    }
    // EPERM: it exists but belongs to someone else.
    std::io::Error::last_os_error().raw_os_error() == Some(1)
}

/// The snapshot belongs to another live instance of this app — an exam in
/// progress, not a leftover. Restoring under it would unlock that exam.
pub(super) fn owner_alive_elsewhere() -> bool {
    let Some(snapshot) = snapshot_path().and_then(|path| load(&path).ok().flatten()) else {
        return false;
    };
    let owner = snapshot.owner_pid;
    if owner == std::process::id() || owner == 0 || !process_alive(owner) {
        return false;
    }
    let Some(ours) = std::env::current_exe().ok().and_then(|exe| {
        exe.file_name()
            .map(|name| name.to_string_lossy().into_owned())
    }) else {
        return false;
    };
    Command::new("/bin/ps")
        .args(["-p", &owner.to_string(), "-o", "comm="])
        .bounded_output()
        .map(|output| {
            let comm = String::from_utf8_lossy(&output.stdout).trim().to_string();
            comm.rsplit('/').next().unwrap_or(&comm) == ours
        })
        .unwrap_or(false)
}

// ── Login agent ──────────────────────────────────────────────────────────────

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Restores at the next login if the Mac restarts or loses power mid-exam,
/// even if the student never opens the app again. Best effort: the watchdog
/// and the on-launch recovery cover every other path.
fn install_login_agent() {
    let (Ok(exe), Some(path)) = (std::env::current_exe(), login_agent_path()) else {
        return;
    };
    let exe = exe.to_string_lossy().into_owned();
    // A translocated app runs from a random path that is gone after reboot.
    if exe.contains("/AppTranslocation/") {
        return;
    }
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LOGIN_AGENT_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{}</string>
		<string>{LOGIN_RESTORE_FLAG}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
"#,
        xml_escape(&exe)
    );
    // Rewriting an identical agent makes macOS announce a new background
    // item on every exam.
    if std::fs::read_to_string(&path).is_ok_and(|existing| existing == plist) {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, plist);
}

pub(super) fn remove_login_agent() {
    if let Some(path) = login_agent_path() {
        let _ = std::fs::remove_file(path);
    }
}

// ── Engage ───────────────────────────────────────────────────────────────────

fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

fn fix_command(pref: &SavedPref) -> String {
    let host = if pref.current_host {
        " -currentHost"
    } else {
        ""
    };
    let domain = shell_quote(&pref.domain);
    let key = shell_quote(&pref.key);
    let restore = match &pref.original {
        None => format!("defaults{host} delete {domain} {key}"),
        Some(Value::Integer(value)) => format!("defaults{host} write {domain} {key} -int {value}"),
        Some(Value::Boolean(value)) => format!("defaults{host} write {domain} {key} -bool {value}"),
        Some(Value::Float(value)) => format!("defaults{host} write {domain} {key} -float {value}"),
        Some(Value::String(value)) => format!(
            "defaults{host} write {domain} {key} -string {}",
            shell_quote(value)
        ),
    };
    format!("{restore}; killall cfprefsd; killall Dock")
}

pub(super) fn engage(
    config: &LockdownConfig,
    caffeinate_pid: Option<u32>,
) -> Result<Vec<String>, String> {
    // Another running instance owns the snapshot: that is an exam in
    // progress, and restoring it would unlock that exam.
    if owner_alive_elsewhere() {
        return Err("Another AMS Access window is already running an exam".into());
    }
    if pending() {
        if let RestoreOutcome::Failed(items) = restore() {
            return Err(format!(
                "Previous desktop settings still need restoration: {}",
                items.join(", ")
            ));
        }
    }
    let _guard = RESTORE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let _state = lock_state();
    let path = snapshot_path().ok_or("Desktop recovery directory is unavailable")?;
    // Re-checked under the locks: another process may have written one.
    if pending() {
        return Err("Previous desktop settings still need restoration".into());
    }

    let (changes, reload) = plan(config);
    let mut prefs: Vec<SavedPref> = Vec::new();
    let mut skipped = Vec::new();
    let mut planned: Vec<&Change> = Vec::new();
    for item in &changes {
        // Each key is snapshotted once, even when two groups touch it.
        if prefs.iter().any(|pref| {
            pref.domain == item.domain
                && pref.key == item.key
                && pref.current_host == item.current_host
        }) {
            continue;
        }
        match read_value(item.domain, item.key, item.current_host) {
            Ok(original) => {
                prefs.push(SavedPref {
                    domain: item.domain.to_string(),
                    key: item.key.to_string(),
                    current_host: item.current_host,
                    label: item.label.to_string(),
                    original,
                });
                planned.push(item);
            }
            // No faithful original, so this key is never touched.
            Err(_) => skipped.push(item.label.to_string()),
        }
    }

    let snapshot = Snapshot {
        version: 1,
        active: true,
        owner_pid: std::process::id(),
        created_at_ms: now_ms(),
        prefs,
        reload,
        caffeinate_pid,
        unrestored: Vec::new(),
    };
    // Nothing has changed yet: a failure here leaves the desktop untouched.
    store(&path, &snapshot)
        .map_err(|error| format!("Could not preserve original desktop settings: {error}"))?;
    install_login_agent();

    let mut unapplied = skipped;
    for item in &planned {
        if !write_value(item.domain, item.key, item.current_host, &item.value) {
            unapplied.push(item.label.to_string());
        }
    }
    reload_services(&snapshot.reload, true);
    for item in &planned {
        if !value_matches(item.domain, item.key, item.current_host, Some(&item.value))
            && !unapplied.iter().any(|label| label == item.label)
        {
            unapplied.push(item.label.to_string());
        }
    }
    unapplied.dedup();
    Ok(unapplied)
}

// ── Restore ──────────────────────────────────────────────────────────────────

static RESTORE_LOCK: Mutex<()> = Mutex::new(());

fn restore_one(pref: &SavedPref) -> bool {
    match &pref.original {
        Some(value) => write_value(&pref.domain, &pref.key, pref.current_host, value),
        None => delete_value(&pref.domain, &pref.key, pref.current_host),
    }
}

fn verify_one(pref: &SavedPref) -> bool {
    value_matches(
        &pref.domain,
        &pref.key,
        pref.current_host,
        pref.original.as_ref(),
    )
}

pub(super) fn restore() -> RestoreOutcome {
    restore_guarded(Guard::Any)
}

/// For background retries: re-checked after taking the locks, because a new
/// lockdown may publish its snapshot while a retry waits for them.
pub(super) fn restore_unless_lockdown_active() -> RestoreOutcome {
    restore_guarded(Guard::UnlessLockdownActive)
}

/// For the watchdog: a relaunched app may already have written its own
/// snapshot, which this watchdog's dead parent never owned.
pub(super) fn restore_owned_by(pid: u32, created_at_ms: u64) -> RestoreOutcome {
    restore_guarded(Guard::OwnedBy { pid, created_at_ms })
}

fn restore_guarded(guard: Guard) -> RestoreOutcome {
    let _guard = RESTORE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // The app, its watchdog, the login agent and a relaunched instance are
    // separate processes; the in-process mutex alone cannot order them.
    let _state = lock_state();
    if matches!(guard, Guard::UnlessLockdownActive) && super::lockdown_active() {
        return RestoreOutcome::Deferred;
    }
    let _budget = crate::process_runner::Budget::new(Duration::from_secs(30));
    let Some(path) = snapshot_path() else {
        return RestoreOutcome::Failed(vec!["Desktop recovery directory is unavailable".into()]);
    };
    let mut snapshot = match load(&path) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            remove_login_agent();
            return RestoreOutcome::NothingToRestore;
        }
        Err(error) => {
            return RestoreOutcome::Failed(vec![format!("Lockdown snapshot unreadable: {error}")])
        }
    };
    if let Guard::OwnedBy { pid, created_at_ms } = guard {
        if snapshot.owner_pid != pid || snapshot.created_at_ms != created_at_ms {
            return RestoreOutcome::Deferred;
        }
    }
    // Write everything back first (newest change first), then reload once,
    // then verify against what the restarted services actually read.
    for pref in snapshot.prefs.iter().rev() {
        let _ = restore_one(pref);
    }
    reload_services(&snapshot.reload, false);
    let mut failed: Vec<&SavedPref> = snapshot
        .prefs
        .iter()
        .filter(|pref| !verify_one(pref))
        .collect();
    // One more pass for anything a racing writer (or the Dock restart) undid.
    if !failed.is_empty() {
        for pref in &failed {
            let _ = restore_one(pref);
        }
        reload_services(&snapshot.reload, false);
        failed.retain(|pref| !verify_one(pref));
    }

    if failed.is_empty() {
        if let Some(pid) = snapshot.caffeinate_pid {
            super::kill_if_caffeinate(pid);
        }
        let _ = std::fs::remove_file(&path);
        remove_login_agent();
        return RestoreOutcome::Restored;
    }

    let mut labels: Vec<String> = Vec::new();
    snapshot.unrestored = failed
        .iter()
        .map(|pref| {
            if !labels.contains(&pref.label) {
                labels.push(pref.label.clone());
            }
            UnrestoredSetting {
                label: format!("{} ({} {})", pref.label, pref.domain, pref.key).replace(" )", ")"),
                fix_command: fix_command(pref),
            }
        })
        .collect();
    let _ = store(&path, &snapshot);
    RestoreOutcome::Failed(labels)
}

pub fn restore_status() -> RestoreStatus {
    let items = snapshot_path()
        .and_then(|path| load(&path).ok().flatten())
        .map(|snapshot| snapshot.unrestored)
        .unwrap_or_default();
    RestoreStatus {
        pending: pending(),
        items,
    }
}

static RETRYING: AtomicBool = AtomicBool::new(false);

/// Keep retrying a failed restore in the background until it verifies.
pub(super) fn ensure_retry() {
    if RETRYING.swap(true, Ordering::SeqCst) {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("ams-lockdown-restore-retry".into())
        .spawn(|| {
            loop {
                std::thread::sleep(Duration::from_secs(10));
                // A live lockdown owns the snapshot; never restore under it.
                // Checked again under the locks inside the call.
                match restore_unless_lockdown_active() {
                    RestoreOutcome::Restored => {
                        super::emit_lockdown_notice(
                            "lockdown_restore_completed",
                            "All desktop settings changed for the exam have been restored",
                        );
                        break;
                    }
                    RestoreOutcome::NothingToRestore => break,
                    RestoreOutcome::Deferred => {}
                    RestoreOutcome::Failed(items) => super::emit_lockdown_notice(
                        "lockdown_restore_pending",
                        &format!("Still restoring desktop settings: {}", items.join(", ")),
                    ),
                }
            }
            RETRYING.store(false, Ordering::SeqCst);
        });
    if spawned.is_err() {
        RETRYING.store(false, Ordering::SeqCst);
    }
}
