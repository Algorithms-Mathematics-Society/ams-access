//! Pure address planning for process-scoped outbound firewall rules.
//! Callers must validate the plan and all target programs before changing rules.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Plan {
    pub(super) allowed: Vec<String>,
    pub(super) blocked_ipv4: Vec<String>,
    pub(super) blocked_ipv6: Vec<String>,
}

/// Complement the allowed endpoints, without creating any overlapping block.
/// No implicit DNS, loopback, or other business-policy exceptions are added.
pub(super) fn plan(allowed_ips: &[String]) -> Result<Plan, String> {
    if allowed_ips.is_empty() {
        return Err("At least one allowed IP address is required".into());
    }

    let mut ipv4 = Vec::new();
    let mut ipv6 = Vec::new();
    for text in allowed_ips {
        match text.parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => ipv4.push(u32::from(ip)),
            Ok(IpAddr::V6(ip)) => ipv6.push(u128::from(ip)),
            Err(_) => return Err(format!("Invalid allowed IP address: {text:?}")),
        }
    }
    ipv4.sort_unstable();
    ipv4.dedup();
    ipv6.sort_unstable();
    ipv6.dedup();

    let allowed = ipv4
        .iter()
        .map(|&ip| Ipv4Addr::from(ip).to_string())
        .chain(ipv6.iter().map(|&ip| Ipv6Addr::from(ip).to_string()))
        .collect();
    let blocked_ipv4 = complement(
        &ipv4.iter().map(|&ip| u128::from(ip)).collect::<Vec<_>>(),
        u128::from(u32::MAX),
        |ip| Ipv4Addr::from(ip as u32).to_string(),
    );
    let blocked_ipv6 = complement(&ipv6, u128::MAX, |ip| Ipv6Addr::from(ip).to_string());

    Ok(Plan {
        allowed,
        blocked_ipv4,
        blocked_ipv6,
    })
}

/// Install a prevalidated plan. `cleanup` must verify removal of old rules;
/// `rollback` must remove and verify any partially installed rules. The caller
/// owns the time budget for each callback, including independent rollback.
pub(super) fn install_with(
    plan: &Plan,
    mut cleanup: impl FnMut() -> Result<(), String>,
    mut add_rule: impl FnMut(&str, &str, &str) -> Result<(), String>,
    mut rollback: impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    if plan.allowed.is_empty() || plan.allowed.iter().any(String::is_empty) {
        return Err("Cannot install firewall policy without allowed IPs".into());
    }
    cleanup()?;

    let install = (|| {
        for addresses in [&plan.blocked_ipv4, &plan.blocked_ipv6] {
            if !addresses.is_empty() {
                add_rule("block", "AMS_PROCTOR_BLOCK_ALL", &addresses.join(","))
                    .map_err(|error| format!("Cannot install block rule: {error}"))?;
            }
        }
        add_rule("allow", "AMS_PROCTOR_ALLOW", &plan.allowed.join(","))
            .map_err(|error| format!("Cannot install allow rule: {error}"))
    })();

    match install {
        Ok(()) => Ok(()),
        Err(error) => match rollback() {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!("{error}; rollback failed: {rollback_error}")),
        },
    }
}

fn complement(allowed: &[u128], max: u128, render: impl Fn(u128) -> String) -> Vec<String> {
    let mut ranges = Vec::new();
    let mut next = Some(0);
    for &ip in allowed {
        if let (Some(start), Some(end)) = (next, ip.checked_sub(1)) {
            if start <= end {
                ranges.push(range(start, end, &render));
            }
        }
        next = ip.checked_add(1).filter(|&value| value <= max);
    }
    if let Some(start) = next {
        ranges.push(range(start, max, &render));
    }
    ranges
}

