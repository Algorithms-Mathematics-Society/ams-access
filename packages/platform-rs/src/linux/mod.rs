pub mod instance;
mod settings;

use crate::process_runner::{Budget, CommandDeadlineExt};
use core_rs::exam::{CloseAppsResult, KeyboardInterceptResult, ProcessScanResult};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

mod kde;
mod kde_live;

static SHIELD_ACTIVE: AtomicBool = AtomicBool::new(false);
static SHIELD_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn battery_status() -> Option<crate::BatteryStatus> {
    let supplies = std::fs::read_dir("/sys/class/power_supply").ok()?;
    for entry in supplies.flatten() {
        let path = entry.path();
        if std::fs::read_to_string(path.join("type")).ok()?.trim() != "Battery" {
            continue;
        }
        let percentage = std::fs::read_to_string(path.join("capacity"))
            .ok()?
            .trim()
            .parse::<u8>()
            .ok()?
            .min(100);
        let state = std::fs::read_to_string(path.join("status")).unwrap_or_default();
        return Some(crate::BatteryStatus {
            percentage,
            charging: matches!(state.trim(), "Charging" | "Full"),
            plugged_in: match state.trim() {
                "Charging" | "Full" | "Not charging" => Some(true),
                "Discharging" => Some(false),
                _ => None,
            },
        });
    }
    None
}

fn shield_generation_active(generation: u64) -> bool {
    SHIELD_ACTIVE.load(Ordering::SeqCst) && SHIELD_GENERATION.load(Ordering::SeqCst) == generation
}

const RESTRICTED: &[&str] = &[
    "obs",
    "obs-studio",
    "obs64",
    "teamviewer",
    "teamviewerd",
    "anydesk",
    "vnc",
    "vncviewer",
    "x11vnc",
    "tigervnc",
    "xrdp",
    "rustdesk",
    "cheat",
    "cheatengine",
    "wireshark",
    "tcpdump",
    "strace",
    "gdb",
    "lldb",
    // `xdotool` is deliberately NOT restricted. This app spawns it itself —
    // five call sites, every 250ms from the workspace watchdog and every 500ms
    // from the focus watchdog — and `spawn_kill_shield` matches on the exe
    // basename, so listing it here meant the lockdown SIGKILLed its own
    // watchdog mid-probe. It then surfaced as "blocked application detected:
    // xdotool" in the candidate's contest room, flipped proctoring red, and
    // filed an incident against a candidate who had done nothing.
    //
    // It is a 40KB input-synthesis utility, not a cheating vector: anything it
    // could do, the restricted screen-sharing and remote-desktop entries above
    // already cover.
    "scrcpy",
    // Zoom is deliberately absent.
    //
    // It leaves helper processes that start and stop on their own, so a
    // candidate who never opened Zoom produced a started/resolved pair every
    // few seconds. One sitting filled the staff help queue with 200 of them,
    // which is how a queue stops being read and a real request gets missed.
    // Zoom *screen sharing* is the thing worth catching and is still caught
    // separately (`CptHost` in macos/remote_access.rs), because that one
    // means somebody else can see the paper.
    "skype",
    "teams",
    "chrome-remote-desktop",
    // Screen recorders (common on Linux; argv[0] basename match)
    "simplescreenrecorder",
    "recordmydesktop",
    "wf-recorder",
    "kooha",
    "gpu-screen-recorder",
    "vokoscreen",
    "vokoscreenng",
    "kazam",
    "peek",
    "byzanz",
    "byzanz-record",
    // NOTE: `ffmpeg` is intentionally NOT listed — it is spawned as a decode
    // worker by browsers/Electron/the Tauri webview itself, so a basename match
    // would kill the exam UI. Detecting recording specifically needs cmdline
    // arg inspection (`-f x11grab`/`v4l2`/`kmsgrab`), a separate follow-up.
    // Remote-access / screen-sharing
    "nomachine",
    "parsec",
    "parsecd",
    "dwagent",
    "dwservice",
    "krfb",
    "gnome-remote-desktop",
    "vino-server",
    "remmina",
    "barrier",
    "synergy",
    "synergyc",
    "synergys",
    "deskreen",
];

/// Chat apps: reported at readiness, never a reason to turn someone away.
/// They keep a tray process alive after their window closes, so "I closed
/// it" and "the scan still sees it" are both true at once.
const ADVISORY: &[&str] = &[
    "discord",
    "telegram-desktop",
    "telegram",
    "signal-desktop",
    "slack",
    "element-desktop",
    "whatsapp-for-linux",
];

/// Lowercase basename of a path-like string (after the last '/').
fn lower_basename(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_lowercase()
}

/// Collect the identifying basenames for a pid: argv[0] from `/proc/<pid>/cmdline`
/// AND the real executable from `readlink /proc/<pid>/exe`. The `/proc/exe` link
/// is the kernel's record of the actual binary, which argv[0] spoofing cannot
/// forge, so checking both catches a process that lies in its cmdline. NOTE:
/// renaming the binary on disk evades both basenames — blocklists are advisory;
/// this is defense-in-depth, not a guarantee. `/proc/<pid>/exe` is only readable
/// for same-user (or root) processes; an unreadable link is skipped.
fn proc_identity_names(pid: u32) -> Vec<String> {
    let mut names: Vec<String> = Vec::with_capacity(2);
    let mut path = std::path::PathBuf::from(format!("/proc/{pid}/cmdline"));
    if let Ok(raw) = std::fs::read(&path) {
        if !raw.is_empty() {
            let argv0 = raw.split(|&b| b == 0).next().unwrap_or(&[]);
            let b = lower_basename(&String::from_utf8_lossy(argv0));
            if !b.is_empty() {
                names.push(b);
            }
        }
    }
    path.set_file_name("exe");
    if let Ok(target) = std::fs::read_link(&path) {
        // readlink appends the suffix only when a running binary was replaced.
        let target = target.to_string_lossy();
        let b = lower_basename(target.strip_suffix(" (deleted)").unwrap_or(&target));
        if !b.is_empty() && !names.contains(&b) {
            names.push(b);
        }
    }
    names
}

/// Return the first RESTRICTED entry that exactly matches any of `names`
/// (each already a lowercase basename). Pure — unit tested.
fn match_restricted(names: &[String]) -> Option<&'static str> {
    RESTRICTED
        .iter()
        .copied()
        .find(|&r| names.iter().any(|n| n == r))
}

/// Return the first ADVISORY entry that exactly matches any of `names`.
fn match_advisory(names: &[String]) -> Option<&'static str> {
    ADVISORY
        .iter()
        .copied()
        .find(|&a| names.iter().any(|n| n == a))
}

/// Scan /proc for running restricted processes.
pub fn scan_processes() -> ProcessScanResult {
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let mut found: Vec<String> = Vec::new();
    let mut advisory: Vec<String> = Vec::new();

    let proc_dir = match std::fs::read_dir("/proc") {
        Ok(entries) => entries,
        Err(error) => {
            crate::process_runner::record_failure(format!("Cannot enumerate processes: {error}"));
            return ProcessScanResult {
                found,
                clean: false,
                advisory: Vec::new(),
            };
        }
    };

    for entry in proc_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                crate::process_runner::record_failure(format!(
                    "Cannot enumerate a process entry: {error}"
                ));
                continue;
            }
        };
        if _budget.expired() {
            break;
        }
        let name = entry.file_name();
        let Some(pid) = name.to_str().and_then(|name| name.parse::<u32>().ok()) else {
            continue;
        };
        let names = proc_identity_names(pid);
        if let Some(r) = match_restricted(&names) {
            if !found.iter().any(|f| f == r) {
                found.push(r.to_string());
            }
        }
        // Deduplicated: one entry per app, however many processes it runs.
        if let Some(a) = match_advisory(&names) {
            if !advisory.iter().any(|f| f == a) {
                advisory.push(a.to_string());
            }
        }
    }

    // `advisory` deliberately does not affect `clean`.
    let clean = found.is_empty() && _budget.failure().is_none();
    ProcessScanResult {
        found,
        clean,
        advisory,
    }
}

/// Detect display server (X11 / Wayland).
pub fn detect_display_server() -> String {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        if let Ok(xdg) = std::env::var("XDG_SESSION_DESKTOP") {
            return format!("wayland/{}", xdg.to_lowercase());
        }
        return "wayland".to_string();
    }
    if std::env::var("DISPLAY").is_ok() {
        return "x11".to_string();
    }
    "unknown".to_string()
}

// ── GSettings keybinding inhibit ─────────────────────────────────────────────

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static SAVED_BINDINGS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn saved() -> &'static Mutex<HashMap<String, String>> {
    SAVED_BINDINGS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Where the pre-exam desktop settings are stored while the lockdown is up.
///
/// **Not `/tmp`.** It used to be, and that made a reboot destroy the only copy
/// of the candidate's own settings: `/usr/lib/tmpfiles.d/tmp.conf` carries
/// `D /tmp ...`, and systemd-tmpfiles runs with `--remove --boot`, so `/tmp`
/// is emptied at every boot. The values being held are dconf/kwriteconfig
/// settings, which are *permanent*.
///
/// That combination had a specific, ugly failure: the app is killed mid-exam
/// (SIGKILL, OOM, a WebKitGTK fault — none of which run our teardown), the
/// candidate reboots to recover, and the backup is gone. Super, Alt+Tab,
/// Alt+F4, screenshot and the touchpad stay disabled *permanently*, with no
/// in-app recovery left. On a laptop with no external mouse that is an
/// unusable machine, caused by exam software, after the exam has finished.
///
/// `$XDG_STATE_HOME` is the correct home for this: it is exactly "state that
/// should persist between restarts but is not config", and it shares dconf's
/// lifetime, which is the thing being restored.
fn backup_path() -> std::path::PathBuf {
    let base = std::env::var_os("XDG_STATE_HOME")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .map(|home| home.join(".local/state"))
        })
        // No HOME at all: fall back to the old location rather than losing the
        // backup entirely. Worse than XDG, far better than nothing.
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));
    base.join("ams-access")
}

/// The pre-2.0.9 location. Read once so an upgrade mid-lockdown can still
/// recover; never written.
const LEGACY_BACKUP_PATH: &str = "/tmp/ams_access_kb_backup";

fn backup_file() -> std::path::PathBuf {
    backup_path().join("kb-backup")
}

