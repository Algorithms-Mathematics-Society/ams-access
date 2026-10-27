#[cfg(unix)]
mod helper_client;
pub mod kiosk;
pub mod process_runner;

#[derive(Clone, Debug, serde::Serialize)]
pub struct BatteryStatus {
    pub percentage: u8,
    pub charging: bool,
    /// On external power, whether or not the battery is taking charge (a full
    /// battery on AC is plugged in but not charging). None where the OS cannot
    /// say; the UI then falls back to `charging`.
    pub plugged_in: Option<bool>,
}

/// One wireless network the machine can see.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WifiNetwork {
    pub ssid: String,
    /// 0-100 where the OS reports it, else None.
    pub signal: Option<u8>,
    pub secured: bool,
    /// Known to the OS as a saved network (macOS).
    pub saved: bool,
    pub current: bool,
}

/// What a scan found, and which radio it came from.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct WifiScan {
    pub networks: Vec<WifiNetwork>,
    /// Nearby scanning failed or exposed no names; using saved profiles.
    pub saved_only: bool,
    /// Whether Wi-Fi is associated, even when macOS hides its name.
    pub connected: bool,
    /// The SSID currently joined, if the OS exposes it.
    pub current: Option<String>,
    /// False when there is no wireless interface, or the OS refused to list.
    /// The UI shows nothing at all rather than an empty list, which would
    /// read as "no networks in range".
    pub supported: bool,
}

pub mod wifi_parse;

cfg_if::cfg_if! {
    if #[cfg(target_os = "linux")] {
        pub mod linux;
    } else if #[cfg(target_os = "windows")] {
        pub mod windows;
    } else if #[cfg(target_os = "macos")] {
        pub mod macos;
    }
}

// Exercise macOS journal failure paths without invoking native commands.
#[cfg(all(test, not(target_os = "macos")))]
#[path = "macos/lockdown_recovery.rs"]
mod macos_lockdown_recovery_tests;

// Verify Windows cleanup decisions without invoking real firewall commands.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "windows/firewall_recovery.rs"]
mod windows_firewall_recovery_tests;

// Test callback-delivery classification without installing a native hook.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "windows/hook_delivery.rs"]
mod windows_hook_delivery_tests;

// Exercise renewal and lifecycle races using fake handles, never native input.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "windows/hook_lifecycle.rs"]
mod windows_hook_lifecycle_tests;

// Exercise the Windows shortcut policy without installing a native hook.
#[cfg(all(test, not(target_os = "windows")))]
#[path = "windows/keyboard_policy.rs"]
mod windows_keyboard_policy_tests;

// Mac AppKit dispatch cancellation is pure and can be exercised on every host.
#[cfg(all(test, not(target_os = "macos")))]
#[path = "macos/deferred_job.rs"]
mod macos_deferred_job_tests;

#[cfg(all(test, not(target_os = "macos")))]
#[path = "macos/keyboard_policy.rs"]
#[allow(dead_code)]
mod macos_keyboard_policy_tests;
