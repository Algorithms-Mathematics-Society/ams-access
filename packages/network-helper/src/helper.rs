//! Unix implementation of the privileged network helper.
//!
//! Runs as root under a LaunchDaemon. The main app process communicates over a
//! Unix domain socket at SOCKET_PATH. All pfctl operations happen here so the
//! main app process never needs root.
//!
//! Protocol: newline-delimited JSON, one request -> one response.
//!   Request:  {"cmd":"ping"}
//!             {"cmd":"enable","ips":["1.2.3.4","5.6.7.8"]}
//!             {"cmd":"disable"}
//!   Response: {"ok":true}
//!             {"ok":false,"error":"<message>"}

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
use std::os::fd::AsRawFd;

const SOCKET_PATH: &str = "/private/var/run/ams-proctor.sock";

#[cfg(target_os = "macos")]
const CLIENT_CONFIG_PATH: &str =
    "/Library/Application Support/AMS Access/network-helper-client.conf";

const PFCTL: &str = "/sbin/pfctl";
const ANCHOR: &str = "com.apple/amsaccess.proctor";
const LEGACY_ANCHOR: &str = "com.amsaccess.proctor";

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "lowercase")]
enum Request {
    Ping,
    Enable { ips: Vec<String> },
    Disable,
}

#[derive(Serialize)]
struct Response<'a> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

pub fn run() {
    let _ = std::fs::remove_file(SOCKET_PATH);

    let listener = UnixListener::bind(SOCKET_PATH).expect("AMS helper: failed to bind Unix socket");

    // The socket is reachable by interactive users, but each accepted peer is
    // checked against the root-installed app executable path before commands run.
    let _ = std::fs::set_permissions(SOCKET_PATH, PermissionsExt::from_mode(0o660));
    let _ = Command::new("/usr/sbin/chown")
        .args(["root:staff", SOCKET_PATH])
        .output();

    eprintln!("AMS network helper ready on {SOCKET_PATH}");

    for stream in listener.incoming() {
        match stream {
            // Spawn per connection — pfctl can block for tens of ms under
            // kernel lock; a single-threaded loop would stall the next accept.
            Ok(s) => {
                std::thread::spawn(move || handle_client(s));
            }
            Err(e) => eprintln!("AMS helper accept error: {e}"),
        }
    }
}

fn handle_client(stream: UnixStream) {
    let mut writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(e) => {
            eprintln!("AMS helper stream clone error: {e}");
            return;
        }
    };

    if let Err(e) = authorize_client(&stream) {
        let _ = writeln!(writer, "{}", json_err(&e));
        return;
    }

    let reader = BufReader::new(stream);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let response = dispatch(&line);
        let _ = writeln!(writer, "{response}");
    }
}

#[cfg(target_os = "macos")]
fn authorize_client(stream: &UnixStream) -> Result<(), String> {
    let expected = std::fs::read_to_string(CLIENT_CONFIG_PATH)
        .map_err(|e| format!("read client config: {e}"))?
        .trim()
        .to_string();
    if expected.is_empty() {
        return Err("client config is empty".to_string());
    }

    let pid = peer_pid(stream)?;
    let actual = pid_path(pid)?;
    if actual == expected {
        Ok(())
    } else {
        Err("unauthorized client".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn authorize_client(_stream: &UnixStream) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn peer_pid(stream: &UnixStream) -> Result<libc::pid_t, String> {
    const LOCAL_PEERPID: libc::c_int = 2;

    let mut pid: libc::pid_t = 0;
    let mut len = std::mem::size_of::<libc::pid_t>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            0,
            LOCAL_PEERPID,
            (&mut pid as *mut libc::pid_t).cast(),
            &mut len,
        )
    };

    if rc == 0 && pid > 0 {
        Ok(pid)
    } else {
        Err("unable to identify client process".to_string())
    }
}

#[cfg(target_os = "macos")]
fn pid_path(pid: libc::pid_t) -> Result<String, String> {
    const PROC_PIDPATHINFO_MAXSIZE: usize = 4096;

    extern "C" {
        fn proc_pidpath(
            pid: libc::c_int,
            buffer: *mut libc::c_void,
            buffersize: u32,
        ) -> libc::c_int;
    }

    let mut buf = vec![0u8; PROC_PIDPATHINFO_MAXSIZE];
    let len = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if len <= 0 {
        return Err("unable to resolve client process path".to_string());
    }
    buf.truncate(len as usize);
    String::from_utf8(buf).map_err(|_| "client process path is not utf-8".to_string())
}

fn dispatch(json: &str) -> String {
    match serde_json::from_str::<Request>(json.trim()) {
        Ok(Request::Ping) => json_ok(),
        Ok(Request::Enable { ips }) => {
            match validate_ipv4_allowlist(&ips).and_then(|ips| pfctl_enable(&ips)) {
                Ok(()) => json_ok(),
                Err(e) => json_err(&e),
            }
        }
        Ok(Request::Disable) => match pfctl_disable() {
            Ok(()) => json_ok(),
            Err(e) => json_err(&e),
        },
        Err(e) => json_err(&format!("invalid request: {e}")),
    }
}

fn json_ok() -> String {
    serde_json::to_string(&Response {
        ok: true,
        error: None,
    })
    .unwrap_or_else(|_| r#"{"ok":true}"#.to_string())
}

fn json_err(msg: &str) -> String {
    serde_json::to_string(&Response {
        ok: false,
        error: Some(msg),
    })
    .unwrap_or_else(|_| r#"{"ok":false,"error":"serialization failed"}"#.to_string())
}

fn validate_ipv4_allowlist(ips: &[String]) -> Result<Vec<Ipv4Addr>, String> {
    let mut out = Vec::new();
    for raw in ips {
        match raw.parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) if !out.contains(&ip) => out.push(ip),
            Ok(IpAddr::V4(_)) => {}
            Ok(IpAddr::V6(_)) => {}
            Err(_) => return Err(format!("invalid allowed IP: {raw}")),
        }
    }

    if out.is_empty() {
        Err("no IPv4 addresses available for lockdown allowlist".to_string())
    } else {
        Ok(out)
    }
}

fn pfctl_load_anchor(anchor: &str, rules: &str) -> Result<(), String> {
    let mut child = Command::new(PFCTL)
        .args(["-a", anchor, "-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pfctl -f: {e}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "pfctl stdin unavailable".to_string())?
        .write_all(rules.as_bytes())
        .map_err(|e| format!("write pf rules: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("pfctl wait: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

fn pfctl_enable(ips: &[Ipv4Addr]) -> Result<(), String> {
    let _ = Command::new(PFCTL).arg("-e").output();

    let ip_list = ips
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(", ");

    let rules = format!(
        "table <ams_allowed> persist {{ {ip_list} }}\n\
         pass out quick on lo0 all\n\
         pass out quick inet to <ams_allowed>\n\
         block out quick inet all\n\
         block out quick inet6 all\n"
    );

    // macOS' stock pf.conf evaluates com.apple/* anchors. Loading under that
    // namespace avoids editing /etc/pf.conf while still making the rules active.
    pfctl_load_anchor(ANCHOR, &rules)
}

fn pfctl_disable() -> Result<(), String> {
    for anchor in [ANCHOR, LEGACY_ANCHOR, "com.amsaccess.proctor6"] {
        let out = Command::new(PFCTL)
            .args(["-a", anchor, "-F", "all"])
            .output()
            .map_err(|e| format!("pfctl flush: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.to_lowercase().contains("anchor") {
                return Err(stderr.trim().to_string());
            }
        }
    }
    Ok(())
}
