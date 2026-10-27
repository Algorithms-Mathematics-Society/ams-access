//! One-off WLAN joins. A temporary profile stays in memory; only a verified
//! join saves an app-named profile, leaving user-created profiles untouched.
use std::ffi::c_void;
use std::time::{Duration, Instant};
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_INVALID_DATA, ERROR_INVALID_STATE, HANDLE,
};
use windows::Win32::NetworkManagement::WiFi::*;

#[path = "wifi_profiles.rs"]
mod profiles;

static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

static JOIN: std::sync::Mutex<()> = std::sync::Mutex::new(());
// Windows rejects AUTO unless the client explicitly sets the connection mode.
const SAVE_PROFILE_FLAGS: u32 = WLAN_PROFILE_USER
    | WLAN_PROFILE_CONNECTION_MODE_SET_BY_CLIENT
    | WLAN_PROFILE_CONNECTION_MODE_AUTO;

struct Client<T = Completion>(HANDLE, Option<Box<T>>);

impl<T> Client<T> {
    fn open() -> Result<Self, String> {
        let mut version = 0;
        let mut handle = HANDLE::default();
        check(
            unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) },
            "initialization",
        )?;
        Ok(Self(handle, None))
    }

    fn interfaces(&self) -> Result<Vec<WLAN_INTERFACE_INFO>, String> {
        let mut interfaces = std::ptr::null_mut();
        let code = unsafe { WlanEnumInterfaces(self.0, None, &mut interfaces) };
        let _interfaces = Memory(interfaces.cast());
        check(code, "interface listing")?;
        if interfaces.is_null() {
            return Err("No Wi-Fi adapter is available.".into());
        }
        let count = unsafe { (*interfaces).dwNumberOfItems as usize }.min(256);
        Ok(
            unsafe { std::slice::from_raw_parts((*interfaces).InterfaceInfo.as_ptr(), count) }
                .to_vec(),
        )
    }
}

struct Completion {
    interface: GUID,
    ssid: Vec<u8>,
    name: String,
    result: std::sync::mpsc::SyncSender<u32>,
    last_failure: std::sync::atomic::AtomicU32,
}

unsafe extern "system" fn connection_notification(
    notification: *mut L2_NOTIFICATION_DATA,
    context: *mut c_void,
) {
    if notification.is_null() || context.is_null() {
        return;
    }
    let notification = unsafe { &*notification };
    let context = unsafe { &*context.cast::<Completion>() };
    if notification.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM
        || notification.InterfaceGuid != context.interface
        || ![
            wlan_notification_acm_connection_complete.0 as u32,
            wlan_notification_acm_connection_attempt_fail.0 as u32,
        ]
        .contains(&notification.NotificationCode)
        || notification.pData.is_null()
        || (notification.dwDataSize as usize)
            < std::mem::size_of::<WLAN_CONNECTION_NOTIFICATION_DATA>()
    {
        return;
    }
    let data = unsafe {
        &*notification
            .pData
            .cast::<WLAN_CONNECTION_NOTIFICATION_DATA>()
    };
    if data.wlanConnectionMode != wlan_connection_mode_temporary_profile
        || !profile_matches(&data.strProfileName, &context.name)
        || !ssid_matches(&data.dot11Ssid, &context.ssid)
    {
        return;
    }
    if notification.NotificationCode == wlan_notification_acm_connection_complete.0 as u32 {
        let _ = context.result.try_send(data.wlanReasonCode);
    } else {
        // An attempt can fail before Windows retries another access point.
        context
            .last_failure
            .store(data.wlanReasonCode, std::sync::atomic::Ordering::Relaxed);
    }
}

