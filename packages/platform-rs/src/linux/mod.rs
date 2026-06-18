use core_rs::exam::{
    CloseAppsResult, KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult,
};
use std::sync::atomic::{AtomicBool, Ordering};

static SHIELD_ACTIVE: AtomicBool = AtomicBool::new(false);

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
    "xdotool",
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
    let lower = path.to_lowercase();
    lower.rsplit('/').next().unwrap_or(&lower).to_string()
}

/// Collect the identifying basenames for a pid: argv[0] from `/proc/<pid>/cmdline`
/// AND the real executable from `readlink /proc/<pid>/exe`. The `/proc/exe` link
/// is the kernel's record of the actual binary, which argv[0] spoofing cannot
/// forge, so checking both catches a process that lies in its cmdline. NOTE:
/// renaming the binary on disk evades both basenames — blocklists are advisory;
/// this is defense-in-depth, not a guarantee. `/proc/<pid>/exe` is only readable
/// for same-user (or root) processes; an unreadable link is skipped.
fn proc_identity_names(pid: u32) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    if let Ok(raw) = std::fs::read(format!("/proc/{}/cmdline", pid)) {
        if !raw.is_empty() {
            let argv0 = raw.split(|&b| b == 0).next().unwrap_or(&[]);
            let b = lower_basename(&String::from_utf8_lossy(argv0));
            if !b.is_empty() {
                names.push(b);
            }
        }
    }
    if let Ok(target) = std::fs::read_link(format!("/proc/{}/exe", pid)) {
        // readlink may append " (deleted)" if the binary was replaced after exec.
        let b = lower_basename(&target.to_string_lossy().replace(" (deleted)", ""));
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
    let mut found: Vec<String> = Vec::new();

    let Ok(proc_dir) = std::fs::read_dir("/proc") else {
        return ProcessScanResult { found, clean: true };
    };

    for entry in proc_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(pid) = name.parse::<u32>() else {
            continue;
        };
        if let Some(r) = match_restricted(&proc_identity_names(pid)) {
            if !found.iter().any(|f| f == r) {
                found.push(r.to_string());
            }
        }
    }

    let clean = found.is_empty();
    ProcessScanResult { found, clean }
}

