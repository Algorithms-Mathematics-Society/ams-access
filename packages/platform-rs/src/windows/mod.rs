use core_rs::exam::{
    CloseAppsResult, DisplayScan, KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult,
};
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

/// CreateProcess flag that suppresses the console window of a child process.
/// Without it, every console helper we shell out to (tasklist, reg, netsh,
/// taskkill, systeminfo) flashes a black cmd window — and because the live scan
/// and the kill-shield run on tight loops, those windows flicker continuously.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a `Command` for a console helper that never flashes a window.
/// Use this for every spawn that runs a console-mode program; GUI launchers
/// (e.g. explorer.exe) don't need it and should not be silenced.
fn hidden_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static SHIELD_ACTIVE: AtomicBool = AtomicBool::new(false);
static ESCAPE_BLOCKED: AtomicBool = AtomicBool::new(true);
// Set to true between spawn_hook_thread() call and HOOK_THREAD_ID becoming non-zero.
// Prevents the watchdog from treating the startup window as a dead thread.
static HOOK_STARTING: AtomicBool = AtomicBool::new(false);

/// All processes killed by the shield thread during an exam session.
const RESTRICTED: &[&str] = &[
    // Remote access / screen share
    "teamviewer.exe",
    "teamviewerhost.exe",
    "anydesk.exe",
    "vncviewer.exe",
    "tvnviewer.exe",
    "rustdesk.exe",
    "parsec.exe",
    "nomachine.exe",
    "nxplayer.exe",
    "remotedesktopmanager.exe",
    "mstsc.exe",
    "rdpclip.exe",
    // Communication tools with built-in screen share
    "discord.exe",
    "zoom.exe",
    "teams.exe",
    "ms-teams.exe",
    "skype.exe",
    "webex.exe",
    "slack.exe",
    // Screen recorders
    "obs64.exe",
    "obs32.exe",
    "obs.exe",
    "bandicam.exe",
    "fraps.exe",
    "dxtory.exe",
    "xsplit.broadcaster.exe",
    "xsplit.gamecaster.exe",
    "action.exe", // Mirillis Action!
    "medal.exe",  // Medal.tv
    "loom.exe",
    "flashback.exe", // BB FlashBack
    "recordit.exe",
    "screenpresso.exe",
    "sharex.exe",
    "lightshot.exe",
    "greenshot.exe",
    "snagit32.exe",
    "snagit64.exe",
    "snagiteditor.exe",
    "camtasia.exe",
    // NVIDIA ShadowPlay / GeForce Experience
    "nvcontainer.exe",
    "nvcapture.exe",
    "nvsphelper64.exe",
    // Xbox Game Bar and gaming overlays
    "gamebarpresencewriter.exe",
    "gamebar.exe",
    "xboxgameoverlay.exe",
    "overwolf.exe",
    // Debugging / packet inspection
    "cheatengine-x86_64.exe",
    "cheatengine.exe",
    "wireshark.exe",
    "x64dbg.exe",
    "x32dbg.exe",
    "ollydbg.exe",
    "processhacker.exe",
    "procexp.exe",
    "procexp64.exe",
    "autohotkey.exe",
    "autohotkey64.exe",
    "charles.exe",
    "fiddler.exe",
    // Interception / tunnel tools — no legitimate exam use (F15). VPN clients and
    // Burp (runs under javaw.exe) are intentionally NOT here: VPN needs the
    // organizer-override design and Burp needs behavioral detection — both are
    // deferred to the network-cluster slice.
    "mitmproxy.exe",
    "mitmdump.exe",
    "mitmweb.exe",
    "ngrok.exe",
];

/// Processes whose mere presence is sufficient to declare active screen capture.
/// Game Bar and nvcontainer are intentionally absent — they are gated in
/// detect_screen_capture() Layers 2 and 3 with additional registry checks to
/// avoid false positives on gaming PCs.
const CAPTURE_PROCESSES: &[&str] = &[
    "obs64.exe",
    "obs32.exe",
    "obs.exe",
    "bandicam.exe",
    "fraps.exe",
    "dxtory.exe",
    "xsplit.broadcaster.exe",
    "xsplit.gamecaster.exe",
    "action.exe",
    "medal.exe",
    "loom.exe",
    "flashback.exe",
    "screenpresso.exe",
    "sharex.exe",
    "lightshot.exe",
    "greenshot.exe",
    "snagit32.exe",
    "snagit64.exe",
    "snagiteditor.exe",
    "camtasia.exe",
    "nvcapture.exe", // nvcapture = dedicated ShadowPlay capture service; no false positives
    "discord.exe",
    "zoom.exe",
    "teams.exe",
    "ms-teams.exe",
    "skype.exe",
    "parsec.exe",
    "nomachine.exe",
    // Remote-access / screen-share tools: presence here means a remote party can
    // see the candidate's screen (a possible proctoring bypass). These are also in
    // RESTRICTED (killed at lockdown) but were never *flagged* at readiness.
    "teamviewer.exe",
    "teamviewerhost.exe",
    "anydesk.exe",
    "vncviewer.exe",
    "tvnviewer.exe",
    "rustdesk.exe",
    "mstsc.exe",
    "webex.exe",
    "remotedesktopmanager.exe",
    "nxplayer.exe",
];

// ── Elevation check ───────────────────────────────────────────────────────────

/// True when the process token is elevated (UAC "Administrator").
///
/// Token query, not `net session` — that command depends on the LanmanServer
/// service and reports "not admin" on machines where the service is disabled,
/// which would hard-block readiness for a candidate who IS elevated.
pub fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut TOKEN_ELEVATION as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

/// Command-line marker handed to the elevated instance so it knows it is the
/// product of a relaunch. Startup auto-elevation checks for this and refuses to
/// prompt again, so a declined or ineffective elevation can never loop into a
/// UAC storm. A fresh manual launch (no marker) is free to prompt again.
pub const RELAUNCH_MARKER: &str = "--ams-relaunched";