fn write_backup(map: &HashMap<String, String>) -> bool {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    let Ok(content) = serde_json::to_string(map) else {
        return false;
    };
    let dir = backup_path();
    let result = (|| -> std::io::Result<()> {
        if let Some(parent) = dir.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Upgrade an existing app-owned directory without following symlinks.
        if dir.exists() {
            let handle = std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(TOKEN_OPEN_FLAGS | 0x10000)
                .open(&dir)?;
            if handle.metadata()?.uid() != own_uid()? {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "backup directory owner mismatch",
                ));
            }
            handle.set_permissions(std::fs::Permissions::from_mode(0o700))?;
        }
        store_private_file_at(&backup_file(), &content)
    })();
    if let Err(e) = result {
        eprintln!("[ams][kb] cannot persist recovery backup: {e}; not applying new settings");
        false
    } else {
        true
    }
}

fn decode_backup(content: &str) -> Result<HashMap<String, String>, String> {
    if content.trim_start().starts_with('{') {
        return serde_json::from_str(content).map_err(|error| error.to_string());
    }
    let mut map = HashMap::new();
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let (key, value) = line.split_once('\t').ok_or("Malformed recovery journal")?;
        if key.is_empty() {
            return Err("Empty recovery key".into());
        }
        map.insert(key.to_owned(), value.to_owned());
    }
    Ok(map)
}

fn read_backup_file(path: &std::path::Path) -> Result<Option<HashMap<String, String>>, String> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    let file = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(TOKEN_OPEN_FLAGS)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file()
        || metadata.uid() != own_uid().map_err(|e| e.to_string())?
        || metadata.len() > 1_048_576
    {
        return Err("Invalid recovery journal ownership, type or size".into());
    }
    let mut content = String::new();
    file.take(1_048_577)
        .read_to_string(&mut content)
        .map_err(|e| e.to_string())?;
    if content.len() > 1_048_576 {
        return Err("Recovery journal too large".into());
    }
    decode_backup(&content).map(Some)
}

fn owned_regular_file(path: &std::path::Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    path.symlink_metadata().ok().is_some_and(|metadata| {
        metadata.file_type().is_file() && own_uid().ok() == Some(metadata.uid())
    })
}

fn read_legacy_backup_file(
    path: &std::path::Path,
) -> Result<Option<HashMap<String, String>>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) if owned_regular_file(path) => read_backup_file(path),
        Ok(_) => Ok(None),
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                || error.kind() == std::io::ErrorKind::PermissionDenied =>
        {
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn read_backup() -> Result<Option<HashMap<String, String>>, String> {
    let mut combined =
        read_legacy_backup_file(std::path::Path::new(LEGACY_BACKUP_PATH))?.unwrap_or_default();
    if let Some(current) = read_backup_file(&backup_file())? {
        combined.extend(current);
    }
    Ok((!combined.is_empty()).then_some(combined))
}

fn delete_backup() {
    let _ = std::fs::remove_file(backup_file());
    // The legacy copy too, or a stale /tmp file would be restored on a later
    // run and silently undo settings the candidate has since changed. Never
    // touch another user's file in the shared directory.
    let legacy = std::path::Path::new(LEGACY_BACKUP_PATH);
    if owned_regular_file(legacy) {
        let _ = std::fs::remove_file(legacy);
    }
}

/// Retry saved restoration on startup. Failed keys remain recoverable.
pub fn recover_keyboard_if_crashed() {
    disable_keyboard_intercept();
}

/// Dock/panel settings to hide during exam. Schema may not exist (silently ignored).
const GNOME_DOCK_SETTINGS: &[(&str, &str, &str)] = &[
    // dash-to-dock (common extension on Arch/Ubuntu)
    (
        "org.gnome.shell.extensions.dash-to-dock",
        "dock-fixed",
        "false",
    ),
    (
        "org.gnome.shell.extensions.dash-to-dock",
        "autohide",
        "true",
    ),
    (
        "org.gnome.shell.extensions.dash-to-dock",
        "intellihide",
        "false",
    ),
    // dash-to-panel (alternative panel extension)
    (
        "org.gnome.shell.extensions.dash-to-panel",
        "panel-position",
        "'TOP'",
    ),
    // Ubuntu dock (ubuntu-dock extension)
    (
        "org.gnome.shell.extensions.ubuntu-dock",
        "dock-fixed",
        "false",
    ),
    ("org.gnome.shell.extensions.ubuntu-dock", "autohide", "true"),
    (
        "org.gnome.shell.extensions.ubuntu-dock",
        "intellihide",
        "false",
    ),
];

/// (schema, key, disable_value)
/// String keys: disable with ''. Array keys: disable with @as [].
const GNOME_SHORTCUTS: &[(&str, &str, &str)] = &[
    // One workspace, so a three-finger swipe has nowhere to go.
    //
    // This replaces disabling the touchpad outright. Gestures are not bound
    // to a keybinding, so emptying `switch-to-workspace-*` below does not
    // reach them, and the workspace watchdog is X11-only -- on the Wayland
    // session that modern GNOME defaults to it logs and returns. Killing the
    // touchpad was the only thing left, and it took the pointer with it: a
    // laptop candidate with no mouse could not click Run, change question or
    // submit, which is not a lockdown, it is an exclusion.
    //
    // Restored from the saved value by the same machinery as every other key
    // here, including after a crash.
    ("org.gnome.mutter", "dynamic-workspaces", "false"),
    ("org.gnome.desktop.wm.preferences", "num-workspaces", "1"),
    // Super key overlay — NOTE: schema is org.gnome.mutter, NOT org.gnome.mutter.keybindings
    ("org.gnome.mutter", "overlay-key", "''"),
    // Activities / app grid
    ("org.gnome.shell.keybindings", "toggle-overview", "@as []"),
    (
        "org.gnome.shell.keybindings",
        "toggle-application-view",
        "@as []",
    ),
    // Window switching
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-windows",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-applications",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-windows-backward",
        "@as []",
    ),
    // Workspace switching
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-left",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-right",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-1",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-2",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-3",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-4",
        "@as []",
    ),
    // Close / minimize / show-desktop
    ("org.gnome.desktop.wm.keybindings", "close", "@as []"),
    ("org.gnome.desktop.wm.keybindings", "minimize", "@as []"),
    ("org.gnome.desktop.wm.keybindings", "show-desktop", "@as []"),
    (
        "org.gnome.desktop.wm.keybindings",
        "panel-run-dialog",
        "@as []",
    ),
    // Screenshot / screen recording
    ("org.gnome.shell.keybindings", "screenshot", "@as []"),
    ("org.gnome.shell.keybindings", "screenshot-window", "@as []"),
    (
        "org.gnome.shell.keybindings",
        "show-screen-recording-ui",
        "@as []",
    ),
    // Wayland restore-shortcuts inhibit
    (
        "org.gnome.mutter.wayland.keybindings",
        "restore-shortcuts",
        "@as []",
    ),
    // Hot corner: a mouse flick to the top-left opens the Activities overview
    // (a desktop-switch surface) and is NOT a keybinding, so it must be turned
    // off separately. Boolean key — disable value is `false`.
    ("org.gnome.desktop.interface", "enable-hot-corners", "false"),
    // Version-dependent families: discover schema/key and writability first.
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-applications-backward",
        "@as []",
    ),
    ("org.gnome.desktop.wm.keybindings", "switch-group", "@as []"),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-group-backward",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-panels",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-panels-backward",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "cycle-windows",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "cycle-windows-backward",
        "@as []",
    ),
    ("org.gnome.desktop.wm.keybindings", "cycle-group", "@as []"),
    (
        "org.gnome.desktop.wm.keybindings",
        "cycle-group-backward",
        "@as []",
    ),
    ("org.gnome.desktop.wm.keybindings", "cycle-panels", "@as []"),
    (
        "org.gnome.desktop.wm.keybindings",
        "cycle-panels-backward",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-up",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-down",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-last",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-5",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-6",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-7",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-8",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-9",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-10",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-11",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "switch-to-workspace-12",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-left",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-right",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-up",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-down",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-last",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-1",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-2",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-3",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-4",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-5",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-6",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-7",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-8",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-9",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-10",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-11",
        "@as []",
    ),
    (
        "org.gnome.desktop.wm.keybindings",
        "move-to-workspace-12",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "show-screenshot-ui",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "toggle-message-tray",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "toggle-quick-settings",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-1",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-2",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-3",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-4",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-5",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-6",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-7",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-8",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "switch-to-application-9",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-1",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-2",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-3",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-4",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-5",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-6",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-7",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-8",
        "@as []",
    ),
    (
        "org.gnome.shell.keybindings",
        "open-new-window-application-9",
        "@as []",
    ),
];