/// Detect virtualisation via DMI and cpuinfo.
pub fn detect_virtualization() -> VirtDetectionResult {
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
    if let Ok(output) = std::process::Command::new("systemd-detect-virt")
        .arg("--quiet")
        .output()
    {
        if output.status.success() {
            let virt = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !virt.is_empty() && virt != "none" {
                return VirtDetectionResult {
                    detected: true,
                    platform: Some(virt),
                    confidence: "high".to_string(),
                };
            }
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

const BACKUP_PATH: &str = "/tmp/ams_access_kb_backup";

fn write_backup(map: &HashMap<String, String>) {
    let content: String = map.iter().map(|(k, v)| format!("{}\t{}\n", k, v)).collect();
    let _ = std::fs::write(BACKUP_PATH, content);
}

fn read_backup() -> Option<HashMap<String, String>> {
    let content = std::fs::read_to_string(BACKUP_PATH).ok()?;
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
    let _ = std::fs::remove_file(BACKUP_PATH);
}

/// Call on app startup — restores GSettings if a previous run crashed without cleanup.
/// Call on app startup — restores GSettings or KDE configs if a previous run crashed without cleanup.
pub fn recover_keyboard_if_crashed() {
    if let Some(backup) = read_backup() {
        let mut has_kde = false;
        for (map_key, original) in &backup {
            if map_key.starts_with("gnome/") {
                if let Some(path) = map_key.strip_prefix("gnome/") {
                    if let Some((schema, key)) = path.split_once('/') {
                        gsettings_set(schema, key, original);
                    }
                }
            } else if map_key.starts_with("kde/") {
                if let Some(path) = map_key.strip_prefix("kde/") {
                    if let Some((group, key)) = path.split_once('/') {
                        kwriteconfig_set(group, key, original);
                        has_kde = true;
                    }
                }
            } else if map_key == "kde_meta" {
                let _ = std::process::Command::new("kwriteconfig5")
                    .args([
                        "--file",
                        "kwinrc",
                        "--group",
                        "ModifierOnlyShortcuts",
                        "--key",
                        "Meta",
                        original,
                    ])
                    .status();
                has_kde = true;
            }
        }
        if has_kde {
            kde_reconfigure();
            let _ = std::process::Command::new("qdbus")
                .args(["org.kde.KWin", "/KWin", "reconfigure"])
                .status();
        }
        delete_backup();
    }
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
        .output()
        .ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn gsettings_set(schema: &str, key: &str, value: &str) {
    if gsettings_get(schema, key).is_none() {
        return;
    }
    let _ = std::process::Command::new("gsettings")
        .args(["set", schema, key, value])
        .stderr(std::process::Stdio::null())
        .status();
}

fn kreadconfig_get(group: &str, key: &str) -> Option<String> {
    let out = std::process::Command::new("kreadconfig5")
        .args([
            "--file",
            "kglobalshortcutsrc",
            "--group",
            group,
            "--key",
            key,
        ])
        .output()
        .ok()?;
    if out.status.success() {
        let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if val.is_empty() {
            None
        } else {
            Some(val)
        }
    } else {
        None
    }
}

fn kwriteconfig_set(group: &str, key: &str, value: &str) {
    let _ = std::process::Command::new("kwriteconfig5")
        .args([
            "--file",
            "kglobalshortcutsrc",
            "--group",
            group,
            "--key",
            key,
            value,
        ])
        .status();
}

fn kde_reconfigure() {
    let _ = std::process::Command::new("qdbus")
        .args([
            "org.kde.kglobalaccel",
            "/kglobalaccel",
            "org.kde.KGlobalAccel.reconfigure",
        ])
        .status();
}

/// Disable GNOME and KDE compositor shortcuts (Super, Alt+Tab, Alt+F4, launcher, etc.)
#[allow(clippy::map_entry)]
pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("XDG_SESSION_DESKTOP"))
        .or_else(|_| std::env::var("GDMSESSION"))
        .unwrap_or_default()
        .to_lowercase();
    let is_gnome = desktop.contains("gnome") || desktop.contains("ubuntu");
    let is_kde = desktop.contains("kde") || desktop.contains("plasma");

    if is_gnome {
        let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
        let all_settings = GNOME_SHORTCUTS.iter().chain(GNOME_DOCK_SETTINGS.iter());

        for &(schema, key, disable_val) in all_settings {
            let map_key = format!("gnome/{schema}/{key}");
            if !saved.contains_key(&map_key) {
                if let Some(current) = gsettings_get(schema, key) {
                    saved.insert(map_key.clone(), current);
                }
            }
            gsettings_set(schema, key, disable_val);
        }

        write_backup(&saved);

        let method = if is_wayland {
            "gsettings/wayland"
        } else {
            "gsettings/x11"
        };
        return KeyboardInterceptResult {
            active: true,
            method: method.to_string(),
            platform: "linux".to_string(),
        };
    } else if is_kde {
        let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());

        for &(group, key, disable_val) in KDE_SHORTCUTS {
            let map_key = format!("kde/{group}/{key}");
            if !saved.contains_key(&map_key) {
                if let Some(current) = kreadconfig_get(group, key) {
                    saved.insert(map_key.clone(), current);
                }
            }
            kwriteconfig_set(group, key, disable_val);
        }

        let meta_key = "kde_meta".to_string();
        if !saved.contains_key(&meta_key) {
            let current = std::process::Command::new("kreadconfig5")
                .args([
                    "--file",
                    "kwinrc",
                    "--group",
                    "ModifierOnlyShortcuts",
                    "--key",
                    "Meta",
                ])
                .output()
                .ok()
                .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
                .unwrap_or_default();
            if !current.is_empty() {
                saved.insert(meta_key, current);
            }
        }
        let _ = std::process::Command::new("kwriteconfig5")
            .args([
                "--file",
                "kwinrc",
                "--group",
                "ModifierOnlyShortcuts",
                "--key",
                "Meta",
                "none",
            ])
            .status();

        write_backup(&saved);

        kde_reconfigure();
        let _ = std::process::Command::new("qdbus")
            .args(["org.kde.KWin", "/KWin", "reconfigure"])
            .status();

        return KeyboardInterceptResult {
            active: true,
            method: "kwriteconfig/kde".to_string(),
            platform: "linux".to_string(),
        };
    }

    KeyboardInterceptResult {
        active: false,
        method: "unsupported".to_string(),
        platform: "linux".to_string(),
    }
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
            let map_key = "gnome/org.gnome.desktop.peripherals.touchpad/send-events".to_string();
            let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());
            if !saved.contains_key(&map_key) {
                if let Some(current) =
                    gsettings_get("org.gnome.desktop.peripherals.touchpad", "send-events")
                {
                    saved.insert(map_key, current);
                    write_backup(&saved);
                }
            }
        }

        let value = if enabled { "'enabled'" } else { "'disabled'" };
        gsettings_set(
            "org.gnome.desktop.peripherals.touchpad",
            "send-events",
            value,
        );
        return;
    }

    // KDE: the xinput fallback below covers KDE on X11, but does nothing on
    // Wayland. On KDE Wayland the touchpad is driven by the KDED `touchpad`
    // module — ask it to disable/enable over DBus. BEST-EFFORT: the method lives
    // under `org.kde.kded6` (Plasma 6) or `org.kde.kded5` (Plasma 5); a missing
    // service / wrong version simply no-ops (no regression vs today). This path
    // is unverified on a live KDE Wayland session and should be smoke-tested
    // there. Runtime-only (not persisted) — `unlock` re-enables; matches xinput.
    let is_kde = desktop.contains("kde") || desktop.contains("plasma");
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
                let _ = std::process::Command::new(bin)
                    .args([kded, "/modules/touchpad", method])
                    .output();
            }
        }
        // fall through to xinput as well (covers KDE on X11).
    }

    // X11 fallback — xinput does nothing on Wayland but won't panic.
    let Ok(out) = std::process::Command::new("xinput").arg("list").output() else {
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
        let _ = std::process::Command::new("xinput")
            .args([action, &id.to_string()])
            .output();
    }
}