/// Relaunch this executable elevated via the `runas` shell verb. This raises
/// the standard one-click UAC consent prompt — the candidate never has to
/// find the exe and right-click "Run as administrator" themselves. The elevated
/// instance is started with [`RELAUNCH_MARKER`] so it won't try to elevate again.
///
/// Returns Ok(()) once the elevated instance has been started; the caller is
/// responsible for exiting the current (unelevated) instance. `uac_declined`
/// means the candidate dismissed the consent prompt.
pub fn relaunch_as_admin() -> Result<(), String> {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    if is_elevated() {
        return Ok(());
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_w = HSTRING::from(exe.as_os_str());
    let hinstance = unsafe {
        ShellExecuteW(
            None,
            w!("runas"),
            PCWSTR(exe_w.as_ptr()),
            // w! needs a literal; must stay equal to RELAUNCH_MARKER above.
            w!("--ams-relaunched"),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };

    // Per ShellExecuteW docs the return value is > 32 on success;
    // SE_ERR_ACCESSDENIED (5) is what a declined UAC prompt produces.
    if hinstance.0 as isize > 32 {
        Ok(())
    } else {
        Err("uac_declined".to_string())
    }
}

/// Deep-link straight into the Windows Settings page that controls the given
/// permission, so a candidate fixes an OS-level privacy block with one click
/// instead of hunting through Settings manually.
pub fn open_privacy_settings(section: &str) -> Result<(), String> {
    let uri = match section {
        "camera" => "ms-settings:privacy-webcam",
        "microphone" => "ms-settings:privacy-microphone",
        _ => return Err(format!("unknown_settings_section:{section}")),
    };
    // explorer.exe resolves ms-settings: URIs without flashing a console window.
    std::process::Command::new("explorer.exe")
        .arg(uri)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Escape context control ────────────────────────────────────────────────────

pub fn set_escape_blocked(blocked: bool) {
    ESCAPE_BLOCKED.store(blocked, Ordering::SeqCst);
}

// ── Process scanning ──────────────────────────────────────────────────────────

pub struct FoundProcess {
    pub name: String,
    pub pid: u32,
}

/// Returns restricted processes with their PIDs for precise kill-by-PID.
pub fn scan_processes_with_pids() -> Vec<FoundProcess> {
    let mut found = Vec::new();
    let Ok(out) = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
    else {
        return found;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        // CSV format: "image.exe","PID","Session Name","Session#","Mem Usage"
        let mut cols = line.splitn(5, ',');
        let image = cols.next().unwrap_or("").trim_matches('"').to_lowercase();
        let pid_str = cols.next().unwrap_or("").trim_matches('"');
        let pid: u32 = pid_str.parse().unwrap_or(0);
        if pid == 0 {
            continue;
        }
        for &r in RESTRICTED {
            if image == r {
                found.push(FoundProcess {
                    name: r.to_string(),
                    pid,
                });
                break;
            }
        }
    }
    found
}

pub fn scan_processes() -> ProcessScanResult {
    let procs = scan_processes_with_pids();
    let clean = procs.is_empty();
    let found = procs
        .into_iter()
        .map(|p| p.name.trim_end_matches(".exe").to_string())
        .collect();
    ProcessScanResult { found, clean }
}

// ── Screen capture detection ──────────────────────────────────────────────────

/// Multi-layer detection of active screen capture.
///
/// `apply_capture_protection()` is the prevention layer (makes window black).
/// This function is the detection layer for logging and UI warnings.
pub fn detect_screen_capture() -> bool {
    let ps = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    // Layer 1: known capture process is running
    for name in CAPTURE_PROCESSES {
        if ps.contains(*name) {
            return true;
        }
    }

    // Layer 2: Game Bar — only flag if it survived kill-shield AND DVR is still enabled.
    // Game Bar processes are NOT in CAPTURE_PROCESSES (Layer 1) so this check is reachable.
    // Rationale: gamebar.exe runs for GPU overlay on many gaming PCs; its presence alone
    // is not a capture signal. DVR-enabled + running = active capture threat.
    let gamebar_running = ps.contains("gamebarpresencewriter")
        || ps.contains("gamebar")
        || ps.contains("xboxgameoverlay");
    if gamebar_running
        && (reg_dword_nonzero(r"HKCU\System\GameConfigStore", "GameDVR_Enabled")
            || reg_dword_nonzero(
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR",
                "AppCaptureEnabled",
            ))
    {
        return true;
    }

    // Layer 3: nvcontainer.exe — hosts many NVIDIA services (telemetry, driver IPC, etc.)
    // Only flag when the dedicated ShadowPlay capture registry key is enabled.
    if ps.contains("nvcontainer")
        && reg_dword_nonzero(
            r"HKCU\SOFTWARE\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS",
            "Enabled",
        )
    {
        return true;
    }

    false
}

/// Apply DWM capture exclusion to the exam window so it renders as solid black
/// to all screen capture APIs: WGC (used by Google Meet, Teams, OBS), DXGI
/// output duplication, BitBlt/PrintScreen, and browser-based meeting tools.
///
/// Requires Windows 10 2004+ (19041) for WDA_EXCLUDEFROMCAPTURE.
/// Falls back to WDA_MONITOR on older builds which blocks DWM-path captures.
///
/// `hwnd_raw` is the HWND cast to isize (obtained from `WebviewWindow::hwnd()`).
pub fn apply_capture_protection(hwnd_raw: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WINDOW_DISPLAY_AFFINITY,
    };

    // 0x11 = WDA_EXCLUDEFROMCAPTURE (Windows 10 2004+)
    // Excludes from ALL capture paths: WGC, DXGI ODuplication, GDI BitBlt, print-screen
    const WDA_EXCLUDEFROMCAPTURE: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x11);
    // 0x01 = WDA_MONITOR — older fallback; blocks GDI/DWM captures but not WGC
    const WDA_MONITOR: WINDOW_DISPLAY_AFFINITY = WINDOW_DISPLAY_AFFINITY(0x01);

    let hwnd = HWND(hwnd_raw as *mut _);
    unsafe {
        if SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE).is_ok() {
            return true;
        }
        // Fallback for Windows 10 pre-2004
        SetWindowDisplayAffinity(hwnd, WDA_MONITOR).is_ok()
    }
}

// ── Registry helpers ──────────────────────────────────────────────────────────

fn reg_dword_nonzero(key: &str, value: &str) -> bool {
    let Ok(out) = hidden_command("reg")
        .args(["query", key, "/v", value])
        .output()
    else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    if let Some(hex) = text.split("0x").nth(1) {
        let part = hex.split_whitespace().next().unwrap_or("0");
        return u64::from_str_radix(part, 16).unwrap_or(0) != 0;
    }
    false
}

