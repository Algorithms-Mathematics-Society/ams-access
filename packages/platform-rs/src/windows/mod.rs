use crate::process_runner::{Budget, CommandDeadlineExt};
use core_rs::exam::{CloseAppsResult, DisplayScan, KeyboardInterceptResult, ProcessScanResult};
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;

mod hook_delivery;
mod hook_lifecycle;
pub mod instance;
mod keyboard_policy;
mod power_request;
mod registry_recovery;
mod wifi;
pub use hook_delivery::{DeliverySnapshot, DeliveryStatus};
pub use registry_recovery::RegistryLockdownStatus;

thread_local! {
    static HOOK_CALLBACK_SESSION: std::cell::RefCell<Option<std::sync::Arc<hook_lifecycle::Session>>> = const { std::cell::RefCell::new(None) };
}

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

static HOOK_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());
static HOOK_SESSION: std::sync::Mutex<Option<std::sync::Arc<hook_lifecycle::Session>>> =
    std::sync::Mutex::new(None);
static SHIELD_ACTIVE: AtomicBool = AtomicBool::new(false);
static VIRTUAL_DESKTOP_GUARD_EPOCH: AtomicU64 = AtomicU64::new(0);
static ESCAPE_BLOCKED: AtomicBool = AtomicBool::new(true);

/// Processes that make a Windows device ineligible for a secured session.
///
/// Detection is intentionally non-destructive. AMS Access reports these
/// processes and requires the candidate to close them; it never terminates a
/// process on the candidate's behalf. Besides being safer, this keeps the
/// packaged Store app from modifying unrelated applications.
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
    // Zoom is deliberately absent.
    //
    // It leaves helper processes that start and stop on their own, so a
    // candidate who never opened Zoom produced a started/resolved pair every
    // few seconds. One sitting filled the staff help queue with 200 of them,
    // which is how a queue stops being read and a real request gets missed.
    // Zoom *screen sharing* is the thing worth catching and is still caught
    // separately (`CptHost` in macos/remote_access.rs), because that one
    // means somebody else can see the paper.
    // Conferencing tools whose whole purpose is sharing a screen. A call
    // can be in progress with no window in front, so these still block.
    "teams.exe",
    "ms-teams.exe",
    "skype.exe",
    "webex.exe",
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
    // NVIDIA ShadowPlay / GeForce Experience (not the generic driver container)
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

/// Chat apps: reported at readiness, never a reason to turn someone away.
///
/// Every one of these keeps a tray process alive after its window closes, so
/// "I closed it" and "the scan still sees it" are both true at once. Blocking
/// on that strands a candidate who has done everything asked of them. They
/// are recorded against the session so an invigilator can see them.
const ADVISORY: &[&str] = &["discord.exe", "slack.exe", "whatsapp.exe", "telegram.exe"];

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

/// Whether this process is running from inside an MSIX package.
///
/// This is the single most consequential fact about a Store build, because
/// **a packaged app can never be elevated**. MSIX has no equivalent of the
/// `requireAdministrator` manifest the installer build embeds — packaged
/// processes always run as the invoking user, and there is no capability that
/// buys it back. So on a Store build `netsh advfirewall` fails and there is no
/// network lockdown, by construction rather than by accident.
///
/// Two things depend on knowing this:
///
///   - startup must not try to auto-elevate. A `runas` relaunch of a packaged
///     app does not produce an elevated packaged app; at best it fails, at
///     worst it launches a second instance outside the package.
///   - readiness must report it distinctly, so an invigilator reading the
///     console can tell "Store build, no firewall by design" apart from "this
///     candidate could not elevate on their own machine". Those look identical
///     otherwise and call for completely different responses.
///
/// Detected by asking for the current package identity: unpackaged processes
/// answer `APPMODEL_ERROR_NO_PACKAGE`, and anything else means we have one.
pub fn is_packaged() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    let mut length: u32 = 0;
    // A null buffer with a zero length is the documented "how long is it?"
    // call. Packaged processes answer ERROR_INSUFFICIENT_BUFFER; only an
    // unpackaged one answers APPMODEL_ERROR_NO_PACKAGE.
    let result = unsafe { GetCurrentPackageFullName(&mut length, None) };
    result != APPMODEL_ERROR_NO_PACKAGE
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
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let mut found = Vec::new();
    let Ok(out) = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .bounded_checked_output()
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
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let procs = scan_processes_with_pids();
    let clean = procs.is_empty() && _budget.failure().is_none();
    let found = procs
        .into_iter()
        .map(|p| p.name.trim_end_matches(".exe").to_string())
        .collect();
    // Chat apps are scanned separately and never affect `clean`: a tray
    // process nobody can see must not be what stops a candidate entering.
    // Deduplicated, because Discord alone is six processes and listing it
    // six times told a candidate nothing except that something was wrong.
    let advisory = scan_advisory();
    ProcessScanResult {
        found,
        clean,
        advisory,
    }
}

/// Chat apps currently running, deduplicated and without the `.exe`.
fn scan_advisory() -> Vec<String> {
    let Ok(out) = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .bounded_checked_output()
    else {
        return Vec::new();
    };
    advisory_in(&String::from_utf8_lossy(&out.stdout))
}

