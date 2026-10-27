//! Friendly session profiles; cleanup never deletes an unverified user profile.
use super::{check, ssid_hex, Memory, SAVE_PROFILE_FLAGS};
use windows::core::{GUID, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NOT_FOUND, HANDLE};
use windows::Win32::NetworkManagement::WiFi::*;

const LEGACY_PREFIX: &str = "AMS Access Wi-Fi ";
const OWNER: &[u8] = b"ams-access:wifi-profile:v1:";
const MAX_PROFILES: usize = 4096;
const MAX_XML_UNITS: usize = 1024 * 1024;

#[derive(Clone)]
struct Profile {
    name: String,
    flags: u32,
}

fn per_user(flags: u32) -> bool {
    flags & WLAN_PROFILE_USER != 0 && flags & WLAN_PROFILE_GROUP_POLICY == 0
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn inventory(client: HANDLE, interface: &GUID) -> Result<Vec<Profile>, String> {
    let mut list = std::ptr::null_mut();
    let code = unsafe { WlanGetProfileList(client, interface, None, &mut list) };
    let _memory = Memory(list.cast());
    check(code, "profile listing")?;
    if list.is_null() {
        return Err("Windows returned no Wi-Fi profile list.".into());
    }
    let count = unsafe { (*list).dwNumberOfItems as usize };
    if count > MAX_PROFILES {
        return Err(
            "Windows returned too many Wi-Fi profiles to safely update their names.".into(),
        );
    }
    Ok(
        unsafe { std::slice::from_raw_parts((*list).ProfileInfo.as_ptr(), count) }
            .iter()
            .map(|profile| {
                let end = profile
                    .strProfileName
                    .iter()
                    .position(|&unit| unit == 0)
                    .unwrap_or(profile.strProfileName.len());
                Profile {
                    name: String::from_utf16_lossy(&profile.strProfileName[..end]),
                    flags: profile.dwFlags,
                }
            })
            .collect(),
    )
}

fn hex_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.is_empty()
        || hex.len() > 64
        || !hex.len().is_multiple_of(2)
        || !hex.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).ok())
        .collect()
}

fn element<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let opening = format!("<{tag}>");
    let closing = format!("</{tag}>");
    if xml.matches(&format!("<{tag}")).count() != 1 || xml.matches(&closing).count() != 1 {
        return None;
    }
    xml.split_once(&opening)?
        .1
        .split_once(&closing)
        .map(|(content, _)| content)
}

fn profile_ssid(xml: &str) -> Option<Vec<u8>> {
    // Windows owns this XML. Unfamiliar, prefixed, or ambiguous shapes are never ownership proof.
    if xml.contains("<!")
        || xml.split('<').skip(1).any(|part| {
            part.split([' ', '>', '/'])
                .find(|name| !name.is_empty())
                .is_some_and(|name| name.contains(':'))
        })
    {
        return None;
    }
    let config = element(xml, "SSIDConfig")?;
    let ssid = element(config, "SSID")?;
    let hex = element(ssid, "hex")?;
    if hex.contains(['<', '>']) {
        return None;
    }
    hex_bytes(hex)
}

fn stored_ssid(
    client: HANDLE,
    interface: &GUID,
    name: &str,
) -> Result<(u32, Option<Vec<u8>>), String> {
    let name = wide(name);
    let mut xml = PWSTR::null();
    // Zero flags deliberately never requests WLAN_PROFILE_GET_PLAINTEXT_KEY.
    let mut flags = 0;
    let code = unsafe {
        WlanGetProfile(
            client,
            interface,
            PCWSTR(name.as_ptr()),
            None,
            &mut xml,
            Some(&mut flags),
            None,
        )
    };
    let _memory = Memory(xml.0.cast());
    check(code, "profile verification")?;
    if xml.is_null() {
        return Err("Windows returned no Wi-Fi profile details.".into());
    }
    let length = (0..MAX_XML_UNITS)
        .find(|&index| unsafe { *xml.0.add(index) == 0 })
        .ok_or_else(|| {
            "Windows returned Wi-Fi profile details too large to verify safely.".to_string()
        })?;
    let text = String::from_utf16(unsafe { std::slice::from_raw_parts(xml.0, length) })
        .map_err(|_| "Windows returned invalid Wi-Fi profile details.".to_string())?;
    Ok((flags, profile_ssid(&text)))
}

// None means absent; an empty payload means foreign or malformed ownership data.
fn ownership(client: HANDLE, interface: &GUID, name: &str) -> Result<Option<Vec<u8>>, String> {
    let name = wide(name);
    let mut size = 0;
    let mut data = std::ptr::null_mut();
    let code = unsafe {
        WlanGetProfileCustomUserData(
            client,
            interface,
            PCWSTR(name.as_ptr()),
            None,
            &mut size,
            &mut data,
        )
    };
    let _memory = Memory(data.cast());
    if code == ERROR_FILE_NOT_FOUND.0 {
        return Ok(None);
    }
    check(code, "profile ownership verification")?;
    if size == 0 {
        return Ok(None);
    }
    if data.is_null() || size as usize <= OWNER.len() || size as usize > OWNER.len() + 32 {
        return Ok(Some(Vec::new()));
    }
    let bytes = unsafe { std::slice::from_raw_parts(data, size as usize) };
    Ok(Some(bytes.strip_prefix(OWNER).unwrap_or_default().to_vec()))
}

