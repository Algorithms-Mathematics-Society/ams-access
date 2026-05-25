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

pub fn lock_desktop() -> bool {
    enable_keyboard_intercept().active
}

pub fn unlock_desktop() {
    disable_keyboard_intercept();
}

// ── Network lockdown (pf) ─────────────────────────────────────────────────────

const PF_RULES_PATH: &str = "/tmp/ams_pf.conf";

fn pfctl(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("pfctl")
        .args(args)
        .output()
        .map_err(|e| e.to_string())
}

/// Apply outbound firewall via pf: allow only `allowed_ips`, block everything else.
/// Rules persist until `disable_network_lockdown` is called — intentional.
pub fn enable_network_lockdown(allowed_ips: &[String]) -> Result<(), String> {
    let mut rules = String::from("# AMS Proctor - generated, do not edit\n");
    rules.push_str("set skip on lo0\n");
    for ip in allowed_ips {
        rules.push_str(&format!("pass out quick to {} keep state\n", ip));
    }
    rules.push_str("block out all\n");

    std::fs::write(PF_RULES_PATH, &rules).map_err(|e| e.to_string())?;

    let out = pfctl(&["-f", PF_RULES_PATH])?;
    if !out.status.success() {
        return Err(format!(
            "pfctl load failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    // Enable pf (idempotent if already on)
    let _ = pfctl(&["-e"]);

    Ok(())
}

/// Reload default macOS pf rules and disable pf (it's off by default on macOS).
pub fn disable_network_lockdown() -> Result<(), String> {
    let _ = pfctl(&["-f", "/etc/pf.conf"]);
    let _ = pfctl(&["-d"]);
    let _ = std::fs::remove_file(PF_RULES_PATH);
    Ok(())
}