/// The advisory apps named in `tasklist /FO CSV /NH` output.
///
/// Split out from the command so it can be tested without a Windows host --
/// the rest of this module cannot even be compiled on the build machine.
fn advisory_in(tasklist_csv: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in tasklist_csv.lines() {
        // CSV: "image.exe","PID",... -- only the image name is needed.
        let image = line
            .split(',')
            .next()
            .unwrap_or("")
            .trim_matches('"')
            .to_lowercase();
        for &a in ADVISORY {
            if image == a {
                let name = a.trim_end_matches(".exe").to_string();
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
    }
    names
}

// ── Screen capture detection ──────────────────────────────────────────────────

/// Multi-layer detection of active screen capture.
///
/// `apply_capture_protection()` requests display affinity for the exam window.
/// This function is the detection layer for logging and UI warnings.
pub fn detect_screen_capture() -> bool {
    let _budget = Budget::new(std::time::Duration::from_secs(5));
    let ps = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .bounded_checked_output()
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

mod capture_protection;
pub use capture_protection::{
    apply_capture_protection, capture_protection_status, CaptureProtectionStatus,
};

// ── Registry helpers ──────────────────────────────────────────────────────────

fn reg_dword_nonzero(key: &str, value: &str) -> bool {
    let Ok(out) = hidden_command("reg")
        .args(["query", key, "/v", value])
        .bounded_output()
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

// ── Sleep prevention ──────────────────────────────────────────────────────────

fn set_sleep_prevention(enable: bool) {
    if let Err(error) = power_request::set(enable) {
        eprintln!("AMS Access: sleep prevention update failed: {error}");
    }
}

pub fn battery_status() -> Option<crate::BatteryStatus> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    // 255 means that Windows cannot determine the percentage. ACLineStatus 1
    // means connected to AC power; it is the stable signal exposed by Win32.
    (status.BatteryLifePercent <= 100).then_some(crate::BatteryStatus {
        percentage: status.BatteryLifePercent,
        charging: status.ACLineStatus == 1,
        // 0 offline, 1 online, 255 unknown.
        plugged_in: match status.ACLineStatus {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        },
    })
}

// ── Registry lockdown ─────────────────────────────────────────────────────────

/// Recover only a journal owned by this application. Legacy policy values
/// without a snapshot cannot be distinguished from user/admin settings.
pub fn recover_registry_if_crashed() -> Result<(), String> {
    if !instance::owns_instance() {
        return Err("Windows recovery requires instance ownership".into());
    }
    if is_packaged() {
        return Ok(());
    }
    registry_recovery::restore()
}

pub fn desktop_recovery_pending() -> bool {
    !is_packaged() && registry_recovery::pending()
}

// ── Desktop lock / unlock ─────────────────────────────────────────────────────

// Native-only gate: Tauri window/WebView callbacks must stay outside it.
// Closing is terminal for this process; the next exam needs a new instance.
struct TerminalGate {
    closed: AtomicBool,
    operation: std::sync::Mutex<()>,
}

impl TerminalGate {
    const fn new() -> Self {
        Self {
            closed: AtomicBool::new(false),
            operation: std::sync::Mutex::new(()),
        }
    }

    fn enter(&self) -> Option<std::sync::MutexGuard<'_, ()>> {
        let guard = self
            .operation
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        (!self.closed.load(Ordering::SeqCst)).then_some(guard)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.operation
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn close(&self) -> std::sync::MutexGuard<'_, ()> {
        self.closed.store(true, Ordering::SeqCst);
        self.lock()
    }

    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }
}

static DESKTOP_GATE: TerminalGate = TerminalGate::new();

#[cfg(test)]
mod terminal_gate_tests {
    use super::TerminalGate;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};

    #[test]
    fn close_waits_for_active_native_change_then_restores() {
        let gate = Arc::new(TerminalGate::new());
        let changed = Arc::new(Mutex::new(false));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker = {
            let gate = Arc::clone(&gate);
            let changed = Arc::clone(&changed);
            std::thread::spawn(move || {
                let _guard = gate.enter().unwrap();
                entered_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
                *changed.lock().unwrap() = true;
            })
        };
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let closer = {
            let gate = Arc::clone(&gate);
            let changed = Arc::clone(&changed);
            std::thread::spawn(move || {
                let _guard = gate.close();
                *changed.lock().unwrap() = false;
            })
        };
        let deadline = Instant::now() + Duration::from_secs(1);
        while !gate.is_closed() {
            assert!(
                Instant::now() < deadline,
                "shutdown did not publish cancellation"
            );
            std::thread::yield_now();
        }
        finish_tx.send(()).unwrap();
        worker.join().unwrap();
        closer.join().unwrap();
        assert!(!*changed.lock().unwrap());
    }

    #[test]
    fn close_rejects_queued_native_change_and_keyboard_probe() {
        let gate = Arc::new(TerminalGate::new());
        let hook_operation = Arc::new(Mutex::new(()));
        let held_hook = hook_operation.lock().unwrap();
        let (native_queued_tx, native_queued_rx) = mpsc::channel();
        let (native_continue_tx, native_continue_rx) = mpsc::channel();
        let native = {
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                native_queued_tx.send(()).unwrap();
                native_continue_rx.recv().unwrap();
                gate.enter().is_some()
            })
        };
        let (queued_tx, queued_rx) = mpsc::channel();
        let probe = {
            let gate = Arc::clone(&gate);
            let hook_operation = Arc::clone(&hook_operation);
            std::thread::spawn(move || {
                queued_tx.send(()).unwrap();
                let _hook = hook_operation.lock().unwrap();
                !gate.is_closed()
            })
        };
        native_queued_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        queued_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        drop(gate.close());
        native_continue_tx.send(()).unwrap();
        drop(held_hook);
        assert!(!native.join().unwrap());
        assert!(!probe.join().unwrap());
    }
}

pub fn lock_desktop() -> bool {
    lock_desktop_checked().unwrap_or(false)
}

pub struct DesktopLockdownStatus {
    pub keyboard_active: bool,
    pub registry: RegistryLockdownStatus,
}

pub fn lock_desktop_checked() -> Result<bool, String> {
    lock_desktop_with_status().map(|status| status.keyboard_active)
}

/// Unelevated entry skips new registry policies, never unfinished recovery.
pub fn lock_desktop_with_status() -> Result<DesktopLockdownStatus, String> {
    let _operation = DESKTOP_GATE
        .enter()
        .ok_or("Windows desktop lockdown cannot start during shutdown")?;
    if !instance::owns_instance() {
        return Err("Windows lockdown requires instance ownership".into());
    }
    // MSIX virtualizes HKCU; packaged builds must not mutate these settings.
    let registry = if is_packaged() {
        RegistryLockdownStatus::NotApplicablePackaged
    } else {
        match registry_recovery::engage(is_elevated()) {
            Ok(status) => status,
            Err(error) => {
                eprintln!("Windows registry lockdown failed: {error}");
                if let Err(restore_error) = registry_recovery::restore() {
                    eprintln!("Windows registry rollback incomplete: {restore_error}");
                }
                return Err(format!("Windows registry lockdown failed: {error}"));
            }
        }
    };
    set_sleep_prevention(true);
    VIRTUAL_DESKTOP_GUARD_EPOCH.fetch_add(1, Ordering::SeqCst);
    SHIELD_ACTIVE.store(true, Ordering::SeqCst);
    // The caller decides whether unavailable keyboard interception is advisory
    // and owns rollback when its entry policy requires the hook.
    Ok(DesktopLockdownStatus {
        keyboard_active: enable_keyboard_intercept().active,
        registry,
    })
}