fn connection_failure(reason: u32) -> String {
    let detail = match reason {
        WLAN_REASON_CODE_KEY_MISMATCH | WLAN_REASON_CODE_MSMSEC_PSK_MISMATCH_SUSPECTED => {
            "The Wi-Fi password was rejected. Re-enter the password and retry."
        }
        WLAN_REASON_CODE_ASSOCIATION_FAILURE => {
            "The Wi-Fi adapter disconnected while joining. Check the signal and retry."
        }
        _ => "Windows could not connect. Check the password and signal, then retry.",
    };
    format!("{detail} (Windows reason {reason}.)")
}
impl<T> Drop for Client<T> {
    fn drop(&mut self) {
        unsafe {
            if self.1.is_some() {
                // Unregister waits for callbacks before their context is released.
                WlanRegisterNotification(
                    self.0,
                    WLAN_NOTIFICATION_SOURCE_NONE,
                    false,
                    None,
                    None,
                    None,
                    None,
                );
            }
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

fn profile_matches(native: &[u16], wanted: &str) -> bool {
    native
        .iter()
        .copied()
        .take_while(|&unit| unit != 0)
        .eq(wanted.encode_utf16())
}

fn association_state(interfaces: &[WLAN_INTERFACE_INFO]) -> Option<bool> {
    if interfaces.is_empty() {
        None
    } else {
        Some(
            interfaces
                .iter()
                .any(|interface| interface.isState == wlan_interface_state_connected),
        )
    }
}

fn visible_network(row: &WLAN_AVAILABLE_NETWORK) -> Option<crate::WifiNetwork> {
    if row.uNumberOfBssids == 0 {
        return None;
    }
    let bytes = row
        .dot11Ssid
        .ucSSID
        .get(..row.dot11Ssid.uSSIDLength as usize)?;
    // A lossy replacement or whitespace trim would join a different SSID.
    let ssid = std::str::from_utf8(bytes).ok()?.to_owned();
    if ssid.is_empty() {
        return None;
    }
    Some(crate::WifiNetwork {
        ssid,
        signal: Some(row.wlanSignalQuality.min(100) as u8),
        secured: row.bSecurityEnabled.as_bool(),
        current: false,
    })
}

fn scan_result(
    rows: Vec<crate::WifiNetwork>,
    interfaces: &[WLAN_INTERFACE_INFO],
    current: Option<String>,
) -> crate::WifiScan {
    let Some(connected) = association_state(interfaces) else {
        return crate::WifiScan::default();
    };
    let current = current.filter(|_| connected);
    crate::WifiScan {
        networks: crate::wifi_parse::tidy(rows, current.as_deref()),
        current,
        connected,
        supported: true,
    }
}

fn current_connection(client: HANDLE, interface: &GUID) -> Result<WLAN_CONNECTION_ATTRIBUTES, u32> {
    let mut size = 0;
    let mut data = std::ptr::null_mut();
    let code = unsafe {
        WlanQueryInterface(
            client,
            interface,
            wlan_intf_opcode_current_connection,
            None,
            &mut size,
            &mut data,
            None,
        )
    };
    let _data = Memory(data);
    if code != 0 {
        return Err(code);
    }
    if data.is_null() || (size as usize) < std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>() {
        return Err(ERROR_INVALID_DATA.0);
    }
    Ok(unsafe { *data.cast::<WLAN_CONNECTION_ATTRIBUTES>() })
}

fn connection_name(attrs: &WLAN_CONNECTION_ATTRIBUTES) -> Option<String> {
    if attrs.isState != wlan_interface_state_connected {
        return None;
    }
    let ssid = &attrs.wlanAssociationAttributes.dot11Ssid;
    let bytes = ssid.ucSSID.get(..ssid.uSSIDLength as usize)?;
    let name = std::str::from_utf8(bytes).ok()?;
    (!name.is_empty()).then(|| name.to_owned())
}

fn refresh_connection(
    interface: &mut WLAN_INTERFACE_INFO,
    result: Result<WLAN_CONNECTION_ATTRIBUTES, u32>,
) -> Option<String> {
    match result {
        Ok(attrs) => {
            interface.isState = attrs.isState;
            connection_name(&attrs)
        }
        Err(code) => {
            if code == ERROR_INVALID_STATE.0 {
                interface.isState = wlan_interface_state_disconnected;
            }
            None
        }
    }
}

fn read_scan() -> Result<crate::WifiScan, String> {
    let client: Client = Client::open()?;
    let mut interfaces = client.interfaces()?;
    let mut current = None;
    let mut rows = Vec::new();
    let mut listed = false;
    let mut list_error = None;
    for interface in &mut interfaces {
        if interface.isState == wlan_interface_state_connected {
            let result = current_connection(client.0, &interface.InterfaceGuid);
            let name = refresh_connection(interface, result);
            if current.is_none() {
                current = name;
            }
        }
        let mut networks = std::ptr::null_mut();
        let code = unsafe {
            WlanGetAvailableNetworkList(client.0, &interface.InterfaceGuid, 0, None, &mut networks)
        };
        let _networks = Memory(networks.cast());
        if code != 0 {
            list_error.get_or_insert(code);
            continue;
        }
        if networks.is_null() {
            continue;
        }
        listed = true;
        let count = unsafe { (*networks).dwNumberOfItems as usize }.min(4096);
        let native = unsafe { std::slice::from_raw_parts((*networks).Network.as_ptr(), count) };
        rows.extend(native.iter().filter_map(visible_network));
    }
    if !listed {
        return Err(list_error
            .map(network_list_error)
            .unwrap_or_else(|| "No Wi-Fi adapter is available.".into()));
    }
    Ok(scan_result(rows, &interfaces, current))
}

pub(super) fn scan() -> crate::WifiScan {
    read_scan().unwrap_or_default()
}

struct ScanCompletion {
    interfaces: Vec<GUID>,
    result: std::sync::mpsc::SyncSender<(GUID, bool)>,
}

unsafe extern "system" fn scan_notification(
    notification: *mut L2_NOTIFICATION_DATA,
    context: *mut c_void,
) {
    if notification.is_null() || context.is_null() {
        return;
    }
    let notification = unsafe { &*notification };
    let context = unsafe { &*context.cast::<ScanCompletion>() };
    if notification.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM
        || !context.interfaces.contains(&notification.InterfaceGuid)
    {
        return;
    }
    let complete = notification.NotificationCode == wlan_notification_acm_scan_complete.0 as u32;
    if complete || notification.NotificationCode == wlan_notification_acm_scan_fail.0 as u32 {
        let _ = context
            .result
            .try_send((notification.InterfaceGuid, complete));
    }
}

fn await_scan(
    mut pending: Vec<GUID>,
    mut receive: impl FnMut() -> Option<(GUID, bool)>,
) -> Result<(), String> {
    while !pending.is_empty() {
        let Some((interface, success)) = receive() else {
            return Err("Wi-Fi rescan did not finish. Wait a moment and rescan again.".into());
        };
        if let Some(index) = pending.iter().position(|guid| *guid == interface) {
            if !success {
                return Err("Windows could not refresh Wi-Fi networks. Rescan and retry.".into());
            }
            pending.swap_remove(index);
        }
    }
    Ok(())
}

fn scan_targets(interfaces: &[WLAN_INTERFACE_INFO]) -> Vec<GUID> {
    interfaces
        .iter()
        .filter(|interface| interface.isState != wlan_interface_state_not_ready)
        .map(|interface| interface.InterfaceGuid)
        .collect()
}

pub(super) fn rescan() -> Result<crate::WifiScan, String> {
    let _operation = JOIN
        .try_lock()
        .map_err(|_| "A Wi-Fi operation is already in progress. Try again shortly.".to_string())?;
    admit_operation(&SHUTTING_DOWN)?;
    let mut client: Client<ScanCompletion> = Client::open()?;
    let interfaces = client.interfaces()?;
    let pending = scan_targets(&interfaces);
    if pending.is_empty() {
        return Err("No Wi-Fi adapter is available.".into());
    }
    let (send, receive) = std::sync::mpsc::sync_channel(pending.len());
    client.1 = Some(Box::new(ScanCompletion {
        interfaces: pending.clone(),
        result: send,
    }));
    let context = client.1.as_deref().unwrap();
    check(
        unsafe {
            WlanRegisterNotification(
                client.0,
                WLAN_NOTIFICATION_SOURCE_ACM,
                true,
                Some(scan_notification),
                Some((context as *const ScanCompletion).cast()),
                None,
                None,
            )
        },
        "rescan notifications",
    )?;
    // One four-second deadline across all adapters; background reads never trigger a scan.
    let deadline = Instant::now() + Duration::from_secs(4);
    for interface in &pending {
        check(
            unsafe { WlanScan(client.0, interface, None, None, None) },
            "rescan request",
        )?;
    }
    await_scan(pending, || {
        let remaining = deadline.checked_duration_since(Instant::now())?;
        receive.recv_timeout(remaining).ok()
    })?;
    read_scan()
}

fn ssid_matches(native: &DOT11_SSID, wanted: &[u8]) -> bool {
    native.uSSIDLength as usize == wanted.len() && native.ucSSID[..wanted.len()] == *wanted
}

fn confirmed(attrs: &WLAN_CONNECTION_ATTRIBUTES, ssid: &[u8], name: &str, kind: Security) -> bool {
    attrs.isState == wlan_interface_state_connected
        && attrs.wlanConnectionMode == wlan_connection_mode_temporary_profile
        && profile_matches(&attrs.strProfileName, name)
        && ssid_matches(&attrs.wlanAssociationAttributes.dot11Ssid, ssid)
        && security(
            attrs.wlanSecurityAttributes.dot11AuthAlgorithm,
            attrs.wlanSecurityAttributes.dot11CipherAlgorithm,
        ) == Some(kind)
}

fn wait_for_connection(
    receive: impl FnOnce() -> Option<u32>,
    query: impl FnOnce() -> bool,
    last_failure: impl FnOnce() -> u32,
) -> Result<(), String> {
    match receive() {
        Some(0) => Ok(()),
        Some(reason) => Err(connection_failure(reason)),
        None if query() => Ok(()),
        None => {
            let reason = last_failure();
            if reason != 0 {
                Err(connection_failure(reason))
            } else {
                Err("Could not confirm connection to the selected Wi-Fi network. Check the password and signal, then retry.".into())
            }
        }
    }
}

fn finish_join(
    wait: impl FnOnce() -> Result<(), String>,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    wait()?;
    save()
}

fn network_list_error(code: u32) -> String {
    if code == ERROR_ACCESS_DENIED.0 {
        "Windows denied access to Wi-Fi network details (code 5). Check Location permissions in Windows Settings > Privacy & security, allow access for this app, then retry.".into()
    } else {
        format!("Windows could not list Wi-Fi networks (code {code}). Rescan and retry.")
    }
}

fn check(code: u32, action: &str) -> Result<(), String> {
    if code == 0 {
        Ok(())
    } else {
        Err(format!("Windows Wi-Fi {action} failed (code {code})."))
    }
}

fn admit_operation(closing: &std::sync::atomic::AtomicBool) -> Result<(), String> {
    if closing.load(std::sync::atomic::Ordering::Acquire) {
        Err("Wi-Fi operations are unavailable while the application exits.".into())
    } else {
        Ok(())
    }
}

pub(super) fn cleanup(shutdown: bool) -> Result<(), String> {
    if shutdown {
        SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::Release);
    }
    let _operation = JOIN
        .lock()
        .map_err(|_| "The Wi-Fi operation lock could not be acquired.".to_string())?;
    let client: Client = Client::open()?;
    let mut first_error = None;
    for interface in client.interfaces()? {
        if let Err(error) = profiles::cleanup(client.0, &interface.InterfaceGuid) {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

pub(super) fn connect(ssid: &str, password: &str) -> Result<(), String> {
    let _join = JOIN
        .try_lock()
        .map_err(|_| "A Wi-Fi connection is already in progress. Try again shortly.".to_string())?;
    admit_operation(&SHUTTING_DOWN)?;
    if ssid.is_empty() || ssid.len() > 32 || ssid.chars().any(char::is_control) {
        return Err("Choose a Wi-Fi network with a valid name (1–32 bytes).".into());
    }
    let mut client: Client = Client::open()?;
    let entries = client.interfaces()?;
    let mut selected = None;
    let mut found = false;
    let mut list_error = None;
    for interface in &entries {
        let mut networks = std::ptr::null_mut();
        let code = unsafe {
            WlanGetAvailableNetworkList(client.0, &interface.InterfaceGuid, 0, None, &mut networks)
        };
        let _networks = Memory(networks.cast());
        if code != 0 {
            list_error.get_or_insert(code);
            continue;
        }
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
    } else if let Some(code) = list_error {
        network_list_error(code)
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
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    client.1 = Some(Box::new(Completion {
        interface,
        ssid: ssid.as_bytes().to_vec(),
        name: name.clone(),
        result: send,
        last_failure: std::sync::atomic::AtomicU32::new(0),
    }));
    let completion = client.1.as_deref().unwrap();
    check(
        unsafe {
            WlanRegisterNotification(
                client.0,
                WLAN_NOTIFICATION_SOURCE_ACM,
                false,
                Some(connection_notification),
                Some((completion as *const Completion).cast()),
                None,
                None,
            )
        },
        "connection notifications",
    )?;
    check(
        unsafe { WlanConnect(client.0, &interface, &params, None) },
        "connection request",
    )?;
    finish_join(
        || {
            wait_for_connection(
                || receive.recv_timeout(Duration::from_secs(30)).ok(),
                || {
                    current_connection(client.0, &interface)
                        .is_ok_and(|attrs| confirmed(&attrs, ssid.as_bytes(), &name, kind))
                },
                || {
                    completion
                        .last_failure
                        .load(std::sync::atomic::Ordering::Relaxed)
                },
            )
        },
        || {
            profiles::save(client.0, &interface, ssid).map_err(|error| {
                format!("Joined {ssid}, but Windows could not save it for reconnection. {error}")
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_closes_admission_before_waiting_for_active_join() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        };
        let gate = Arc::new(Mutex::new(()));
        let closing = Arc::new(AtomicBool::new(false));
        let active_join = gate.lock().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let worker_gate = gate.clone();
        let worker_closing = closing.clone();
        let worker = std::thread::spawn(move || {
            worker_closing.store(true, Ordering::Release);
            send.send(()).unwrap();
            let _cleanup = worker_gate.lock().unwrap();
            assert!(admit_operation(&worker_closing).is_err());
        });
        receive.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(admit_operation(&closing).is_err());
        drop(active_join);
        worker.join().unwrap();
        assert!(admit_operation(&AtomicBool::new(false)).is_ok());
    }

    #[test]
    fn save_flags_pass_windows_auto_mode_validation() {
        // Installed wlanapi.dll rejects mode bits 0x20000 (AUTO without SET_BY_CLIENT).
        let rejected = |flags: u32| flags & !0x30002 != 0 || flags & 0x30000 == 0x20000;
        assert!(rejected(
            WLAN_PROFILE_USER | WLAN_PROFILE_CONNECTION_MODE_AUTO
        ));
        assert!(!rejected(SAVE_PROFILE_FLAGS));
        assert_ne!(SAVE_PROFILE_FLAGS & WLAN_PROFILE_USER, 0);
    }

    #[test]
    fn current_connection_replaces_cached_hotspot_and_clears_on_disconnect() {
        let mut hotspot = WLAN_AVAILABLE_NETWORK {
            uNumberOfBssids: 1,
            dwFlags: WLAN_AVAILABLE_NETWORK_CONNECTED,
            ..Default::default()
        };
        hotspot.dot11Ssid.uSSIDLength = 7;
        hotspot.dot11Ssid.ucSSID[..7].copy_from_slice(b"Hotspot");
        let row = visible_network(&hotspot).unwrap();
        assert!(
            !row.current,
            "cached connection flags are not association evidence"
        );
        let mut interface = WLAN_INTERFACE_INFO {
            isState: wlan_interface_state_connected,
            ..Default::default()
        };
        let mut attrs = WLAN_CONNECTION_ATTRIBUTES {
            isState: wlan_interface_state_connected,
            ..Default::default()
        };
        attrs.wlanAssociationAttributes.dot11Ssid.uSSIDLength = 7;
        attrs.wlanAssociationAttributes.dot11Ssid.ucSSID[..7].copy_from_slice(b"Router ");
        let current = refresh_connection(&mut interface, Ok(attrs));
        let scan = scan_result(vec![row.clone()], &[interface], current);
        assert_eq!(scan.current.as_deref(), Some("Router "));
        assert!(!scan.networks[0].current);
        attrs.isState = wlan_interface_state_disconnected;
        let current = refresh_connection(&mut interface, Ok(attrs));
        let scan = scan_result(vec![row.clone()], &[interface], current);
        assert!(!scan.connected && scan.current.is_none() && !scan.networks[0].current);
        interface.isState = wlan_interface_state_connected;
        let current = refresh_connection(&mut interface, Err(ERROR_INVALID_STATE.0));
        let scan = scan_result(vec![row.clone()], &[interface], current);
        assert!(!scan.connected && scan.current.is_none());
        interface.isState = wlan_interface_state_connected;
        let current = refresh_connection(&mut interface, Err(ERROR_ACCESS_DENIED.0));
        let scan = scan_result(vec![row], &[interface], current);
        assert!(scan.connected && scan.current.is_none() && !scan.networks[0].current);
    }

    #[test]
    fn hidden_ssid_uses_interface_association_and_unknown_is_not_disconnected() {
        let mut interface = WLAN_INTERFACE_INFO {
            isState: wlan_interface_state_connected,
            ..Default::default()
        };
        let scan = scan_result(vec![], &[interface], None);
        assert!(scan.supported && scan.connected && scan.current.is_none());
        interface.isState = wlan_interface_state_disconnected;
        let scan = scan_result(vec![], &[interface], None);
        assert!(scan.supported && !scan.connected);
        assert!(!scan_result(vec![], &[], None).supported);
    }

    #[test]
    fn native_scan_preserves_exact_ssid_bytes_through_join_selection() {
        let mut rows = Vec::new();
        for name in ["Router", "Router ", " Router", "  "] {
            let mut native = WLAN_AVAILABLE_NETWORK {
                uNumberOfBssids: 1,
                wlanSignalQuality: 70,
                bSecurityEnabled: true.into(),
                dwFlags: WLAN_AVAILABLE_NETWORK_CONNECTED,
                ..Default::default()
            };
            native.dot11Ssid.uSSIDLength = name.len() as u32;
            native.dot11Ssid.ucSSID[..name.len()].copy_from_slice(name.as_bytes());
            let row = visible_network(&native).unwrap();
            assert_eq!(row.ssid, name);
            assert!(ssid_matches(&native.dot11Ssid, row.ssid.as_bytes()));
            if name != name.trim() {
                assert!(!ssid_matches(&native.dot11Ssid, name.trim().as_bytes()));
            }
            rows.push(row);
        }
        let scan = scan_result(
            rows,
            &[WLAN_INTERFACE_INFO {
                isState: wlan_interface_state_connected,
                ..Default::default()
            }],
            Some("Router".into()),
        );
        assert_eq!(
            scan.networks.len(),
            4,
            "distinct whitespace is identity, not padding"
        );
        assert_eq!(scan.current.as_deref(), Some("Router"));
    }

    #[test]
    fn native_scan_omits_unseen_profiles_and_unrepresentable_names() {
        let mut native = WLAN_AVAILABLE_NETWORK::default();
        native.dot11Ssid.uSSIDLength = 1;
        native.dot11Ssid.ucSSID[0] = b'X';
        assert!(visible_network(&native).is_none());
        native.uNumberOfBssids = 1;
        assert!(visible_network(&native).is_some());
        native.dot11Ssid.ucSSID[0] = 255;
        assert!(visible_network(&native).is_none());
        native.dot11Ssid.uSSIDLength = 33;
        assert!(visible_network(&native).is_none());
    }

    #[test]
    fn explicit_rescan_requires_all_adapters_and_reports_failure_or_timeout() {
        let first = GUID::from_u128(1);
        let second = GUID::from_u128(2);
        assert_eq!(
            scan_targets(&[
                WLAN_INTERFACE_INFO {
                    InterfaceGuid: first,
                    isState: wlan_interface_state_not_ready,
                    ..Default::default()
                },
                WLAN_INTERFACE_INFO {
                    InterfaceGuid: second,
                    isState: wlan_interface_state_disconnected,
                    ..Default::default()
                },
            ]),
            vec![second]
        );
        let mut events = [(first, true), (first, true), (second, true)].into_iter();
        assert!(await_scan(vec![first, second], || events.next()).is_ok());
        assert!(await_scan(vec![first], || Some((first, false))).is_err());
        assert!(await_scan(vec![first], || None).is_err());
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let mut context = ScanCompletion {
            interfaces: vec![first],
            result: send,
        };
        let mut notification = L2_NOTIFICATION_DATA {
            NotificationSource: WLAN_NOTIFICATION_SOURCE_ACM,
            NotificationCode: wlan_notification_acm_scan_complete.0 as u32,
            InterfaceGuid: second,
            ..Default::default()
        };
        let pointer = (&mut context as *mut ScanCompletion).cast();
        unsafe {
            scan_notification(&mut notification, pointer);
        }
        assert!(receive.try_recv().is_err());
        notification.InterfaceGuid = first;
        unsafe {
            scan_notification(&mut notification, pointer);
        }
        assert_eq!(receive.try_recv().unwrap(), (first, true));
        notification.NotificationCode = wlan_notification_acm_scan_fail.0 as u32;
        unsafe {
            scan_notification(&mut notification, pointer);
        }
        assert_eq!(receive.try_recv().unwrap(), (first, false));
    }

    #[test]
    fn network_enumeration_failure_exposes_permissions_and_native_code() {
        let denied = network_list_error(ERROR_ACCESS_DENIED.0);
        assert!(denied.contains("Location permissions") && denied.contains("code 5"));
        assert!(!denied.contains("password"));
        assert!(network_list_error(1062).contains("code 1062"));
    }

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
        attrs.strProfileName[7] = 123;
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
    fn completion_correlates_attempt_and_keeps_intermediate_failure_retryable() {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let mut context = Completion {
            interface: GUID::zeroed(),
            ssid: b"Guest".to_vec(),
            name: "unique".into(),
            result: send,
            last_failure: std::sync::atomic::AtomicU32::new(0),
        };
        let mut data = WLAN_CONNECTION_NOTIFICATION_DATA {
            wlanConnectionMode: wlan_connection_mode_temporary_profile,
            wlanReasonCode: 229378,
            ..Default::default()
        };
        data.strProfileName[..6].copy_from_slice(&"unique".encode_utf16().collect::<Vec<_>>());
        data.strProfileName[7] = 123;
        data.dot11Ssid.uSSIDLength = 5;
        data.dot11Ssid.ucSSID[..5].copy_from_slice(b"Guest");
        let mut notification = L2_NOTIFICATION_DATA {
            NotificationSource: WLAN_NOTIFICATION_SOURCE_ACM,
            NotificationCode: wlan_notification_acm_connection_attempt_fail.0 as u32,
            InterfaceGuid: context.interface,
            dwDataSize: std::mem::size_of_val(&data) as u32,
            pData: (&mut data as *mut WLAN_CONNECTION_NOTIFICATION_DATA).cast(),
        };
        let context_ptr = (&mut context as *mut Completion).cast();
        unsafe {
            connection_notification(&mut notification, context_ptr);
        }
        assert!(receive.try_recv().is_err());
        assert_eq!(
            context
                .last_failure
                .load(std::sync::atomic::Ordering::Relaxed),
            229378
        );
        notification.NotificationCode = wlan_notification_acm_connection_complete.0 as u32;
        context.name = "another-attempt".into();
        unsafe {
            connection_notification(&mut notification, context_ptr);
        }
        assert!(receive.try_recv().is_err());
        context.name = "unique".into();
        data.wlanReasonCode = 0;
        notification.pData = (&mut data as *mut WLAN_CONNECTION_NOTIFICATION_DATA).cast();
        unsafe {
            connection_notification(&mut notification, context_ptr);
        }
        assert_eq!(receive.try_recv().unwrap(), 0);
        data.wlanReasonCode = 229378;
        notification.pData = (&mut data as *mut WLAN_CONNECTION_NOTIFICATION_DATA).cast();
        unsafe {
            connection_notification(&mut notification, context_ptr);
        }
        assert_eq!(receive.try_recv().unwrap(), 229378);
        notification.dwDataSize = 1;
        unsafe {
            connection_notification(&mut notification, context_ptr);
        }
        assert!(receive.try_recv().is_err());
    }

    #[test]
    fn terminal_failure_is_reported_without_waiting_or_saving() {
        let result = finish_join(
            || {
                wait_for_connection(
                    || Some(229378),
                    || panic!("terminal failure must not query"),
                    || 0,
                )
            },
            || panic!("failed credentials must not be saved"),
        );
        assert!(result.unwrap_err().contains("229378"));
    }

    #[test]
    fn notification_timeout_queries_once_and_retains_last_failure() {
        assert!(wait_for_connection(|| None, || true, || 229378).is_ok());
        let error = wait_for_connection(|| None, || false, || 229378).unwrap_err();
        assert!(error.contains("adapter disconnected"));
        assert!(
            connection_failure(WLAN_REASON_CODE_MSMSEC_PSK_MISMATCH_SUSPECTED)
                .contains("password was rejected")
        );
    }

    #[test]
    fn rejected_join_has_bounded_queries() {
        let mut reads = 0;
        let mut saves = 0;
        let result = finish_join(
            || {
                wait_for_connection(
                    || None,
                    || {
                        reads += 1;
                        false
                    },
                    || 0,
                )
            },
            || {
                saves += 1;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert_eq!(reads, 1);
        assert_eq!(saves, 0);
    }

    #[test]
    fn save_failure_is_reported_after_verified_join() {
        let mut saves = 0;
        let result = finish_join(
            || wait_for_connection(|| Some(0), || panic!("no query needed"), || 0),
            || {
                saves += 1;
                Err("save failed".into())
            },
        );
        assert_eq!(saves, 1);
        assert_eq!(result, Err("save failed".into()));
    }
}