fn mark_owned(client: HANDLE, interface: &GUID, name: &str, ssid: &str) -> Result<(), String> {
    let name = wide(name);
    let marker = [OWNER, ssid.as_bytes()].concat();
    check(
        unsafe {
            WlanSetProfileCustomUserData(client, interface, PCWSTR(name.as_ptr()), &marker, None)
        },
        "profile ownership marking",
    )
}

fn legacy_ssid(profile: &Profile, stored_flags: u32, stored: &[u8]) -> Option<String> {
    if !per_user(profile.flags) || !per_user(stored_flags) {
        return None;
    }
    let name = std::str::from_utf8(stored).ok()?;
    if name.is_empty() || name.len() > 32 || name.chars().any(char::is_control) {
        return None;
    }
    (profile.name == format!("{LEGACY_PREFIX}{}", ssid_hex(name))).then(|| name.to_owned())
}

fn choose_name(
    ssid: &str,
    profiles: &[Profile],
    mut reusable: impl FnMut(&Profile) -> Result<bool, String>,
) -> Result<(String, bool), String> {
    for number in 1..=16 {
        let name = if number == 1 {
            ssid.to_owned()
        } else {
            format!("{ssid} ({number})")
        };
        match profiles.iter().find(|profile| profile.name == name) {
            None => return Ok((name, false)),
            Some(profile) if reusable(profile)? => return Ok((name, true)),
            _ => {}
        }
    }
    Err(
        "Existing Wi-Fi profiles occupy all available friendly names. No profile was overwritten."
            .into(),
    )
}

fn deletable(profile: &Profile, flags: u32, ssid: &[u8], owner: Option<&[u8]>) -> bool {
    if !per_user(profile.flags) || !per_user(flags) || owner == Some(&[]) {
        return false;
    }
    if let Some(owned_ssid) = owner {
        return !ssid.is_empty() && ssid == owned_ssid;
    }
    legacy_ssid(profile, flags, ssid).is_some()
}