pub fn unlock_desktop() {
    let _operation = DESKTOP_GATE.lock();
    unlock_desktop_unlocked();
}

pub fn close_desktop_on_exit() {
    let _operation = DESKTOP_GATE.close();
    unlock_desktop_unlocked();
}

fn unlock_desktop_unlocked() {
    if !instance::owns_instance() {
        return;
    }
    set_sleep_prevention(false);
    SHIELD_ACTIVE.store(false, Ordering::SeqCst);
    disable_keyboard_intercept();
    if let Err(error) = recover_registry_if_crashed() {
        eprintln!("Windows registry restoration incomplete: {error}");
    }
}

// ── Remote desktop detection ──────────────────────────────────────────────────

pub fn detect_remote_desktop() -> bool {
    let _budget = Budget::new(std::time::Duration::from_secs(5));
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
        .bounded_checked_output()
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

/// Resolve the attached monitor count, absorbing a transient failure.
///
/// `read` returns the raw `SM_CMONITORS` value (`<= 0` on failure). Returns the
/// first positive count, or `0` — the "could not verify" sentinel — if every
/// attempt fails. `backoff(attempt)` is invoked between attempts (real sleep in
/// production, a no-op in tests). Pure: no Win32, so it is unit-testable.
fn resolve_monitor_count(
    attempts: u32,
    mut read: impl FnMut() -> i32,
    mut backoff: impl FnMut(u32),
) -> u32 {
    for attempt in 0..attempts {
        let raw = read();
        if raw > 0 {
            return raw as u32;
        }
        if attempt + 1 < attempts {
            backoff(attempt);
        }
    }
    0
}

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
    use std::time::Duration;
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

    // 3 reads at ~0/200/400 ms, early-exit on the first positive count. A
    // transient SM_CMONITORS == 0 (GPU TDR / hotplug debounce / RDP transition)
    // settles in ~100-300 ms; the 200 ms spacing samples ACROSS that window
    // rather than re-reading the same instant. All-fail leaves count == 0,
    // the indeterminate sentinel (core-rs blocks it on strict Windows).
    let count = resolve_monitor_count(
        3,
        || unsafe { GetSystemMetrics(SM_CMONITORS) },
        |_| std::thread::sleep(Duration::from_millis(200)),
    );

    DisplayScan {
        count,
        has_extra: count > 1,
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
        .bounded_output()
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
        .bounded_output()
        .map(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_uppercase();
            text.lines()
                .any(|line| line.contains(":3389") && line.contains("LISTENING"))
        })
        .unwrap_or(false);

    listening_3389
}

// ── Keyboard intercept ────────────────────────────────────────────────────────

struct WindowsHookApi {
    started: std::time::Instant,
}

impl hook_lifecycle::HookApi for WindowsHookApi {
    type Handle = windows::Win32::UI::WindowsAndMessaging::HHOOK;

    fn install(&mut self) -> Result<Self::Handle, String> {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowsHookExW, WH_KEYBOARD_LL};
        unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(kbproc), None, 0) }
            .map_err(|error| error.to_string())
    }

    fn retire(&mut self, hook: Self::Handle) {
        // A silently removed handle may already be invalid. The owner still
        // retires every handle it received, including cancellation races.
        unsafe {
            let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
        }
    }

    fn pump(&mut self) -> bool {
        use windows::Win32::Foundation::WAIT_FAILED;
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, MsgWaitForMultipleObjectsEx, PeekMessageW, TranslateMessage, MSG,
            MWMO_INPUTAVAILABLE, PM_REMOVE, QS_ALLINPUT, WM_QUIT,
        };
        // Bound the batch so a message flood cannot indefinitely postpone the
        // renewal deadline. PeekMessage also dispatches sent hook callbacks.
        for _ in 0..64 {
            let mut msg = MSG::default();
            if !unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE) }.as_bool() {
                break;
            }
            if msg.message == WM_QUIT {
                return false;
            }
            unsafe {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        // Wake immediately for input; cancellation is checked at least every
        // 50 ms while idle without a busy poll or synthetic input probe.
        unsafe {
            MsgWaitForMultipleObjectsEx(None, 50, QS_ALLINPUT, MWMO_INPUTAVAILABLE) != WAIT_FAILED
        }
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis().min(u64::MAX as u128) as u64
    }

    fn report_failure(&mut self, error: &str) {
        eprintln!("AMS Access: keyboard hook installation/renewal failed: {error}");
    }
}

fn spawn_hook_thread(session: std::sync::Arc<hook_lifecycle::Session>) {
    session.starting.store(true, Ordering::SeqCst);
    let owner = session.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("ams-keyboard-hook".into())
        .spawn(move || {
            HOOK_CALLBACK_SESSION.with(|slot| *slot.borrow_mut() = Some(owner.clone()));
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                hook_lifecycle::run(
                    &owner,
                    &mut WindowsHookApi {
                        started: std::time::Instant::now(),
                    },
                );
            }));
            if result.is_err() {
                eprintln!("AMS Access: keyboard hook owner panicked");
                owner.installed.store(false, Ordering::SeqCst);
                owner.starting.store(false, Ordering::SeqCst);
                // Publish exit last: after this store the watchdog may start
                // a new owner. This thread must never mutate session again.
                owner.alive.store(false, Ordering::SeqCst);
            }
            HOOK_CALLBACK_SESSION.with(|slot| *slot.borrow_mut() = None);
        })
    {
        eprintln!("AMS Access: keyboard hook thread spawn failed: {error}");
        session.failed.store(true, Ordering::SeqCst);
        session.starting.store(false, Ordering::SeqCst);
        session.cancel();
    }
}

fn spawn_hook_watchdog(session: std::sync::Arc<hook_lifecycle::Session>) -> bool {
    let result = std::thread::Builder::new()
        .name("ams-hook-watchdog".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if !session.active.load(Ordering::SeqCst) {
                break;
            }
            if !session.alive.load(Ordering::SeqCst) && !session.starting.load(Ordering::SeqCst) {
                spawn_hook_thread(session.clone());
            }
        });
    match result {
        Ok(_) => true,
        Err(error) => {
            eprintln!("AMS Access: keyboard hook watchdog spawn failed: {error}");
            false
        }
    }
}

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let _operation = HOOK_OPERATION
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if DESKTOP_GATE.is_closed() {
        return keyboard_intercept_result(false);
    }
    let existing = HOOK_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    if let Some(session) = existing.as_ref() {
        if session.ready() {
            return keyboard_intercept_result(true);
        }
        session.cancel();
    }
    let session = std::sync::Arc::new(hook_lifecycle::Session::new(hook_delivery::reset_session()));
    *HOOK_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(session.clone());
    spawn_hook_thread(session.clone());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while session.active.load(Ordering::SeqCst)
        && !session.ready()
        && std::time::Instant::now() < deadline
    {
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let installed = session.ready() && spawn_hook_watchdog(session.clone());
    if !installed {
        session.cancel();
    }
    keyboard_intercept_result(installed)
}

