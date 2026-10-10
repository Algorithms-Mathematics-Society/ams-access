// Prevents an additional console window on Windows in release, DO NOT REMOVE
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The lockdown watchdog and the login-time restore are this same binary
    // started with a helper flag. They must exit before anything GUI starts.
    if let Some(code) = ams_access_lib::run_helper_mode() {
        std::process::exit(code);
    }
    ams_access_lib::run();
}