fn reg_key_exists(key: &str) -> bool {
    hidden_command("reg")
        .args(["query", key])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn reg_set(key: &str, value_name: &str, data: &str) {
    let _ = hidden_command("reg")
        .args([
            "add",
            key,
            "/v",
            value_name,
            "/t",
            "REG_DWORD",
            "/d",
            data,
            "/f",
        ])
        .output();
}

fn reg_delete_value(key: &str, value_name: &str) {
    let _ = hidden_command("reg")
        .args(["delete", key, "/v", value_name, "/f"])
        .output();
}

// ── Sleep prevention ──────────────────────────────────────────────────────────

fn set_sleep_prevention(enable: bool) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    unsafe {
        if enable {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

// ── Registry lockdown ─────────────────────────────────────────────────────────

fn apply_registry_policies(enable: bool) {
    if enable {
        reg_set(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System",
            "DisableTaskMgr",
            "1",
        );
        reg_set(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer",
            "NoWinKeys",
            "1",
        );
    } else {
        reg_delete_value(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System",
            "DisableTaskMgr",
        );
        reg_delete_value(
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer",
            "NoWinKeys",
        );
    }
}

fn set_touchpad_gestures_enabled(enabled: bool) {
    let val = if enabled { "1" } else { "0" };
    // Windows Precision Touchpad (WPT) multi-finger gesture registry keys.
    // These are read dynamically by the WPT driver — no restart required.
    // Non-WPT touchpads (legacy Synaptics/Elan) use vendor-specific drivers
    // and are not affected by these keys; the virtual desktop guard thread
    // catches escapes from those devices instead.
    reg_set(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad",
        "ThreeFingerSlideEnabled",
        val,
    );
    reg_set(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad",
        "FourFingerSlideEnabled",
        val,
    );
}

fn set_game_bar_enabled(enabled: bool) {
    let val = if enabled { "1" } else { "0" };
    reg_set(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR",
        "AppCaptureEnabled",
        val,
    );
    reg_set(r"HKCU\System\GameConfigStore", "GameDVR_Enabled", val);
    // Disable the Game Bar shell presence itself
    reg_set(
        r"HKCU\Software\Microsoft\GameBar",
        "UseNexusForGameBarEnabled",
        val,
    );
}

// ── Crash recovery ────────────────────────────────────────────────────────────

/// Clears registry lockdown left by a previous crashed session.
/// Must be called before Tauri initialises so it completes before any
/// enable_keyboard_intercept() call can race the restore.
pub fn recover_registry_if_crashed() {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System";
    let task_mgr_set = hidden_command("reg")
        .args(["query", key, "/v", "DisableTaskMgr"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if task_mgr_set {
        eprintln!("AMS Access: crashed-session registry state detected — restoring");
        apply_registry_policies(false);
        set_game_bar_enabled(true);
        set_touchpad_gestures_enabled(true);
        let _ = disable_network_lockdown();
        set_sleep_prevention(false);
    }
}

// ── Desktop lock / unlock ─────────────────────────────────────────────────────

pub fn lock_desktop() -> bool {
    set_sleep_prevention(true);
    apply_registry_policies(true);
    set_game_bar_enabled(false);
    set_touchpad_gestures_enabled(false);

    SHIELD_ACTIVE.store(true, Ordering::SeqCst);
    std::thread::spawn(|| {
        while SHIELD_ACTIVE.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            if !SHIELD_ACTIVE.load(Ordering::SeqCst) {
                break;
            }
            for proc in scan_processes_with_pids() {
                // Kill by PID — avoids name collision with legitimate same-named processes
                let _ = hidden_command("taskkill")
                    .args(["/F", "/PID", &proc.pid.to_string()])
                    .output();
            }
        }
    });

    let result = enable_keyboard_intercept();
    result.active
}

pub fn unlock_desktop() {
    set_sleep_prevention(false);
    apply_registry_policies(false);
    set_game_bar_enabled(true);
    set_touchpad_gestures_enabled(true);
    SHIELD_ACTIVE.store(false, Ordering::SeqCst);
    disable_keyboard_intercept();
}

// ── Virtualization detection (fast: registry + CPUID + ACPI, systeminfo fallback) ──

pub fn detect_virtualization() -> VirtDetectionResult {
    // Method 1: Specific registry keys left by VM guest tools (<100 ms total).
    // Hyper-V VM guest key is checked here — critical for the MicrosoftHyperV CPUID
    // exclusion in Method 2 to be correct.
    const VM_REGISTRY_KEYS: &[(&str, &str)] = &[
        (r"HKLM\SOFTWARE\VMware, Inc.\VMware Tools", "vmware"),
        (
            r"HKLM\SOFTWARE\Oracle\VirtualBox Guest Additions",
            "virtualbox",
        ),
        (
            r"HKLM\SOFTWARE\Microsoft\Virtual Machine\Guest\Parameters",
            "hyper-v",
        ),
        (r"HKLM\HARDWARE\ACPI\DSDT\VBOX__", "virtualbox"),
        (r"HKLM\HARDWARE\ACPI\DSDT\BOCHS_", "bochs"),
        (r"HKLM\HARDWARE\ACPI\DSDT\QEMU", "qemu"),
        (r"HKLM\HARDWARE\ACPI\FADT\VBOX__", "virtualbox"),
    ];
    for (key, platform) in VM_REGISTRY_KEYS {
        if reg_key_exists(key) {
            return VirtDetectionResult {
                detected: true,
                platform: Some(platform.to_string()),
                confidence: "high".to_string(),
            };
        }
    }

    // Method 2: CPUID hypervisor present bit (~1µs, no I/O — fastest possible check).
    //
    // MicrosoftHyperV is intentionally excluded: Windows 11 enables Hyper-V VBS /
    // Credential Guard / HVCI on bare-metal hardware, which sets the CPUID hypervisor
    // bit with vendor "Microsoft Hv" but is NOT a VM. If this were a real Hyper-V VM,
    // the Guest\Parameters registry key (Method 1) would have already matched and
    // returned. Reaching this point means that key is absent → treat "Microsoft Hv" as
    // VBS on bare metal and fall through.
    {
        let cpuid = raw_cpuid::CpuId::new();
        if let Some(hv) = cpuid.get_hypervisor_info() {
            let kind = hv.identify();
            if !matches!(kind, raw_cpuid::Hypervisor::HyperV) {
                let platform = match kind {
                    raw_cpuid::Hypervisor::VMware => "vmware",
                    raw_cpuid::Hypervisor::KVM => "kvm",
                    raw_cpuid::Hypervisor::Xen => "xen",
                    raw_cpuid::Hypervisor::QEMU => "qemu",
                    raw_cpuid::Hypervisor::Bhyve => "bhyve",
                    // Parallels has no dedicated raw-cpuid variant; it surfaces
                    // as Unknown(..) and is still reported as detected.
                    _ => "unknown_hypervisor",
                };
                return VirtDetectionResult {
                    detected: true,
                    platform: Some(platform.to_string()),
                    confidence: "high".to_string(),
                };
            }
        }
    }

    // Method 3: ACPI table name scan (~30ms) — catches QEMU / bochs without guest tools.
    if let Ok(out) = hidden_command("reg")
        .args(["query", r"HKLM\HARDWARE\ACPI\DSDT"])
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        for vm in &["vbox", "vmware", "qemu", "bochs", "xen", "bxpc"] {
            if text.contains(vm) {
                return VirtDetectionResult {
                    detected: true,
                    platform: Some(vm.to_string()),
                    confidence: "high".to_string(),
                };
            }
        }
    }

    // Method 4: systeminfo — last resort for unusual / hardened VMs that leave no
    // registry or CPUID traces. Capped at 3s to avoid a visible onboarding stall.
    // Confidence is "medium" because this relies on loose string matching of
    // English-localised systeminfo output.
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = std::thread::Builder::new()
            .name("ams-sysinfo-vm".into())
            .spawn(move || {
                let _ = tx.send(hidden_command("systeminfo").output());
            });
        if let Ok(Ok(out)) = rx.recv_timeout(std::time::Duration::from_secs(3)) {
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for vm in &[
                "vmware",
                "virtualbox",
                "virtual machine",
                "hyper-v",
                "kvm",
                "xen",
                "qemu",
                "parallels",
            ] {
                if text.contains(vm) {
                    return VirtDetectionResult {
                        detected: true,
                        platform: Some(vm.to_string()),
                        confidence: "medium".to_string(),
                    };
                }
            }
        }
    }

    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high".to_string(),
    }
}

// ── Remote desktop detection ──────────────────────────────────────────────────

pub fn detect_remote_desktop() -> bool {
    // Method 1: SESSIONNAME for built-in Windows RDP
    if std::env::var("SESSIONNAME")
        .map(|s| s.to_uppercase().contains("RDP"))
        .unwrap_or(false)
    {
        return true;
    }

    // Method 2: SM_REMOTESESSION — non-zero in any WTS/RDP remote session
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};
        if GetSystemMetrics(SM_REMOTESESSION) != 0 {
            return true;
        }
    }

    // Method 3: Known third-party remote agents not already in RESTRICTED
    // (belt-and-suspenders — RESTRICTED kill-shield covers these too)
    let ps = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase())
        .unwrap_or_default();

    for agent in &[
        "teamviewer.exe",
        "teamviewerhost.exe",
        "anydesk.exe",
        "vncviewer.exe",
        "rustdesk.exe",
        "parsec.exe",
        "nomachine.exe",
    ] {
        if ps.contains(*agent) {
            return true;
        }
    }

    false
}