const KDE_SHORTCUTS: &[(&str, &str, &str)] = &[
    // Group, Key, Disable Value
    ("kwin", "Walk Through Windows", "none"),
    ("kwin", "Walk Through Windows (Reverse)", "none"),
    ("kwin", "Walk Through Windows Alternative", "none"),
    ("kwin", "Walk Through Windows Alternative (Reverse)", "none"),
    ("kwin", "ShowDesktopGrid", "none"),
    ("kwin", "Expose", "none"),
    ("kwin", "ExposeAll", "none"),
    ("kwin", "ExposeClass", "none"),
    ("kwin", "Overview", "none"),
    // Virtual-desktop switching (the actual desktop-switch vectors — previously
    // unblocked on KDE).
    ("kwin", "Switch to Next Desktop", "none"),
    ("kwin", "Switch to Previous Desktop", "none"),
    ("kwin", "Switch One Desktop to the Left", "none"),
    ("kwin", "Switch One Desktop to the Right", "none"),
    ("kwin", "Switch One Desktop Up", "none"),
    ("kwin", "Switch One Desktop Down", "none"),
    ("org.kde.plasmashell", "manage activities", "none"),
    ("org.kde.plasmashell", "next activity", "none"),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum KdeControlFamily {
    WindowSwitch,
    Overview,
    DesktopSwitch,
    Activity,
}

fn kde_control_family(component: &str, action: &str) -> KdeControlFamily {
    if component == "org.kde.plasmashell" {
        KdeControlFamily::Activity
    } else if action.starts_with("Walk Through Windows") {
        KdeControlFamily::WindowSwitch
    } else if action.starts_with("Switch ") {
        KdeControlFamily::DesktopSwitch
    } else {
        KdeControlFamily::Overview
    }
}

fn settings_command(program: &str, args: &[&str]) -> Option<String> {
    if program == "ams-gsettings-user-value" {
        use gio::prelude::SettingsExt;
        let [schema_id, key] = args else {
            return None;
        };
        let source = gio::SettingsSchemaSource::default()?;
        let schema = source.lookup(schema_id, true)?;
        if !schema.has_key(key) || schema.path().is_none() {
            return None;
        }
        let settings = gio::Settings::new_full(&schema, None::<&gio::SettingsBackend>, None);
        // Unlike `dconf read`, this excludes system/default database values.
        // Local backend reads are not subprocesses and cannot be hard-cancelled.
        return Some(
            settings
                .user_value(key)
                .map(|v| v.print(true).to_string())
                .unwrap_or_default(),
        );
    }
    crate::process_runner::optional(|| {
        let output = std::process::Command::new(program)
            .args(args)
            .bounded_output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    })
}

/// GSettings prints an explicit array type for an empty string array; avoid
/// stripping quotes/whitespace inside actual values during readback comparison.
fn normalize_gvariant(value: &str) -> &str {
    let value = value.trim();
    if value == "@as []" {
        "[]"
    } else {
        value
    }
}

fn intercept_outcome(applied: usize, total: usize, method: &str) -> KeyboardInterceptResult {
    KeyboardInterceptResult {
        // Preserve the existing advisory policy for unsupported schema keys,
        // while no longer reporting success when every attempted write failed.
        active: applied > 0,
        method: if method == "unsupported" {
            method.to_string()
        } else {
            format!("{method} ({applied}/{total} applied)")
        },
        platform: "linux".to_string(),
    }
}

fn kconfig_set(file: &str, group: &str, key: &str, value: &str) -> bool {
    kde::config_set(file, group, key, value)
}

/// Capture AND persist each original value before applying a change. Existing
/// saved values win on retries; a read/write failure must not erase recovery.
fn backup_before_apply(
    saved: &mut HashMap<String, String>,
    key: &str,
    read: impl FnOnce() -> Option<String>,
    apply: impl FnOnce(&str) -> bool,
    persist: impl FnOnce(&HashMap<String, String>) -> bool,
) -> bool {
    if !saved.contains_key(key) {
        let Some(original) = read() else {
            return false;
        };
        saved.insert(key.to_string(), original);
    }
    persist(saved) && apply(&saved[key])
}

/// Whether a successful setting change contributes to keyboard interception.
fn is_gnome_keyboard_control(schema: &str, key: &str) -> bool {
    // Workspace count, dock layout and hot corners can change without any
    // shortcut being intercepted. Only binding schemas and Mutter's overlay
    // key establish keyboard coverage.
    matches!(
        schema,
        "org.gnome.desktop.wm.keybindings"
            | "org.gnome.shell.keybindings"
            | "org.gnome.mutter.wayland.keybindings"
    ) || (schema == "org.gnome.mutter" && key == "overlay-key")
}

fn apply_kde_meta_with(
    original: &str,
    mut read: impl FnMut() -> Option<String>,
    mut write: impl FnMut(&str) -> bool,
) -> bool {
    let Some(current) = read() else { return false };
    current.is_empty() || (current == original && write(""))
}

fn restore_kde_meta_with(
    original: &str,
    mut read: impl FnMut() -> Option<String>,
    mut write: impl FnMut(&str) -> bool,
) -> bool {
    let Some(current) = read() else { return false };
    current == original || (current.is_empty() && write(original))
}

fn gnome_intercept_outcome(
    applied: usize,
    total: usize,
    method: &str,
    shortcuts_applied: usize,
    budget: &Budget,
) -> KeyboardInterceptResult {
    let incomplete = budget.expired() || budget.failure().is_some();
    let mut result = intercept_outcome(applied, total, method);
    result.active = shortcuts_applied > 0 && !incomplete;
    result
}

/// Disable supported compositor shortcuts and report observed coverage.
fn enable_keyboard_intercept_inner() -> KeyboardInterceptResult {
    let budget = Budget::new(std::time::Duration::from_secs(8));
    let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("XDG_SESSION_DESKTOP"))
        .or_else(|_| std::env::var("GDMSESSION"))
        .unwrap_or_default()
        .to_lowercase();
    let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
    // Retain failed startup recovery values before recording anything new.
    match read_backup() {
        Ok(Some(backup)) => {
            for (key, value) in backup {
                saved.entry(key).or_insert(value);
            }
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("[ams][kb] recovery journal cannot be read: {error}");
            return intercept_outcome(0, 0, "recovery-required");
        }
    }
    let mut applied = 0;
    if desktop.contains("cinnamon") {
        return intercept_outcome(0, 0, "unsupported");
    }
    if desktop.contains("gnome") || desktop.contains("ubuntu") {
        let mut shortcuts_applied = 0;
        let mut settings = settings::Settings::new(settings_command);
        for &(schema, key, value) in GNOME_SHORTCUTS.iter().chain(GNOME_DOCK_SETTINGS.iter()) {
            if budget.expired() {
                break;
            }
            let entry = format!("gnome/{schema}/{key}");
            let original = if saved.contains_key(&entry) {
                None
            } else {
                settings.snapshot(schema, key, value)
            };
            if backup_before_apply(
                &mut saved,
                &entry,
                || original,
                |snapshot| settings.apply(schema, key, snapshot),
                write_backup,
            ) {
                applied += 1;
                if is_gnome_keyboard_control(schema, key) {
                    shortcuts_applied += 1;
                }
            }
        }
        return gnome_intercept_outcome(
            applied,
            GNOME_SHORTCUTS.len() + GNOME_DOCK_SETTINGS.len(),
            if is_wayland {
                "gsettings/wayland"
            } else {
                "gsettings/x11"
            },
            shortcuts_applied,
            &budget,
        );
    }
    if desktop.contains("kde") || desktop.contains("plasma") {
        let Some(mut adapter) = kde_live::Adapter::discover() else {
            return intercept_outcome(0, KDE_SHORTCUTS.len(), "unsupported");
        };
        let mut available = 0;
        let mut family_available = [false; 4];
        let mut family_applied = [false; 4];
        for &(component, action, _) in KDE_SHORTCUTS {
            if budget.expired() {
                break;
            }
            let key = format!("kde_live/{component}/{action}");
            let plan = if saved.contains_key(&key) {
                saved
                    .get(&key)
                    .and_then(|value| serde_json::from_str(value).ok())
            } else {
                adapter.plan(component, action)
            };
            let Some(plan) = plan else { continue };
            available += 1;
            let family = kde_control_family(component, action) as usize;
            family_available[family] = true;
            let original = (!saved.contains_key(&key))
                .then(|| serde_json::to_string(&plan).ok())
                .flatten();
            if backup_before_apply(
                &mut saved,
                &key,
                || original,
                |snapshot| {
                    serde_json::from_str::<kde_live::Plan>(snapshot)
                        .ok()
                        .is_some_and(|plan| adapter.apply(&plan))
                },
                write_backup,
            ) {
                applied += 1;
                family_applied[family] = true;
            }
        }

        let meta_original = (!saved.contains_key("kde_meta"))
            .then(|| kde::config_get("kwinrc", "ModifierOnlyShortcuts", "Meta"))
            .flatten();
        let meta_applied = backup_before_apply(
            &mut saved,
            "kde_meta",
            || meta_original,
            |original| {
                apply_kde_meta_with(
                    original,
                    || kde::config_get("kwinrc", "ModifierOnlyShortcuts", "Meta"),
                    |value| kconfig_set("kwinrc", "ModifierOnlyShortcuts", "Meta", value),
                )
            },
            write_backup,
        ) && kde::reconfigure_kwin();
        let required_covered = kde_required_coverage(&family_available, &family_applied);
        return KeyboardInterceptResult {
            active: meta_applied && applied == available && required_covered,
            method: format!(
                "kde/kglobalaccel-live ({applied}/{available} discovered applied; meta {})",
                if meta_applied {
                    "applied"
                } else {
                    "unverified"
                }
            ),
            platform: "linux".into(),
        };
    }

    intercept_outcome(0, 0, "unsupported")
}

fn kde_required_coverage(available: &[bool; 4], applied: &[bool; 4]) -> bool {
    [
        KdeControlFamily::WindowSwitch,
        KdeControlFamily::Overview,
        KdeControlFamily::DesktopSwitch,
    ]
    .iter()
    .all(|family| {
        let i = *family as usize;
        available[i] && applied[i]
    })
}

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    crate::process_runner::optional(enable_keyboard_intercept_inner)
}

// ── Process kill shield ───────────────────────────────────────────────────────

/// Returns (process_name, pid) pairs for every restricted process found in /proc.
fn scan_restricted_pids() -> Vec<(String, u32)> {
    let budget = Budget::new(std::time::Duration::from_secs(2));
    let mut result = Vec::new();
    let Ok(proc_dir) = std::fs::read_dir("/proc") else {
        return result;
    };
    for entry in proc_dir.flatten() {
        if budget.expired() {
            break;
        }
        let fname = entry.file_name();
        let Some(pid) = fname.to_str().and_then(|name| name.parse::<u32>().ok()) else {
            continue;
        };
        if let Some(r) = match_restricted(&proc_identity_names(pid)) {
            result.push((r.to_string(), pid));
        }
    }
    result
}

/// Spawn a background thread that kills restricted processes by PID every second.
fn spawn_kill_shield(generation: u64) {
    let our_pid = std::process::id();
    std::thread::Builder::new()
        .name("ams-kill-shield".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if !shield_generation_active(generation) {
                break;
            }
            for (_, pid) in scan_restricted_pids() {
                if pid == our_pid || !shield_generation_active(generation) {
                    continue;
                }
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .bounded_output();
            }
        })
        .ok();
}

// ── Workspace watchdog (X11 only) ─────────────────────────────────────────────
//
// Pointer input is preserved. Wayland does not expose global window state to
// these X11 tools; compositor gestures remain a separate verification gap.
// On X11 a touchpad swipe can still slip through — the watchdog
// detects the drift and moves the exam window to whichever workspace became active.