pub(super) fn cleanup(client: HANDLE, interface: &GUID) -> Result<(), String> {
    let mut first_error = None;
    for profile in inventory(client, interface)? {
        if !per_user(profile.flags) {
            continue;
        }
        let result = (|| {
            let owner = ownership(client, interface, &profile.name)?;
            if owner.as_deref() == Some(&[])
                || (owner.is_none() && !profile.name.starts_with(LEGACY_PREFIX))
            {
                return Ok(());
            }
            let (flags, ssid) = stored_ssid(client, interface, &profile.name)?;
            if ssid
                .as_deref()
                .is_some_and(|ssid| deletable(&profile, flags, ssid, owner.as_deref()))
            {
                let name = wide(&profile.name);
                let code =
                    unsafe { WlanDeleteProfile(client, interface, PCWSTR(name.as_ptr()), None) };
                if code != ERROR_NOT_FOUND.0 {
                    check(code, "profile cleanup")?;
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            first_error.get_or_insert(error);
        }
    }
    first_error.map_or(Ok(()), Err)
}

pub(super) fn save(client: HANDLE, interface: &GUID, ssid: &str) -> Result<(), String> {
    let profiles = inventory(client, interface)?;
    let (name, overwrite) = choose_name(ssid, &profiles, |profile| {
        if !per_user(profile.flags)
            || ownership(client, interface, &profile.name)?.as_deref() != Some(ssid.as_bytes())
        {
            return Ok(false);
        }
        let (flags, stored) = stored_ssid(client, interface, &profile.name)?;
        Ok(per_user(flags) && stored.as_deref() == Some(ssid.as_bytes()))
    })?;
    let name_wide = wide(&name);
    check(
        unsafe {
            WlanSaveTemporaryProfile(
                client,
                interface,
                PCWSTR(name_wide.as_ptr()),
                PCWSTR::null(),
                SAVE_PROFILE_FLAGS,
                overwrite,
                None,
            )
        },
        "profile save",
    )?;
    // Profile writes can reset custom data; reapply ownership after every successful save.
    finish_save(
        || mark_owned(client, interface, &name, ssid),
        || {
            let code =
                unsafe { WlanDeleteProfile(client, interface, PCWSTR(name_wide.as_ptr()), None) };
            if code == ERROR_NOT_FOUND.0 {
                Ok(())
            } else {
                check(code, "unsaved profile rollback")
            }
        },
    )
}

fn finish_save(
    mark: impl FnOnce() -> Result<(), String>,
    rollback: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    match mark() {
        Ok(()) => Ok(()),
        Err(error) => match rollback() {
            Ok(()) => Err(format!("The app-created Wi-Fi profile could not be marked for cleanup and was removed. {error}")),
            Err(rollback_error) => Err(format!("The app-created Wi-Fi profile could not be marked or removed. {error} {rollback_error}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(name: &str) -> Profile {
        Profile {
            name: name.into(),
            flags: WLAN_PROFILE_USER,
        }
    }

    #[test]
    fn legacy_identity_requires_exact_name_ssid_and_per_user_scope() {
        let old = profile("AMS Access Wi-Fi 526F7574657220");
        assert_eq!(
            legacy_ssid(&old, WLAN_PROFILE_USER, b"Router "),
            Some("Router ".into())
        );
        assert!(legacy_ssid(&old, WLAN_PROFILE_USER, b"Router").is_none());
        assert!(legacy_ssid(&old, 0, b"Router ").is_none());
        assert!(legacy_ssid(
            &old,
            WLAN_PROFILE_USER | WLAN_PROFILE_GROUP_POLICY,
            b"Router "
        )
        .is_none());
        assert!(legacy_ssid(
            &profile("AMS Access Wi-Fi 526f7574657220"),
            WLAN_PROFILE_USER,
            b"Router "
        )
        .is_none());
        assert!(legacy_ssid(&profile("Other"), WLAN_PROFILE_USER, b"Router ").is_none());
    }

    #[test]
    fn encrypted_profile_ssid_parser_rejects_ambiguous_or_unfamiliar_xml() {
        let xml = "<WLANProfile><SSIDConfig><SSID><hex>526F7574657220</hex><name>Router </name></SSID></SSIDConfig><MSM><keyMaterial>encrypted</keyMaterial></MSM></WLANProfile>";
        assert_eq!(profile_ssid(xml), Some(b"Router ".to_vec()));
        for invalid in [
            xml.replace(
                "<hex>526F7574657220</hex>",
                "<hex>526F7574657220</hex><hex>58</hex>",
            ),
            xml.replace("<SSID>", "<s:SSID>"),
            xml.replace("</SSID>", ""),
            xml.replace("526F7574657220", "XYZ"),
            format!("<!--{xml}-->{xml}"),
            format!("{xml}{xml}"),
        ] {
            assert!(profile_ssid(&invalid).is_none());
        }
    }

    #[test]
    fn friendly_names_preserve_user_profiles_and_reuse_only_verified_ownership() {
        assert_eq!(
            choose_name("Router ", &[], |_| panic!()).unwrap(),
            ("Router ".into(), false)
        );
        let profiles = [profile("Router"), profile("Router (2)")];
        assert_eq!(
            choose_name("Router", &profiles, |_| Ok(false)).unwrap(),
            ("Router (3)".into(), false)
        );
        assert_eq!(
            choose_name("Router", &profiles, |p| Ok(p.name == "Router (2)")).unwrap(),
            ("Router (2)".into(), true)
        );
        let full: Vec<_> = (1..=16)
            .map(|n| {
                profile(&if n == 1 {
                    "Router".into()
                } else {
                    format!("Router ({n})")
                })
            })
            .collect();
        assert!(choose_name("Router", &full, |_| Ok(false)).is_err());
    }

    #[test]
    fn marker_failure_rolls_back_and_reports_partial_failure() {
        assert!(finish_save(|| Ok(()), || panic!("must retain owned profile")).is_ok());
        assert!(finish_save(|| Err("denied".into()), || Ok(()))
            .unwrap_err()
            .contains("was removed"));
        assert!(finish_save(|| Err("denied".into()), || Err("busy".into()))
            .unwrap_err()
            .contains("could not be marked or removed"));
    }

    #[test]
    fn cleanup_requires_ownership_or_exact_legacy_identity() {
        let user = profile("Router");
        assert!(!deletable(&user, WLAN_PROFILE_USER, b"Router", None));
        assert!(deletable(
            &user,
            WLAN_PROFILE_USER,
            b"Router",
            Some(b"Router")
        ));
        assert!(!deletable(&user, 0, b"Router", Some(b"Router")));
        assert!(!deletable(
            &user,
            WLAN_PROFILE_USER,
            b"Other",
            Some(b"Router")
        ));
        let legacy = profile("AMS Access Wi-Fi 526F75746572");
        assert!(deletable(&legacy, WLAN_PROFILE_USER, b"Router", None));
        assert!(!deletable(&legacy, WLAN_PROFILE_USER, b"Other", None));
        assert!(!deletable(&legacy, WLAN_PROFILE_USER, b"Router", Some(&[])));
        assert!(!deletable(&legacy, WLAN_PROFILE_USER, b"", Some(b"Router")));
    }
}
