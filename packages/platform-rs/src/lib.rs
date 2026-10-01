#[cfg(unix)]
mod helper_client;
pub mod kiosk;
pub mod process_runner;

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