fn keyboard_intercept_result(active: bool) -> KeyboardInterceptResult {
    KeyboardInterceptResult {
        active,
        method: "ll-keyboard-hook".to_string(),
        platform: "windows".to_string(),
    }
}

/// Whether the current lifecycle has a successful installation/renewal and a
/// live owner. This is readiness evidence, not proof of callback delivery.
pub fn keyboard_hook_ready() -> bool {
    HOOK_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .is_some_and(|session| session.ready())
}

/// Passive callback evidence; renewal failure is visible as install_failed even
/// when a previous handle remains installed as best-effort protection.
pub fn keyboard_hook_delivery_diagnostics() -> DeliverySnapshot {
    let session = HOOK_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    if let Some(session) = session {
        hook_delivery::snapshot(
            session.active.load(Ordering::SeqCst),
            session.installed.load(Ordering::SeqCst),
            session.alive.load(Ordering::SeqCst),
            session.starting.load(Ordering::SeqCst),
            session.failed.load(Ordering::SeqCst),
        )
    } else {
        hook_delivery::snapshot(false, false, false, false, false)
    }
}

pub fn disable_keyboard_intercept() {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    let _operation = HOOK_OPERATION
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(session) = HOOK_SESSION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
    {
        session.cancel();
    }
    // The owner observes cancellation during its bounded pump. No TID-based
    // WM_QUIT can be lost before queue creation or target a reused thread ID.
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
        CallNextHookEx, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, LLKHF_INJECTED, WM_KEYUP, WM_SYSKEYUP,
    };

    let active = HOOK_CALLBACK_SESSION.with(|slot| {
        slot.borrow().as_ref().is_some_and(|session| {
            if !session.active.load(Ordering::SeqCst) {
                return false;
            }
            hook_delivery::record_callback(session.generation);
            true
        })
    });
    // A cancelled owner's hook may remain in the chain until its next pump.
    // It must never intercept keys for a replacement lifecycle.
    if !active {
        return CallNextHookEx(None, code, wparam, lparam);
    }
    if code >= 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = kb.vkCode;
        // Reject synthetic keystrokes (SendInput / keybd_event / many automation
        // tools) while a lockdown hook is active: an injected key during an exam is
        // a tampering signal, never legitimate candidate input. Swallow it every
        // time; the violation emit is throttled below so a flood can't spam events.
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        if injected {
            emit_injected_input_event("injected_input", "synthetic_keystroke_blocked");
            return LRESULT(1);
        }
        let alt_down = kb.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let ctrl_down = (GetAsyncKeyState(0x11) as u16 & 0x8000) != 0;
        let shift_down = (GetAsyncKeyState(0x10) as u16 & 0x8000) != 0;
        let win_down = (GetAsyncKeyState(0x5B) as u16 & 0x8000) != 0
            || (GetAsyncKeyState(0x5C) as u16 & 0x8000) != 0;
        let key_up = wparam.0 as u32 == WM_KEYUP || wparam.0 as u32 == WM_SYSKEYUP;
        let blocked = keyboard_policy::should_block(
            vk,
            key_up,
            alt_down,
            ctrl_down,
            shift_down,
            win_down,
            ESCAPE_BLOCKED.load(Ordering::Relaxed),
        );

        if blocked {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

// ── Virtual desktop guard ─────────────────────────────────────────────────────

fn virtual_desktop_targets<T: Copy + Eq>(
    original: T,
    registry: Option<T>,
    foreground: isize,
    exam: isize,
    mut on_current: impl FnMut(isize) -> bool,
    mut desktop_id: impl FnMut(isize) -> Option<T>,
) -> [Option<T>; 2] {
    let registry = registry.filter(|id| *id != original);
    let foreground = (foreground != 0 && foreground != exam && on_current(foreground))
        .then(|| desktop_id(foreground))
        .flatten()
        .filter(|id| *id != original && Some(*id) != registry);
    [registry, foreground]
}

fn move_exam_to_current<T: Copy>(
    targets: impl IntoIterator<Item = T>,
    original_id: T,
    mut move_exam: impl FnMut(T) -> Result<(), String>,
    mut is_current: impl FnMut() -> bool,
) -> Result<(), String> {
    let mut last_error = "current desktop ID unavailable".to_string();
    for desktop_id in targets {
        if let Err(error) = move_exam(desktop_id) {
            last_error = error;
            continue;
        }
        if is_current() {
            return Ok(());
        }
        move_exam(original_id)
            .map_err(|error| format!("stale desktop ID; rollback failed: {error}"))?;
        last_error = "stale desktop ID; restored original desktop".into();
    }
    Err(last_error)
}

fn parse_virtual_desktop_id(value_type: u32, bytes: &[u8]) -> Option<windows::core::GUID> {
    use windows::Win32::System::Registry::REG_BINARY;
    if value_type != REG_BINARY.0 || bytes.len() != 16 {
        return None;
    }
    let id = windows::core::GUID {
        data1: u32::from_le_bytes(bytes[0..4].try_into().ok()?),
        data2: u16::from_le_bytes(bytes[4..6].try_into().ok()?),
        data3: u16::from_le_bytes(bytes[6..8].try_into().ok()?),
        data4: bytes[8..16].try_into().ok()?,
    };
    (id != windows::core::GUID::zeroed()).then_some(id)
}

fn current_virtual_desktop_from_registry() -> Option<windows::core::GUID> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenSessionId, TOKEN_QUERY};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, REG_VALUE_TYPE, RRF_RT_REG_BINARY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn read(path: &str) -> Option<windows::core::GUID> {
        let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut bytes = [0u8; 16];
        let mut size = bytes.len() as u32;
        let mut value_type = REG_VALUE_TYPE(0);
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(path.as_ptr()),
                windows::core::w!("CurrentVirtualDesktop"),
                RRF_RT_REG_BINARY,
                Some(&mut value_type),
                Some(bytes.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        (status == ERROR_SUCCESS)
            .then(|| bytes.get(..size as usize))
            .flatten()
            .and_then(|value| parse_virtual_desktop_id(value_type.0, value))
    }

    let mut token = HANDLE::default();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.is_ok() {
        let mut session_id = 0u32;
        let mut returned = 0u32;
        let session = unsafe {
            GetTokenInformation(
                token,
                TokenSessionId,
                Some((&mut session_id as *mut u32).cast()),
                std::mem::size_of::<u32>() as u32,
                &mut returned,
            )
        };
        let _ = unsafe { CloseHandle(token) };
        if session.is_ok() {
            let path = format!(
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo\{session_id}\VirtualDesktops"
            );
            if let Some(id) = read(&path) {
                return Some(id);
            }
        }
    }
    // shortcut: Explorer's undocumented current-desktop value can lag a switch
    // or disappear on a Windows update; validate after moving and roll back.
    read(r"Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops")
}

