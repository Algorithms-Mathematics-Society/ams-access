//! Parsing the three platforms' wireless listings.
//!
//! Split from the per-OS modules and kept free of any command execution so
//! it can be unit-tested on any machine: the output formats are the awkward
//! part, and they are the part a developer on Linux cannot otherwise
//! exercise for macOS or Windows.

use crate::WifiNetwork;

/// Merge duplicates, mark the joined one, strongest first.
///
/// Every platform lists a network once per band or per BSSID, so a laptop in
/// a hall sees the same name five times. A candidate picking a network wants
/// one row per name.
pub fn tidy(mut rows: Vec<WifiNetwork>, current: Option<&str>) -> Vec<WifiNetwork> {
    rows.retain(|n| !n.ssid.trim().is_empty());
    rows.sort_by_key(|n| std::cmp::Reverse(n.signal.unwrap_or(0)));
    let mut seen: Vec<WifiNetwork> = Vec::new();
    for mut row in rows {
        row.current = current.is_some_and(|c| c == row.ssid);
        if let Some(existing) = seen.iter_mut().find(|e| e.ssid == row.ssid) {
            if row.signal > existing.signal {
                existing.signal = row.signal;
            }
            existing.secured |= row.secured;
            existing.saved |= row.saved;
            existing.current |= row.current;
            continue;
        }
        seen.push(row);
    }
    // The joined network first, then by strength.
    seen.sort_by_key(|n| (std::cmp::Reverse(n.current), std::cmp::Reverse(n.signal)));
    seen
}

/// `nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY dev wifi list`
///
/// Colon separated, and an SSID may itself contain an escaped colon, so the
/// fields are taken from the ends inward rather than by splitting.
pub fn parse_nmcli(stdout: &str) -> (Vec<WifiNetwork>, Option<String>) {
    let mut rows = Vec::new();
    let mut current = None;
    for line in stdout.lines() {
        let parts: Vec<&str> = split_escaped(line, ':');
        if parts.len() < 4 {
            continue;
        }
        let active = parts[0].trim() == "yes";
        let security = parts[parts.len() - 1].trim();
        let signal = parts[parts.len() - 2].trim().parse::<u8>().ok();
        let ssid = parts[1..parts.len() - 2].join(":");
        let ssid = ssid.trim().to_string();
        if ssid.is_empty() {
            continue;
        }
        if active {
            current = Some(ssid.clone());
        }
        rows.push(WifiNetwork {
            ssid,
            signal,
            secured: !security.is_empty() && security != "--",
            current: active,
            saved: false,
        });
    }
    (rows, current)
}

/// nmcli escapes a literal colon in a field as `\:`.
fn split_escaped(line: &str, sep: char) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] as char == sep {
            out.push(&line[start..i]);
            start = i + 1;
        }
        i += 1;
    }
    out.push(&line[start..]);
    out
}

/// `netsh wlan show networks mode=bssid`, in whatever language Windows is
/// installed in -- so the labels are matched by their shape, not their text:
/// a line with exactly one colon whose left side ends in a number is an
/// "SSID N : name" line.
pub fn parse_netsh(stdout: &str) -> Vec<WifiNetwork> {
    let mut rows: Vec<WifiNetwork> = Vec::new();
    for line in stdout.lines() {
        let Some((left, right)) = line.split_once(':') else {
            continue;
        };
        let left = left.trim();
        let right = right.trim();
        if right.is_empty() {
            continue;
        }
        let is_ssid_header = left
            .rsplit(' ')
            .next()
            .is_some_and(|tail| tail.chars().all(|c| c.is_ascii_digit()) && !tail.is_empty())
            && !left.to_ascii_lowercase().contains("bssid");
        if is_ssid_header {
            rows.push(WifiNetwork {
                ssid: right.to_string(),
                signal: None,
                secured: true,
                current: false,
                saved: false,
            });
            continue;
        }
        let key = left.to_ascii_lowercase();
        let Some(last) = rows.last_mut() else {
            continue;
        };
        if right.ends_with('%') {
            if let Ok(pct) = right.trim_end_matches('%').trim().parse::<u8>() {
                last.signal = Some(pct.max(last.signal.unwrap_or(0)));
            }
        } else if key.contains("authentication") || key.contains("authentifizierung") {
            // "Open" is the one value that means unsecured in every locale
            // Windows writes it in; anything else is some flavour of WPA.
            last.secured = !right.eq_ignore_ascii_case("open");
        }
    }
    rows
}