// ── External-display detection (F10) ──────────────────────────────────────────

/// Probe the attached display topology.
///
/// `count` is the number of display monitors currently attached (a candidate
/// running a second screen the proctor cannot see is a high-value cheating
/// vector). `has_extra` is the must-have signal (`count > 1`). `has_wireless`
/// is a best-effort bonus: it scans the active QueryDisplayConfig paths for a
/// wireless/virtual output technology (Miracast, indirect-virtual, indirect-
/// wired e.g. Spacedesk/iDisplay), which a plain monitor count can miss when a
/// wireless sink mirrors rather than extends. Never panics; on any Win32 error
/// the corresponding signal degrades to a conservative default.
pub fn detect_external_displays() -> core_rs::exam::DisplayScan {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

    // Monitor count: SM_CMONITORS counts display monitors on the desktop. It
    // returns 0 only on failure, in which case we assume a single display so we
    // never block a candidate on a query glitch.
    let raw = unsafe { GetSystemMetrics(SM_CMONITORS) };
    let count = if raw <= 0 { 1 } else { raw as u32 };
    let has_extra = count > 1;

    DisplayScan {
        count,
        has_extra,
        has_wireless: detect_wireless_display(),
    }
}

/// Best-effort: true when an *active* display path uses a wireless or virtual
/// output technology. Conservative — any QueryDisplayConfig failure returns
/// false (we never manufacture a wireless signal we can't prove).
fn detect_wireless_display() -> bool {
    use windows::Win32::Devices::Display::{
        GetDisplayConfigBufferSizes, QueryDisplayConfig, DISPLAYCONFIG_MODE_INFO,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL,
        DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST,
        DISPLAYCONFIG_PATH_INFO, QDC_ONLY_ACTIVE_PATHS,
    };
    use windows::Win32::Foundation::ERROR_SUCCESS;

    unsafe {
        let mut path_count: u32 = 0;
        let mut mode_count: u32 = 0;
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != ERROR_SUCCESS
        {
            return false;
        }
        if path_count == 0 {
            return false;
        }

        let mut paths: Vec<DISPLAYCONFIG_PATH_INFO> =
            vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes: Vec<DISPLAYCONFIG_MODE_INFO> =
            vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];

        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        ) != ERROR_SUCCESS
        {
            return false;
        }

        // QueryDisplayConfig may report fewer paths than the buffer it sized;
        // honour the returned count so we don't read stale/zeroed entries.
        paths.truncate(path_count as usize);
        paths.iter().any(|p| {
            let tech = p.targetInfo.outputTechnology;
            tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST
                || tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL
                || tech == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED
        })
    }
}

// ── RDP server detection (F9) ─────────────────────────────────────────────────

/// True when this machine is actively *hosting* an RDP listener (someone could
/// be driving the exam remotely). This is the inverse of `detect_remote_desktop`,
/// which detects being INSIDE an RDP session.
///
/// Requires BOTH the Remote Desktop Services (`TermService`) to be RUNNING AND a
/// socket LISTENING on port 3389. Requiring both cuts false positives: an
/// installed-but-idle TermService is common on Windows Pro, but a 3389 LISTENING
/// socket means the host is actually accepting inbound RDP. Parsing is lenient
/// (case-insensitive substring) so it survives locale/format variation.
pub fn detect_rdp_server() -> bool {
    let svc_running = hidden_command("sc")
        .args(["query", "TermService"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_uppercase()
                .contains("RUNNING")
        })
        .unwrap_or(false);
    if !svc_running {
        return false;
    }

    let listening_3389 = hidden_command("netstat")
        .args(["-ano"])
        .output()
        .map(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_uppercase();
            text.lines()
                .any(|line| line.contains(":3389") && line.contains("LISTENING"))
        })
        .unwrap_or(false);

    listening_3389
}

// ── Keyboard intercept ────────────────────────────────────────────────────────

