use crate::process_runner::{Budget, CommandDeadlineExt};
use core_rs::exam::{
    CloseAppsResult, KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static SHIELD_ACTIVE: AtomicBool = AtomicBool::new(false);
static SHIELD_GENERATION: AtomicU64 = AtomicU64::new(0);

fn shield_generation_active(generation: u64) -> bool {
    SHIELD_ACTIVE.load(Ordering::SeqCst) && SHIELD_GENERATION.load(Ordering::SeqCst) == generation
}

const RESTRICTED: &[&str] = &[
    "obs",
    "obs-studio",
    "obs64",
    "discord",
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
    "zoom",
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
    // Comms apps that can screen-share
    "telegram-desktop",
    "telegram",
    "signal-desktop",
    "slack",
    "element-desktop",
    "whatsapp-for-linux",
];

const VM_STRINGS: &[&str] = &[
    "vmware",
    "virtualbox",
    "vbox",
    "kvm",
    "qemu",
    "bochs",
    "xen",
    "hyper-v",
    "hyperv",
    "parallels",
    "bhyve",
    "nutanix",
    "proxmox",
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

/// Scan /proc for running restricted processes.
pub fn scan_processes() -> ProcessScanResult {
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let mut found: Vec<String> = Vec::new();

    let proc_dir = match std::fs::read_dir("/proc") {
        Ok(entries) => entries,
        Err(error) => {
            crate::process_runner::record_failure(format!("Cannot enumerate processes: {error}"));
            return ProcessScanResult {
                found,
                clean: false,
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
        if let Some(r) = match_restricted(&proc_identity_names(pid)) {
            if !found.iter().any(|f| f == r) {
                found.push(r.to_string());
            }
        }
    }

    let clean = found.is_empty() && _budget.failure().is_none();
    ProcessScanResult { found, clean }
}

/// systemd-detect-virt prints the detected technology only without --quiet.
fn systemd_virtualization(success: bool, stdout: &[u8]) -> Option<String> {
    let name = String::from_utf8_lossy(stdout).trim().to_string();
    (success && !name.is_empty() && name != "none").then_some(name)
}

/// Detect virtualisation via DMI and cpuinfo.
pub fn detect_virtualization() -> VirtDetectionResult {
    let _budget = Budget::new(std::time::Duration::from_secs(6));
    let dmi_paths = [
        "/sys/class/dmi/id/product_name",
        "/sys/class/dmi/id/sys_vendor",
        "/sys/class/dmi/id/board_vendor",
        "/sys/class/dmi/id/bios_vendor",
        "/sys/class/dmi/id/product_version",
    ];

    for path in &dmi_paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let lower = content.to_lowercase();
            for &vm in VM_STRINGS {
                if lower.contains(vm) {
                    return VirtDetectionResult {
                        detected: true,
                        platform: Some(vm.to_string()),
                        confidence: "high".to_string(),
                    };
                }
            }
        }
    }

    // Check /proc/cpuinfo hypervisor flag
    if let Ok(cpuinfo) = std::fs::read_to_string("/proc/cpuinfo") {
        if cpuinfo.contains("hypervisor") {
            return VirtDetectionResult {
                detected: true,
                platform: Some("hypervisor".to_string()),
                confidence: "medium".to_string(),
            };
        }
        // CPUID hypervisor vendor strings
        for vm in &["VMwareVMware", "KVMKVMKVM", "XenVMMXenVMM", "Microsoft Hv"] {
            if cpuinfo.contains(vm) {
                return VirtDetectionResult {
                    detected: true,
                    platform: Some(vm.to_lowercase()),
                    confidence: "high".to_string(),
                };
            }
        }
    }

    // Check /proc/1/environ for container indicators
    if let Ok(environ) = std::fs::read_to_string("/proc/1/environ") {
        if environ.contains("container=")
            || environ.contains("DOCKER")
            || environ.contains("kubernetes")
        {
            return VirtDetectionResult {
                detected: true,
                platform: Some("container".to_string()),
                confidence: "medium".to_string(),
            };
        }
    }

    // Check systemd-detect-virt
    if let Ok(output) = std::process::Command::new("systemd-detect-virt").bounded_output() {
        if let Some(virt) = systemd_virtualization(output.status.success(), &output.stdout) {
            return VirtDetectionResult {
                detected: true,
                platform: Some(virt),
                confidence: "high".to_string(),
            };
        }
    }

    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high".to_string(),
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
    let content: String = map.iter().map(|(k, v)| format!("{k}\t{v}\n")).collect();
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

fn read_backup() -> Option<HashMap<String, String>> {
    // Current location first, then the legacy one, so a build that upgrades
    // while a crashed lockdown is outstanding still restores it.
    let content = std::fs::read_to_string(backup_file())
        .or_else(|_| std::fs::read_to_string(LEGACY_BACKUP_PATH))
        .ok()?;
    let mut map = HashMap::new();
    for line in content.lines() {
        if let Some((k, v)) = line.split_once('\t') {
            map.insert(k.to_string(), v.to_string());
        }
    }
    if map.is_empty() {
        None
    } else {
        Some(map)
    }
}

fn delete_backup() {
    let _ = std::fs::remove_file(backup_file());
    // The legacy copy too, or a stale /tmp file would be restored on a later
    // run and silently undo settings the candidate has since changed.
    let _ = std::fs::remove_file(LEGACY_BACKUP_PATH);
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

fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let out = std::process::Command::new("gsettings")
        .args(["get", schema, key])
        .bounded_output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
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

fn gsettings_set(schema: &str, key: &str, value: &str) -> bool {
    let wrote = std::process::Command::new("gsettings")
        .args(["set", schema, key, value])
        .stderr(std::process::Stdio::null())
        .bounded_status()
        .map(|s| s.success())
        .unwrap_or(false);
    wrote
        && gsettings_get(schema, key)
            .is_some_and(|actual| normalize_gvariant(&actual) == normalize_gvariant(value))
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

fn kde_tool(stem: &str) -> Option<&'static str> {
    let tools = match stem {
        "kreadconfig" => ["kreadconfig6", "kreadconfig5"],
        "kwriteconfig" => ["kwriteconfig6", "kwriteconfig5"],
        _ => return None,
    };
    tools.into_iter().find(|tool| {
        crate::process_runner::optional(|| {
            std::process::Command::new(tool)
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .bounded_status()
                .is_ok_and(|s| s.success())
        })
    })
}

// Missing KDE keys inherit defaults. Persist their absence so restoration can
// delete the temporary override instead of permanently replacing a default.
const KDE_UNSET: &str = "__AMS_ACCESS_UNSET_CONFIG_KEY__";

fn kconfig_get(file: &str, group: &str, key: &str) -> Option<String> {
    let out = std::process::Command::new(kde_tool("kreadconfig")?)
        .args([
            "--file",
            file,
            "--group",
            group,
            "--key",
            key,
            "--default",
            KDE_UNSET,
        ])
        .bounded_output()
        .ok()?;
    out.status.success().then(|| {
        String::from_utf8_lossy(&out.stdout)
            .trim_end_matches(['\r', '\n'])
            .to_string()
    })
}

fn kconfig_set(file: &str, group: &str, key: &str, value: &str) -> bool {
    let Some(tool) = kde_tool("kwriteconfig") else {
        return false;
    };
    let mut command = std::process::Command::new(tool);
    command.args(["--file", file, "--group", group, "--key", key]);
    if value == KDE_UNSET {
        command.arg("--delete");
    } else {
        command.arg(value);
    }
    command.bounded_status().is_ok_and(|s| s.success())
        && kconfig_get(file, group, key).is_some_and(|actual| actual == value)
}

fn kde_reconfigure() -> bool {
    let mut accel = false;
    let mut kwin = false;
    for bin in ["qdbus6", "qdbus-qt6", "qdbus"] {
        if !accel {
            accel = crate::process_runner::optional(|| {
                std::process::Command::new(bin)
                    .args([
                        "org.kde.kglobalaccel",
                        "/kglobalaccel",
                        "org.kde.KGlobalAccel.reconfigure",
                    ])
                    .bounded_status()
                    .is_ok_and(|s| s.success())
            });
        }
        if !kwin {
            kwin = crate::process_runner::optional(|| {
                std::process::Command::new(bin)
                    .args(["org.kde.KWin", "/KWin", "reconfigure"])
                    .bounded_status()
                    .is_ok_and(|s| s.success())
            });
        }
        if accel && kwin {
            return true;
        }
    }
    false
}

/// Capture AND persist each original value before applying a change. Existing
/// saved values win on retries; a read/write failure must not erase recovery.
fn backup_before_apply(
    saved: &mut HashMap<String, String>,
    key: &str,
    read: impl FnOnce() -> Option<String>,
    apply: impl FnOnce() -> bool,
    persist: impl FnOnce(&HashMap<String, String>) -> bool,
) -> bool {
    if !saved.contains_key(key) {
        let Some(original) = read() else {
            return false;
        };
        saved.insert(key.to_string(), original);
    }
    persist(saved) && apply()
}

/// Disable supported compositor shortcuts and report observed coverage.
pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("XDG_SESSION_DESKTOP"))
        .or_else(|_| std::env::var("GDMSESSION"))
        .unwrap_or_default()
        .to_lowercase();
    let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
    // Retain failed startup recovery values before recording anything new.
    if let Some(backup) = read_backup() {
        for (key, value) in backup {
            saved.entry(key).or_insert(value);
        }
    }
    let mut applied = 0;
    if desktop.contains("gnome") || desktop.contains("ubuntu") {
        let mut shortcuts_applied = 0;
        for (index, &(schema, key, value)) in GNOME_SHORTCUTS
            .iter()
            .chain(GNOME_DOCK_SETTINGS.iter())
            .enumerate()
        {
            if backup_before_apply(
                &mut saved,
                &format!("gnome/{schema}/{key}"),
                || gsettings_get(schema, key),
                || gsettings_set(schema, key, value),
                write_backup,
            ) {
                applied += 1;
                if index < GNOME_SHORTCUTS.len() && key != "enable-hot-corners" {
                    shortcuts_applied += 1;
                }
            }
        }
        let mut result = intercept_outcome(
            applied,
            GNOME_SHORTCUTS.len() + GNOME_DOCK_SETTINGS.len(),
            if is_wayland {
                "gsettings/wayland"
            } else {
                "gsettings/x11"
            },
        );
        // Dock layout or hot-corner changes alone are not a keyboard intercept.
        result.active = shortcuts_applied > 0;
        return result;
    }
    if desktop.contains("kde") || desktop.contains("plasma") {
        for &(group, key, value) in KDE_SHORTCUTS {
            if backup_before_apply(
                &mut saved,
                &format!("kde/{group}/{key}"),
                || kconfig_get("kglobalshortcutsrc", group, key),
                || kconfig_set("kglobalshortcutsrc", group, key, value),
                write_backup,
            ) {
                applied += 1;
            }
        }
        if backup_before_apply(
            &mut saved,
            "kde_meta",
            || kconfig_get("kwinrc", "ModifierOnlyShortcuts", "Meta"),
            || kconfig_set("kwinrc", "ModifierOnlyShortcuts", "Meta", "none"),
            write_backup,
        ) {
            applied += 1;
        }
        if !kde_reconfigure() {
            applied = 0;
        }
        return intercept_outcome(applied, KDE_SHORTCUTS.len() + 1, "kwriteconfig/kde");
    }
    intercept_outcome(0, 0, "unsupported")
}

// ── Touchpad control ──────────────────────────────────────────────────────────

/// Disable or re-enable the touchpad.
///
/// GNOME (X11 + Wayland): flips `org.gnome.desktop.peripherals.touchpad send-events`.
/// X11 non-GNOME fallback: disables every device whose name contains "touchpad"
/// via `xinput`. Silently no-ops on Wayland when neither path applies.
// `#[allow(clippy::map_entry)]` mirrors enable_keyboard_intercept: the
// contains_key/insert split is kept intentionally so the backup is only written
// when a value is actually captured (and the borrow of `saved` is released
// before write_backup), matching the existing `gnome/` backup idiom.
#[allow(clippy::map_entry)]
fn set_touchpad_enabled(enabled: bool) {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();
    let is_gnome = desktop.contains("gnome") || desktop.contains("ubuntu");

    if is_gnome {
        // LX-2a: when DISABLING, back up the current send-events value under the
        // same `gnome/<schema>/<key>` map-key convention used by the keyboard
        // intercept. recover_keyboard_if_crashed()/disable_keyboard_intercept()
        // already iterate every `gnome/`-prefixed key and restore it via
        // gsettings_set, so this value is restored automatically on crash recovery
        // and normal teardown with NO change to those functions. Only back up on
        // the disable path (enable is the restore direction) and only if not
        // already captured, mirroring enable_keyboard_intercept().
        if !enabled {
            let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
            backup_before_apply(
                &mut saved,
                "gnome/org.gnome.desktop.peripherals.touchpad/send-events",
                || gsettings_get("org.gnome.desktop.peripherals.touchpad", "send-events"),
                || {
                    gsettings_set(
                        "org.gnome.desktop.peripherals.touchpad",
                        "send-events",
                        "'disabled'",
                    )
                },
                write_backup,
            );
        }
        // GNOME restoration is performed from its original saved value by
        // disable_keyboard_intercept, never forced to an assumed enabled state.
        return;
    }

    let is_kde = desktop.contains("kde") || desktop.contains("plasma");
    set_optional_touchpad_enabled_with(enabled, is_kde, |program, args| {
        std::process::Command::new(program)
            .args(args)
            .bounded_output()
    });
}

// Only runtime, best-effort KDE/X11 touchpad controls are optional. Keep the
// journaled GNOME branch above and required keyboard setup outside this scope.
fn set_optional_touchpad_enabled_with(
    enabled: bool,
    is_kde: bool,
    mut run: impl FnMut(&str, &[&str]) -> std::io::Result<std::process::Output>,
) {
    crate::process_runner::optional(|| {
        // KDE: the xinput fallback below covers KDE on X11, but does nothing on
        // Wayland. On KDE Wayland the touchpad is driven by the KDED `touchpad`
        // module — ask it to disable/enable over DBus. BEST-EFFORT: the method lives
        // under `org.kde.kded6` (Plasma 6) or `org.kde.kded5` (Plasma 5); a missing
        // service / wrong version simply no-ops (no regression vs today). This path
        // is unverified on a live KDE Wayland session and should be smoke-tested
        // there. Runtime-only (not persisted) — `unlock` re-enables; matches xinput.
        if is_kde {
            let method = if enabled {
                "org.kde.touchpad.enable"
            } else {
                "org.kde.touchpad.disable"
            };
            // Try both the `qdbus`/`qdbus6` binary names and the Plasma 6/5 KDED
            // service names; the wrong combinations just no-op.
            for bin in ["qdbus", "qdbus6"] {
                for kded in ["org.kde.kded6", "org.kde.kded5"] {
                    let _ = run(bin, &[kded, "/modules/touchpad", method]);
                }
            }
            // fall through to xinput as well (covers KDE on X11).
        }

        // X11 fallback — xinput does nothing on Wayland but won't panic.
        let Ok(out) = run("xinput", &["list"]) else {
            return;
        };
        let ids: Vec<u32> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|line| line.to_lowercase().contains("touchpad"))
            .filter_map(|line| {
                // line format: "  ↳ Synaptics TouchPad   id=14   [slave  pointer  (2)]"
                line.split("id=")
                    .nth(1)?
                    .split_whitespace()
                    .next()?
                    .parse::<u32>()
                    .ok()
            })
            .collect();

        let action = if enabled { "enable" } else { "disable" };
        for id in ids {
            let _ = run("xinput", &[action, &id.to_string()]);
        }
    });
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
// On Wayland the touchpad is fully disabled above and GSettings already blocks
// all workspace-switch keyboard shortcuts, so no watchdog is needed there.
// On X11 a touchpad swipe can still slip through on non-WPT drivers — the watchdog
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

/// Restore all DE keybindings to their pre-exam values.
pub fn lock_desktop() -> bool {
    let active = enable_keyboard_intercept().active;
    if !active {
        return false;
    }
    set_touchpad_enabled(false);
    if !SHIELD_ACTIVE.swap(true, Ordering::SeqCst) {
        let generation = SHIELD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        spawn_kill_shield(generation);
        spawn_workspace_watchdog(generation);
        spawn_focus_watchdog(generation);
    }
    true
}

pub fn unlock_desktop() {
    SHIELD_ACTIVE.store(false, Ordering::SeqCst);
    SHIELD_GENERATION.fetch_add(1, Ordering::SeqCst);
    set_touchpad_enabled(true);
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
        || std::path::Path::new(LEGACY_BACKUP_PATH).exists()
}

pub fn disable_keyboard_intercept() {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(backup) = read_backup() {
        for (key, value) in backup {
            saved.entry(key).or_insert(value);
        }
    }
    restore_saved_settings(
        &mut saved,
        |key, value| {
            if let Some(path) = key.strip_prefix("gnome/") {
                return path
                    .split_once('/')
                    .is_some_and(|(schema, key)| gsettings_set(schema, key, value));
            }
            if let Some(path) = key.strip_prefix("kde/") {
                return path.split_once('/').is_some_and(|(group, key)| {
                    kconfig_set("kglobalshortcutsrc", group, key, value)
                });
            }
            key == "kde_meta" && kconfig_set("kwinrc", "ModifierOnlyShortcuts", "Meta", value)
        },
        kde_reconfigure,
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
    helper_send(r#"{"cmd":"ping"}"#)
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
fn configured_nameservers() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in ["/etc/resolv.conf", "/run/systemd/resolve/resolv.conf"] {
        let Ok(contents) = std::fs::read_to_string(path) else {
            continue;
        };
        for line in contents.lines() {
            if let Some(rest) = line.trim().strip_prefix("nameserver") {
                let candidate = rest.trim().to_string();
                if candidate.parse::<std::net::IpAddr>().is_ok() && !out.contains(&candidate) {
                    out.push(candidate);
                }
            }
        }
    }
    out
}

pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
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
        .filter(|ip| nameservers.contains(ip))
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
        .map_err(|e| format!("pkexec: {e}"))?;

    if !out.status.success() {
        // pkexec exit 126 = user dismissed/failed auth; 127 = pkexec missing.
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr);
        if code == 126 {
            return Err("admin_auth_cancelled".to_string());
        }
        if code == 127 {
            return Err("pkexec_not_available".to_string());
        }
        return Err(format!(
            "helper install failed (exit {code}): {}",
            stderr.trim()
        ));
    }

    // Give the daemon up to 3 s to create its socket before returning.
    for _ in 0..30 {
        if network_helper_running() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    Err("helper installed but socket not ready within 3 s".to_string())
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
            || {
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
            || {
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
            || {
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
            ("kde_meta".into(), super::KDE_UNSET.into()),
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
mod required_probe_review_tests {
    use super::systemd_virtualization;

    #[test]
    fn systemd_fallback_requires_success_and_detected_technology() {
        assert_eq!(systemd_virtualization(true, b"kvm\n"), Some("kvm".into()));
        assert_eq!(systemd_virtualization(false, b"none\n"), None);
        assert_eq!(systemd_virtualization(true, b"none\n"), None);
        assert_eq!(systemd_virtualization(true, b""), None);
        assert_eq!(systemd_virtualization(false, b"permission denied"), None);
    }
}

#[cfg(test)]
mod optional_touchpad_tests {
    use super::set_optional_touchpad_enabled_with;
    use crate::process_runner::{record_failure, Budget};
    use std::os::unix::process::ExitStatusExt;
    use std::time::Duration;

    fn output(stdout: &[u8]) -> std::process::Output {
        std::process::Output {
            status: std::process::ExitStatus::from_raw(0),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn missing_alternatives_do_not_poison_successful_kde_entry_or_restore() {
        for enabled in [false, true] {
            let budget = Budget::new(Duration::from_secs(2));
            let mut usable_calls = 0;
            set_optional_touchpad_enabled_with(enabled, true, |program, _| {
                if program == "qdbus6" {
                    usable_calls += 1;
                    Ok(output(b""))
                } else {
                    // Mirrors the runner recording a failed spawn. No native
                    // desktop commands are invoked by this regression.
                    record_failure(format!("{program}: executable not found"));
                    Err(std::io::ErrorKind::NotFound.into())
                }
            });
            assert_eq!(usable_calls, 2);
            assert!(budget.failure().is_none());
        }
    }

    #[test]
    fn optional_controls_preserve_required_failures_before_and_after_them() {
        let budget = Budget::new(Duration::from_secs(2));
        record_failure("required keyboard snapshot failed");
        set_optional_touchpad_enabled_with(false, true, |_, _| {
            record_failure("optional tool timed out");
            Err(std::io::ErrorKind::TimedOut.into())
        });
        assert_eq!(
            budget.failure().as_deref(),
            Some("required keyboard snapshot failed")
        );
        drop(budget);

        let budget = Budget::new(Duration::from_secs(2));
        set_optional_touchpad_enabled_with(false, false, |_, _| Ok(output(b"")));
        record_failure("required restoration failed");
        assert_eq!(
            budget.failure().as_deref(),
            Some("required restoration failed")
        );
    }

    #[test]
    fn xinput_fallback_still_applies_the_requested_action() {
        for (enabled, action) in [(false, "disable"), (true, "enable")] {
            let budget = Budget::new(Duration::from_secs(2));
            let mut calls = Vec::new();
            set_optional_touchpad_enabled_with(enabled, false, |program, args| {
                assert_eq!(program, "xinput");
                calls.push(args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>());
                Ok(output(if args == ["list"] {
                    b"Synaptics TouchPad id=14 [slave pointer (2)]\n"
                } else {
                    b""
                }))
            });
            assert_eq!(
                calls,
                vec![vec!["list".to_string()], vec![action.into(), "14".into()]]
            );
            assert!(budget.failure().is_none());
        }
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