// ── Process kill shield ───────────────────────────────────────────────────────

/// Returns (process_name, pid) pairs for every restricted process found in /proc.
fn scan_restricted_pids() -> Vec<(String, u32)> {
    let mut result = Vec::new();
    let Ok(proc_dir) = std::fs::read_dir("/proc") else {
        return result;
    };
    for entry in proc_dir.flatten() {
        let fname = entry.file_name().to_string_lossy().to_string();
        let Ok(pid) = fname.parse::<u32>() else {
            continue;
        };
        if let Some(r) = match_restricted(&proc_identity_names(pid)) {
            result.push((r.to_string(), pid));
        }
    }
    result
}

/// Spawn a background thread that kills restricted processes by PID every second.
fn spawn_kill_shield() {
    let our_pid = std::process::id();
    std::thread::Builder::new()
        .name("ams-kill-shield".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if !SHIELD_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            for (_, pid) in scan_restricted_pids() {
                if pid == our_pid {
                    continue;
                }
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
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

fn xdotool_int(args: &[&str]) -> Option<u32> {
    let out = std::process::Command::new("xdotool")
        .args(args)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Spawn a workspace-guard thread (no-op if not on X11 or xdotool/wmctrl absent).
fn spawn_workspace_watchdog() {
    // Only meaningful on X11.
    if std::env::var("DISPLAY").is_err() {
        return;
    }

    std::thread::Builder::new()
        .name("ams-workspace-guard".into())
        .spawn(|| {
            // Give the window manager time to map our window.
            let our_pid = std::process::id().to_string();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            let win_id: u64 = loop {
                // xdotool search --pid returns newline-separated window IDs.
                if let Some(id) = std::process::Command::new("xdotool")
                    .args(["search", "--pid", &our_pid, "--onlyvisible"])
                    .output()
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
                if std::time::Instant::now() > deadline {
                    return; // xdotool not available or window never appeared
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            };

            loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if !SHIELD_ACTIVE.load(Ordering::SeqCst) {
                    break;
                }

                let Some(active_desktop) = xdotool_int(&["get_desktop"]) else {
                    continue;
                };
                let Some(our_desktop) =
                    xdotool_int(&["get_desktop_for_window", &win_id.to_string()])
                else {
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
                        .output();
                    // Focus it.
                    let _ = std::process::Command::new("xdotool")
                        .args(["windowfocus", "--sync", &win_id.to_string()])
                        .output();
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
        .output()
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
fn spawn_focus_watchdog() {
    if std::env::var("DISPLAY").is_err() {
        return; // X11 only
    }
    std::thread::Builder::new()
        .name("ams-focus-guard".into())
        .spawn(|| {
            // Wait until at least one of our windows has mapped.
            let our_pid = std::process::id().to_string();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                if !our_window_ids(&our_pid).is_empty() {
                    break;
                }
                if std::time::Instant::now() > deadline {
                    return; // xdotool unavailable or window never appeared
                }
                std::thread::sleep(std::time::Duration::from_millis(200));
            }

            // Debounce: emit only on the transition into "not focused", so a
            // sustained focus loss is one violation, not one per poll.
            let mut lost = false;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if !SHIELD_ACTIVE.load(Ordering::SeqCst) {
                    break;
                }
                let active = std::process::Command::new("xdotool")
                    .arg("getactivewindow")
                    .output()
                    .ok()
                    .and_then(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .trim()
                            .parse::<u64>()
                            .ok()
                    });
                let Some(active) = active else {
                    continue; // active window unresolvable — don't flap
                };
                // Re-scan our windows each poll (xdotool search is ~ms) so a
                // newly-mapped dialog counts as ours. An empty set means the scan
                // transiently failed — skip rather than emit a false positive.
                let ours = our_window_ids(&our_pid);
                if ours.is_empty() {
                    continue;
                }
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
    SHIELD_ACTIVE.store(true, Ordering::SeqCst);
    set_touchpad_enabled(false);
    spawn_kill_shield();
    spawn_workspace_watchdog();
    spawn_focus_watchdog();
    enable_keyboard_intercept().active
}

pub fn unlock_desktop() {
    SHIELD_ACTIVE.store(false, Ordering::SeqCst);
    set_touchpad_enabled(true);
    disable_keyboard_intercept();
}

pub fn disable_keyboard_intercept() {
    let mut saved = saved().lock().unwrap_or_else(|e| e.into_inner());

    if saved.is_empty() {
        if let Some(backup) = read_backup() {
            let mut has_kde = false;
            for (map_key, original) in &backup {
                if map_key.starts_with("gnome/") {
                    if let Some(path) = map_key.strip_prefix("gnome/") {
                        if let Some((schema, key)) = path.split_once('/') {
                            gsettings_set(schema, key, original);
                        }
                    }
                } else if map_key.starts_with("kde/") {
                    if let Some(path) = map_key.strip_prefix("kde/") {
                        if let Some((group, key)) = path.split_once('/') {
                            kwriteconfig_set(group, key, original);
                            has_kde = true;
                        }
                    }
                } else if map_key == "kde_meta" {
                    let _ = std::process::Command::new("kwriteconfig5")
                        .args([
                            "--file",
                            "kwinrc",
                            "--group",
                            "ModifierOnlyShortcuts",
                            "--key",
                            "Meta",
                            original,
                        ])
                        .status();
                    has_kde = true;
                }
            }
            if has_kde {
                kde_reconfigure();
                let _ = std::process::Command::new("qdbus")
                    .args(["org.kde.KWin", "/KWin", "reconfigure"])
                    .status();
            }
        }
        delete_backup();
        return;
    }

    let mut has_kde = false;
    let keys: Vec<String> = saved.keys().cloned().collect();
    for map_key in keys {
        if map_key.starts_with("gnome/") {
            if let Some(original) = saved.remove(&map_key) {
                if let Some(path) = map_key.strip_prefix("gnome/") {
                    if let Some((schema, key)) = path.split_once('/') {
                        gsettings_set(schema, key, &original);
                    }
                }
            }
        } else if map_key.starts_with("kde/") {
            if let Some(original) = saved.remove(&map_key) {
                if let Some(path) = map_key.strip_prefix("kde/") {
                    if let Some((group, key)) = path.split_once('/') {
                        kwriteconfig_set(group, key, &original);
                        has_kde = true;
                    }
                }
            }
        } else if map_key == "kde_meta" {
            if let Some(original) = saved.remove("kde_meta") {
                let _ = std::process::Command::new("kwriteconfig5")
                    .args([
                        "--file",
                        "kwinrc",
                        "--group",
                        "ModifierOnlyShortcuts",
                        "--key",
                        "Meta",
                        &original,
                    ])
                    .status();
                has_kde = true;
            }
        }
    }

    if has_kde {
        kde_reconfigure();
        let _ = std::process::Command::new("qdbus")
            .args(["org.kde.KWin", "/KWin", "reconfigure"])
            .status();
    }

    delete_backup();
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

use std::io::{BufRead as _, BufReader, Write as _};
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

/// In-memory token for the lockdown this process established. Held only in RAM
/// (never persisted) so a crash-relaunch deliberately cannot lift the lockdown.
static SESSION_TOKEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

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
    match UnixStream::connect(HELPER_SOCKET) {
        Ok(s) => Ok(s),
        Err(primary) => UnixStream::connect(HELPER_SOCKET_FALLBACK)
            .map_err(|fallback| format!("{HELPER_CONNECT_ERR_PREFIX} ({HELPER_SOCKET}: {primary}; {HELPER_SOCKET_FALLBACK}: {fallback})")),
    }
}

/// Send a single newline-delimited JSON command and parse the `{"ok":...}` reply.
fn helper_send(json: &str) -> Result<(), String> {
    let stream = helper_connect()?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
        .ok();

    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    writeln!(writer, "{json}").map_err(|e| format!("send: {e}"))?;

    let mut reader = BufReader::new(stream);
    let mut response = String::new();
    reader
        .read_line(&mut response)
        .map_err(|e| format!("read response: {e}"))?;

    let parsed: serde_json::Value = serde_json::from_str(response.trim())
        .map_err(|e| format!("invalid helper response: {e}"))?;

    if parsed.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(parsed
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("helper command failed")
            .to_string())
    }
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
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    // Mint + remember this session's token, then send it with the allowlist.
    let token = mint_token();
    {
        let mut slot = SESSION_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        *slot = Some(token.clone());
    }
    let request =
        serde_json::json!({ "cmd": "enable", "ips": allowed_ips, "token": token }).to_string();
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

/// Lift the network lockdown via the privileged helper, presenting this
/// session's token. A connection failure means the helper isn't running, so
/// there is nothing to flush — treated as success. On success the in-memory
/// token is cleared.
pub fn disable_network_lockdown() -> Result<(), String> {
    let token = {
        let slot = SESSION_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        slot.clone().unwrap_or_default()
    };
    let request = serde_json::json!({ "cmd": "disable", "token": token }).to_string();
    match helper_send(&request) {
        Ok(()) => {
            let mut slot = SESSION_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
            *slot = None;
            Ok(())
        }
        Err(e) if e.starts_with(HELPER_CONNECT_ERR_PREFIX) => Ok(()),
        Err(e) => Err(e),
    }
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
        .output()
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
    let mut closed = Vec::new();
    let mut failed = Vec::new();

    // Phase 1: SIGTERM all named processes.
    for name in names {
        let _ = std::process::Command::new("pkill")
            .args(["-15", "-x", name])
            .output();
    }

    std::thread::sleep(std::time::Duration::from_millis(600));

    // Phase 2: SIGKILL survivors.
    for name in names {
        if linux_process_alive(name) {
            let _ = std::process::Command::new("pkill")
                .args(["-9", "-x", name])
                .output();
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
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{lower_basename, match_restricted, mint_token};

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
