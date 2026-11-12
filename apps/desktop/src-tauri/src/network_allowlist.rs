//! Native-owned destinations needed in addition to the resolved API allowlist.

// Dedicated TURN EIP behind turn.amsaccess.com. A relay migration must update
// this reviewed literal and ship a new desktop release. Never derive firewall
// exceptions from credentials, ICE candidates, SDP, or user configuration.
const REVIEWED_VOICE_RELAY_IP: &str = "43.204.79.244";

/// Call only after confirming API resolution. DNS-only resolvers and this
/// fixed relay must not make an unresolved API look like a working lockdown.
pub fn with_reviewed_voice_relay(mut api_ips: Vec<String>) -> Result<Vec<String>, String> {
    if api_ips.is_empty() {
        return Err("Could not resolve any allowed domains to IPs".into());
    }
    if !api_ips.iter().any(|ip| ip == REVIEWED_VOICE_RELAY_IP) {
        api_ips.push(REVIEWED_VOICE_RELAY_IP.into());
    }
    Ok(api_ips)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unresolved_api_cannot_engage_using_only_the_fixed_relay() {
        assert!(with_reviewed_voice_relay(Vec::new()).is_err());
    }

    #[test]
    fn permits_exact_reviewed_relay_and_preserves_both_api_families() {
        let api = vec!["192.0.2.10".into(), "2001:db8::10".into()];
        assert_eq!(
            with_reviewed_voice_relay(api).unwrap(),
            ["192.0.2.10", "2001:db8::10", "43.204.79.244"]
        );
    }

    #[test]
    fn repeated_entry_does_not_duplicate_the_reviewed_destination() {
        let first = with_reviewed_voice_relay(vec!["192.0.2.10".into()]).unwrap();
        assert_eq!(with_reviewed_voice_relay(first.clone()).unwrap(), first);
    }
}