fn spawn_hook_thread() {
    HOOK_STARTING.store(true, Ordering::SeqCst);
    std::thread::spawn(|| {
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL,
        };

        let tid = unsafe { GetCurrentThreadId() };
        HOOK_THREAD_ID.store(tid, Ordering::SeqCst);
        HOOK_STARTING.store(false, Ordering::SeqCst);

        unsafe {
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(kbproc), None, 0) {
                Ok(h) => h,
                Err(_) => {
                    HOOK_ACTIVE.store(false, Ordering::SeqCst);
                    HOOK_THREAD_ID.store(0, Ordering::SeqCst);
                    HOOK_STARTING.store(false, Ordering::SeqCst); // unblock watchdog startup poll
                    return;
                }
            };

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            UnhookWindowsHookEx(hook).ok();
        }

        // Signal death without clearing HOOK_ACTIVE — watchdog uses TID==0 to detect
        HOOK_THREAD_ID.store(0, Ordering::SeqCst);
    });
}

fn spawn_hook_watchdog() {
    std::thread::spawn(|| {
        // Wait until the hook thread is fully started (TID registered) before the
        // first check — avoids a false "thread died" during the startup window.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if HOOK_THREAD_ID.load(Ordering::SeqCst) != 0 {
                break;
            }
            if std::time::Instant::now() > deadline {
                eprintln!("AMS Access: WH_KEYBOARD_LL hook thread failed to start within 10s");
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if !HOOK_ACTIVE.load(Ordering::SeqCst) {
                break; // deliberate stop via disable_keyboard_intercept
            }
            // TID==0 and not in startup window => thread died unexpectedly
            if HOOK_THREAD_ID.load(Ordering::SeqCst) == 0 && !HOOK_STARTING.load(Ordering::SeqCst) {
                eprintln!("AMS Access: WH_KEYBOARD_LL hook thread died — respawning");
                spawn_hook_thread();
                // Spin until new thread registers its TID before next watchdog check
                let respawn_deadline =
                    std::time::Instant::now() + std::time::Duration::from_secs(5);
                while HOOK_THREAD_ID.load(Ordering::SeqCst) == 0
                    && std::time::Instant::now() < respawn_deadline
                {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
    });
}

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    if HOOK_ACTIVE.load(Ordering::SeqCst) {
        return KeyboardInterceptResult {
            active: true,
            method: "ll-keyboard-hook".to_string(),
            platform: "windows".to_string(),
        };
    }
    HOOK_ACTIVE.store(true, Ordering::SeqCst);
    set_sleep_prevention(true);
    spawn_hook_thread();
    spawn_hook_watchdog();

    KeyboardInterceptResult {
        active: true,
        method: "ll-keyboard-hook".to_string(),
        platform: "windows".to_string(),
    }
}

pub fn disable_keyboard_intercept() {
    HOOK_ACTIVE.store(false, Ordering::SeqCst);
    set_sleep_prevention(false);
    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            use windows::Win32::Foundation::{LPARAM, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
            PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)).ok();
        }
    }
}

// ── Injected-input event callback (F11) ───────────────────────────────────────
//
// The low-level keyboard hook runs `kbproc` (an `extern "system"` callback). When
// it detects an injected (synthetic) keystroke it swallows the key and raises a
// proctoring event through this callback, mirroring the clipboard-event pattern
// above: a single host closure registered once, invoked under catch_unwind so a
// panic crossing the FFI boundary can never abort the exam process. Emission is
// throttled to at most one event per second because a SendInput flood could
// otherwise produce thousands of identical events; the BLOCK in `kbproc` is NOT
// throttled and happens on every injected key.

/// Host callback for injected-input events: `callback(kind, detail)`. Only the
/// first registration per process wins; later calls are ignored.
type InjectedInputCallback = Box<dyn Fn(&str, &str) + Send + Sync>;
static INJECTED_EVENT_CALLBACK: OnceLock<InjectedInputCallback> = OnceLock::new();

/// Epoch-millis of the last injected-input event we emitted (0 = none yet). Used
/// to throttle emission to one event per second.
static INJECTED_LAST_MS: AtomicU64 = AtomicU64::new(0);

/// Register the host callback invoked when an injected keystroke is blocked.
///
/// `callback(kind, detail)` is invoked from the keyboard hook thread — it must be
/// cheap and non-blocking. Only the first registration per process wins.
pub fn set_injected_input_callback<F>(f: F)
where
    F: Fn(&str, &str) + Send + Sync + 'static,
{
    let _ = INJECTED_EVENT_CALLBACK.set(Box::new(f));
}

/// Raise an injected-input event to the host, throttled to once per second.
///
/// Called from the `extern "system"` `kbproc`. Like `emit_clipboard_event`, the
/// host closure can panic inside Tauri's emit machinery; a panic unwinding out of
/// an FFI callback escalates to a process abort, so it is contained with
/// catch_unwind and never allowed to take down the exam app.
fn emit_injected_input_event(kind: &str, detail: &str) {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = INJECTED_LAST_MS.load(Ordering::SeqCst);
    if now.saturating_sub(last) < 1000 {
        return; // throttle: at most one emit per second
    }
    INJECTED_LAST_MS.store(now, Ordering::SeqCst);

    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = INJECTED_EVENT_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(kind, detail)));
    }
}

