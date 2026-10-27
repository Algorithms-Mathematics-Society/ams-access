//! Passwords stay in process memory, never in subprocess arguments.
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};

#[link(name = "CoreWLAN", kind = "framework")]
extern "C" {}

#[link(name = "CoreLocation", kind = "framework")]
extern "C" {}

thread_local! {
    static LOCATION_MANAGER: std::cell::RefCell<Option<Retained<AnyObject>>> = const { std::cell::RefCell::new(None) };
}

fn authorization_status(status: i32) -> &'static str {
    match status {
        0 => "not_determined",
        1 => "restricted",
        3 | 4 => "authorized", // Always / WhenInUse
        _ => "denied",
    }
}

pub fn location_status() -> &'static str {
    // SAFETY: CLLocationManager's class authorizationStatus returns CLAuthorizationStatus (int).
    unsafe { authorization_status(msg_send![class!(CLLocationManager), authorizationStatus]) }
}

/// Must run on the app main thread; never requests location updates.
pub fn request_location() {
    assert!(objc2::MainThreadMarker::new().is_some());
    if location_status() != "not_determined" {
        return;
    }
    LOCATION_MANAGER.with(|slot| {
        // SAFETY: the manager is created, retained and released on the main run loop.
        unsafe {
            let manager: Retained<AnyObject> = msg_send![class!(CLLocationManager), new];
            let _: () = msg_send![&*manager, requestWhenInUseAuthorization];
            *slot.borrow_mut() = Some(manager);
        }
    });
}

pub fn finish_location_request() {
    assert!(objc2::MainThreadMarker::new().is_some());
    LOCATION_MANAGER.with(|slot| slot.borrow_mut().take());
}

// CoreWLAN scans block until the OS answers. Never queue multiple radio scans
// behind a slow/permission-stalled operation; cached status reads remain cheap.
static RADIO_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Cached nearby networks for ordinary status reads; broadcast scan only on Rescan.
pub(super) fn scan(interface: &str, refresh: bool) -> Result<Vec<crate::WifiNetwork>, String> {
    let _operation =
        if refresh {
            Some(RADIO_OPERATION.try_lock().map_err(|_| {
                "Wi-Fi is busy. Wait for the current change, then rescan.".to_string()
            })?)
        } else {
            None
        };
    let result = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
        autoreleasepool(|_| unsafe {
            let client: *mut AnyObject = msg_send![class!(CWWiFiClient), sharedWiFiClient];
            if client.is_null() {
                return Err("Wi-Fi controls are unavailable on this Mac.".into());
            }
            let name = ns_string(interface);
            let radio: *mut AnyObject = msg_send![client, interfaceWithName: &*name];
            if radio.is_null() {
                return Err("No wireless interface on this Mac.".into());
            }
            let networks: *mut AnyObject = if refresh {
                let mut error: *mut AnyObject = std::ptr::null_mut();
                msg_send![radio, scanForNetworksWithName: std::ptr::null_mut::<AnyObject>(), error: &mut error]
            } else {
                msg_send![radio, cachedScanResults]
            };
            if networks.is_null() {
                return if refresh {
                    Err(
                        "Could not scan Wi-Fi. Check macOS Wi-Fi and Location access, then retry."
                            .into(),
                    )
                } else {
                    Ok(Vec::new())
                };
            }
            let candidates: *mut AnyObject = msg_send![networks, allObjects];
            let count: usize = msg_send![candidates, count];
            let mut rows = Vec::new();
            for index in 0..count.min(256) {
                let network: *mut AnyObject = msg_send![candidates, objectAtIndex: index];
                let name: *mut AnyObject = msg_send![network, ssid];
                if name.is_null() {
                    continue;
                }
                let utf8: *const std::ffi::c_char = msg_send![name, UTF8String];
                if utf8.is_null() {
                    continue;
                }
                let Ok(ssid) = std::ffi::CStr::from_ptr(utf8).to_str() else {
                    continue;
                };
                if ssid.is_empty() || ssid.len() > 32 {
                    continue;
                }
                // kCWSecurityNone = 0. Do not infer security from a saved profile.
                let open: Bool = msg_send![network, supportsSecurity: 0isize];
                rows.push(crate::WifiNetwork {
                    ssid: ssid.into(),
                    signal: None,
                    secured: !open.as_bool(),
                    saved: false,
                    current: false,
                });
            }
            if refresh && count > 0 && rows.is_empty() {
                return Err("macOS is hiding network names. Check Location access for AMS Access, then rescan.".into());
            }
            Ok(rows)
        })
    }));
    result.unwrap_or_else(|_| {
        Err("macOS could not read Wi-Fi networks. Check Wi-Fi access and retry.".into())
    })
}

unsafe fn ns_string(text: &str) -> Retained<AnyObject> {
    let allocated: *mut AnyObject = msg_send![class!(NSString), alloc];
    let value: *mut AnyObject = msg_send![allocated, initWithBytes: text.as_ptr().cast::<std::ffi::c_void>(),
        length: text.len(), encoding: 4usize];
    Retained::from_raw(value).expect("valid UTF-8 NSString")
}

pub(super) fn connect(interface: &str, ssid: &str, password: &str) -> Result<(), String> {
    if ssid.is_empty() || ssid.len() > 32 {
        return Err("Wi-Fi names must contain 1–32 bytes.".into());
    }
    let _operation = RADIO_OPERATION
        .try_lock()
        .map_err(|_| "Wi-Fi is busy. Wait for the current scan, then retry.".to_string())?;
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
    fn invalid_ssids_are_rejected_before_native_calls() {
        for ssid in ["", &"x".repeat(33), &"é".repeat(17)] {
            assert!(connect("en0", ssid, "secret").is_err());
        }
    }
}
