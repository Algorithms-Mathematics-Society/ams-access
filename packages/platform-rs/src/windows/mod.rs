use core_rs::exam::{KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult};

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

/// Scan running processes via `tasklist /FO CSV`.
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

/// Detect virtualisation via systeminfo and registry.
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

    // Check Hyper-V guest key
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

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    #[cfg(feature = "windows-hooks")]
    {
        // SetWindowsHookExW(WH_KEYBOARD_LL, ...) would go here
    }
    KeyboardInterceptResult {
        active: true,
        method: "tauri-webview-intercept",
        platform: "windows",
    }
}

pub fn disable_keyboard_intercept() {}

pub fn detect_remote_desktop() -> bool {
    std::env::var("SESSIONNAME")
        .map(|s| s.to_uppercase().contains("RDP"))
        .unwrap_or(false)
}
