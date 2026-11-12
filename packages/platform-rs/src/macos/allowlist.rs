//! Keeps the pf allowlist usable for a whole exam.
//!
//! The helper's rules allow listed IPs and block everything else, and they are
//! resolved once at lockdown. Two things go stale under that: DNS (the
//! resolvers were not on the list, so once the cache expired no name could be
//! looked up) and the API's addresses (a failover or new load balancer IP cut
//! every locked Mac off). So the resolvers are allowed, and the API host is
//! re-resolved every minute while the lockdown is live.

use crate::process_runner::CommandDeadlineExt;
use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const REFRESH_EVERY: Duration = Duration::from_secs(60);

struct Live {
    domains: Vec<String>,
    /// The API's addresses: every port.
    ips: Vec<String>,
    /// DNS servers: port 53/853 only.
    resolvers: Vec<String>,
}

/// What the live lockdown was built from; `None` once it is released.
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static REFRESHER: AtomicBool = AtomicBool::new(false);

/// Every allowed domain resolved to IPs, plus the system's DNS resolvers.
pub fn resolve_allowlist(domains: &[String]) -> Vec<String> {
    let ips = resolve_domains(domains);
    // Resolvers only when the API itself resolved to IPv4: the pf rules drop
    // IPv6, so a list of nothing but DNS servers (or IPv6-only API addresses on
    // a NAT64 network) must not pass for a working lockdown.
    if !ips.iter().any(|ip| ip.parse::<Ipv4Addr>().is_ok()) {
        return Vec::new();
    }
    merged(&ips, &dns_resolvers())
}

fn resolve_domains(domains: &[String]) -> Vec<String> {
    let mut ips: Vec<String> = Vec::new();
    for domain in domains {
        if domain.parse::<IpAddr>().is_ok() {
            ips = merged(&ips, std::slice::from_ref(domain));
        } else if let Ok(addresses) = (domain.as_str(), 443).to_socket_addrs() {
            let found: Vec<String> = addresses.map(|a| a.ip().to_string()).collect();
            ips = merged(&ips, &found);
        }
    }
    ips
}

/// Apply the lockdown for `domains` and keep it current until it is released.
pub fn enable_and_follow(domains: &[String], ips: &[String]) -> Result<(), String> {
    let mut live = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // `ips` comes from resolve_allowlist: split the resolvers back out so the
    // helper can hold them to the DNS ports.
    let current = dns_resolvers();
    let (resolvers, ips): (Vec<String>, Vec<String>) =
        ips.iter().cloned().partition(|ip| current.contains(ip));
    super::enable_network_lockdown(&ips, &resolvers)?;
    *live = Some(Live {
        domains: domains.to_vec(),
        ips,
        resolvers,
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
    let fresh = resolve_domains(&domains);
    // Always the current resolvers, even when the API did not resolve: after a
    // move to a network with another DNS server, that server is blocked until
    // it is added, so waiting for the API to resolve first would wait forever.
    let fresh_resolvers = dns_resolvers();
    let mut guard = LIVE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(live) = guard.as_mut().filter(|live| live.domains == domains) else {
        return; // released, or re-armed for another contest, meanwhile
    };
    let next = merged(&live.ips, &fresh);
    let next_resolvers = merged(&live.resolvers, &fresh_resolvers);
    let changed = next.len() != live.ips.len() || next_resolvers.len() != live.resolvers.len();
    if changed && super::enable_network_lockdown(&next, &next_resolvers).is_ok() {
        live.ips = next;
        live.resolvers = next_resolvers;
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
    fn api_dns_refresh_retains_initial_dedicated_voice_relay() {
        let live = vec!["192.0.2.10".to_string(), "43.204.79.244".to_string()];
        assert_eq!(merged(&live, &[]), live);
        assert_eq!(
            merged(&live, &["192.0.2.11".to_string()]),
            ["192.0.2.10", "43.204.79.244", "192.0.2.11"]
        );
    }

    #[test]
    fn resolvers_are_not_added_when_the_api_did_not_resolve() {
        assert!(resolve_allowlist(&["nonexistent.invalid".to_string()]).is_empty());
        // IPv6-only API (NAT64): pf would allow only DNS and the relay.
        assert!(resolve_allowlist(&["2001:db8::10".to_string()]).is_empty());
    }
}