fn desktop_pair(output: &std::process::Output) -> Option<(u32, u32)> {
    if !output.status.success() {
        return None;
    }
    let text = std::str::from_utf8(&output.stdout).ok()?;
    let mut lines = text.lines();
    let pair = (
        lines.next()?.trim().parse().ok()?,
        lines.next()?.trim().parse().ok()?,
    );
    lines.next().is_none().then_some(pair)
}

fn focus_snapshot(output: &std::process::Output) -> Option<(u64, std::collections::HashSet<u64>)> {
    // xdotool script mode returns the last command's status. getactivewindow
    // always reports an error to stderr when it fails; reject that partial
    // snapshot even if the subsequent window search succeeds.
    if !output.status.success() || !output.stderr.is_empty() {
        return None;
    }
    let text = std::str::from_utf8(&output.stdout).ok()?;
    let mut lines = text.lines();
    let active = lines.next()?.trim().parse().ok()?;
    let ours: Option<std::collections::HashSet<u64>> =
        lines.map(|line| line.trim().parse().ok()).collect();
    let ours = ours?;
    (!ours.is_empty()).then_some((active, ours))
}

fn watchdogs_supported(display_server: &str) -> bool {
    display_server == "x11"
}

/// Spawn a workspace-guard thread (no-op if not on X11 or xdotool/wmctrl absent).
fn spawn_workspace_watchdog(generation: u64) {
    let session = detect_display_server();
    if !watchdogs_supported(&session) {
        // Loud, because the alternative is a proctored session silently
        // enforcing less than the organizer believes it does.
        eprintln!(
            "[ams][watchdog] workspace guard disabled: {session} session has no usable X11 \
             window to track. Desktop-switch correction is NOT active."
        );
        return;
    }

    std::thread::Builder::new()
        .name("ams-workspace-guard".into())
        .spawn(move || {
            // Give the window manager time to map our window.
            let our_pid = std::process::id().to_string();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let win_id: u64 = loop {
                // xdotool search --pid returns newline-separated window IDs.
                if let Some(id) = std::process::Command::new("xdotool")
                    .args(["search", "--pid", &our_pid, "--onlyvisible"])
                    .bounded_output()
                    .ok()
                    .and_then(|out| {
                        String::from_utf8_lossy(&out.stdout)
                            .lines()
                            .filter_map(|l| l.trim().parse::<u64>().ok())
                            .next()
                    })
                {
                    break id;
                }
                if !shield_generation_active(generation) || std::time::Instant::now() > deadline {
                    return; // xdotool not available or window never appeared
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            };

            loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if !shield_generation_active(generation) {
                    break;
                }

                // Both read-only queries share one X connection/process. Chained
                // commands stop on failure; exactly two values are required.
                let pair = std::process::Command::new("xdotool")
                    .args(["get_desktop", "get_desktop_for_window", &win_id.to_string()])
                    .bounded_output()
                    .ok()
                    .and_then(|output| desktop_pair(&output));
                let Some((active_desktop, our_desktop)) = pair else {
                    continue;
                };

                if active_desktop != our_desktop {
                    // Move exam window to wherever the user switched.
                    let _ = std::process::Command::new("wmctrl")
                        .args([
                            "-i",
                            "-r",
                            &format!("0x{:x}", win_id),
                            "-t",
                            &active_desktop.to_string(),
                        ])
                        .bounded_output();
                    // Focus it.
                    let _ = std::process::Command::new("xdotool")
                        .args(["windowfocus", "--sync", &win_id.to_string()])
                        .bounded_output();
                }
            }
        })
        .ok();
}

// ── Native lockdown-event sink + focus-loss watchdog (X11 only) ───────────────
//
// platform-rs must not depend on tauri, so the desktop shell registers a sink
// closure here; the focus watchdog raises a `focus_loss` violation through it.
// This complements the webview blur/visibilitychange signal with an independent,
// harder-to-suppress native check. X11 only — Wayland does not expose the active
// window to ordinary clients, so there is no equivalent (the watchdog no-ops).

type LockdownEventCallback = Box<dyn Fn(&str, &str) + Send + Sync>;
static LOCKDOWN_EVENT_CALLBACK: OnceLock<LockdownEventCallback> = OnceLock::new();

/// Register the host-application sink for lockdown security events. Invoked from
/// background threads; must be cheap/non-blocking. First registration wins.
pub fn set_lockdown_event_callback<F>(callback: F)
where
    F: Fn(&str, &str) + Send + Sync + 'static,
{
    let _ = LOCKDOWN_EVENT_CALLBACK.set(Box::new(callback));
}

/// Raise a security event to the host app (+ a stderr trail). The host callback
/// reaches Tauri's emit machinery, which can panic if the webview is gone; a
/// panic unwinding out of a spawned thread can escalate to process abort(), so
/// it is contained here (mirrors the macOS guard).
fn emit_lockdown_event(kind: &str, detail: &str) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = LOCKDOWN_EVENT_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(kind, detail)));
    }
}