unsafe extern "system" fn kbproc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, LLKHF_INJECTED,
    };

    if code >= 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = kb.vkCode;
        // Reject synthetic keystrokes (SendInput / keybd_event / many automation
        // tools) while a lockdown hook is active: an injected key during an exam is
        // a tampering signal, never legitimate candidate input. Swallow it every
        // time; the violation emit is throttled below so a flood can't spam events.
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        if injected && HOOK_ACTIVE.load(Ordering::SeqCst) {
            emit_injected_input_event("injected_input", "synthetic_keystroke_blocked");
            return LRESULT(1);
        }
        let alt_down = kb.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let ctrl_down = (GetAsyncKeyState(0x11) as u16 & 0x8000) != 0;
        let shift_down = (GetAsyncKeyState(0x10) as u16 & 0x8000) != 0;
        let win_down = (GetAsyncKeyState(0x5B) as u16 & 0x8000) != 0
            || (GetAsyncKeyState(0x5C) as u16 & 0x8000) != 0;

        let blocked = vk == 0x5B   // LWin
            || vk == 0x5C // RWin
            || vk == 0x2C // VK_SNAPSHOT (PrintScreen — all methods incl. Win+Shift+S snipping)
            || (alt_down && vk == 0x09)  // Alt+Tab
            || (alt_down && vk == 0x73)  // Alt+F4
            || (ctrl_down && vk == 0x1B) // Ctrl+Esc (Start menu)
            || (ctrl_down && shift_down && vk == 0x1B) // Ctrl+Shift+Esc (Task Manager direct)
            || (ctrl_down && shift_down && vk == 0x09) // Ctrl+Shift+Tab
            || (vk == 0x1B && ESCAPE_BLOCKED.load(Ordering::Relaxed)) // Esc — context-aware
            || (alt_down && vk == 0x0D)  // Alt+Enter (window size menu)
            || (alt_down && vk == 0x20)  // Alt+Space (system menu)
            || (alt_down && vk == 0x5A)  // Alt+Z (NVIDIA ShadowPlay overlay)
            || (alt_down && vk == 0x52)  // Alt+R (AMD ReLive recording)
            || (alt_down && vk == 0x78)  // Alt+F9 (Fraps record toggle)
            || win_down; // Any Win+ combo: Win+G (Game Bar), Win+Tab, Win+D, Win+Shift+S, etc.

        if blocked {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

// ── Virtual desktop guard ─────────────────────────────────────────────────────

/// Spawn a background thread that detects when the exam window is no longer on
/// the current virtual desktop (e.g. touchpad 3-finger swipe on non-WPT devices)
/// and moves it back within 250 ms.
///
/// Strategy: `GetForegroundWindow()` always returns a window on the active desktop.
/// We get its desktop GUID via `IVirtualDesktopManager::GetWindowDesktopId`, then
/// call `MoveWindowToDesktop(exam_hwnd, that_guid)` so the exam follows the user
/// to whichever desktop they switch to — they cannot escape by switching desktops.
///
/// Stops when `SHIELD_ACTIVE` is false (set by `unlock_desktop()`).
pub fn spawn_virtual_desktop_guard(hwnd_raw: isize) {
    let _ = std::thread::Builder::new()
        .name("ams-vd-guard".into())
        .spawn(move || {
            use windows::Win32::Foundation::HWND;
            use windows::Win32::System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            };
            use windows::Win32::UI::Shell::IVirtualDesktopManager;
            use windows::Win32::UI::WindowsAndMessaging::{
                GetForegroundWindow, SetForegroundWindow,
            };

            // STA required for shell COM objects
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if hr.is_err() {
                return;
            }

            // CLSID_VirtualDesktopManager = {aa509086-5ca9-4c25-8f95-589d3c07b48a}
            const CLSID_VDM: windows::core::GUID = windows::core::GUID {
                data1: 0xaa509086,
                data2: 0x5ca9,
                data3: 0x4c25,
                data4: [0x8f, 0x95, 0x58, 0x9d, 0x3c, 0x07, 0xb4, 0x8a],
            };
            let vdm: windows::core::Result<IVirtualDesktopManager> =
                unsafe { CoCreateInstance(&CLSID_VDM, None, CLSCTX_INPROC_SERVER) };
            let Ok(vdm) = vdm else {
                unsafe { CoUninitialize() };
                return;
            };

            let hwnd = HWND(hwnd_raw as *mut _);

            loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if !SHIELD_ACTIVE.load(Ordering::SeqCst) {
                    break;
                }

                // Check if our window is still on the active virtual desktop
                let on_current = unsafe { vdm.IsWindowOnCurrentVirtualDesktop(hwnd) };
                let escaped = matches!(on_current, Ok(b) if !b.as_bool());
                if !escaped {
                    continue;
                }

                // GetForegroundWindow() returns a window that IS on the current desktop —
                // get its desktop GUID and move the exam window to that same desktop.
                let fg = unsafe { GetForegroundWindow() };
                if fg.0.is_null() || fg == hwnd {
                    continue;
                }
                if let Ok(desktop_id) = unsafe { vdm.GetWindowDesktopId(fg) } {
                    unsafe { vdm.MoveWindowToDesktop(hwnd, &desktop_id) }.ok();
                    // Bring exam window to front on the new desktop
                    let _ = unsafe { SetForegroundWindow(hwnd) }.ok();
                }
            }

            unsafe { CoUninitialize() };
        });
}

// ── Foreground-window predicate ───────────────────────────────────────────────

/// True when the exam window (HWND passed as isize) is the system foreground
/// window, i.e. the candidate is actually looking at the exam. Used by the
/// Tauri layer to poll for focus-loss (taskbar click / mouse window-switch that
/// bypasses the keyboard hook). Returns true on a null/equal foreground so a
/// transient query failure never produces a false violation.
pub fn is_foreground_window(hwnd_raw: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let hwnd = HWND(hwnd_raw as *mut _);
    let fg = unsafe { GetForegroundWindow() };
    fg.0.is_null() || fg == hwnd
}

// ── DLL search-path hardening ─────────────────────────────────────────────────

/// Harden the DLL search path against planted-DLL hijacking of the proctor
/// process: drop the current working directory from the search order and
/// restrict default LoadLibrary resolution to the application + System32 + user
/// directories (DEFAULT_DIRS), excluding the insecure CWD and %PATH%. Call ONCE
/// at process start, before any non-system DLL is loaded. Best-effort; failures
/// are non-fatal. Note: only affects DLLs loaded after this call — the exe's
/// static imports are already resolved by the loader (see the /DEPENDENTLOADFLAG
/// linker flag in the desktop crate's build.rs for loader-level coverage).
pub fn harden_dll_search_path() {
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{
        SetDefaultDllDirectories, SetDllDirectoryW, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
    };

    unsafe {
        // Remove the current working directory from the legacy DLL search order.
        // CRITICAL: pass an EMPTY string, NOT null — SetDllDirectory(null) RESTORES
        // the default (CWD-included) order; only "" removes the CWD.
        let empty: [u16; 1] = [0];
        let _ = SetDllDirectoryW(PCWSTR(empty.as_ptr()));
        // Default search = application dir + System32 + user dirs. Drops the
        // insecure CWD/%PATH% while still resolving the app's own bundled DLLs
        // (WebView2Loader, ANGLE EGL, etc.). NOT System32-only, which would break
        // loading those co-located DLLs and blank the webview.
        let _ = SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    }
}

// ── Network lockdown (process-scoped, not global policy) ─────────────────────