fn report_virtual_desktop_guard_failure(last_report: &mut Option<std::time::Instant>, error: &str) {
    if last_report.is_none_or(|last| last.elapsed() >= std::time::Duration::from_secs(5)) {
        eprintln!("AMS Access: virtual desktop recovery failed: {error}");
        *last_report = Some(std::time::Instant::now());
    }
}

/// Spawn a background thread that detects when the exam window is no longer on
/// the current virtual desktop (e.g. touchpad 3-finger swipe on non-WPT devices)
/// and attempts to move it back every 250 ms.
///
/// Read Explorer's current desktop ID when available; otherwise use a current
/// foreground window's GUID. Verify the move and roll it back if the ID was stale.
///
/// Stops when `SHIELD_ACTIVE` is false (set by `unlock_desktop()`).
pub fn spawn_virtual_desktop_guard(hwnd_raw: isize) {
    let epoch = VIRTUAL_DESKTOP_GUARD_EPOCH.load(Ordering::SeqCst);
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
                eprintln!("AMS Access: virtual desktop guard COM initialization failed: {hr:?}");
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
            let vdm = match vdm {
                Ok(vdm) => vdm,
                Err(error) => {
                    eprintln!("AMS Access: virtual desktop guard COM object unavailable: {error}");
                    unsafe { CoUninitialize() };
                    return;
                }
            };

            let hwnd = HWND(hwnd_raw as *mut _);
            let mut last_report = None;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if !SHIELD_ACTIVE.load(Ordering::SeqCst)
                    || VIRTUAL_DESKTOP_GUARD_EPOCH.load(Ordering::SeqCst) != epoch
                {
                    break;
                }

                // Check if our window is still on the active virtual desktop
                match unsafe { vdm.IsWindowOnCurrentVirtualDesktop(hwnd) } {
                    Ok(current) if !current.as_bool() => {}
                    Ok(_) => continue,
                    Err(error) => {
                        report_virtual_desktop_guard_failure(
                            &mut last_report,
                            &format!("current-desktop query: {error}"),
                        );
                        continue;
                    }
                }

                let fg = unsafe { GetForegroundWindow() };
                if !fg.0.is_null() {
                    let name = foreground_process_name(fg);
                    if name.is_none() || is_secure_or_system_process(name.as_deref()) {
                        continue; // unknown ownership may be a protected system dialog
                    }
                }
                // Serialize target selection and the final move with teardown.
                let Some(_operation) = DESKTOP_GATE.enter() else {
                    break;
                };
                if !SHIELD_ACTIVE.load(Ordering::SeqCst)
                    || VIRTUAL_DESKTOP_GUARD_EPOCH.load(Ordering::SeqCst) != epoch
                {
                    break;
                }
                if !matches!(
                    unsafe { vdm.IsWindowOnCurrentVirtualDesktop(hwnd) },
                    Ok(current) if !current.as_bool()
                ) {
                    continue;
                }
                let Ok(original_id) = (unsafe { vdm.GetWindowDesktopId(hwnd) }) else {
                    report_virtual_desktop_guard_failure(
                        &mut last_report,
                        "exam desktop ID unavailable",
                    );
                    continue;
                };
                if original_id == windows::core::GUID::zeroed() {
                    report_virtual_desktop_guard_failure(
                        &mut last_report,
                        "exam desktop ID is zero",
                    );
                    continue;
                }
                let targets = virtual_desktop_targets(
                    original_id,
                    current_virtual_desktop_from_registry(),
                    fg.0 as isize,
                    hwnd_raw,
                    |candidate| {
                        unsafe { vdm.IsWindowOnCurrentVirtualDesktop(HWND(candidate as *mut _)) }
                            .is_ok_and(|current| current.as_bool())
                    },
                    |candidate| {
                        unsafe { vdm.GetWindowDesktopId(HWND(candidate as *mut _)) }
                            .ok()
                            .filter(|id| *id != windows::core::GUID::zeroed())
                    },
                );
                if let Err(error) = move_exam_to_current(
                    targets.into_iter().flatten(),
                    original_id,
                    |id| {
                        unsafe { vdm.MoveWindowToDesktop(hwnd, &id) }
                            .map_err(|error| error.to_string())
                    },
                    || {
                        unsafe { vdm.IsWindowOnCurrentVirtualDesktop(hwnd) }
                            .is_ok_and(|current| current.as_bool())
                    },
                ) {
                    report_virtual_desktop_guard_failure(&mut last_report, &error);
                } else {
                    last_report = None;
                    let current_fg = unsafe { GetForegroundWindow() };
                    if !current_fg.0.is_null() {
                        let name = foreground_process_name(current_fg);
                        if name.is_some() && !is_secure_or_system_process(name.as_deref()) {
                            if let Err(error) = unsafe { SetForegroundWindow(hwnd) }.ok() {
                                report_virtual_desktop_guard_failure(
                                    &mut last_report,
                                    &format!("foreground activation: {error}"),
                                );
                            }
                        }
                    }
                }
            }

            unsafe { CoUninitialize() };
        });
}

#[cfg(test)]
mod virtual_desktop_guard_tests {
    use super::{move_exam_to_current, parse_virtual_desktop_id, virtual_desktop_targets};
    use windows::Win32::System::Registry::{REG_BINARY, REG_SZ};

    #[test]
    fn registry_target_covers_missing_or_stale_foreground() {
        for foreground in [0, 7] {
            let targets = virtual_desktop_targets(
                41,
                Some(42),
                foreground,
                9,
                |_| false,
                |_| panic!("stale foreground must not supply an ID"),
            );
            assert_eq!(targets, [Some(42), None]);
        }
    }