/// All visible X11 window IDs owned by `pid` (empty if xdotool fails). Checking
/// the active window against the whole SET — not just one id — means a focus
/// change to one of the app's OWN windows (a GTK file dialog, a WebKitGTK
/// sub-surface) is not mistaken for the candidate switching away.
fn our_window_ids(pid: &str) -> std::collections::HashSet<u64> {
    std::process::Command::new("xdotool")
        .args(["search", "--pid", pid, "--onlyvisible"])
        .bounded_output()
        .ok()
        .map(|out| {
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter_map(|l| l.trim().parse::<u64>().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Spawn a native focus-loss watchdog (X11 only; no-op on Wayland or if xdotool
/// is absent). Emits a `focus_loss` violation once per episode when the active
/// window is none of the app's own windows. Detection only — the workspace
/// watchdog handles desktop-switch correction; this never steals focus back, so
/// it can't fight a legitimate system modal.
fn spawn_focus_watchdog(generation: u64) {
    let session = detect_display_server();
    if !watchdogs_supported(&session) {
        // On Wayland this leaves the webview's own blur/visibilitychange
        // handler as the ONLY focus signal, and that is the one a candidate
        // can suppress from the page. Say so rather than appear to watch.
        eprintln!(
            "[ams][watchdog] focus guard disabled: {session} session exposes no X11 active \
             window. Native focus_loss violations will NOT be raised."
        );
        return;
    }
    std::thread::Builder::new()
        .name("ams-focus-guard".into())
        .spawn(move || {
            // Wait until at least one of our windows has mapped.
            let our_pid = std::process::id().to_string();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                if !our_window_ids(&our_pid).is_empty() {
                    break;
                }
                if !shield_generation_active(generation) || std::time::Instant::now() > deadline {
                    return; // xdotool unavailable or window never appeared
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            // Debounce: emit only on the transition into "not focused", so a
            // sustained focus loss is one violation, not one per poll.
            let mut lost = false;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if !shield_generation_active(generation) {
                    break;
                }
                // Script mode runs each line separately, preserving printed
                // IDs and the original active-window-then-owned-windows order.
                // No shell is involved; pid is the numeric process id.
                let script = format!("getactivewindow\nsearch --pid {our_pid} --onlyvisible\n");
                let snapshot = crate::process_runner::output(
                    std::process::Command::new("xdotool").arg("-"),
                    std::time::Duration::from_secs(3),
                    Some(script.as_bytes()),
                )
                .ok()
                .and_then(|output| focus_snapshot(&output));
                let Some((active, ours)) = snapshot else {
                    continue;
                };
                if !ours.contains(&active) {
                    if !lost {
                        lost = true;
                        emit_lockdown_event("focus_loss", "native_focus_lost");
                    }
                } else {
                    lost = false;
                }
            }
        })
        .ok();
}

// ── Desktop lock / unlock ─────────────────────────────────────────────────────

/// Apply supported desktop controls and start applicable detection.
pub fn lock_desktop() -> bool {
    let active = enable_keyboard_intercept().active;
    // Detection runs independently of shortcut-setting support. These
    // watchdogs still explicitly decline Wayland-wide window claims.
    // Preserve pointer input. A single GNOME workspace mitigates workspace
    // switching; overview and other compositor gestures still need verification.
    if !SHIELD_ACTIVE.swap(true, Ordering::SeqCst) {
        let generation = SHIELD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_kill_shield(generation);
        spawn_workspace_watchdog(generation);
        spawn_focus_watchdog(generation);
    }
    active
}

pub fn unlock_desktop() {
    SHIELD_ACTIVE.store(false, Ordering::SeqCst);
    SHIELD_GENERATION.fetch_add(1, Ordering::SeqCst);
    // Restore only journaled changes, including legacy GNOME touchpad values.
    // Entry does not disable pointer input, so blindly enabling a touchpad
    // would overwrite a candidate's intentionally disabled setting.
    disable_keyboard_intercept();
}

/// Preserve every failed key until a later recovery attempt succeeds.
fn restore_saved_settings(
    saved: &mut HashMap<String, String>,
    mut restore: impl FnMut(&str, &str) -> bool,
    reconfigure: impl FnOnce() -> bool,
) {
    let mut restored = Vec::new();
    let mut has_kde = false;
    for (key, value) in saved.iter() {
        if restore(key, value) {
            restored.push(key.clone());
        }
        has_kde |= key.starts_with("kde/") || key == "kde_meta";
    }
    let kde_ok = !has_kde || reconfigure();
    for key in restored {
        if kde_ok || !(key.starts_with("kde/") || key == "kde_meta") {
            saved.remove(&key);
        }
    }
}

/// Allows the app to report an incomplete restoration without changing the
/// cross-platform command contract. No system probes or mutations are made.
pub fn keyboard_recovery_pending() -> bool {
    !saved().lock().unwrap_or_else(|e| e.into_inner()).is_empty()
        || backup_file().exists()
        || owned_regular_file(std::path::Path::new(LEGACY_BACKUP_PATH))
}

fn quarantine_owned_journal(path: &std::path::Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
        Ok(_) if !owned_regular_file(path) => {
            return Err(format!(
                "refusing to discard unsafe recovery journal {}",
                path.display()
            ))
        }
        Ok(_) => {}
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("recovery journal has no valid filename")?;
    let quarantine =
        path.with_file_name(format!("{name}.discarded-{}-{stamp}", std::process::id()));
    std::fs::rename(path, quarantine).map_err(|error| error.to_string())
}

fn quarantine_owned_legacy_journal(path: &std::path::Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
        // The legacy location is shared. Foreign or otherwise unsafe objects
        // are unrelated state and must remain untouched without blocking the
        // candidate from discarding their owned current journal.
        Ok(_) if !owned_regular_file(path) => Ok(()),
        Ok(_) => quarantine_owned_journal(path),
    }
}

/// Forget recovery records only after an explicit candidate action. This does
/// not mutate desktop settings; owned journals are quarantined as evidence.
pub fn discard_keyboard_recovery() -> Result<(), String> {
    quarantine_owned_journal(&backup_file())?;
    quarantine_owned_legacy_journal(std::path::Path::new(LEGACY_BACKUP_PATH))?;
    saved().lock().unwrap_or_else(|e| e.into_inner()).clear();
    Ok(())
}

pub fn disable_keyboard_intercept() {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
    match read_backup() {
        Ok(Some(backup)) => {
            for (key, value) in backup {
                saved.entry(key).or_insert(value);
            }
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("[ams][kb] recovery journal retained: {error}");
            return;
        }
    }
    if saved.is_empty() {
        delete_backup();
        return;
    }
    let mut kde_live = saved
        .keys()
        .any(|key| key.starts_with("kde_live/"))
        .then(kde_live::Adapter::discover)
        .flatten();
    let mut settings = settings::Settings::new(settings_command);
    // Config readback proves persistence, not that KGlobalAccel accepted the
    // restored shortcut live. Retain those recovery records until a supported
    // live API can verify them. A kwinrc-only Meta restoration can be reloaded.
    let has_kglobalaccel = saved.keys().any(|key| key.starts_with("kde/"));
    restore_saved_settings(
        &mut saved,
        |key, value| {
            if key.starts_with("kde_live/") {
                return serde_json::from_str::<kde_live::Plan>(value)
                    .ok()
                    .is_some_and(|plan| {
                        kde_live
                            .as_mut()
                            .is_some_and(|adapter| adapter.restore(&plan))
                    });
            }

            if let Some(path) = key.strip_prefix("gnome/") {
                return path
                    .split_once('/')
                    .is_some_and(|(schema, key)| settings.restore(schema, key, value));
            }
            if let Some(path) = key.strip_prefix("kde/") {
                return path.split_once('/').is_some_and(|(group, key)| {
                    kconfig_set("kglobalshortcutsrc", group, key, value)
                });
            }
            key == "kde_meta"
                && restore_kde_meta_with(
                    value,
                    || kde::config_get("kwinrc", "ModifierOnlyShortcuts", "Meta"),
                    |desired| kconfig_set("kwinrc", "ModifierOnlyShortcuts", "Meta", desired),
                )
        },
        || !has_kglobalaccel && kde::reconfigure_kwin(),
    );
    if saved.is_empty() {
        delete_backup();
    } else {
        write_backup(&saved);
        eprintln!(
            "[ams][kb] {} settings still need restoration; recovery backup retained",
            saved.len()
        );
    }
}

/// Check for LD_PRELOAD injection (security risk indicator).
pub fn check_ld_preload() -> Option<String> {
    std::env::var("LD_PRELOAD").ok().filter(|s| !s.is_empty())
}

/// Check if ptrace is allowed (debugger detection).
pub fn check_ptrace_scope() -> u8 {
    std::fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope")
        .ok()
        .and_then(|s| s.trim().parse::<u8>().ok())
        .unwrap_or(0)
}

// ── Network lockdown (privileged helper client) ───────────────────────────────
//
// LX-3: the app intentionally runs in the user session (so the webview can reach
// the camera/mic/DBus/portals), which means it has neither root nor
// CAP_NET_ADMIN. Shelling iptables in-process therefore failed on a normal
// launch and the network was NOT locked. We now mirror the macOS design: all
// iptables/ip6tables work happens in the root `network-helper` daemon and this
// module is only a thin Unix-domain-socket CLIENT. The JSON protocol and socket
// path are shared verbatim with the helper (see packages/network-helper).
//
// LX-4: family-splitting (v4 → iptables, v6 → ip6tables) is done inside the
// helper; this client passes BOTH families through untouched.

use std::os::unix::net::UnixStream;

/// Same socket the helper binds. /run is the canonical runtime tmpfs; /var/run
/// is a compatibility symlink on modern distros, tried as a fallback.
const HELPER_SOCKET: &str = "/run/ams-proctor.sock";
const HELPER_SOCKET_FALLBACK: &str = "/var/run/ams-proctor.sock";

/// Where `install_network_helper` lands the systemd unit files. The packaged
/// copies live in the repo under packaging/linux/ and are bundled as Tauri
/// resources; install copies them here with pkexec.
const SYSTEMD_UNIT_DEST: &str = "/etc/systemd/system/ams-proctor-helper.service";
const HELPER_BINARY_DEST: &str = "/usr/local/lib/ams-access/ams-access-networkhelper";
/// Root-written file pinning the authorized client binary's absolute path. The
/// helper's `authorize_client` reads it (must match `helper.rs::CLIENT_CONFIG_PATH`).
const CLIENT_CONFIG_DEST: &str = "/etc/ams-access/network-helper-client.conf";

/// True for install paths that change every launch (AppImage's `/.mount_*`, or a
/// `/tmp` extraction). Pinning such a path would lock out the next run, so we
/// skip the pin and let the helper fall back to its exe-basename check.
fn is_ephemeral_client_path(path: &str) -> bool {
    path.contains("/.mount_") || path.starts_with("/tmp/")
}

/// Prefix of the error `helper_connect` returns when the socket is unreachable.
/// Callers match on it to tell "helper not running" apart from a command error,
/// so the two must stay in sync (kept here as one source of truth).
const HELPER_CONNECT_ERR_PREFIX: &str = "connect to helper";

/// Serialized with enable/disable so repeated calls retain the same recovery
/// capability until the helper has confirmed teardown.
static SESSION_TOKEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

// Linux open flags, used only in this Linux module. NOFOLLOW rejects a planted
// symlink; NONBLOCK avoids hanging on an unexpected FIFO before metadata checks.
const TOKEN_OPEN_FLAGS: i32 = 0x20000 | 0x800;

fn own_uid() -> std::io::Result<u32> {
    use std::os::unix::fs::MetadataExt;
    Ok(std::fs::metadata("/proc/self")?.uid())
}

fn private_directory(path: &std::path::Path, create: bool) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    if create {
        match std::fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(e) => return Err(e),
        }
    }
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_dir()
        || metadata.uid() != own_uid()?
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "recovery directory must be a private directory owned by this user",
        ));
    }
    Ok(())
}

/// Boot-scoped recovery survives a crash/relaunch. Runtime directories can be
/// removed at final logout; recovering across logout still requires helper-side
/// ownership/liveness handling and is not promised by this client file.
fn session_token_path() -> std::io::Result<std::path::PathBuf> {
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or(std::path::PathBuf::from(format!(
            "/run/user/{}",
            own_uid()?
        )));
    private_directory(&base, false)?;
    Ok(base.join("ams-access").join("session-token"))
}

