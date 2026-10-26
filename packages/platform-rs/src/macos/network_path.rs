//! Routes that would take the exam around the pf allowlist. With a system
//! proxy or a full-tunnel VPN the API is reached through an address that is
//! not in the allowlist, so lockdown would cut the candidate off. The network
//! stage warns before lockdown instead.

use crate::process_runner::CommandDeadlineExt;
use std::process::Command;

/// Plain-English warnings, empty when the path to the API looks direct.
pub fn network_path_warnings() -> Vec<String> {
    let read = |program: &str, args: &[&str]| {
        Command::new(program)
            .args(args)
            .bounded_output()
            .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
            .unwrap_or_default()
    };
    let mut warnings = Vec::new();
    if proxy_enabled(&read("/usr/sbin/scutil", &["--proxy"])) {
        warnings.push("A web proxy is turned on for this Mac. Exam protection blocks traffic through it, so AMS Access would lose its connection. Turn it off in System Settings > Network > Details > Proxies, or ask your invigilator.".to_string());
    }
    if let Some(interface) = full_tunnel_vpn(&read("/usr/sbin/netstat", &["-rn", "-f", "inet"])) {
        warnings.push(format!("A VPN ({interface}) is carrying all of this Mac's internet traffic. Exam protection blocks it, so AMS Access would lose its connection. Disconnect the VPN before you continue."));
    }
    warnings
}

/// `scutil --proxy`: an HTTP, HTTPS or automatic (PAC) proxy is on.
fn proxy_enabled(scutil: &str) -> bool {
    scutil.lines().any(|line| {
        let mut parts = line.split(':').map(str::trim);
        matches!(
            (parts.next(), parts.next()),
            (
                Some("HTTPEnable" | "HTTPSEnable" | "ProxyAutoConfigEnable"),
                Some("1")
            )
        )
    })
}

/// `netstat -rn -f inet`: the tunnel interface holding the default route, or
/// the 0/1 + 128.0/1 pair VPNs use to override it.
fn full_tunnel_vpn(routes: &str) -> Option<String> {
    routes.lines().find_map(|line| {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [destination, _gateway, flags, interface, ..] = fields[..] else {
            return None;
        };
        let default = matches!(destination, "default" | "0/1" | "128.0/1");
        let tunnel = ["utun", "ipsec", "ppp"]
            .iter()
            .any(|prefix| interface.starts_with(prefix));
        // An interface-scoped (I) default only serves traffic bound to that
        // interface, as macOS sets up for every link; it is not the main path.
        (default && tunnel && !flags.contains('I')).then(|| interface.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIRECT: &str = "Routing tables

Internet:
Destination        Gateway            Flags               Netif Expire
default            172.20.0.1         UGScg                 en0
default            link#26            UCSIg           bridge100      !
default            link#30            UCSIg               utun4
127                127.0.0.1          UCS                   lo0
";

    #[test]
    fn a_direct_route_is_clean_even_with_scoped_tunnel_defaults() {
        assert_eq!(full_tunnel_vpn(DIRECT), None);
    }

    #[test]
    fn a_tunnel_carrying_the_default_route_is_a_full_tunnel() {
        let vpn = "Destination Gateway Flags Netif Expire\n\
                   default     10.8.0.1 UGScg utun3\n\
                   default     172.20.0.1 UGScIg en0\n";
        assert_eq!(full_tunnel_vpn(vpn).as_deref(), Some("utun3"));
        let split_default = "0/1  10.8.0.1  UGSc  utun5\n128.0/1  10.8.0.1  UGSc  utun5\n";
        assert_eq!(full_tunnel_vpn(split_default).as_deref(), Some("utun5"));
        assert_eq!(
            full_tunnel_vpn("default  10.0.0.1  UGSc  ppp0\n").as_deref(),
            Some("ppp0")
        );
        // A split tunnel that only routes the office network is fine.
        assert_eq!(full_tunnel_vpn("10/8  10.8.0.1  UGSc  utun3\n"), None);
    }

    #[test]
    fn proxies_are_found_and_disabled_ones_ignored() {
        let off = "<dictionary> {\n  ExceptionsList : <array> {\n    0 : *.local\n  }\n  FTPPassive : 1\n  HTTPEnable : 0\n}\n";
        assert!(!proxy_enabled(off));
        let http =
            "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 8888\n  HTTPProxy : 127.0.0.1\n}\n";
        assert!(proxy_enabled(http));
        assert!(proxy_enabled("  HTTPSEnable : 1\n"));
        let pac = "  ProxyAutoConfigEnable : 1\n  ProxyAutoConfigURLString : http://wpad/x.pac\n";
        assert!(proxy_enabled(pac));
    }
}
