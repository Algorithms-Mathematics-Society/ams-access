use core_rs::exam::{KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

const RESTRICTED: &[&str] = &[
    "obs64.exe",
    "obs32.exe",
    "obs.exe",
    "discord.exe",
    "teamviewer.exe",
    "teamviewerhost.exe",
    "anydesk.exe",
    "vncviewer.exe",
    "tvnviewer.exe",
    "rustdesk.exe",
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
    "zoom.exe",
    "teams.exe",
    "skype.exe",
    "mstsc.exe",
    "rdpclip.exe",
];

pub fn scan_processes() -> ProcessScanResult {
    let mut found = Vec::new();
    if let Ok(out) = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        for &r in RESTRICTED {
            if text.contains(r) && !found.contains(&r.to_string()) {
                found.push(r.trim_end_matches(".exe").to_string());
            }
        }
    }
    let clean = found.is_empty();
    ProcessScanResult { found, clean }
}

pub fn detect_virtualization() -> VirtDetectionResult {
    if let Ok(out) = std::process::Command::new("systeminfo").output() {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        let vm_markers = [
            "vmware",
            "virtualbox",
            "virtual machine",
            "hyper-v",
            "kvm",
            "xen",
            "qemu",
            "parallels",
        ];
        for &vm in &vm_markers {
            if text.contains(vm) {
                return VirtDetectionResult {
                    detected: true,
                    platform: Some(vm.to_string()),
                    confidence: "high",
                };
            }
        }
    }
    let hv_check = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Virtual Machine\Guest\Parameters",
        ])
        .output();
    if matches!(hv_check, Ok(ref out) if out.status.success()) {
        return VirtDetectionResult {
            detected: true,
            platform: Some("hyper-v".to_string()),
            confidence: "high",
        };
    }
    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high",
    }
}

/// Prevent display/system sleep during exam.
fn set_sleep_prevention(enable: bool) {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        EXECUTION_STATE,
    };
    unsafe {
        if enable {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

pub fn lock_desktop() -> bool {
    set_sleep_prevention(true);
    let result = enable_keyboard_intercept();
    result.active
}

pub fn unlock_desktop() {
    set_sleep_prevention(false);
    disable_keyboard_intercept();
}

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    if HOOK_ACTIVE.load(Ordering::SeqCst) {
        return KeyboardInterceptResult {
            active: true,
            method: "ll-keyboard-hook",
            platform: "windows",
        };
    }
    HOOK_ACTIVE.store(true, Ordering::SeqCst);
    set_sleep_prevention(true);

    std::thread::spawn(|| {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Threading::GetCurrentThreadId;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL,
        };

        let tid = unsafe { GetCurrentThreadId() };
        HOOK_THREAD_ID.store(tid, Ordering::SeqCst);

        unsafe {
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(kbproc), None, 0) {
                Ok(h) => h,
                Err(_) => {
                    HOOK_ACTIVE.store(false, Ordering::SeqCst);
                    HOOK_THREAD_ID.store(0, Ordering::SeqCst);
                    return;
                }
            };

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}

            UnhookWindowsHookEx(hook).ok();
        }

        HOOK_ACTIVE.store(false, Ordering::SeqCst);
        HOOK_THREAD_ID.store(0, Ordering::SeqCst);
    });

    KeyboardInterceptResult {
        active: true,
        method: "ll-keyboard-hook",
        platform: "windows",
    }
}

pub fn disable_keyboard_intercept() {
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

unsafe extern "system" fn kbproc(
    code: i32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, HHOOK, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN,
    };

    if code >= 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let vk = kb.vkCode;
        let alt_down = kb.flags.0 & LLKHF_ALTDOWN.0 != 0;
        let ctrl_down =
            (windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x11) as u16 & 0x8000)
                != 0;

        // Block: Win keys, PrintScreen, Alt+Tab, Alt+F4, Ctrl+Esc, Escape
        let blocked = vk == 0x5B  // LWin
            || vk == 0x5C          // RWin
            || vk == 0x2C          // PrintScreen
            || (alt_down && vk == 0x09)  // Alt+Tab
            || (alt_down && vk == 0x73)  // Alt+F4
            || (ctrl_down && vk == 0x1B) // Ctrl+Esc
            || vk == 0x1B; // Escape

        if blocked {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn detect_remote_desktop() -> bool {
    std::env::var("SESSIONNAME")
        .map(|s| s.to_uppercase().contains("RDP"))
        .unwrap_or(false)
}

// ── Network lockdown (Windows Firewall via netsh) ─────────────────────────────

fn netsh(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("netsh")
        .args(args)
        .output()
        .map_err(|e| e.to_string())
}

/// Apply outbound firewall: set default outbound to block, allow only `allowed_ips`.
/// Rules persist until `disable_network_lockdown` is called — intentional.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    // Clear any leftover rules first (idempotent)
    let _ = disable_network_lockdown();

    // Add allow rules for whitelisted IPs before setting default to block
    for ip in allowed_ips {
        let out = std::process::Command::new("netsh")
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

    // Set default outbound to block across all profiles
    // Explicit allow rules above take precedence over the default block
    let out = netsh(&[
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,blockoutbound",
    ])?;
    if !out.status.success() {
        return Err(format!(
            "netsh set policy failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    Ok(())
}

/// Restore default outbound policy and remove AMS allow rules.
pub fn disable_network_lockdown() -> Result<(), String> {
    // Restore Windows default: block inbound, allow outbound
    let _ = netsh(&[
        "advfirewall",
        "set",
        "allprofiles",
        "firewallpolicy",
        "blockinbound,allowoutbound",
    ]);
    // Remove all AMS allow rules
    let _ = netsh(&[
        "advfirewall",
        "firewall",
        "delete",
        "rule",
        "name=AMS_PROCTOR_ALLOW",
    ]);
    Ok(())
}