    #[test]
    fn absent_or_stale_registry_requires_valid_current_foreground() {
        let targets = virtual_desktop_targets(
            41,
            None,
            7,
            9,
            |_| false,
            |_| panic!("stale foreground must not supply an ID"),
        );
        assert_eq!(targets, [None, None]);

        let targets = virtual_desktop_targets(41, Some(41), 7, 9, |_| true, |_| Some(43));
        assert_eq!(targets, [None, Some(43)]);
        let targets = virtual_desktop_targets(41, Some(41), 7, 9, |_| true, |_| Some(41));
        assert_eq!(targets, [None, None]);
    }

    #[test]
    fn failed_move_does_not_verify_or_retry_without_another_target() {
        let result = move_exam_to_current(
            [42],
            41,
            |_| Err("move denied".into()),
            || panic!("failed move cannot be current"),
        );
        assert_eq!(result.err().as_deref(), Some("move denied"));
    }

    #[test]
    fn stale_registry_target_rolls_back_then_tries_valid_foreground_target() {
        let moved = std::cell::RefCell::new(Vec::new());
        let targets = virtual_desktop_targets(41, Some(42), 7, 9, |_| true, |_| Some(43));
        assert_eq!(targets, [Some(42), Some(43)]);
        let result = move_exam_to_current(
            targets.into_iter().flatten(),
            41,
            |id| {
                moved.borrow_mut().push(id);
                Ok(())
            },
            || moved.borrow().last() == Some(&43),
        );
        assert!(result.is_ok());
        assert_eq!(*moved.borrow(), vec![42, 41, 43]);
    }

    #[test]
    fn rollback_failure_aborts_before_second_target() {
        let moved = std::cell::RefCell::new(Vec::new());
        let result = move_exam_to_current(
            [42, 43],
            41,
            |id| {
                moved.borrow_mut().push(id);
                if id == 41 {
                    Err("rollback denied".into())
                } else {
                    Ok(())
                }
            },
            || false,
        );
        assert!(result.err().unwrap().contains("rollback failed"));
        assert_eq!(*moved.borrow(), vec![42, 41]);
    }

