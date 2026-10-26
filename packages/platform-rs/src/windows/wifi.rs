//! One-off WLAN joins. A temporary profile stays in memory; only a verified
//! join saves an app-named profile, leaving user-created profiles untouched.
use std::ffi::c_void;
use std::time::{Duration, Instant};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::NetworkManagement::WiFi::*;

static JOIN: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct Client(HANDLE);
impl Drop for Client {
    fn drop(&mut self) {
        unsafe {
            WlanCloseHandle(self.0, None);
        }
    }
}
struct Memory(*mut c_void);
impl Drop for Memory {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                WlanFreeMemory(self.0);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Security {
    Open,
    Wpa2,
    Wpa3,
}

fn security(auth: DOT11_AUTH_ALGORITHM, cipher: DOT11_CIPHER_ALGORITHM) -> Option<Security> {
    match (auth, cipher) {
        (DOT11_AUTH_ALGO_80211_OPEN, DOT11_CIPHER_ALGO_NONE) => Some(Security::Open),
        (DOT11_AUTH_ALGO_RSNA_PSK, DOT11_CIPHER_ALGO_CCMP) => Some(Security::Wpa2),
        (DOT11_AUTH_ALGO_WPA3_SAE, DOT11_CIPHER_ALGO_CCMP) => Some(Security::Wpa3),
        _ => None,
    }
}

fn valid_credentials(ssid: &str, password: &str, kind: Security) -> Result<(), String> {
    if ssid.is_empty() || ssid.len() > 32 || ssid.chars().any(char::is_control) {
        return Err("Choose a Wi-Fi network with a valid name (1–32 bytes).".into());
    }
    match kind {
        Security::Open if password.is_empty() => Ok(()),
        Security::Open => Err("This open Wi-Fi network does not use a password.".into()),
        Security::Wpa2 | Security::Wpa3
            if (8..=63).contains(&password.len())
                && password.is_ascii()
                && !password.chars().any(char::is_control) =>
        {
            Ok(())
        }
        Security::Wpa2
            if password.len() == 64 && password.bytes().all(|b| b.is_ascii_hexdigit()) =>
        {
            Ok(())
        }
        _ => {
            Err("Use an 8–63 character Wi-Fi password (or a 64-digit hexadecimal WPA2 key).".into())
        }
    }
}

fn ssid_hex(ssid: &str) -> String {
    ssid.bytes().map(|b| format!("{b:02X}")).collect()
}

fn profile_xml(name: &str, ssid: &str, password: &str, kind: Security) -> String {
    let hex = ssid_hex(ssid);
    let key = password
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    let (auth, encryption) = match kind {
        Security::Open => ("open", "none"),
        Security::Wpa2 => ("WPA2PSK", "AES"),
        Security::Wpa3 => ("WPA3SAE", "AES"),
    };
    let shared = if kind == Security::Open {
        String::new()
    } else {
        let key_type = if kind == Security::Wpa2 && password.len() == 64 {
            "networkKey"
        } else {
            "passPhrase"
        };
        format!("<sharedKey><keyType>{key_type}</keyType><protected>false</protected><keyMaterial>{key}</keyMaterial></sharedKey>")
    };
    format!(
        r#"<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>{name}</name><SSIDConfig><SSID><hex>{hex}</hex></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>{auth}</authentication><encryption>{encryption}</encryption><useOneX>false</useOneX></authEncryption>{shared}</security></MSM></WLANProfile>"#
    )
}

fn ssid_matches(native: &DOT11_SSID, wanted: &[u8]) -> bool {
    native.uSSIDLength as usize == wanted.len() && native.ucSSID[..wanted.len()] == *wanted
}

fn confirmed(attrs: &WLAN_CONNECTION_ATTRIBUTES, ssid: &[u8], name: &str, kind: Security) -> bool {
    let profile = String::from_utf16_lossy(&attrs.strProfileName);
    attrs.isState == wlan_interface_state_connected
        && attrs.wlanConnectionMode == wlan_connection_mode_temporary_profile
        && profile.trim_end_matches('\0') == name
        && ssid_matches(&attrs.wlanAssociationAttributes.dot11Ssid, ssid)
        && security(
            attrs.wlanSecurityAttributes.dot11AuthAlgorithm,
            attrs.wlanSecurityAttributes.dot11CipherAlgorithm,
        ) == Some(kind)
}

fn wait_for_connection(
    mut query: impl FnMut() -> bool,
    mut pause: impl FnMut() -> bool,
) -> Result<(), String> {
    for attempt in 0..15 {
        if query() {
            return Ok(());
        }
        if attempt == 14 || !pause() {
            break;
        }
    }
    Err("Could not confirm connection to the selected Wi-Fi network. Check the password and signal, then retry.".into())
}

fn finish_join(
    query: impl FnMut() -> bool,
    pause: impl FnMut() -> bool,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    wait_for_connection(query, pause)?;
    save()
}

fn check(code: u32, action: &str) -> Result<(), String> {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("Windows Wi-Fi {action} failed (code {code})."))
    }
}