fn range(start: u128, end: u128, render: &impl Fn(u128) -> String) -> String {
    if start == end {
        render(start)
    } else {
        format!("{}-{}", render(start), render(end))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(addresses: &[&str]) -> Plan {
        plan(
            &addresses
                .iter()
                .map(|ip| (*ip).to_owned())
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    fn contains(ranges: &[String], ip: IpAddr) -> bool {
        let number = match ip {
            IpAddr::V4(v4) => u128::from(u32::from(v4)),
            IpAddr::V6(v6) => u128::from(v6),
        };
        ranges.iter().any(|text| {
            let (first, last) = text.split_once('-').unwrap_or((text, text));
            let first = first.parse::<IpAddr>().unwrap();
            let last = last.parse::<IpAddr>().unwrap();
            let to_number = |addr| match addr {
                IpAddr::V4(v4) => u128::from(u32::from(v4)),
                IpAddr::V6(v6) => u128::from(v6),
            };
            to_number(first) <= number && number <= to_number(last)
        })
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detached_windows_com_rule_accepts_planned_remote_addresses() {
        use super::super::{hidden_command, CommandDeadlineExt};
        use std::time::Duration;

        let planned = make(&[
            "203.0.113.10",
            "203.0.113.12",
            "2001:db8::10",
            "2001:db8::12",
        ]);
        let script = format!(
            r#"
$ErrorActionPreference = 'Stop'
try {{
    foreach ($addresses in @('{ipv4}', '{ipv6}', '{allowed}')) {{
        # Detached rule only: never create FwPolicy2 or register with Rules.Add.
        $rule = New-Object -ComObject HNetCfg.FWRule
        $rule.RemoteAddresses = $addresses
        if ([string]::IsNullOrEmpty([string]$rule.RemoteAddresses)) {{
            throw "Detached RemoteAddresses readback was empty"
        }}
    }}
    exit 0
}} catch {{
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}}
"#,
            ipv4 = planned.blocked_ipv4.join(","),
            ipv6 = planned.blocked_ipv6.join(","),
            allowed = planned.allowed.join(","),
        );
        let output = hidden_command("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &script,
            ])
            .bounded_output_with_timeout(Duration::from_secs(30))
            .expect("detached COM validation must finish within 30 seconds");
        assert!(
            output.status.success(),
            "detached COM RemoteAddresses rejected plan: stdout={}, stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    #[test]
    fn installs_grouped_mixed_family_ranges_before_allow_without_overlaps() {
        use std::cell::RefCell;

        let plan = make(&[
            "2001:db8::12",
            "10.0.0.12",
            "10.0.0.10",
            "2001:db8::10",
            "10.0.0.10",
        ]);
        let events = RefCell::new(Vec::new());
        install_with(
            &plan,
            || {
                events.borrow_mut().push("cleanup".to_string());
                Ok(())
            },
            |action, name, addresses| {
                events
                    .borrow_mut()
                    .push(format!("{action}:{name}:{addresses}"));
                Ok(())
            },
            || {
                events.borrow_mut().push("rollback".to_string());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*events.borrow(), [
            "cleanup",
            "block:AMS_PROCTOR_BLOCK_ALL:0.0.0.0-10.0.0.9,10.0.0.11,10.0.0.13-255.255.255.255",
            "block:AMS_PROCTOR_BLOCK_ALL:::-2001:db8::f,2001:db8::11,2001:db8::13-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
            "allow:AMS_PROCTOR_ALLOW:10.0.0.10,10.0.0.12,2001:db8::10,2001:db8::12",
        ]);
        for allowed in &plan.allowed {
            let ip = allowed.parse::<IpAddr>().unwrap();
            let blocks = if ip.is_ipv4() {
                &plan.blocked_ipv4
            } else {
                &plan.blocked_ipv6
            };
            assert!(!contains(blocks, ip), "allow overlaps block: {ip}");
        }
    }

    #[test]
    fn each_add_failure_triggers_one_rollback() {
        use std::cell::RefCell;

        let plan = make(&["10.0.0.10", "2001:db8::10"]);
        for failed_add in 0..3 {
            let events = RefCell::new(Vec::new());
            let mut add_count = 0;
            let error = install_with(
                &plan,
                || {
                    events.borrow_mut().push("cleanup");
                    Ok(())
                },
                |action, _, _| {
                    events
                        .borrow_mut()
                        .push(if action == "block" { "block" } else { "allow" });
                    let index = add_count;
                    add_count += 1;
                    if index == failed_add {
                        Err("add failed".into())
                    } else {
                        Ok(())
                    }
                },
                || {
                    events.borrow_mut().push("rollback");
                    Ok(())
                },
            )
            .unwrap_err();
            assert!(error.contains("add failed"));
            let mut expected = vec!["cleanup"];
            expected.extend(std::iter::repeat_n("block", (failed_add + 1).min(2)));
            if failed_add == 2 {
                expected.push("allow");
            }
            expected.push("rollback");
            assert_eq!(*events.borrow(), expected);
        }
    }

    #[test]
    fn skips_empty_block_group_instead_of_sending_empty_remoteip() {
        let plan = Plan {
            allowed: vec!["::1".into()],
            blocked_ipv4: vec![],
            blocked_ipv6: vec!["::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff".into()],
        };
        let mut calls = Vec::new();
        install_with(
            &plan,
            || Ok(()),
            |action, name, addresses| {
                calls.push((action.to_owned(), name.to_owned(), addresses.to_owned()));
                Ok(())
            },
            || panic!("successful install must not roll back"),
        )
        .unwrap();
        assert_eq!(
            calls,
            [
                (
                    "block".into(),
                    "AMS_PROCTOR_BLOCK_ALL".into(),
                    "::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff".into()
                ),
                ("allow".into(), "AMS_PROCTOR_ALLOW".into(), "::1".into()),
            ]
        );
    }

    #[test]
    fn rollback_failure_is_reported_with_original_add_failure() {
        let error = install_with(
            &make(&["10.0.0.10"]),
            || Ok(()),
            |_, _, _| Err("add denied".into()),
            || Err("recovery timed out".into()),
        )
        .unwrap_err();
        assert!(error.contains("add denied"), "{error}");
        assert!(error.contains("recovery timed out"), "{error}");
    }

    #[test]
    fn cleanup_failure_does_not_add_or_rollback() {
        let error = install_with(
            &make(&["10.0.0.10"]),
            || Err("cleanup not verified".into()),
            |_, _, _| panic!("must not add after failed cleanup"),
            || panic!("must not roll back if cleanup never succeeded"),
        )
        .unwrap_err();
        assert_eq!(error, "cleanup not verified");
    }

    #[test]
    fn empty_allow_plan_cannot_install_or_mutate() {
        let invalid = Plan {
            allowed: vec![],
            blocked_ipv4: vec!["0.0.0.0-255.255.255.255".into()],
            blocked_ipv6: vec![],
        };
        assert!(install_with(
            &invalid,
            || panic!("must validate before cleanup"),
            |_, _, _| panic!("must not add an unfiltered allow"),
            || panic!("must not rollback before mutation"),
        )
        .is_err());
    }

    #[test]
    fn rejects_empty_and_invalid_input_instead_of_skipping_it() {
        assert!(plan(&[]).is_err());
        for invalid in ["", " ", "any", "1.2.3.4-1.2.3.5", "::1%4"] {
            assert!(
                plan(&["127.0.0.1".into(), invalid.into()]).is_err(),
                "{invalid:?}"
            );
        }
    }

    #[test]
    fn normalizes_sorts_and_deduplicates_both_families() {
        let result = make(&["::2", "255.255.255.255", "0.0.0.1", "::2", "0.0.0.1", "::1"]);
        assert_eq!(result.allowed, ["0.0.0.1", "255.255.255.255", "::1", "::2"]);
        assert_eq!(result.blocked_ipv4, ["0.0.0.0", "0.0.0.2-255.255.255.254"]);
        assert_eq!(
            result.blocked_ipv6,
            ["::", "::3-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]
        );
    }

    #[test]
    fn handles_zero_max_and_adjacent_endpoints() {
        let result = make(&[
            "0.0.0.0",
            "0.0.0.1",
            "255.255.255.254",
            "255.255.255.255",
            "::",
            "::1",
            "ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe",
            "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
        ]);
        assert_eq!(result.blocked_ipv4, ["0.0.0.2-255.255.255.253"]);
        assert_eq!(
            result.blocked_ipv6,
            ["::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffd"]
        );
        assert!(make(&["0.0.0.0", "::"]).blocked_ipv4[0].starts_with("0.0.0.1-"));
        assert!(
            make(&["255.255.255.255", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]).blocked_ipv6[0]
                .ends_with("-ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe")
        );
    }

    #[test]
    fn missing_family_blocks_its_entire_address_space() {
        let v4_only = make(&["127.0.0.1"]);
        assert_eq!(
            v4_only.blocked_ipv6,
            ["::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"]
        );
        let v6_only = make(&["::1"]);
        assert_eq!(v6_only.blocked_ipv4, ["0.0.0.0-255.255.255.255"]);
    }

    #[test]
    fn every_synthetic_address_is_in_exactly_one_side_of_the_policy() {
        for family in 0..2 {
            for allowed in [
                vec![0u8],
                vec![255],
                vec![0, 1, 2, 127, 128, 254, 255],
                vec![33, 33, 34],
            ] {
                let ips: Vec<String> = allowed
                    .iter()
                    .map(|&n| {
                        if family == 0 {
                            Ipv4Addr::from(u32::from(n)).to_string()
                        } else {
                            Ipv6Addr::from(u128::from(n)).to_string()
                        }
                    })
                    .collect();
                let result = plan(&ips).unwrap();
                let ranges = if family == 0 {
                    &result.blocked_ipv4
                } else {
                    &result.blocked_ipv6
                };
                for n in 0..=255u8 {
                    let ip = if family == 0 {
                        IpAddr::V4(Ipv4Addr::from(u32::from(n)))
                    } else {
                        IpAddr::V6(Ipv6Addr::from(u128::from(n)))
                    };
                    assert_eq!(contains(ranges, ip), !allowed.contains(&n), "{ip}");
                }
            }
        }
    }
}