/// `networksetup -listpreferredwirelessnetworks <iface>` and friends give a
/// plain indented list of names.
pub fn parse_networksetup_list(stdout: &str) -> Vec<WifiNetwork> {
    stdout
        .lines()
        .skip(1) // the header line names the interface
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|ssid| WifiNetwork {
            ssid: ssid.to_string(),
            signal: None,
            // Unknown from this listing. Assumed secured, because offering a
            // password box for an open network is a smaller error than
            // joining a secured one without asking.
            secured: true,
            current: false,
            saved: true,
        })
        .collect()
}

/// CoreWLAN RSSI is dBm; expose a clamped percentage like the other platforms.
pub fn rssi_percent(rssi: isize) -> Option<u8> {
    (rssi < 0).then(|| ((rssi.clamp(-100, -50) + 100) * 2) as u8)
}

/// Prefer nearby named networks; saved profiles are an explicitly labelled fallback.
pub fn macos_scan_rows(
    nearby: Vec<WifiNetwork>,
    saved: Vec<WifiNetwork>,
    current: Option<&str>,
) -> (Vec<WifiNetwork>, bool) {
    let mut rows = tidy(nearby, current);
    let saved_only = rows.is_empty();
    if saved_only {
        rows = saved;
    } else {
        for row in &mut rows {
            row.saved = saved.iter().any(|profile| profile.ssid == row.ssid);
        }
    }
    if let Some(name) = current {
        if !rows.iter().any(|row| row.ssid == name) {
            rows.push(WifiNetwork {
                ssid: name.to_string(),
                signal: None,
                secured: true,
                saved: false,
                current: true,
            });
        }
    }
    (tidy(rows, current), saved_only)
}

/// Only the success label contains an SSID; errors can contain colons too.
pub fn parse_networksetup_current(stdout: &str) -> Option<String> {
    let name = stdout
        .trim()
        .strip_prefix("Current Wi-Fi Network: ")?
        .trim();
    (!name.is_empty() && name != "<redacted>").then(|| name.to_string())
}

