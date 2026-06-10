use core_rs::exam::{CloseAppsResult, KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult};
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

/// Scan /proc for running restricted processes.
pub fn scan_processes() -> ProcessScanResult {
    let mut found = Vec::new();

    let Ok(proc_dir) = std::fs::read_dir("/proc") else {
        return ProcessScanResult { found, clean: true };
    };

    for entry in proc_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let cmdline_path = format!("/proc/{}/cmdline", name);
        let Ok(raw) = std::fs::read(&cmdline_path) else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        // cmdline is null-separated; argv[0] is the executable path
        let exe = raw.split(|&b| b == 0).next().unwrap_or(&[]);
        let exe_str = String::from_utf8_lossy(exe).to_lowercase();
        // match only the basename so "/usr/bin/obs-studio" → "obs-studio"
        let basename = exe_str.rsplit('/').next().unwrap_or(&exe_str).to_string();
        for &r in RESTRICTED {
            if basename == r && !found.contains(&r.to_string()) {
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
fn set_touchpad_enabled(enabled: bool) {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();
    let is_gnome = desktop.contains("gnome") || desktop.contains("ubuntu");

    if is_gnome {
        let value = if enabled { "'enabled'" } else { "'disabled'" };
        gsettings_set(
            "org.gnome.desktop.peripherals.touchpad",
            "send-events",
            value,
        );
        return;
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
        let Ok(raw) = std::fs::read(format!("/proc/{}/cmdline", pid)) else {
            continue;
        };
        if raw.is_empty() {
            continue;
        }
        let exe = raw.split(|&b| b == 0).next().unwrap_or(&[]);
        let exe_str = String::from_utf8_lossy(exe).to_lowercase();
        let basename = exe_str.rsplit('/').next().unwrap_or(&exe_str).to_string();
        for &r in RESTRICTED {
            if basename == r {
                result.push((r.to_string(), pid));
                break;
            }
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

// ── Desktop lock / unlock ─────────────────────────────────────────────────────

/// Restore all DE keybindings to their pre-exam values.
pub fn lock_desktop() -> bool {
    SHIELD_ACTIVE.store(true, Ordering::SeqCst);
    set_touchpad_enabled(false);
    spawn_kill_shield();
    spawn_workspace_watchdog();
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

// ── Network lockdown (iptables) ───────────────────────────────────────────────

const IPTABLES_CHAIN: &str = "AMS_PROCTOR";

fn iptables(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("iptables")
        .args(args)
        .output()
        .map_err(|e| e.to_string())
}

/// Apply outbound firewall: allow only `allowed_ips`, block everything else.
/// Rules persist until `disable_network_lockdown` is called — intentional.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    // Tear down any leftover chain from a previous session (idempotent)
    let _ = iptables(&["-D", "OUTPUT", "-j", IPTABLES_CHAIN]);
    let _ = iptables(&["-F", IPTABLES_CHAIN]);
    let _ = iptables(&["-X", IPTABLES_CHAIN]);

    // Create fresh chain
    let out = iptables(&["-N", IPTABLES_CHAIN])?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr);
        if !msg.contains("Chain already exists") {
            return Err(format!("iptables -N failed: {}", msg));
        }
    }

    // Loopback always passes
    let out = iptables(&["-A", IPTABLES_CHAIN, "-o", "lo", "-j", "ACCEPT"])?;
    if !out.status.success() {
        return Err(format!(
            "iptables loopback rule failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Keep already-established connections alive (prevents exam session from dropping)
    let out = iptables(&[
        "-A",
        IPTABLES_CHAIN,
        "-m",
        "state",
        "--state",
        "ESTABLISHED,RELATED",
        "-j",
        "ACCEPT",
    ])?;
    if !out.status.success() {
        return Err(format!(
            "iptables established rule failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Allow each whitelisted IP
    for ip in allowed_ips {
        let out = iptables(&["-A", IPTABLES_CHAIN, "-d", ip.as_str(), "-j", "ACCEPT"])?;
        if !out.status.success() {
            return Err(format!(
                "iptables allow {} failed: {}",
                ip,
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    // Drop everything else
    let out = iptables(&["-A", IPTABLES_CHAIN, "-j", "DROP"])?;
    if !out.status.success() {
        return Err(format!(
            "iptables DROP rule failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Hook chain into OUTPUT (position 1 = evaluated first)
    let out = iptables(&["-I", "OUTPUT", "1", "-j", IPTABLES_CHAIN])?;
    if !out.status.success() {
        return Err(format!(
            "iptables OUTPUT hook failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(())
}

/// Remove the AMS_PROCTOR iptables chain and all its rules.
pub fn disable_network_lockdown() -> Result<(), String> {
    let _ = iptables(&["-D", "OUTPUT", "-j", IPTABLES_CHAIN]);
    let _ = iptables(&["-F", IPTABLES_CHAIN]);
    let _ = iptables(&["-X", IPTABLES_CHAIN]);
    Ok(())
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