/// Scopes outbound firewall to this process only, allows only `allowed_ips`.
///
/// Uses a specific BLOCK rule for this exe plus per-IP ALLOW rules. Windows
/// Firewall resolves specificity conflicts in favour of the more constrained
/// rule, so ALLOW(exe → specific-ip) wins over BLOCK(exe → any).
///
/// Does NOT touch the global outbound policy so other processes keep internet.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    let _ = disable_network_lockdown(); // idempotent cleanup

    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();

    // netsh needs program="path with spaces"; wrap value in embedded quotes
    let program_arg = format!("program=\"{}\"", exe);

    // Block-all outbound rule for this exe
    let out = hidden_command("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=AMS_PROCTOR_BLOCK_ALL",
            "dir=out",
            "action=block",
            "enable=yes",
            "profile=any",
            &program_arg,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "netsh block-all failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Per-IP allow rules — more specific than BLOCK_ALL so they win
    for ip in allowed_ips {
        // Upstream (lib.rs) already validates via parse::<IpAddr>() or to_socket_addrs().
        // We re-validate here as a safety net. Critically, use parse::<IpAddr>() not a
        // char-set check — the char-set approach rejects valid IPv6 addresses containing
        // hex letters (a-f), e.g. 2607:f8b0:4004:c09::71 fails is_ascii_digit().
        if ip.parse::<std::net::IpAddr>().is_err() {
            continue;
        }
        let out = hidden_command("netsh")
            .args([
                "advfirewall",
                "firewall",
                "add",
                "rule",
                "name=AMS_PROCTOR_ALLOW",
                "dir=out",
                "action=allow",
                "enable=yes",
                "profile=any",
                &format!("remoteip={}", ip),
                &program_arg,
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!(
                "netsh allow {} failed: {}",
                ip,
                String::from_utf8_lossy(&out.stderr)
            ));
        }
    }

    // IPv6: the BLOCK_ALL rule has no remoteip filter, so netsh applies it to all traffic
    // regardless of IP version — no separate ::/0 block rule is needed.
    // IPv6 ALLOW rules are added above when lib.rs resolves both A and AAAA records via
    // to_socket_addrs(), which returns both IPv4 and IPv6 addresses.

    Ok(())
}

/// Remove all AMS firewall rules and restore unrestricted outbound access.
pub fn disable_network_lockdown() -> Result<(), String> {
    let _ = hidden_command("netsh")
        .args([
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            "name=AMS_PROCTOR_BLOCK_ALL",
        ])
        .output();
    let _ = hidden_command("netsh")
        .args([
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            "name=AMS_PROCTOR_ALLOW",
        ])
        .output();
    Ok(())
}

/// Returns true if `name` (without .exe) is in the Windows RESTRICTED list.
pub fn is_restricted_name(name: &str) -> bool {
    RESTRICTED
        .iter()
        .any(|&r| r.trim_end_matches(".exe").eq_ignore_ascii_case(name))
}

/// Force-terminate each named restricted app using taskkill.
///
/// `names` contains process names WITHOUT the `.exe` extension — the same
/// format that `scan_processes()` returns.
/// `/T` kills the entire process tree so child processes (Electron helpers,
/// zoom subprocesses) are also terminated.
/// Discord respawn guard: retry up to 3 times with a 600 ms gap.
pub fn close_apps(names: &[String]) -> CloseAppsResult {
    let mut closed = Vec::new();
    let mut failed = Vec::new();

    for name in names {
        let exe = format!("{}.exe", name);
        let mut killed = false;

        for _ in 0..3 {
            let _ = hidden_command("taskkill")
                .args(["/IM", &exe, "/F", "/T"])
                .output();
            std::thread::sleep(std::time::Duration::from_millis(600));
            if !win_process_alive(name) {
                killed = true;
                break;
            }
        }

        if killed {
            closed.push(name.clone());
        } else {
            failed.push(name.clone());
        }
    }

    CloseAppsResult { closed, failed }
}

/// Returns true if a process matching `name` (without .exe) is still alive.
fn win_process_alive(name: &str) -> bool {
    scan_processes()
        .found
        .iter()
        .any(|f| f.eq_ignore_ascii_case(name))
}

// ── Clipboard monitor ─────────────────────────────────────────────────────────
//
// Native clipboard surveillance for the lockdown session. A message-only window
// subscribes to `WM_CLIPBOARDUPDATE` via AddClipboardFormatListener; on each
// update we inspect only *metadata* (available formats + owner/foreground HWND),
// never the clipboard contents, and classify the event. Classified events flow
// out through `CLIPBOARD_EVENT_CALLBACK`, mirroring the macOS lockdown-event
// callback pattern (set_lockdown_event_callback / emit_lockdown_event): the
// host registers one closure and we invoke it under catch_unwind, because the
// wndproc is `extern "system"` and a panic unwinding across the FFI boundary
// would abort the process (the SIGABRT class of bug).

/// Host callback for clipboard events: `callback(kind, detail, payload_json)`.
/// Only the first registration per process wins; later calls are ignored.
type ClipboardEventCallback = Box<dyn Fn(&str, &str, String) + Send + Sync>;
static CLIPBOARD_EVENT_CALLBACK: OnceLock<ClipboardEventCallback> = OnceLock::new();

/// Thread id of the clipboard pump thread, or 0 when not running. Used by
/// `stop_clipboard_monitor` to PostThreadMessage(WM_QUIT) into the pump.
static CLIPBOARD_THREAD_ID: AtomicU32 = AtomicU32::new(0);
/// Last clipboard sequence number we processed — dedup for the duplicate
/// WM_CLIPBOARDUPDATE messages Windows can deliver for a single change.
static CLIPBOARD_LAST_SEQ: AtomicU32 = AtomicU32::new(0);
/// The exam window HWND (as isize) so the stateless wndproc can compare it
/// against the clipboard owner / foreground window.
static CLIPBOARD_EXAM_HWND: AtomicIsize = AtomicIsize::new(0);
/// Guard against starting a second monitor while one is already running.
static CLIPBOARD_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Set by `stop_clipboard_monitor` so a `stop` that races the pump thread's
/// startup (before it has entered GetMessageW) still tears down cleanly instead
/// of leaking the thread with a lost WM_QUIT.
static CLIPBOARD_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Register the host callback invoked on every classified clipboard event.
///
/// `callback(kind, detail, payload_json)` is invoked from the clipboard pump
/// thread's wndproc — it must be cheap and non-blocking. Only the first
/// registration per process wins; later calls are ignored.
pub fn set_clipboard_event_callback<F>(callback: F)
where
    F: Fn(&str, &str, String) + Send + Sync + 'static,
{
    let _ = CLIPBOARD_EVENT_CALLBACK.set(Box::new(callback));
}

/// Raise a clipboard event to the host app.
///
/// Called from the `extern "system"` wndproc. The host callback ends up in
/// Tauri's emit machinery, which can panic (e.g. if the webview is gone); a
/// panic unwinding out of an FFI callback escalates to a process abort, so it
/// is contained here and never allowed to take down the exam app.
fn emit_clipboard_event(kind: &str, detail: &str, payload_json: String) {
    eprintln!("AMS Access: {kind}: {detail}");
    if let Some(callback) = CLIPBOARD_EVENT_CALLBACK.get() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            callback(kind, detail, payload_json)
        }));
    }
}