fn store_private_file_at(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "recovery path has no directory",
        )
    })?;
    private_directory(dir, true)?;
    let tmp = dir.join(format!(
        ".session-token-{}-{}",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    // Each writer owns an exclusive sibling. Never truncate a shared .tmp file
    // or follow a symlink, and never remove another writer's temporary file.
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&tmp)?;
    let result = (|| {
        file.write_all(token.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        std::fs::File::open(dir)?.sync_all()
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn store_session_token_at(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    store_private_file_at(path, token)
}

fn load_session_token_at(path: &std::path::Path) -> Option<String> {
    use std::io::Read;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    private_directory(path.parent()?, false).ok()?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(TOKEN_OPEN_FLAGS)
        .open(path)
        .ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file()
        || metadata.uid() != own_uid().ok()?
        || metadata.permissions().mode() & 0o077 != 0
    {
        return None;
    }
    let mut raw = String::new();
    file.take(129).read_to_string(&mut raw).ok()?;
    let token = raw.trim();
    // Currently minted tokens are precisely 128 bits in hex. Reject corrupt,
    // oversized or unexpected data rather than forwarding it to the helper.
    (token.len() == 32 && token.bytes().all(|b| b.is_ascii_hexdigit())).then(|| token.to_string())
}

fn clear_session_token_at(path: &std::path::Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        match private_directory(dir, false) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            result => result?,
        }
    }
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

/// 16 random bytes from /dev/urandom, hex-encoded (32 chars). Falls back to a
/// PID+nanos nonce if urandom is unavailable — still unique per session.
fn mint_token() -> String {
    use std::io::Read;
    let mut buf = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() {
            return buf.iter().map(|b| format!("{b:02x}")).collect();
        }
    }
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:032x}", nanos ^ ((std::process::id() as u128) << 80))
}

/// Connect to the helper socket, preferring /run then /var/run.
fn helper_connect() -> Result<UnixStream, String> {
    match crate::helper_client::connect(std::path::Path::new(HELPER_SOCKET)) {
        Ok(s) => Ok(s),
        Err(primary) if primary.kind() == std::io::ErrorKind::TimedOut => Err(format!("{HELPER_CONNECT_ERR_PREFIX} ({HELPER_SOCKET}: {primary})")),
        Err(primary) => crate::helper_client::connect(std::path::Path::new(HELPER_SOCKET_FALLBACK))
            .map_err(|fallback| format!("{HELPER_CONNECT_ERR_PREFIX} ({HELPER_SOCKET}: {primary}; {HELPER_SOCKET_FALLBACK}: {fallback})")),
    }
}

/// Send a single newline-delimited JSON command and parse the `{"ok":...}` reply.
fn helper_send(json: &str) -> Result<(), String> {
    crate::helper_client::send(json, helper_connect)
}

/// Ping the helper, returning the precise failure reason on `Err` (socket
/// unreachable, authorization rejected, malformed reply, …). `network_helper_running`
/// discards this detail down to a bool for the readiness policy; callers that need
/// to diagnose *why* the helper looks down should use this and log the message.
pub fn network_helper_status() -> Result<(), String> {
    helper_send(r#"{"cmd":"ping_v2"}"#)
}

/// True when the helper daemon socket is reachable and answers a ping.
pub fn network_helper_running() -> bool {
    network_helper_status().is_ok()
}

/// Apply the outbound firewall via the privileged helper.
///
/// `allowed_ips` may contain BOTH IPv4 and IPv6 literals; the helper splits them
/// by family. If the helper is not installed/reachable, returns a clear `Err`
/// so the launch gate can refuse to start the exam (egress would be unrestricted
/// otherwise — see the Tauri `enable_network_lockdown` command in lib.rs).
/// Nameservers this host is configured to use, read from the same files the
/// caller unions when it builds the allowlist.
///
/// Used only to work out which entries in `allowed_ips` are resolvers, so they
/// can be sent port-scoped rather than wide open. Reading it here rather than
/// changing `enable_network_lockdown`'s signature keeps the cross-platform
/// dispatch identical on macOS and Windows.
/// Parse resolver directives strictly, including inline comments, and normalize
/// IP spelling so equivalent IPv6 addresses cannot bypass DNS-only scoping.
pub fn parse_resolv_nameservers(contents: &str) -> Vec<String> {
    let mut result = Vec::new();
    for line in contents.lines() {
        let content = line.split(['#', ';']).next().unwrap_or("");
        let mut fields = content.split_whitespace();
        if fields.next() != Some("nameserver") {
            continue;
        }
        let Some(address) = fields
            .next()
            .and_then(|s| s.parse::<std::net::IpAddr>().ok())
        else {
            continue;
        };
        if fields.next().is_some() {
            continue;
        }
        let address = address.to_string();
        if !result.contains(&address) {
            result.push(address);
        }
    }
    result
}

fn configured_nameservers() -> Vec<String> {
    let mut result = Vec::new();
    for path in ["/etc/resolv.conf", "/run/systemd/resolve/resolv.conf"] {
        if let Ok(contents) = std::fs::read_to_string(path) {
            for address in parse_resolv_nameservers(&contents) {
                if !result.contains(&address) {
                    result.push(address);
                }
            }
        }
    }
    result
}

pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    // Old helpers cannot promise resolver scoping/recovery validation. Updating
    // is required for new enforcement; legacy disable remains usable.
    network_helper_status().map_err(|error| format!("network_helper_update_required: {error}"))?;
    let mut slot = SESSION_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    let path =
        session_token_path().map_err(|e| format!("cannot store network recovery token: {e}"))?;
    // Reuse a live token on retries. Replacing it before a failed helper call
    // could lose the only capability that can undo an already-applied firewall.
    let token = slot
        .clone()
        .or_else(|| load_session_token_at(&path))
        .unwrap_or_else(mint_token);
    store_session_token_at(&path, &token)
        .map_err(|e| format!("cannot store network recovery token: {e}"))?;
    *slot = Some(token.clone());

    // Split out the resolvers so the helper can restrict them to DNS ports.
    // They stay in `ips` as well: an older helper ignores `resolvers`, and
    // dropping them from `ips` would leave that helper with no DNS at all —
    // failing the exam shut rather than merely leaving it as wide as before.
    let nameservers = configured_nameservers();
    let resolvers: Vec<&String> = allowed_ips
        .iter()
        .filter(|ip| {
            ip.parse::<std::net::IpAddr>()
                .is_ok_and(|address| nameservers.contains(&address.to_string()))
        })
        .collect();

    let request = serde_json::json!({
        "cmd": "enable",
        "ips": allowed_ips,
        "resolvers": resolvers,
        "token": token,
    })
    .to_string();
    helper_send(&request).map_err(|e| {
        if e.starts_with(HELPER_CONNECT_ERR_PREFIX) {
            "network helper not installed/running: cannot lock egress. \
             Install it via install_network_helper (pkexec/systemd)."
                .to_string()
        } else {
            e
        }
    })
}

const MARKER_PATH: &str = "/run/ams-proctor.lock";
pub const HELPER_RULES_MAY_PERSIST: &str = "helper_unreachable_rules_may_persist";

fn lockdown_marker_may_exist() -> bool {
    // Only a definite ENOENT is absence. Permission and other metadata errors
    // must not turn a possibly applied firewall into a successful recovery.
    !matches!(std::fs::symlink_metadata(MARKER_PATH),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound)
}

fn disable_outcome(result: Result<(), String>, marker_present: bool) -> Result<(), String> {
    match result {
        Err(e) if e.starts_with(HELPER_CONNECT_ERR_PREFIX) => {
            if marker_present {
                Err(format!("{HELPER_RULES_MAY_PERSIST}: {e}"))
            } else {
                Ok(())
            }
        }
        result => result,
    }
}

/// Retain the recovery capability on any uncertain outcome. A helper which is
/// unreachable is a harmless no-op only if no active lockdown marker exists.
pub fn disable_network_lockdown() -> Result<(), String> {
    let mut slot = SESSION_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
    let path = session_token_path().ok();
    let token = slot
        .clone()
        .or_else(|| path.as_ref().and_then(|p| load_session_token_at(p)))
        .unwrap_or_default();
    let request = serde_json::json!({ "cmd": "disable", "token": token }).to_string();
    disable_outcome(helper_send(&request), lockdown_marker_may_exist())?;
    if let Some(path) = path {
        if let Err(e) = clear_session_token_at(&path) {
            return Err(format!(
                "network restored but recovery token cleanup failed: {e}"
            ));
        }
    }
    *slot = None;
    Ok(())
}

/// Install the helper binary + systemd unit and start it as root.
///
/// Best-effort: this shells `pkexec` (one polkit auth prompt) to run a small
/// install script as root that (1) copies the helper binary to
/// `HELPER_BINARY_DEST`, (2) installs the systemd `.service` to
/// `SYSTEMD_UNIT_DEST`, (3) `systemctl daemon-reload && enable --now`s it.
///
/// Assumptions / caveats (documented honestly):
///   * systemd is the init system (true for ~all desktop distros AMS targets).
///   * `pkexec` (polkit) is present; if not, this returns an error and the
///     organizer must pre-install the unit out of band.
///   * `helper_binary` is the path to the compiled `ams-access-networkhelper`
///     (resolved by the caller from the Tauri resource dir).
///   * `unit_source` is the bundled `ams-proctor-helper.service` file.
///   * `client_binary` is the calling app's own absolute path (`current_exe`),
///     pinned into `CLIENT_CONFIG_DEST` so the helper can full-path-authorize
///     the client (macOS parity). For an ephemeral install path (AppImage) we
///     pass an empty pin so the helper falls back to its basename check and a
///     stale pin is removed.
pub fn install_network_helper(
    helper_binary: &str,
    unit_source: &str,
    client_binary: &str,
) -> Result<(), String> {
    // Only pin a stable path; an AppImage mount path would lock out the next run.
    let client_pin = if is_ephemeral_client_path(client_binary) {
        ""
    } else {
        client_binary
    };

    // Build a single root shell script so there is exactly one pkexec prompt.
    // Paths are passed as positional args and quoted to avoid injection.
    let script = r#"
set -e
HELPER_SRC="$1"
UNIT_SRC="$2"
HELPER_DEST="$3"
UNIT_DEST="$4"
CLIENT_PIN="$5"
CONFIG_DEST="$6"
if ! command -v systemctl >/dev/null 2>&1 || [ ! -d /run/systemd/system ]; then
  echo systemd_not_available >&2
  exit 69
fi
install -d "$(dirname "$HELPER_DEST")"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER_DEST"
install -o root -g root -m 644 "$UNIT_SRC" "$UNIT_DEST"
if [ -n "$CLIENT_PIN" ]; then
  install -d "$(dirname "$CONFIG_DEST")"
  printf '%s\n' "$CLIENT_PIN" > "$CONFIG_DEST"
  chown root:root "$CONFIG_DEST"
  chmod 644 "$CONFIG_DEST"
else
  rm -f "$CONFIG_DEST"
fi
systemctl daemon-reload
systemctl enable ams-proctor-helper.service
systemctl restart ams-proctor-helper.service
"#;

    let out = std::process::Command::new("pkexec")
        .args([
            "/bin/sh",
            "-c",
            script,
            "sh", // $0
            helper_binary,
            unit_source,
            HELPER_BINARY_DEST,
            SYSTEMD_UNIT_DEST,
            client_pin,
            CLIENT_CONFIG_DEST,
        ])
        .bounded_output_with_timeout(std::time::Duration::from_secs(120))
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "pkexec_not_available".to_string()
            } else {
                format!("pkexec: {e}")
            }
        })?;

    if !out.status.success() {
        // pkexec 126 means dismissed auth; 127 means authorization failed.
        // A missing executable is a spawn NotFound error, handled above.
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr);
        if code == 126 {
            return Err("admin_auth_cancelled".to_string());
        }
        if code == 127 {
            return Err("admin_auth_failed".to_string());
        }
        if code == 69 {
            return Err("systemd_not_available".to_string());
        }
        return Err(format!(
            "helper install failed (exit {code}): {}",
            stderr.trim()
        ));
    }

    // One end-to-end deadline, not thirty potentially ten-second ping reads.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if crate::helper_client::ping_until(std::path::Path::new(HELPER_SOCKET), deadline).is_ok() {
            return Ok(());
        }
        std::thread::sleep(
            std::time::Duration::from_millis(100)
                .min(deadline.saturating_duration_since(std::time::Instant::now())),
        );
    }
    Err("helper_startup_timeout".to_string())
}

/// Returns true if `name` is in the Linux RESTRICTED process list.
pub fn is_restricted_name(name: &str) -> bool {
    RESTRICTED.iter().any(|&r| r.eq_ignore_ascii_case(name))
}

