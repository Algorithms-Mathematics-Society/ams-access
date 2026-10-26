//! Nearby scans and in-process password joins through CoreWLAN.
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};

#[link(name = "CoreWLAN", kind = "framework")]
extern "C" {}

const SCAN_FLAG: &str = "--wifi-scan";
const SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct Scan {
    pub interface: String,
    pub networks: Vec<crate::WifiNetwork>,
    pub current: Option<String>,
}

pub(super) fn scan() -> Option<Scan> {
    use crate::process_runner::CommandDeadlineExt;
    // CoreWLAN cannot cancel a synchronous scan. Process isolation lets the
    // deadline runner kill and reap a hung scan without leaking worker threads.
    let output = std::process::Command::new(std::env::current_exe().ok()?)
        .arg(SCAN_FLAG)
        .bounded_output_with_timeout(SCAN_TIMEOUT)
        .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

/// Recognized before Tauri/AppKit startup, like the existing watchdog mode.
pub fn scan_helper_mode() -> Option<i32> {
    if std::env::args().nth(1).as_deref() != Some(SCAN_FLAG) {
        return None;
    }
    // CoreWLAN runs on the calling worker, never this process's main thread.
    let result = std::thread::Builder::new()
        .name("wifi-scan".into())
        .spawn(scan_native)
        .ok()
        .and_then(|worker| worker.join().ok())
        .flatten();
    Some(
        match result.and_then(|scan| serde_json::to_string(&scan).ok()) {
            Some(json) => {
                println!("{json}");
                0
            }
            None => 1,
        },
    )
}

fn scan_native() -> Option<Scan> {
    autoreleasepool(|_| {
        // SAFETY: SDK selectors and ABI types; nil is checked and all borrowed
        // Foundation/CoreWLAN objects are consumed inside this autorelease pool.
        unsafe {
            let client: *mut AnyObject = msg_send![class!(CWWiFiClient), sharedWiFiClient];
            if client.is_null() {
                return None;
            }
            let radio: *mut AnyObject = msg_send![client, interface];
            if radio.is_null() {
                return None;
            }
            let interface = visible_string(msg_send![radio, interfaceName])?;
            let mut error: *mut AnyObject = std::ptr::null_mut();
            let networks: *mut AnyObject = msg_send![radio,
                scanForNetworksWithName: std::ptr::null::<AnyObject>(), error: &mut error];
            if networks.is_null() {
                return None;
            }
            let current = visible_string(msg_send![radio, ssid]);
            let candidates: *mut AnyObject = msg_send![networks, allObjects];
            let count: usize = msg_send![candidates, count];
            let mut rows = Vec::new();
            for index in 0..count {
                let network: *mut AnyObject = msg_send![candidates, objectAtIndex: index];
                let Some(ssid) = visible_string(msg_send![network, ssid]) else {
                    continue;
                };
                let rssi: isize = msg_send![network, rssiValue];
                let open: Bool = msg_send![network, supportsSecurity: 0isize]; // kCWSecurityNone
                rows.push(crate::WifiNetwork {
                    ssid,
                    signal: crate::wifi_parse::rssi_percent(rssi),
                    secured: !open.as_bool(),
                    saved: false,
                    current: false,
                });
            }
            Some(Scan {
                interface,
                networks: rows,
                current,
            })
        }
    })
}

/// The caller keeps the NSString alive until its bytes have been copied.
unsafe fn visible_string(value: *mut AnyObject) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let bytes: *const std::ffi::c_char = msg_send![value, UTF8String];
    if bytes.is_null() {
        return None;
    }
    let name = std::ffi::CStr::from_ptr(bytes).to_str().ok()?;
    (!name.trim().is_empty() && name != "<redacted>").then(|| name.to_string())
}

pub(super) fn connect(interface: &str, ssid: &str, password: &str) -> Result<(), String> {
    if ssid.is_empty() || ssid.len() > 32 {
        return Err("Wi-Fi names must contain 1–32 bytes.".into());
    }
    autoreleasepool(|_| {
        // SAFETY: CoreWLAN/Foundation selectors and argument types follow the
        // SDK headers; autoreleased results stay inside this pool, nil is checked.
        unsafe {
            let string = |text: &str| -> Retained<AnyObject> {
                let allocated: *mut AnyObject = msg_send![class!(NSString), alloc];
                let value: *mut AnyObject = msg_send![allocated, initWithBytes: text.as_ptr().cast::<std::ffi::c_void>(),
                    length: text.len(), encoding: 4usize]; // NSUTF8StringEncoding
                Retained::from_raw(value).expect("valid UTF-8 NSString")
            };
            let client: *mut AnyObject = msg_send![class!(CWWiFiClient), sharedWiFiClient];
            if client.is_null() {
                return Err("Wi-Fi controls are unavailable on this Mac.".into());
            }
            let name = string(interface);
            let radio: *mut AnyObject = msg_send![client, interfaceWithName: &*name];
            if radio.is_null() {
                return Err("No wireless interface on this Mac.".into());
            }
            let name = string(ssid);
            let mut error: *mut AnyObject = std::ptr::null_mut();
            let networks: *mut AnyObject = msg_send![radio,
                scanForNetworksWithName: &*name, error: &mut error];
            if networks.is_null() {
                return Err("Could not find that Wi-Fi network. Check macOS Wi-Fi and Location access, then retry.".into());
            }
            let candidates: *mut AnyObject = msg_send![networks, allObjects];
            let count: usize = msg_send![candidates, count];
            let network = (0..count).find_map(|index| {
                let candidate: *mut AnyObject = msg_send![candidates, objectAtIndex: index];
                let ssid: *mut AnyObject = msg_send![candidate, ssid];
                if ssid.is_null() {
                    return None;
                }
                let matches: Bool = msg_send![ssid, isEqualToString: &*name];
                matches.as_bool().then_some(candidate)
            });
            let Some(network) = network else {
                return Err(
                    "That Wi-Fi network is unavailable. Check its range and macOS Location access."
                        .into(),
                );
            };
            let secret = string(password);
            let joined: Bool = msg_send![radio, associateToNetwork: network,
                password: &*secret, error: &mut error];
            if joined.as_bool() {
                Ok(())
            } else {
                // Do not echo native error descriptions, which may contain credentials.
                Err("Could not join that Wi-Fi network. Check the password and try again.".into())
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_names_drop_nil_blank_and_redacted_but_preserve_unicode() {
        autoreleasepool(|_| unsafe {
            assert_eq!(visible_string(std::ptr::null_mut()), None);
            for name in [c"", c" ", c"<redacted>"] {
                let value: *mut AnyObject =
                    msg_send![class!(NSString), stringWithUTF8String: name.as_ptr()];
                assert_eq!(visible_string(value), None);
            }
            let value: *mut AnyObject =
                msg_send![class!(NSString), stringWithUTF8String: c"Café: 5G".as_ptr()];
            assert_eq!(visible_string(value).as_deref(), Some("Café: 5G"));
        });
    }

    #[test]
    fn invalid_ssids_are_rejected_before_native_calls() {
        for ssid in ["", &"x".repeat(33), &"é".repeat(17)] {
            assert!(connect("en0", ssid, "secret").is_err());
        }
    }
}