/// Start the native clipboard monitor for the exam window `hwnd_raw`.
///
/// Idempotent: a second call while a monitor is already running is a no-op. The
/// monitor runs on its own thread (a message-only window + GetMessage pump) and
/// is torn down by `stop_clipboard_monitor`.
pub fn start_clipboard_monitor(hwnd_raw: isize) {
    if CLIPBOARD_ACTIVE.swap(true, Ordering::SeqCst) {
        return; // already running
    }
    CLIPBOARD_EXAM_HWND.store(hwnd_raw, Ordering::SeqCst);
    CLIPBOARD_STOP_REQUESTED.store(false, Ordering::SeqCst);

    let _ = std::thread::Builder::new()
        .name("ams-clipboard-monitor".into())
        .spawn(|| {
            use windows::core::w;
            use windows::Win32::Foundation::HWND;
            use windows::Win32::System::DataExchange::AddClipboardFormatListener;
            use windows::Win32::System::DataExchange::RemoveClipboardFormatListener;
            use windows::Win32::System::LibraryLoader::GetModuleHandleW;
            use windows::Win32::System::Threading::GetCurrentThreadId;
            use windows::Win32::UI::WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, DispatchMessageW, GetMessageW, RegisterClassW,
                TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
            };

            // Publish the thread id BEFORE creating the window so a `stop` that
            // arrives during startup has a valid target for WM_QUIT. Paired with
            // the CLIPBOARD_STOP_REQUESTED check below, this closes the race where
            // a quick lock->unlock could otherwise leak this thread forever (a
            // WM_QUIT posted to tid 0 is lost and GetMessageW blocks for good).
            CLIPBOARD_THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);

            unsafe {
                let hinstance = GetModuleHandleW(None).unwrap_or_default();
                let class_name = w!("AmsAccessClipboardMonitor");

                let wc = WNDCLASSW {
                    lpfnWndProc: Some(clipboard_wndproc),
                    hInstance: hinstance.into(),
                    lpszClassName: class_name,
                    ..Default::default()
                };
                // RegisterClassW returns 0 on failure; a non-zero atom means OK.
                // If the class was already registered (atom 0 / ERROR_CLASS_ALREADY_EXISTS)
                // CreateWindowExW will still succeed, so we don't hard-fail here.
                let _atom = RegisterClassW(&wc);

                let hwnd = match CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    class_name,
                    w!("AMS Access Clipboard Monitor"),
                    WINDOW_STYLE(0),
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    Some(hinstance.into()),
                    None,
                ) {
                    Ok(h) => h,
                    Err(_) => {
                        CLIPBOARD_THREAD_ID.store(0, Ordering::SeqCst);
                        CLIPBOARD_ACTIVE.store(false, Ordering::SeqCst);
                        return;
                    }
                };

                if AddClipboardFormatListener(hwnd).is_err() {
                    let _ = DestroyWindow(hwnd);
                    CLIPBOARD_THREAD_ID.store(0, Ordering::SeqCst);
                    CLIPBOARD_ACTIVE.store(false, Ordering::SeqCst);
                    return;
                }

                // If stop was requested during window setup, skip the pump and go
                // straight to teardown (the posted WM_QUIT, if any, would be left
                // unconsumed otherwise).
                if !CLIPBOARD_STOP_REQUESTED.load(Ordering::SeqCst) {
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                }

                // Pump exited (WM_QUIT) or was skipped — tear down.
                let _ = RemoveClipboardFormatListener(hwnd);
                let _ = DestroyWindow(hwnd);
                let _: HWND = hwnd; // keep hwnd typed for clarity
            }

            CLIPBOARD_THREAD_ID.store(0, Ordering::SeqCst);
            CLIPBOARD_ACTIVE.store(false, Ordering::SeqCst);
        });
}

/// Stop the clipboard monitor: break the pump so its thread tears down the
/// listener and window. Safe to call when not running (no-op).
pub fn stop_clipboard_monitor() {
    // Set the stop flag first so the pump thread bails even if it has not yet
    // entered GetMessageW (and thus might miss the WM_QUIT below).
    CLIPBOARD_STOP_REQUESTED.store(true, Ordering::SeqCst);
    let tid = CLIPBOARD_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            use windows::Win32::Foundation::{LPARAM, WPARAM};
            use windows::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
            PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)).ok();
        }
    }
}

/// Message-only window procedure for the clipboard monitor. Stateless (cannot
/// capture), so it reads shared statics; the only path into Rust closure code
/// is `emit_clipboard_event`, which is catch_unwind-guarded.
unsafe extern "system" fn clipboard_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{HWND, LRESULT};
    use windows::Win32::System::DataExchange::{
        GetClipboardOwner, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    };
    use windows::Win32::System::Ole::{CF_BITMAP, CF_DIB, CF_UNICODETEXT};
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, GetForegroundWindow, WM_CLIPBOARDUPDATE,
    };

    if msg == WM_CLIPBOARDUPDATE {
        // Dedup duplicate update notifications for a single clipboard change.
        let seq = GetClipboardSequenceNumber();
        if CLIPBOARD_LAST_SEQ.swap(seq, Ordering::SeqCst) == seq && seq != 0 {
            return LRESULT(0);
        }

        let exam = HWND(CLIPBOARD_EXAM_HWND.load(Ordering::SeqCst) as *mut _);
        let owner_is_exam = GetClipboardOwner().unwrap_or_default() == exam;
        let fg = GetForegroundWindow();
        let foreground_is_exam = !fg.0.is_null() && fg == exam;
        // A genuinely-different app is focused (non-null AND not the exam). NULL
        // foreground happens transiently during the lock/desktop switch, so we do
        // NOT escalate to "external write" on it — that would spam false highs.
        let foreground_other_app = !fg.0.is_null() && fg != exam;

        // Metadata only — never OpenClipboard to read contents.
        let fmt = if IsClipboardFormatAvailable(CF_BITMAP.0 as u32).is_ok()
            || IsClipboardFormatAvailable(CF_DIB.0 as u32).is_ok()
        {
            "image"
        } else if IsClipboardFormatAvailable(CF_UNICODETEXT.0 as u32).is_ok() {
            "text"
        } else {
            "other"
        };

        let (kind, sev) = match fmt {
            "image" => ("clipboard_capture_image", "high"),
            "text" if foreground_other_app => ("clipboard_external_write", "high"),
            "text" if !owner_is_exam => ("clipboard_write", "medium"),
            "text" => ("clipboard_write", "info"),
            _ => ("clipboard_write", "info"),
        };

        let payload = serde_json::json!({
            "format": fmt,
            "owner_is_exam": owner_is_exam,
            "foreground_is_exam": foreground_is_exam,
            "severity": sev,
        })
        .to_string();

        emit_clipboard_event(kind, sev, payload);
        return LRESULT(0);
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}