/// Link status on this Wi-Fi interface survives SSID privacy redaction.
pub fn parse_ipconfig_wifi_associated(stdout: &str) -> bool {
    let field = |key: &str, value: &str| {
        stdout
            .lines()
            .any(|line| line.trim().split_once(" : ") == Some((key, value)))
    };
    field("InterfaceType", "WiFi") && field("LinkStatusActive", "TRUE")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corewlan_rssi_uses_real_strength_and_clamps_the_percentage() {
        for (rssi, expected) in [
            (-120, Some(0)),
            (-100, Some(0)),
            (-75, Some(50)),
            (-50, Some(100)),
            (-30, Some(100)),
            (0, None),
            (10, None),
        ] {
            assert_eq!(rssi_percent(rssi), expected);
        }
    }

    #[test]
    fn nearby_rows_exclude_out_of_range_profiles_and_mark_saved_and_current() {
        let mut nearby = parse_networksetup_list("header\nCampus\nHotspot\nCampus\nGuest");
        for (row, signal) in nearby.iter_mut().zip([20, 90, 60, 40]) {
            row.signal = Some(signal);
        }
        let saved = parse_networksetup_list("header\nCampus\nOut of range");
        let (rows, saved_only) = macos_scan_rows(nearby, saved, Some("Campus"));
        assert!(!saved_only);
        assert_eq!(
            rows.iter().map(|row| row.ssid.as_str()).collect::<Vec<_>>(),
            ["Campus", "Hotspot", "Guest"]
        );
        assert!(rows[0].current && rows[0].saved);
        assert_eq!(rows[0].signal, Some(60));
        assert!(!rows[1].saved && !rows[1].current);
    }

    #[test]
    fn missing_or_unnamed_scan_uses_saved_profiles_without_inventing_a_connection() {
        let saved = parse_networksetup_list("header\nCampus\nOut of range");
        for nearby in [
            Vec::new(),
            vec![WifiNetwork {
                ssid: " ".into(),
                signal: Some(99),
                secured: false,
                saved: false,
                current: true,
            }],
        ] {
            let (rows, saved_only) = macos_scan_rows(nearby, saved.clone(), None);
            assert!(saved_only);
            assert_eq!(rows.len(), 2);
            assert!(rows
                .iter()
                .all(|row| row.saved && !row.current && row.signal.is_none()));
        }
    }

    #[test]
    fn visible_current_is_included_even_when_missing_from_the_scan() {
        let nearby = parse_networksetup_list("header\nGuest");
        let (rows, saved_only) = macos_scan_rows(nearby, Vec::new(), Some("Campus"));
        assert!(!saved_only);
        assert_eq!(rows[0].ssid, "Campus");
        assert!(rows[0].current);
    }

    #[test]
    fn macos_current_name_requires_a_success_label_and_visible_name() {
        assert_eq!(
            parse_networksetup_current("Current Wi-Fi Network: Campus: 5G\n"),
            Some("Campus: 5G".into())
        );
        for out in [
            "You are not associated with an AirPort network.",
            "Error: unavailable",
            "Current Wi-Fi Network: ",
            "Current Wi-Fi Network: <redacted>",
        ] {
            assert_eq!(parse_networksetup_current(out), None);
        }
    }

    #[test]
    fn macos_redacted_wifi_is_connected_only_with_an_active_wifi_link() {
        let summary = "<dictionary> {\n  InterfaceType : WiFi\n  LinkStatusActive : TRUE\n  SSID : <redacted>\n}";
        assert!(parse_ipconfig_wifi_associated(summary));
        assert!(!parse_ipconfig_wifi_associated(
            &summary.replace("TRUE", "FALSE")
        ));
        assert!(!parse_ipconfig_wifi_associated(
            &summary.replace("WiFi", "Ethernet")
        ));
        assert!(!parse_ipconfig_wifi_associated("SSID : <redacted>"));
        assert!(!parse_ipconfig_wifi_associated(""));
    }

    #[test]
    fn nmcli_rows_carry_signal_security_and_the_active_network() {
        let out = "yes:CampusWiFi:72:WPA2\nno:Guest:45:\nno:Hostel_5G:88:WPA2";
        let (rows, current) = parse_nmcli(out);
        assert_eq!(current.as_deref(), Some("CampusWiFi"));
        assert_eq!(rows.len(), 3);
        let guest = rows.iter().find(|r| r.ssid == "Guest").unwrap();
        assert!(!guest.secured, "empty SECURITY means open");
        assert_eq!(guest.signal, Some(45));
        assert!(rows.iter().find(|r| r.ssid == "Hostel_5G").unwrap().secured);
    }

    #[test]
    fn an_ssid_containing_a_colon_survives_nmcli_escaping() {
        let (rows, _) = parse_nmcli(r"no:Block\:B:61:WPA2");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ssid, r"Block\:B");
        assert_eq!(rows[0].signal, Some(61));
    }

    #[test]
    fn duplicates_across_bands_collapse_to_one_row_keeping_the_best_signal() {
        let rows = vec![
            WifiNetwork {
                ssid: "Campus".into(),
                signal: Some(40),
                secured: false,
                current: false,
                saved: false,
            },
            WifiNetwork {
                ssid: "Campus".into(),
                signal: Some(75),
                secured: true,
                current: false,
                saved: true,
            },
            WifiNetwork {
                ssid: "Other".into(),
                signal: Some(90),
                secured: true,
                current: false,
                saved: false,
            },
        ];
        let tidied = tidy(rows, Some("Campus"));
        assert_eq!(tidied.len(), 2);
        assert_eq!(tidied[0].ssid, "Campus", "the joined network sorts first");
        assert!(tidied[0].current);
        assert!(tidied[0].saved);
        assert_eq!(tidied[0].signal, Some(75), "strongest of the duplicates");
        assert!(tidied[0].secured, "secured if any duplicate was");
    }

    #[test]
    fn blank_ssids_are_dropped() {
        let rows = vec![
            WifiNetwork {
                ssid: "  ".into(),
                signal: Some(80),
                secured: true,
                current: false,
                saved: false,
            },
            WifiNetwork {
                ssid: "Real".into(),
                signal: Some(10),
                secured: true,
                current: false,
                saved: false,
            },
        ];
        assert_eq!(tidy(rows, None).len(), 1);
    }

    #[test]
    fn netsh_is_parsed_by_shape_so_a_localised_windows_still_works() {
        let out = "Interface name : Wi-Fi\n\
                   SSID 1 : CampusWiFi\n\
                       Authentication  : WPA2-Personal\n\
                       BSSID 1  : aa:bb:cc:dd:ee:ff\n\
                            Signal : 82%\n\
                   SSID 2 : OpenGuest\n\
                       Authentication  : Open\n\
                            Signal : 55%";
        let rows = parse_netsh(out);
        assert_eq!(rows.len(), 2, "BSSID lines must not become networks");
        assert_eq!(rows[0].ssid, "CampusWiFi");
        assert_eq!(rows[0].signal, Some(82));
        assert!(rows[0].secured);
        assert_eq!(rows[1].ssid, "OpenGuest");
        assert!(!rows[1].secured, "Open means unsecured");
    }

    #[test]
    fn networksetup_list_skips_its_header() {
        let out = "Preferred networks on en0:\n\tCampusWiFi\n\tHostel\n";
        let rows = parse_networksetup_list(out);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].ssid, "CampusWiFi");
        assert!(rows.iter().all(|row| row.saved && row.signal.is_none()));
    }
}
