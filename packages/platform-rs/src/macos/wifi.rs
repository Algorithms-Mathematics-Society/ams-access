//! Passwords stay in process memory, never in subprocess arguments.
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};

#[link(name = "CoreWLAN", kind = "framework")]
extern "C" {}

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
    fn invalid_ssids_are_rejected_before_native_calls() {
        for ssid in ["", &"x".repeat(33), &"é".repeat(17)] {
            assert!(connect("en0", ssid, "secret").is_err());
        }
    }
}
