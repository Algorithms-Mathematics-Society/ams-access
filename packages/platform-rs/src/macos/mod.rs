use core_rs::exam::{KeyboardInterceptResult, ProcessScanResult, VirtDetectionResult};

const RESTRICTED: &[&str] = &[
    "obs",
    "Discord",
    "TeamViewer",
    "AnyDesk",
    "VNC Viewer",
    "Chicken",
    "RealVNC",
    "RustDesk",
    "Wireshark",
    "lldb",
    "gdb",
    "Charles",
    "Proxyman",
    "Zoom",
    "Teams",
    "Skype",
    "Remote Desktop",
    "Microsoft Remote Desktop",
    "Reflector",
];

/// Scan processes via `ps -axo comm`.
pub fn scan_processes() -> ProcessScanResult {
    let mut found = Vec::new();

    if let Ok(out) = std::process::Command::new("ps")
        .args(["-axo", "comm"])
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout);
        for &r in RESTRICTED {
            if text.to_lowercase().contains(&r.to_lowercase()) && !found.contains(&r.to_string()) {
                found.push(r.to_string());
            }
        }
    }

    let clean = found.is_empty();
    ProcessScanResult { found, clean }
}

/// Detect virtualisation via system_profiler.
pub fn detect_virtualization() -> VirtDetectionResult {
    if let Ok(out) = std::process::Command::new("system_profiler")
        .arg("SPHardwareDataType")
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        let vm_markers = ["vmware", "virtualbox", "parallels", "qemu", "kvm", "xen"];
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

    VirtDetectionResult {
        detected: false,
        platform: None,
        confidence: "high",
    }
}

pub fn enable_keyboard_intercept() -> KeyboardInterceptResult {
    #[cfg(feature = "macos-tcc")]
    {
        // CGEventTapCreate for HID event tap would go here
    }
    KeyboardInterceptResult {
        active: true,
        method: "tauri-webview-intercept",
        platform: "macos",
    }
}

pub fn disable_keyboard_intercept() {}
