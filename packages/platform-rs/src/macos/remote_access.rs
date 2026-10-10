//! Remote-control and screen-sharing detection for the Remote access check.
//!
//! Reads the same process list as the Restricted apps check, so a tool the
//! candidate is asked to close there is the same tool named here.

use crate::process_runner::CommandDeadlineExt;
use std::process::Command;

/// Process basename → what the candidate sees. Matched case-insensitively.
const REMOTE_PROCESSES: &[(&str, &str)] = &[
    // macOS's own services. These cannot be quit like an app; they are
    // turned off in System Settings → General → Sharing.
    ("screensharingd", "Screen Sharing"),
    ("AppleVNCServer", "Screen Sharing"),
    ("ARDAgent", "Remote Management"),
    ("RemoteDesktopAgent", "Remote Management"),
    ("sshd", "Remote Login (SSH)"),
    ("sshd-session", "Remote Login (SSH)"),
    // Third-party tools.
    ("TeamViewer", "TeamViewer"),
    ("TeamViewer_Service", "TeamViewer"),
    ("TeamViewer_Desktop", "TeamViewer"),
    ("TeamViewerHost", "TeamViewer"),
    ("AnyDesk", "AnyDesk"),
    ("RustDesk", "RustDesk"),
    ("parsecd", "Parsec"),
    ("Parsec", "Parsec"),
    ("SRStreamer", "Splashtop"),
    ("Splashtop Streamer", "Splashtop"),
    ("remoting_me2me_host", "Chrome Remote Desktop"),
    ("ChromeRemoteDesktopHost", "Chrome Remote Desktop"),
    ("vncserver", "VNC server"),
    ("Xvnc", "VNC server"),
    ("x11vnc", "VNC server"),
    ("OSXvnc-server", "VNC server"),
    ("Vine Server", "VNC server"),
    ("vncagent", "RealVNC Server"),
    ("vncserverui", "RealVNC Server"),
    ("Jump Desktop Connect", "Jump Desktop"),
    ("nxserver.bin", "NoMachine"),
    ("nxnode.bin", "NoMachine"),
    ("LogMeIn", "LogMeIn"),
    ("LMIGUIAgent", "LogMeIn"),
    // Zoom starts this host only while a screen share is running.
    ("CptHost", "Zoom screen sharing"),
];

/// Third-party remote-access processes. These are applications, so they
/// belong on the Restricted apps list and can be closed from it; the system
/// services above cannot.
pub(super) const REMOTE_APPS: &[&str] = &[
    "TeamViewer",
    "TeamViewer_Service",
    "TeamViewer_Desktop",
    "TeamViewerHost",
    "AnyDesk",
    "RustDesk",
    "parsecd",
    "Parsec",
    "SRStreamer",
    "Splashtop Streamer",
    "remoting_me2me_host",
    "ChromeRemoteDesktopHost",
    "vncserver",
    "Xvnc",
    "x11vnc",
    "OSXvnc-server",
    "Vine Server",
    "vncagent",
    "vncserverui",
    "Jump Desktop Connect",
    "nxserver.bin",
    "nxnode.bin",
    "LogMeIn",
    "LMIGUIAgent",
    "CptHost",
];

/// Listening ports that mean a remote-control service is on even when its
/// daemon is not running yet (launchd starts it on the first connection),
/// with the names that already account for the port.
const REMOTE_PORTS: &[(&str, &str, &[&str])] = &[
    (
        "5900",
        "Screen Sharing or VNC (port 5900)",
        &["Screen Sharing", "VNC server", "RealVNC Server"],
    ),
    (
        "3283",
        "Remote Management (port 3283)",
        &["Remote Management"],
    ),
    ("22", "Remote Login (SSH)", &[]),
];

fn listening_ports() -> Vec<String> {
    // Unchecked: a missing netstat is not evidence of remote access. Not
    // `-p tcp`, which printed nothing when spawned from the app on current
    // macOS; the protocol is filtered from the full table instead.
    let Ok(out) = Command::new("/usr/sbin/netstat")
        .arg("-an")
        .bounded_output()
    else {
        return vec![];
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter(|line| line.starts_with("tcp") && line.contains("LISTEN"))
        .filter_map(|line| {
            // "tcp4  0  0  *.5900  *.*  LISTEN": the local address is the
            // fourth column and the port follows its final '.'.
            let local = line.split_whitespace().nth(3)?;
            let (address, port) = local.rsplit_once('.')?;
            // A loopback-only listener is unreachable from another machine.
            (!is_loopback(address)).then(|| port.to_string())
        })
        .collect()
}

/// launchd jobs for macOS's own remote services, switched on in System
/// Settings → General → Sharing.
const SHARING_SERVICES: &[(&str, &str)] = &[
    ("com.apple.screensharing", "Screen Sharing"),
    ("com.openssh.sshd", "Remote Login (SSH)"),
];

/// Built-in sharing services launchd has enabled: the same switch System
/// Settings flips, readable without privilege. netstat alone is not enough;
/// some processes get its table with every TCP line missing. Current macOS
/// prints `=> enabled`; older releases print the raw `Disabled` key, so
/// `=> false` also means on.
fn enabled_sharing_services() -> Vec<&'static str> {
    let Ok(out) = Command::new("/bin/launchctl")
        .args(["print-disabled", "system"])
        .bounded_output()
    else {
        return vec![];
    };
    let text = String::from_utf8_lossy(&out.stdout);
    SHARING_SERVICES
        .iter()
        .filter(|(job, _)| {
            let key = format!("\"{job}\"");
            text.lines().any(|line| {
                let line = line.trim();
                line.starts_with(&key)
                    && (line.ends_with("=> enabled") || line.ends_with("=> false"))
            })
        })
        .map(|(_, name)| *name)
        .collect()
}

fn is_loopback(address: &str) -> bool {
    address.starts_with("127.")
        || address == "::1"
        || address.eq_ignore_ascii_case("localhost")
        || address.starts_with("::ffff:127.")
}

/// Names of the remote-access tools and services active on this Mac,
/// deduplicated. Empty means none were found.
pub fn scan_remote_access(running: &[String]) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for (process, name) in REMOTE_PROCESSES {
        if running.iter().any(|p| p.eq_ignore_ascii_case(process)) {
            add(&mut found, name);
        }
    }
    for name in enabled_sharing_services() {
        add(&mut found, name);
    }
    let ports = listening_ports();
    for (port, name, covered_by) in REMOTE_PORTS {
        let covered = found.iter().any(|f| covered_by.contains(&f.as_str()));
        if !covered && ports.iter().any(|p| p == port) {
            add(&mut found, name);
        }
    }
    if super::session_screen_is_shared() {
        add(&mut found, "Screen is being shared");
    }
    found
}

fn add(found: &mut Vec<String>, name: &str) {
    if !found.iter().any(|seen| seen == name) {
        found.push(name.to_string());
    }
}