pub(super) fn connect(ssid: &str, password: &str) -> Result<(), String> {
    let _join = JOIN
        .try_lock()
        .map_err(|_| "A Wi-Fi connection is already in progress. Try again shortly.".to_string())?;
    if ssid.is_empty() || ssid.len() > 32 || ssid.chars().any(char::is_control) {
        return Err("Choose a Wi-Fi network with a valid name (1–32 bytes).".into());
    }
    let mut version = 0;
    let mut handle = HANDLE::default();
    check(
        unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) },
        "initialization",
    )?;
    let client = Client(handle);
    let mut interfaces = std::ptr::null_mut();
    check(
        unsafe { WlanEnumInterfaces(client.0, None, &mut interfaces) },
        "interface listing",
    )?;
    let _interfaces = Memory(interfaces.cast());
    if interfaces.is_null() {
        return Err("No Wi-Fi adapter is available.".into());
    }
    let count = unsafe { (*interfaces).dwNumberOfItems as usize }.min(256);
    let entries =
        unsafe { std::slice::from_raw_parts((*interfaces).InterfaceInfo.as_ptr(), count) };
    let mut selected = None;
    let mut found = false;
    for interface in entries {
        let mut networks = std::ptr::null_mut();
        if unsafe {
            WlanGetAvailableNetworkList(client.0, &interface.InterfaceGuid, 0, None, &mut networks)
        } != 0
        {
            continue;
        }
        let _networks = Memory(networks.cast());
        if networks.is_null() {
            continue;
        }
        let count = unsafe { (*networks).dwNumberOfItems as usize }.min(4096);
        let rows = unsafe { std::slice::from_raw_parts((*networks).Network.as_ptr(), count) };
        for row in rows {
            if !ssid_matches(&row.dot11Ssid, ssid.as_bytes()) {
                continue;
            }
            found = true;
            if !row.bNetworkConnectable.as_bool() {
                continue;
            }
            if let Some(kind) = security(
                row.dot11DefaultAuthAlgorithm,
                row.dot11DefaultCipherAlgorithm,
            ) {
                if !(kind == Security::Wpa3 && password.len() == 64)
                    && selected
                        .as_ref()
                        .is_none_or(|(_, previous)| kind > *previous)
                {
                    selected = Some((interface.InterfaceGuid, kind));
                }
            }
        }
    }
    let (interface, kind): (GUID, Security) = selected.ok_or_else(|| if found {
        "This Wi-Fi network uses security that this picker cannot join. Use Windows Wi-Fi settings before entering the contest.".to_string()
    } else {
        "The selected Wi-Fi network is no longer available. Rescan and try again.".to_string()
    })?;
    valid_credentials(ssid, password, kind)?;
    let name = format!(
        "ams-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let xml: Vec<u16> = profile_xml(&name, ssid, password, kind)
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut native_ssid = DOT11_SSID {
        uSSIDLength: ssid.len() as u32,
        ..Default::default()
    };
    native_ssid.ucSSID[..ssid.len()].copy_from_slice(ssid.as_bytes());
    let params = WLAN_CONNECTION_PARAMETERS {
        wlanConnectionMode: wlan_connection_mode_temporary_profile,
        strProfile: PCWSTR(xml.as_ptr()),
        pDot11Ssid: &mut native_ssid,
        pDesiredBssidList: std::ptr::null_mut(),
        dot11BssType: dot11_BSS_type_infrastructure,
        dwFlags: 0,
    };
    check(
        unsafe { WlanConnect(client.0, &interface, &params, None) },
        "connection request",
    )?;
    let deadline = Instant::now() + Duration::from_secs(20);
    finish_join(
        || {
            let mut size = 0;
            let mut data = std::ptr::null_mut();
            let code = unsafe {
                WlanQueryInterface(
                    client.0,
                    &interface,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut size,
                    &mut data,
                    None,
                )
            };
            let _data = Memory(data);
            code == 0
                && !data.is_null()
                && size as usize >= std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>()
                && confirmed(
                    unsafe { &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>() },
                    ssid.as_bytes(),
                    &name,
                    kind,
                )
        },
        || {
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_secs(1));
            Instant::now() < deadline
        },
        || {
            // Only a verified join becomes an auto-reconnect profile.
            let saved_name: Vec<u16> = format!("AMS Access Wi-Fi {}", ssid_hex(ssid))
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let code = unsafe {
                WlanSaveTemporaryProfile(
                    client.0,
                    &interface,
                    PCWSTR(saved_name.as_ptr()),
                    PCWSTR::null(),
                    WLAN_PROFILE_USER | WLAN_PROFILE_CONNECTION_MODE_AUTO,
                    true,
                    None,
                )
            };
            if code != 0 {
                return Err(format!(
                    "Connected to {ssid}, but Windows could not save it for reconnection (code {code})."
                ));
            }
            Ok(())
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_is_selected_from_adapter_not_password() {
        assert_eq!(
            security(DOT11_AUTH_ALGO_WPA3_SAE, DOT11_CIPHER_ALGO_CCMP),
            Some(Security::Wpa3)
        );
        assert_eq!(
            security(DOT11_AUTH_ALGO_RSNA_PSK, DOT11_CIPHER_ALGO_CCMP),
            Some(Security::Wpa2)
        );
        assert_eq!(security(DOT11_AUTH_ALGO_RSNA, DOT11_CIPHER_ALGO_CCMP), None);
        assert_eq!(
            security(DOT11_AUTH_ALGO_80211_OPEN, DOT11_CIPHER_ALGO_NONE),
            Some(Security::Open)
        );
        assert!(Security::Wpa3 > Security::Wpa2 && Security::Wpa2 > Security::Open);
        assert!(valid_credentials("Guest", "", Security::Open).is_ok());
        assert!(valid_credentials("Corp", "password", Security::Wpa3).is_ok());
        assert!(valid_credentials("Corp", "", Security::Wpa3).is_err());
    }

    #[test]
    fn temporary_profile_uses_correct_security_without_saved_profile_write() {
        let xml = profile_xml("unique", "Guest&Co", "", Security::Open);
        assert!(xml.contains("<authentication>open</authentication>"));
        assert!(!xml.contains("sharedKey"));
        let xml = profile_xml("unique", "Guest&Co", "pass&word", Security::Wpa3);
        assert!(xml.contains("<authentication>WPA3SAE</authentication>"));
        assert!(xml.contains("pass&amp;word"));
        assert!(xml.contains("<hex>477565737426436F</hex>"));
    }

    #[test]
    fn join_confirmation_requires_this_profile_not_just_matching_ssid() {
        let mut attrs = WLAN_CONNECTION_ATTRIBUTES {
            isState: wlan_interface_state_connected,
            wlanConnectionMode: wlan_connection_mode_temporary_profile,
            ..Default::default()
        };
        attrs.strProfileName[..6].copy_from_slice(&"unique".encode_utf16().collect::<Vec<_>>());
        attrs.wlanAssociationAttributes.dot11Ssid.uSSIDLength = 5;
        attrs.wlanAssociationAttributes.dot11Ssid.ucSSID[..5].copy_from_slice(b"Guest");
        attrs.wlanSecurityAttributes.dot11AuthAlgorithm = DOT11_AUTH_ALGO_RSNA_PSK;
        attrs.wlanSecurityAttributes.dot11CipherAlgorithm = DOT11_CIPHER_ALGO_CCMP;
        assert!(confirmed(&attrs, b"Guest", "unique", Security::Wpa2));
        assert!(!confirmed(&attrs, b"Guest", "other", Security::Wpa2));
        assert!(!confirmed(&attrs, b"Guest", "unique", Security::Wpa3));
        attrs.wlanConnectionMode = wlan_connection_mode_profile;
        assert!(!confirmed(&attrs, b"Guest", "unique", Security::Wpa2));
    }

    #[test]
    fn rejected_join_has_bounded_queries() {
        let mut reads = 0;
        let mut saves = 0;
        let result = finish_join(
            || {
                reads += 1;
                false
            },
            || true,
            || {
                saves += 1;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(reads, 15);
        assert_eq!(saves, 0);
    }

    #[test]
    fn save_failure_is_reported_after_verified_join() {
        let mut saves = 0;
        let result = finish_join(
            || true,
            || panic!("no wait needed"),
            || {
                saves += 1;
                Err("save failed".into())
            },
        );
        assert_eq!(saves, 1);
        assert_eq!(result, Err("save failed".into()));
    }
}
