//! Keeps the pf allowlist usable for a whole exam.
//!
//! The helper's rules allow listed IPs and block everything else, and they are
//! resolved once at lockdown. Two things go stale under that: DNS (the
//! resolvers were not on the list, so once the cache expired no name could be
//! looked up) and the API's addresses (a failover or new load balancer IP cut
//! every locked Mac off). So the resolvers are allowed, and the API host is
//! re-resolved every minute while the lockdown is live.

use crate::process_runner::CommandDeadlineExt;
use std::net::{IpAddr, ToSocketAddrs};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const REFRESH_EVERY: Duration = Duration::from_secs(60);

struct Live {
    domains: Vec<String>,
    ips: Vec<String>,
}

/// What the live lockdown was built from; `None` once it is released.
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static REFRESHER: AtomicBool = AtomicBool::new(false);

/// Every allowed domain resolved to IPs, plus the system's DNS resolvers.
pub fn resolve_allowlist(domains: &[String]) -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    for domain in domains {
        if domain.parse::<IpAddr>().is_ok() {
            ips = merged(&ips, std::slice::from_ref(domain));
        } else if let Ok(addresses) = (domain.as_str(), 443).to_socket_addrs() {
            let found: Vec<String> = addresses.map(|a| a.ip().to_string()).collect();
            ips = merged(&ips, &found);
        }
    }
    // Resolvers only when the API itself resolved: a list of nothing but DNS
    // servers must not pass for a working lockdown.
    if ips.is_empty() {
        return ips;
    }
    merged(&ips, &dns_resolvers())
}

/// Apply the lockdown for `domains` and keep it current until it is released.
pub fn enable_and_follow(domains: &[String], ips: &[String]) -> Result<(), String> {
    let mut live = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    super::enable_network_lockdown(ips)?;
    *live = Some(Live {
        domains: domains.to_vec(),
        ips: ips.to_vec(),
    });
    drop(live);
    if !REFRESHER.swap(true, Ordering::SeqCst) {
        let spawned = std::thread::Builder::new()
            .name("ams-allowlist-refresh".into())
            .spawn(|| loop {
                std::thread::sleep(REFRESH_EVERY);
                refresh();
            });
        if spawned.is_err() {
            REFRESHER.store(false, Ordering::SeqCst);
        }
    }
    Ok(())
}

/// Stop following; called before the rules are flushed so a refresh can
/// never put them back.
pub(super) fn forget() {
    *LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

fn refresh() {
    let Some(domains) = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .map(|live| live.domains.clone())
    else {
        return;
    };
    // Resolved without the lock: a slow lookup must not hold up a release.
    let fresh = resolve_allowlist(&domains);
    let mut guard = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(live) = guard.as_mut().filter(|live| live.domains == domains) else {
        return; // released, or re-armed for another contest, meanwhile
    };
    let next = merged(&live.ips, &fresh);
    if next.len() != live.ips.len() && super::enable_network_lockdown(&next).is_ok() {
        live.ips = next;
    }
}

/// Old addresses are kept so open connections to them are not cut.
fn merged(current: &[String], fresh: &[String]) -> Vec<String> {
    let mut out = current.to_vec();
    for ip in fresh {
        if !out.contains(ip) {
            out.push(ip.clone());
        }
    }
    out
}

fn dns_resolvers() -> Vec<String> {
    Command::new("/usr/sbin/scutil")
        .arg("--dns")
        .bounded_output()
        .map(|out| parse_scutil_resolvers(&String::from_utf8_lossy(&out.stdout)))
        .unwrap_or_default()
}

/// `nameserver[0] : 192.168.1.1` lines; scoped IPv6 (`fe80::1%en0`) is skipped
/// because the pf rules are IPv4-only.
fn parse_scutil_resolvers(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines().map(str::trim) {
        if !line.starts_with("nameserver[") {
            continue;
        }
        let Some((_, ip)) = line.split_once(':') else {
            continue;
        };
        let ip = ip.trim();
        if ip.parse::<IpAddr>().is_ok() && !out.iter().any(|known| known == ip) {
            out.push(ip.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resolvers_across_scopes_without_duplicates() {
        let text = "DNS configuration\n\nresolver #1\n  search domain[0] : lan\n  nameserver[0] : 192.168.1.1\n  nameserver[1] : fe80::1%en0\n  nameserver[2] : 2001:4860:4860::8888\n  if_index : 14 (en0)\n\nDNS configuration (for scoped queries)\n\nresolver #1\n  nameserver[0] : 192.168.1.1\n";
        assert_eq!(
            parse_scutil_resolvers(text),
            vec![
                "192.168.1.1".to_string(),
                "2001:4860:4860::8888".to_string()
            ]
        );
    }

    #[test]
    fn merge_keeps_old_addresses_and_adds_new_ones() {
        let current = vec!["1.1.1.1".to_string(), "2.2.2.2".to_string()];
        let fresh = vec!["2.2.2.2".to_string(), "3.3.3.3".to_string()];
        assert_eq!(
            merged(&current, &fresh),
            vec!["1.1.1.1", "2.2.2.2", "3.3.3.3"]
        );
    }

    #[test]
    fn resolvers_are_not_added_when_the_api_did_not_resolve() {
        assert!(resolve_allowlist(&["nonexistent.invalid".to_string()]).is_empty());
    }
}