/// Send SIGTERM to each named restricted process, wait 600 ms, then
/// SIGKILL any survivors. Uses pkill to avoid requiring the libc crate.
pub fn close_apps(names: &[String]) -> CloseAppsResult {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let mut closed = Vec::new();
    let mut failed = Vec::new();

    // Phase 1: SIGTERM all named processes.
    for name in names {
        let _ = std::process::Command::new("pkill")
            .args(["-15", "-x", name])
            .bounded_output();
    }

    std::thread::sleep(std::time::Duration::from_millis(600));

    // Phase 2: SIGKILL survivors.
    for name in names {
        if linux_process_alive(name) {
            let _ = std::process::Command::new("pkill")
                .args(["-9", "-x", name])
                .bounded_output();
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(150));

    // Classify outcomes.
    for name in names {
        if linux_process_alive(name) {
            failed.push(name.clone());
        } else {
            closed.push(name.clone());
        }
    }

    CloseAppsResult { closed, failed }
}

/// Returns true if any process with this exact name is alive in /proc.
fn linux_process_alive(name: &str) -> bool {
    std::process::Command::new("pgrep")
        .args(["-x", name])
        .bounded_output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{lower_basename, match_restricted, mint_token};

    fn recovery_dir(label: &str) -> std::path::PathBuf {
        use std::os::unix::fs::DirBuilderExt;
        let path = std::env::temp_dir().join(format!(
            "ams-recovery-{label}-{}-{}",
            std::process::id(),
            mint_token()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        path
    }

    #[test]
    fn recovery_token_survives_without_process_state_and_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = recovery_dir("roundtrip");
        let path = dir.join("token");
        let token = mint_token();
        super::store_session_token_at(&path, &token).unwrap();
        assert_eq!(super::load_session_token_at(&path), Some(token));
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        super::clear_session_token_at(&path).unwrap();
        assert_eq!(super::load_session_token_at(&path), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recovery_rejects_symlink_directories_and_files_without_touching_target() {
        use std::os::unix::fs::symlink;
        let dir = recovery_dir("symlink");
        let victim = dir.join("victim");
        std::fs::write(&victim, "untouched").unwrap();
        let path = dir.join("token");
        symlink(&victim, &path).unwrap();
        assert_eq!(super::load_session_token_at(&path), None);
        // Atomic replacement changes the link itself, never its target.
        super::store_session_token_at(&path, &mint_token()).unwrap();
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "untouched");
        let link = dir.join("link");
        symlink(&dir, &link).unwrap();
        assert!(super::store_session_token_at(&link.join("bad"), &mint_token()).is_err());
        assert!(!dir.join("bad").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn recovery_rejects_public_files_and_directories_and_corrupt_tokens() {
        use std::os::unix::fs::PermissionsExt;
        let dir = recovery_dir("permissions");
        let path = dir.join("token");
        super::store_session_token_at(&path, &mint_token()).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(super::load_session_token_at(&path), None);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        for value in ["", " \n", "not-a-token", &"a".repeat(4096)] {
            std::fs::write(&path, value).unwrap();
            assert_eq!(super::load_session_token_at(&path), None);
        }
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(super::store_session_token_at(&path, &mint_token()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_recovery_writes_are_whole_and_leave_no_temporary_files() {
        let dir = recovery_dir("concurrent");
        let path = dir.join("token");
        let a = "a".repeat(32);
        let b = "b".repeat(32);
        super::store_session_token_at(&path, &a).unwrap();
        std::thread::scope(|scope| {
            for index in 0..6 {
                let path = &path;
                let a = &a;
                let b = &b;
                scope.spawn(move || {
                    for _ in 0..30 {
                        if index < 3 {
                            super::store_session_token_at(path, if index % 2 == 0 { a } else { b })
                                .unwrap();
                        } else {
                            let token =
                                super::load_session_token_at(path).expect("no torn/empty read");
                            assert!(token == *a || token == *b);
                        }
                    }
                });
            }
        });
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_atomic_recovery_replace_cleans_up_its_temporary_file() {
        let dir = recovery_dir("failure");
        let path = dir.join("token");
        std::fs::create_dir(&path).unwrap();
        assert!(super::store_session_token_at(&path, &mint_token()).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn teardown_never_hides_helper_refusal_or_a_possibly_live_firewall() {
        for marker in [false, true] {
            assert!(super::disable_outcome(Ok(()), marker).is_ok());
            assert_eq!(
                super::disable_outcome(Err("token mismatch".into()), marker),
                Err("token mismatch".into())
            );
            let result = super::disable_outcome(
                Err(format!("{}: refused", super::HELPER_CONNECT_ERR_PREFIX)),
                marker,
            );
            assert_eq!(result.is_err(), marker);
            if marker {
                assert!(result
                    .unwrap_err()
                    .contains(super::HELPER_RULES_MAY_PERSIST));
            }
        }
    }

    #[test]
    fn watchdogs_do_not_mistake_xwayland_for_an_x11_session() {
        assert!(super::watchdogs_supported("x11"));
        for session in ["wayland", "wayland/gnome", "wayland/kde", "unknown", ""] {
            assert!(!super::watchdogs_supported(session));
        }
    }

    #[test]
    fn keyboard_changes_require_a_durable_original_before_application() {
        use std::cell::Cell;
        let applied = Cell::new(false);
        let mut saved = std::collections::HashMap::new();
        assert!(!super::backup_before_apply(
            &mut saved,
            "key",
            || None,
            |_| {
                applied.set(true);
                true
            },
            |_| true
        ));
        assert!(!applied.get());
        assert!(!super::backup_before_apply(
            &mut saved,
            "key",
            || Some("original".into()),
            |_| {
                applied.set(true);
                true
            },
            |_| false
        ));
        assert!(!applied.get());
        assert!(super::backup_before_apply(
            &mut saved,
            "key",
            || panic!("must retain original"),
            |_| {
                applied.set(true);
                true
            },
            |values| values.get("key").is_some_and(|v| v == "original")
        ));
        assert!(applied.get());
    }

    #[test]
    fn failed_keyboard_restores_remain_available_for_retry() {
        let mut saved = std::collections::HashMap::from([
            ("gnome/schema/first".into(), "first-original".into()),
            ("gnome/schema/second".into(), "second-original".into()),
            ("kde/group/key".into(), "kde-original".into()),
            ("kde_meta".into(), super::kde::UNSET.into()),
        ]);
        super::restore_saved_settings(&mut saved, |key, _| key != "gnome/schema/second", || false);
        assert!(!saved.contains_key("gnome/schema/first"));
        assert_eq!(
            saved.len(),
            3,
            "failed write and failed KDE reload both retain originals"
        );
        super::restore_saved_settings(&mut saved, |_, _| true, || true);
        assert!(saved.is_empty());
    }

    #[test]
    fn workspace_and_desktop_changes_alone_are_not_keyboard_interception() {
        let successful_writes = [
            ("org.gnome.mutter", "dynamic-workspaces"),
            ("org.gnome.desktop.wm.preferences", "num-workspaces"),
            ("org.gnome.desktop.interface", "enable-hot-corners"),
            ("org.gnome.shell.extensions.dash-to-dock", "dock-fixed"),
        ];
        assert!(successful_writes
            .iter()
            .all(|&(schema, key)| !super::is_gnome_keyboard_control(schema, key)));
    }

    #[test]
    fn actual_shortcut_controls_still_count_when_other_settings_fail() {
        for (schema, key) in [
            ("org.gnome.mutter", "overlay-key"),
            ("org.gnome.desktop.wm.keybindings", "switch-applications"),
            ("org.gnome.shell.keybindings", "toggle-overview"),
            ("org.gnome.mutter.wayland.keybindings", "restore-shortcuts"),
        ] {
            assert!(
                super::is_gnome_keyboard_control(schema, key),
                "{schema}/{key}"
            );
        }
        assert!(!super::is_gnome_keyboard_control("unknown", "overlay-key"));
    }

    #[test]
    fn gnome_coverage_outcome_observes_the_real_budget_state() {
        let healthy = super::Budget::new(std::time::Duration::from_secs(1));
        let complete = super::gnome_intercept_outcome(2, 3, "gsettings", 1, &healthy);
        assert!(complete.active);
        drop(healthy);

        let expired = super::Budget::new(std::time::Duration::ZERO);
        let partial = super::gnome_intercept_outcome(2, 3, "gsettings", 1, &expired);
        assert!(!partial.active);
        assert_eq!(
            expired.failure().as_deref(),
            Some("native scan budget exhausted")
        );
    }

    #[test]
    fn keyboard_readback_only_normalizes_the_equivalent_empty_array() {
        assert_eq!(super::normalize_gvariant(" @as []\n"), "[]");
        assert_ne!(
            super::normalize_gvariant("'Super L'"),
            super::normalize_gvariant("'SuperL'")
        );
        assert!(!super::intercept_outcome(0, 21, "gsettings").active);
        assert_eq!(
            super::intercept_outcome(0, 0, "unsupported").method,
            "unsupported"
        );
        let partial = super::intercept_outcome(3, 21, "gsettings");
        assert!(partial.active);
        assert!(partial.method.contains("3/21 applied"));
    }

    #[test]
    fn clearing_a_never_created_recovery_directory_is_a_noop() {
        let dir = recovery_dir("clear-missing");
        assert!(super::clear_session_token_at(&dir.join("not-created").join("token")).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mint_token_is_32_hex_chars_and_varies() {
        let a = mint_token();
        let b = mint_token();
        assert_eq!(a.len(), 32, "16 bytes hex-encoded = 32 chars");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "two mints must differ");
    }

    #[test]
    fn lower_basename_strips_dir_and_lowercases() {
        assert_eq!(lower_basename("/usr/bin/OBS-Studio"), "obs-studio");
        assert_eq!(lower_basename("ffmpeg"), "ffmpeg");
        assert_eq!(lower_basename("/tmp/.mount_x/AppRun"), "apprun");
    }

    #[test]
    fn lockdown_callback_delivers_and_contains_panics() {
        use super::{emit_lockdown_event, set_lockdown_event_callback};
        use std::sync::atomic::{AtomicUsize, Ordering};
        static HITS: AtomicUsize = AtomicUsize::new(0);

        // First registration wins, so this single callback handles both cases.
        set_lockdown_event_callback(|kind, _detail| {
            HITS.fetch_add(1, Ordering::SeqCst);
            if kind == "boom" {
                panic!("a panicking callback must be contained by emit_lockdown_event");
            }
        });

        // Suppress the expected panic's backtrace noise from the contained call.
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        emit_lockdown_event("focus_loss", "native_focus_lost");
        // A panic here must NOT unwind out (on a real spawned thread it would
        // escalate to process abort()).
        emit_lockdown_event("boom", "x");
        std::panic::set_hook(prev);

        assert_eq!(HITS.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn match_restricted_matches_any_identity_name() {
        // argv[0] lied as "bash" but the real exe basename is a recorder.
        let names = vec!["bash".to_string(), "obs".to_string()];
        assert_eq!(match_restricted(&names), Some("obs"));
        // Newly-added recorder is caught.
        assert_eq!(
            match_restricted(&["gpu-screen-recorder".to_string()]),
            Some("gpu-screen-recorder")
        );
        // Nothing restricted → None.
        assert_eq!(
            match_restricted(&["bash".to_string(), "firefox".to_string()]),
            None
        );
        // Empty → None.
        assert_eq!(match_restricted(&[]), None);
    }
}

#[cfg(test)]
mod watchdog_batch_tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    fn output(code: i32, stdout: &str, stderr: &str) -> std::process::Output {
        std::process::Output {
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }
    #[test]
    fn workspace_snapshot_requires_both_values_and_success() {
        assert_eq!(desktop_pair(&output(0, "2\n3\n", "")), Some((2, 3)));
        for out in [
            output(1, "2\n3\n", "failed"),
            output(0, "2\n", ""),
            output(0, "2\n3\n4\n", ""),
            output(0, "2\ninvalid\n", ""),
        ] {
            assert!(desktop_pair(&out).is_none());
        }
    }
    #[test]
    fn focus_snapshot_keeps_all_own_windows_and_rejects_partial_reads() {
        let (active, ours) = focus_snapshot(&output(0, "42\n10\n42\n", "")).unwrap();
        assert_eq!(active, 42);
        assert_eq!(ours.len(), 2);
        assert!(ours.contains(&active));
        for out in [
            output(0, "10\n42\n", "getactivewindow failed"),
            output(1, "42\n", ""),
            output(0, "42\n", ""),
            output(0, "42\nbad\n", ""),
        ] {
            assert!(focus_snapshot(&out).is_none());
        }
    }
}

#[cfg(test)]
mod phase_e_journal_tests {
    use super::decode_backup;

    #[test]
    fn json_journal_preserves_tabs_and_newlines_in_values() {
        let content = r#"{"gnome/schema/key":"line one\nline two\twith tab"}"#;
        let decoded = decode_backup(content).unwrap();
        assert_eq!(
            decoded.get("gnome/schema/key").map(String::as_str),
            Some("line one\nline two\twith tab")
        );
    }

    #[test]
    fn corrupt_json_and_ambiguous_legacy_lines_are_rejected() {
        assert!(decode_backup(r#"{"gnome/schema/key":"unterminated}"#).is_err());
        assert!(decode_backup("gnome/schema/key\tfirst line\nsecond line").is_err());
        assert!(decode_backup("missing-tab").is_err());
        assert!(decode_backup("\torphan").is_err());
    }

    #[test]
    fn legacy_decoder_splits_only_the_first_tab() {
        let decoded = decode_backup("gnome/schema/key\tvalue\twith-tab\n").unwrap();
        assert_eq!(
            decoded.get("gnome/schema/key").map(String::as_str),
            Some("value\twith-tab")
        );
    }

    #[test]
    fn unlock_never_forces_touchpad_enabled() {
        let source = include_str!("mod.rs");
        let unlock = source
            .split_once("pub fn unlock_desktop()")
            .unwrap()
            .1
            .split_once("/// Preserve every failed key")
            .unwrap()
            .0;
        assert!(!unlock.contains("set_touchpad_enabled"));
        assert!(unlock.contains("disable_keyboard_intercept"));
    }
}

#[cfg(test)]
mod phase_f_resolver_tests {
    #[test]
    fn directives_comments_and_ipv6_aliases_are_normalized() {
        let result = super::parse_resolv_nameservers(
            "nameserver 2001:0db8:0:0:0:0:0:1 # primary\nnameserver 2001:db8::1; duplicate\nnameserver 1.1.1.1 # dns\nnameserver1.2.3.4\nnameserver 2.2.2.2 extra\nnameserver invalid\n");
        assert_eq!(result, vec!["2001:db8::1", "1.1.1.1"]);
    }
}

#[cfg(test)]
mod review_regression_tests {
    use super::*;
    #[test]
    fn advisory_desktop_budget_failure_does_not_escape_to_outer_required_scan() {
        let outer = Budget::new(std::time::Duration::from_secs(1));
        crate::process_runner::optional(|| {
            let inner = Budget::new(std::time::Duration::ZERO);
            assert!(inner.expired());
            assert!(inner.failure().is_some());
        });
        assert_eq!(outer.failure(), None);
    }
    #[test]
    fn kde_active_requires_every_core_family_but_not_version_optional_activity() {
        assert!(kde_required_coverage(
            &[true, true, true, false],
            &[true, true, true, false]
        ));
        assert!(!kde_required_coverage(
            &[true, true, false, true],
            &[true, true, false, true]
        ));
        assert!(!kde_required_coverage(
            &[true, true, true, true],
            &[true, false, true, true]
        ));
    }
    #[test]
    fn meta_original_is_persisted_before_mutation_and_conflict_remains_retryable() {
        use std::cell::Cell;
        let persisted = Cell::new(false);
        let mutated = Cell::new(false);
        let mut saved = HashMap::new();
        assert!(backup_before_apply(
            &mut saved,
            "kde_meta",
            || Some(kde::UNSET.into()),
            |_| {
                assert!(persisted.get());
                mutated.set(true);
                true
            },
            |_| {
                persisted.set(true);
                true
            }
        ));
        assert!(mutated.get());
        assert_eq!(saved["kde_meta"], kde::UNSET);
        let mut conflict = saved.clone();
        restore_saved_settings(&mut conflict, |_, _| false, || true);
        assert!(conflict.contains_key("kde_meta"));
    }
    #[test]
    fn explicit_discard_quarantines_owned_journal_and_rejects_symlink() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("ams-discard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let journal = root.join("journal");
        std::fs::write(&journal, b"evidence").unwrap();
        quarantine_owned_journal(&journal).unwrap();
        assert!(!journal.exists());
        let quarantined: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(quarantined.len(), 1);
        assert_eq!(std::fs::read(&quarantined[0]).unwrap(), b"evidence");

        let target = root.join("target");
        std::fs::write(&target, b"foreign").unwrap();
        symlink(&target, &journal).unwrap();
        assert!(quarantine_owned_journal(&journal).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"foreign");
        quarantine_owned_legacy_journal(&journal).unwrap();
        assert!(journal.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(&target).unwrap(), b"foreign");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_pending_predicate_accepts_only_owned_regular_files() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("ams-legacy-pending-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let file = root.join("owned");
        std::fs::write(&file, b"malformed-but-pending").unwrap();
        assert!(owned_regular_file(&file));
        assert!(!owned_regular_file(&root));
        let link = root.join("link");
        symlink(&file, &link).unwrap();
        assert!(!owned_regular_file(&link));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn kde_meta_apply_and_restore_preserve_external_edits() {
        let mut writes = Vec::new();
        assert!(apply_kde_meta_with(
            kde::UNSET,
            || Some(kde::UNSET.into()),
            |v| {
                writes.push(v.to_owned());
                true
            }
        ));
        assert_eq!(writes, [""]);
        writes.clear();
        assert!(!apply_kde_meta_with(
            "launcher",
            || Some("external".into()),
            |v| {
                writes.push(v.to_owned());
                true
            }
        ));
        assert!(writes.is_empty());
        assert!(apply_kde_meta_with(
            "launcher",
            || Some("".into()),
            |_| panic!("idempotent apply must not write")
        ));

        assert!(restore_kde_meta_with(
            kde::UNSET,
            || Some("".into()),
            |v| {
                writes.push(v.to_owned());
                true
            }
        ));
        assert_eq!(writes, [kde::UNSET]);
        writes.clear();
        assert!(restore_kde_meta_with(
            "launcher",
            || Some("".into()),
            |v| {
                writes.push(v.to_owned());
                true
            }
        ));
        assert_eq!(writes, ["launcher"]);
        writes.clear();
        assert!(!restore_kde_meta_with(
            "launcher",
            || Some("external".into()),
            |v| {
                writes.push(v.to_owned());
                true
            }
        ));
        assert!(writes.is_empty());
        assert!(restore_kde_meta_with(
            "",
            || Some("".into()),
            |_| panic!("explicit empty original is already restored")
        ));
    }

    #[test]
    fn unsafe_legacy_types_are_ignored_but_owned_malformed_regular_file_is_error() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("ams-legacy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let link = root.join("legacy");
        symlink(root.join("missing"), &link).unwrap();
        assert_eq!(read_legacy_backup_file(&link).unwrap(), None);
        std::fs::remove_file(&link).unwrap();
        std::fs::write(&link, b"malformed").unwrap();
        assert!(read_legacy_backup_file(&link).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}

// ── wireless ────────────────────────────────────────────────────────────────
//
// NetworkManager, because it is what ships on the desktops candidates use and
// it needs no privileges for a scan. A machine without `nmcli` reports
// `supported: false` and the UI shows nothing, which is honest: an empty list
// would read as "no networks in range".

/// What wireless networks this machine can see.
pub fn wifi_scan() -> crate::WifiScan {
    let Ok(output) = std::process::Command::new("nmcli")
        .args([
            "-t",
            "-f",
            "ACTIVE,SSID,SIGNAL,SECURITY",
            "dev",
            "wifi",
            "list",
        ])
        .output()
    else {
        return crate::WifiScan::default();
    };
    if !output.status.success() {
        return crate::WifiScan::default();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (rows, current) = crate::wifi_parse::parse_nmcli(&text);
    crate::WifiScan {
        networks: crate::wifi_parse::tidy(rows, current.as_deref()),
        connected: current.is_some(),
        saved_only: false,
        current,
        supported: true,
    }
}

/// Join a network. An empty password joins an open one.
pub fn wifi_connect(ssid: &str, password: Option<&str>) -> Result<(), String> {
    let mut command = std::process::Command::new("nmcli");
    command.args(["dev", "wifi", "connect", ssid]);
    if let Some(secret) = password.filter(|p| !p.is_empty()) {
        command.args(["password", secret]);
    }
    match command.output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            // nmcli puts the useful part on stderr, and it is already a
            // sentence ("Error: Connection activation failed: ...").
            let text = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if text.is_empty() {
                "Could not join that network.".to_string()
            } else {
                text
            })
        }
        Err(error) => Err(format!("Could not run nmcli: {error}")),
    }
}