    #[test]
    fn registry_guid_requires_binary_16_bytes_and_nonzero() {
        let bytes = [
            0x43, 0xdd, 0xc4, 0x28, 0xf9, 0x46, 0x02, 0x46, 0xba, 0x2f, 0xe7, 0xe7, 0x72, 0xa2,
            0xd3, 0x30,
        ];
        let id = parse_virtual_desktop_id(REG_BINARY.0, &bytes).unwrap();
        assert_eq!(
            id,
            windows::core::GUID::from_u128(0x28c4dd43_46f9_4602_ba2f_e7e772a2d330)
        );
        assert!(parse_virtual_desktop_id(REG_SZ.0, &bytes).is_none());
        assert!(parse_virtual_desktop_id(REG_BINARY.0, &bytes[..15]).is_none());
        assert!(parse_virtual_desktop_id(REG_BINARY.0, &[0; 16]).is_none());
    }
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

static NETWORK_GATE: TerminalGate = TerminalGate::new();

/// Restrict this executable's outbound destinations without overlapping blocks
/// and allows: explicit Windows firewall blocks always take precedence.
/// The verified private WebView2 image is covered by the same policy.
/// The global outbound policy remains unchanged.
pub fn enable_network_lockdown(
    allowed_ips: &[String],
    runtime: &VerifiedRuntime,
) -> Result<(), String> {
    if !instance::owns_instance() {
        return Err("Windows firewall changes require instance ownership".into());
    }
    // Validate before removing any existing policy.
    let plan = firewall_policy::plan(allowed_ips)?;
    let _policy_owner = NETWORK_GATE
        .enter()
        .ok_or("Windows firewall lockdown cannot start during shutdown")?;
    runtime.revalidate_layout()?;
    // Firewall program identities use DOS paths; canonicalize returns the
    // extended-length prefix, which is not part of the executable identity.
    let native_path = runtime.app_image.to_string_lossy();
    let browser_path = runtime.browser_image.to_string_lossy();
    let native = native_path.strip_prefix(r"\\?\").unwrap_or(&native_path);
    let browser = browser_path.strip_prefix(r"\\?\").unwrap_or(&browser_path);
    firewall_policy::install_programs_with(
        &plan,
        &[(native, ""), (browser, "_WEBVIEW2")],
        disable_network_lockdown_unlocked,
        |program, action, name, addresses| {
            let program_arg = format!("program=\"{program}\"");
            let output = hidden_command("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "add",
                    "rule",
                    &format!("name={name}"),
                    "dir=out",
                    &format!("action={action}"),
                    "enable=yes",
                    "profile=any",
                    &format!("remoteip={addresses}"),
                    &program_arg,
                ])
                .bounded_output()
                .map_err(|error| error.to_string())?;
            if output.status.success() {
                Ok(())
            } else {
                Err(format!(
                    "netsh {action} failed: {} {}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        },
        || {
            // A timed-out creation may have exhausted this thread's budget.
            // Give verified rollback its own bounded cleanup worker.
            std::thread::spawn(disable_network_lockdown_unlocked)
                .join()
                .unwrap_or_else(|_| Err("Windows firewall rollback worker failed".into()))
        },
    )
}

mod firewall_policy;
mod firewall_recovery;
mod private_webview;
pub use private_webview::{prepare_private_runtime, VerifiedRuntime};

// Read actual INetFwRule.Name values, not localized netsh display text. Keep COM
// enumeration in a bounded child so a stalled firewall service cannot strand
// the app's worker. Filter complete names before serialization to bound output;
// -InputObject preserves an array for zero, one, or multiple matching rules.
const FIREWALL_INVENTORY_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
try {
    $policy = New-Object -ComObject HNetCfg.FwPolicy2
    $names = @(foreach ($rule in $policy.Rules) {
        $name = [string]$rule.Name
        if ([string]::Equals($name, 'AMS_PROCTOR_BLOCK_ALL', [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($name, 'AMS_PROCTOR_ALLOW', [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($name, 'AMS_PROCTOR_BLOCK_ALL_WEBVIEW2', [StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($name, 'AMS_PROCTOR_ALLOW_WEBVIEW2', [StringComparison]::OrdinalIgnoreCase)) {
            $name
        }
    })
    [Console]::WriteLine((ConvertTo-Json -InputObject $names -Compress))
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
"#;

/// Remove AMS firewall rules and verify their absence before reporting recovery.
pub fn disable_network_lockdown() -> Result<(), String> {
    if !instance::owns_instance() {
        return Err("Windows firewall recovery requires instance ownership".into());
    }
    let _policy_owner = NETWORK_GATE.lock();
    disable_network_lockdown_unlocked()
}

pub fn close_network_lockdown_on_exit() -> Result<(), String> {
    let _policy_owner = NETWORK_GATE.close();
    if !instance::owns_instance() {
        return Err("Windows firewall recovery requires instance ownership".into());
    }
    disable_network_lockdown_unlocked()
}

// The public operation retains NETWORK_GATE through installation and
// rollback, including when the bounded rollback runs on a separate worker.
fn disable_network_lockdown_unlocked() -> Result<(), String> {
    let _budget = Budget::new(std::time::Duration::from_secs(8));
    firewall_recovery::cleanup(
        |name| {
            hidden_command("netsh")
                .args([
                    "advfirewall",
                    "firewall",
                    "delete",
                    "rule",
                    &format!("name={name}"),
                ])
                .bounded_output()
                .map(|_| ())
                .map_err(|error| format!("Cannot delete firewall rule: {error}"))
        },
        || {
            let output = hidden_command("powershell.exe")
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    FIREWALL_INVENTORY_SCRIPT,
                ])
                .bounded_checked_output()
                .map_err(|error| format!("Cannot verify firewall recovery: {error}"))?;
            String::from_utf8(output.stdout)
                .map_err(|error| format!("Invalid firewall inventory encoding: {error}"))
        },
    )
}

/// Returns true if `name` (without .exe) is in the Windows RESTRICTED list.
pub fn is_restricted_name(name: &str) -> bool {
    RESTRICTED
        .iter()
        .any(|&r| r.trim_end_matches(".exe").eq_ignore_ascii_case(name))
}

#[cfg(test)]
mod advisory_tests {
    use super::{advisory_in, ADVISORY, RESTRICTED};

    /// Real `tasklist /FO CSV /NH` output: Discord runs six processes.
    const SIX_DISCORDS: &str = concat!(
        "\"Discord.exe\",\"1234\",\"Console\",\"1\",\"180,000 K\"\n",
        "\"Discord.exe\",\"1235\",\"Console\",\"1\",\"90,000 K\"\n",
        "\"Discord.exe\",\"1236\",\"Console\",\"1\",\"60,000 K\"\n",
        "\"Discord.exe\",\"1237\",\"Console\",\"1\",\"50,000 K\"\n",
        "\"Discord.exe\",\"1238\",\"Console\",\"1\",\"40,000 K\"\n",
        "\"Discord.exe\",\"1239\",\"Console\",\"1\",\"30,000 K\"\n",
        "\"explorer.exe\",\"900\",\"Console\",\"1\",\"20,000 K\"\n",
    );

    #[test]
    fn one_entry_per_app_however_many_processes_it_runs() {
        // The dialog used to read "discord, discord, discord, discord,
        // discord, discord" from exactly this.
        assert_eq!(advisory_in(SIX_DISCORDS), vec!["discord".to_string()]);
    }

    #[test]
    fn an_unlisted_process_is_not_reported() {
        assert!(advisory_in("\"explorer.exe\",\"900\",\"Console\",\"1\",\"20,000 K\"").is_empty());
        assert!(advisory_in("").is_empty());
    }

    #[test]
    fn a_chat_app_is_never_also_a_blocking_app() {
        // The whole point: an advisory app must not reach `found`, or it
        // would still set `clean = false` and still block entry.
        for &a in ADVISORY {
            assert!(
                !RESTRICTED.contains(&a),
                "{a} is in both lists, so it would still block"
            );
        }
    }
}

#[cfg(test)]
mod restricted_process_tests {
    use super::{is_restricted_name, CAPTURE_PROCESSES, RESTRICTED};

    #[test]
    fn generic_nvidia_container_is_not_restricted_regardless_of_case() {
        for name in ["nvcontainer", "NvContainer", "NVCONTAINER"] {
            assert!(!is_restricted_name(name), "{name} should not be restricted");
        }
        assert!(!RESTRICTED.contains(&"nvcontainer.exe"));
        assert!(!CAPTURE_PROCESSES.contains(&"nvcontainer.exe"));
    }

    #[test]
    fn dedicated_nvidia_capture_processes_remain_restricted() {
        for name in ["nvcapture", "NvCapture", "nvsphelper64", "NVSPHELPER64"] {
            assert!(is_restricted_name(name), "{name} should be restricted");
        }
        assert!(CAPTURE_PROCESSES.contains(&"nvcapture.exe"));
    }

    #[test]
    fn other_restricted_processes_are_unchanged() {
        for name in ["obs64", "anydesk", "wireshark", "gamebar"] {
            assert!(is_restricted_name(name), "{name} should be restricted");
        }
    }
}

/// Report restricted apps that the candidate still needs to close.
///
/// This command used to force-terminate processes. It is deliberately
/// detection-only now: callers retain the existing response shape, but every
/// validated name is returned as unresolved until a subsequent process scan
/// confirms that the candidate closed it themselves.
pub fn close_apps(names: &[String]) -> CloseAppsResult {
    CloseAppsResult {
        closed: Vec::new(),
        failed: names.to_vec(),
    }
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

// ── Fullscreen kiosk: Win32 observers / executors (thin, not unit-tested) ──────

/// Inspect the OS foreground window and return the non-Tauri portion of a
/// `TickInput`: (exam_is_foreground, foreground_is_null, foreground_hwnd,
/// foreground_is_secure_system, foreground_process). Fail-safe: a null
/// foreground is reported as such (the caller's NULL_LOCK_TICKS logic decides
/// transient vs locked); it is NOT coerced to "exam focused".
pub fn observe_foreground(exam_hwnd: isize) -> (bool, bool, isize, bool, Option<String>) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let exam = HWND(exam_hwnd as *mut _);
    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        return (false, true, 0, false, None);
    }
    if fg == exam {
        return (true, false, exam_hwnd, false, None);
    }
    let name = foreground_process_name(fg);
    let secure = is_secure_or_system_process(name.as_deref());
    (false, false, fg.0 as isize, secure, name)
}

/// Lowercased image file name (e.g. "chrome.exe") of the process owning `fg`.
fn foreground_process_name(fg: windows::Win32::Foundation::HWND) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(fg, Some(&mut pid));
    }
    if pid == 0 {
        return None;
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 260];
    let mut len = buf.len() as u32;
    let res = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    if res.is_err() {
        return None;
    }

    let full = String::from_utf16_lossy(&buf[..len as usize]);
    full.rsplit(['\\', '/'])
        .next()
        .map(|s| s.to_ascii_lowercase())
}

/// Secure-desktop / login-UI / UAC processes we must NEVER fight for focus
/// (spec §1 + §5 CASE C secure branch).
fn is_secure_or_system_process(name: Option<&str>) -> bool {
    matches!(
        name,
        Some("winlogon.exe" | "csrss.exe" | "logonui.exe" | "consent.exe")
    )
}

/// One gentle attempt to pull the exam window to the foreground.
pub fn set_exam_foreground(exam_hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
    let _ = unsafe { SetForegroundWindow(HWND(exam_hwnd as *mut _)) };
}

#[cfg(test)]
mod hidden_command_tests {
    use super::{hidden_command, CommandDeadlineExt};

    #[test]
    fn console_helpers_have_no_console_window() {
        let output = hidden_command("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'; [ConsoleProbe]::GetConsoleWindow().ToInt64()"#,
            ])
            .bounded_output_with_timeout(std::time::Duration::from_secs(30))
            .expect("console probe must finish");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "0");
    }
}

#[cfg(test)]
mod display_tests {
    use super::resolve_monitor_count;

    #[test]
    fn first_positive_read_short_circuits() {
        let mut calls = 0;
        let count = resolve_monitor_count(
            3,
            || {
                calls += 1;
                2
            },
            |_| {},
        );
        assert_eq!(count, 2);
        assert_eq!(calls, 1); // no further reads after a good one
    }

    #[test]
    fn retries_absorb_a_transient_zero() {
        let mut reads = [0, 0, 3].into_iter();
        let count = resolve_monitor_count(3, || reads.next().unwrap(), |_| {});
        assert_eq!(count, 3);
    }

    #[test]
    fn persistent_failure_yields_zero_sentinel() {
        let count = resolve_monitor_count(3, || 0, |_| {});
        assert_eq!(count, 0);
    }

    #[test]
    fn negative_reads_are_treated_as_failure() {
        let count = resolve_monitor_count(2, || -1, |_| {});
        assert_eq!(count, 0);
    }
}

#[cfg(test)]
mod firewall_inventory_query_tests {
    use super::{hidden_command, CommandDeadlineExt, FIREWALL_INVENTORY_SCRIPT};

    // Execute the production serialization/filtering in Windows PowerShell,
    // replacing only its COM data source. Never inspect or mutate host rules.
    fn mock_inventory(source: &str) -> std::process::Output {
        let factory = "$policy = New-Object -ComObject HNetCfg.FwPolicy2";
        assert!(FIREWALL_INVENTORY_SCRIPT.contains(factory));
        let script = FIREWALL_INVENTORY_SCRIPT.replace(factory, source);
        // Allow for cold PowerShell startup on shared CI runners.
        hidden_command("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .bounded_output_with_timeout(std::time::Duration::from_secs(30))
            .expect("mock inventory script must finish")
    }

    #[test]
    fn powershell_inventory_preserves_zero_one_and_multiple_name_arrays() {
        for (rules, expected) in [
            ("@()", vec![]),
            ("@([pscustomobject]@{Name='ams_proctor_allow'})", vec!["ams_proctor_allow"]),
            ("@([pscustomobject]@{Name='AMS_PROCTOR_ALLOW'}, [pscustomobject]@{Name='AMS_PROCTOR_BLOCK_ALL'})", vec!["AMS_PROCTOR_ALLOW", "AMS_PROCTOR_BLOCK_ALL"]),
            ("@([pscustomobject]@{Name='AMS_PROCTOR_ALLOW_WEBVIEW2'}, [pscustomobject]@{Name='AMS_PROCTOR_BLOCK_ALL_WEBVIEW2'})", vec!["AMS_PROCTOR_ALLOW_WEBVIEW2", "AMS_PROCTOR_BLOCK_ALL_WEBVIEW2"]),
            ("@([pscustomobject]@{Name='AMS_PROCTOR_ALLOW (backup)'}, [pscustomobject]@{Name='Other'; Description='AMS_PROCTOR_ALLOW'})", vec![]),
        ] {
            let output = mock_inventory(&format!("$policy = [pscustomobject]@{{Rules={rules}}}"));
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            let names: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
            assert_eq!(names, expected);
        }
    }

    #[test]
    fn powershell_inventory_failure_does_not_serialize_an_empty_success() {
        let output = mock_inventory("throw 'mock inventory unavailable'");
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
    }
}

// ── wireless ────────────────────────────────────────────────────────────────
//
// `netsh`, parsed by the shape of its output rather than its labels: it
// prints in the Windows display language, and a candidate on a Hindi or
// German install must get the same list as everyone else.

/// The SSID currently joined, if any.
fn current_ssid() -> Option<String> {
    let output = hidden_command("netsh")
        .args(["wlan", "show", "interfaces"])
        .bounded_output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // The SSID line and the BSSID line differ only by that prefix, and
    // "SSID" is one of the few tokens netsh does not translate.
    text.lines()
        .filter_map(|line| line.split_once(':'))
        .find(|(left, _)| {
            let key = left.trim().to_ascii_lowercase();
            key == "ssid"
        })
        .map(|(_, right)| right.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// What wireless networks this machine can see.
pub fn wifi_scan() -> crate::WifiScan {
    let Ok(output) = hidden_command("netsh")
        .args(["wlan", "show", "networks", "mode=bssid"])
        .bounded_output()
    else {
        return crate::WifiScan::default();
    };
    if !output.status.success() {
        return crate::WifiScan::default();
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let rows = crate::wifi_parse::parse_netsh(&text);
    let current = current_ssid();
    crate::WifiScan {
        networks: crate::wifi_parse::tidy(rows, current.as_deref()),
        connected: current.is_some(),
        current,
        supported: true,
    }
}

/// Join a network.
///
/// Native WLAN accepts an in-memory temporary profile, so a failed join never
/// replaces a saved profile or leaves a password in a temporary file.
pub fn wifi_connect(ssid: &str, password: Option<&str>) -> Result<(), String> {
    wifi::connect(ssid, password.unwrap_or(""))
}
