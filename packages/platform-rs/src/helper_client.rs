//! Unix helper protocol client. Only an explicit pre-dispatch busy response is
//! retryable; EOF, partial writes and timeouts have an uncertain outcome.
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::time::{Duration, Instant};

const BUSY: &str = "helper_busy";
const MAX_FRAME: usize = 64 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

/// Connect without allowing a full Unix-socket listen backlog to park a native
/// readiness/recovery worker indefinitely. No thread is detached on timeout.
pub fn connect(path: &std::path::Path) -> std::io::Result<UnixStream> {
    connect_with_timeout(path, Duration::from_secs(1))
}

fn connect_with_timeout(path: &std::path::Path, timeout: Duration) -> std::io::Result<UnixStream> {
    use std::ffi::{c_int, c_void};
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::os::unix::ffi::OsStrExt;
    #[repr(C)]
    struct PollFd {
        fd: c_int,
        events: i16,
        revents: i16,
    }
    #[cfg(target_os = "macos")]
    #[repr(C)]
    struct Address {
        len: u8,
        family: u8,
        path: [u8; 104],
    }
    #[cfg(not(target_os = "macos"))]
    #[repr(C)]
    struct Address {
        family: u16,
        path: [u8; 108],
    }
    #[cfg(target_os = "macos")]
    type PollCount = u32;
    #[cfg(not(target_os = "macos"))]
    type PollCount = usize;
    unsafe extern "C" {
        fn socket(domain: c_int, kind: c_int, protocol: c_int) -> c_int;
        #[link_name = "connect"]
        fn socket_connect(fd: c_int, address: *const c_void, length: u32) -> c_int;
        fn fcntl(fd: c_int, command: c_int, ...) -> c_int;
        fn poll(fds: *mut PollFd, count: PollCount, timeout_ms: c_int) -> c_int;
        fn getsockopt(
            fd: c_int,
            level: c_int,
            option: c_int,
            value: *mut c_void,
            length: *mut u32,
        ) -> c_int;
    }
    #[cfg(target_os = "macos")]
    const NONBLOCK: c_int = 0x4;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: c_int = 0x800;
    #[cfg(target_os = "macos")]
    const IN_PROGRESS: c_int = 36;
    #[cfg(not(target_os = "macos"))]
    const IN_PROGRESS: c_int = 115;
    #[cfg(target_os = "macos")]
    const SOL_SOCKET: c_int = 0xffff;
    #[cfg(not(target_os = "macos"))]
    const SOL_SOCKET: c_int = 1;
    #[cfg(target_os = "macos")]
    const SO_ERROR: c_int = 0x1007;
    #[cfg(not(target_os = "macos"))]
    const SO_ERROR: c_int = 4;

    #[cfg(target_os = "macos")]
    let mut address = Address {
        len: 0,
        family: 1,
        path: [0; 104],
    };
    #[cfg(not(target_os = "macos"))]
    let mut address = Address {
        family: 1,
        path: [0; 108],
    };
    let bytes = path.as_os_str().as_bytes();
    if bytes.is_empty() || bytes.len() >= address.path.len() || bytes.contains(&0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid helper socket path",
        ));
    }
    address.path[..bytes.len()].copy_from_slice(bytes);
    let length = (2 + bytes.len() + 1) as u32;
    #[cfg(target_os = "macos")]
    {
        address.len = length as u8;
    }
    // SAFETY: AF_UNIX/SOCK_STREAM are supported on these Unix targets; a new
    // descriptor is immediately owned, including all subsequent error paths.
    #[cfg(target_os = "linux")]
    let kind = 1 | 0x80000 | NONBLOCK; // SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK
    #[cfg(not(target_os = "linux"))]
    let kind = 1;
    let raw = unsafe { socket(1, kind, 0) };
    if raw < 0 {
        return Err(std::io::Error::last_os_error());
    }
    let fd = unsafe { OwnedFd::from_raw_fd(raw) };
    let descriptor_flags = unsafe { fcntl(raw, 1) };
    let status_flags = unsafe { fcntl(raw, 3) };
    if descriptor_flags < 0
        || status_flags < 0
        || unsafe { fcntl(raw, 2, descriptor_flags | 1) } < 0
        || unsafe { fcntl(raw, 4, status_flags | NONBLOCK) } < 0
    {
        return Err(std::io::Error::last_os_error());
    }
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() >= deadline {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "helper connect timed out",
            ));
        }
        // SAFETY: address has the native sockaddr_un layout and the supplied
        // length is within its initialized buffer; connect copies it inline.
        if unsafe { socket_connect(raw, &address as *const _ as *const c_void, length) } == 0 {
            let stream = UnixStream::from(fd);
            stream.set_nonblocking(false)?;
            return Ok(stream);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::Interrupted {
            continue;
        }
        if error.kind() == std::io::ErrorKind::WouldBlock {
            // Unix-domain backlog saturation returns EAGAIN without initiating
            // a connection. Retrying this owned socket is safe; SO_ERROR alone
            // would misleadingly report zero for this never-connected socket.
            std::thread::sleep(
                Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now())),
            );
            continue;
        }
        if error.raw_os_error() != Some(IN_PROGRESS) {
            return Err(error);
        }
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .filter(|remaining| !remaining.is_zero())
                .ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::TimedOut, "helper connect timed out")
                })?;
            let mut wait = PollFd {
                fd: fd.as_raw_fd(),
                events: 4,
                revents: 0,
            };
            let millis = remaining
                .as_millis()
                .saturating_add(1)
                .min(c_int::MAX as u128) as c_int;
            let ready = unsafe { poll(&mut wait, 1, millis) };
            if ready == 0 {
                continue;
            }
            if ready < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            let mut status: c_int = 0;
            let mut size = std::mem::size_of_val(&status) as u32;
            if unsafe {
                getsockopt(
                    raw,
                    SOL_SOCKET,
                    SO_ERROR,
                    &mut status as *mut _ as *mut c_void,
                    &mut size,
                )
            } < 0
            {
                return Err(std::io::Error::last_os_error());
            }
            if status != 0 {
                return Err(std::io::Error::from_raw_os_error(status));
            }
            let stream = UnixStream::from(fd);
            stream.set_nonblocking(false)?;
            return Ok(stream);
        }
    }
}

fn exchange(mut stream: UnixStream, json: &str) -> Result<(), String> {
    if json.len() >= MAX_FRAME {
        return Err("helper request too large".into());
    }
    let request = format!("{json}\n");
    let write_deadline = Instant::now() + Duration::from_secs(1);
    let mut remaining = request.as_bytes();
    let written = (|| -> Result<(), String> {
        while !remaining.is_empty() {
            let time = write_deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
                .ok_or("send: timed out")?;
            stream
                .set_write_timeout(Some(time))
                .map_err(|e| format!("send timeout: {e}"))?;
            match stream.write(remaining) {
                Ok(0) => return Err("send: helper closed the connection".into()),
                Ok(count) => remaining = &remaining[count..],
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => (),
                Err(e) => return Err(format!("send: {e}")),
            }
        }
        Ok(())
    })();
    // An overloaded helper may send its explicit rejection before reading our
    // request, then close. Read that response even if our write hit BrokenPipe.
    let response = read_response(&mut stream);
    if response.as_ref().is_err_and(|error| error == BUSY) {
        return response;
    }
    written?;
    response
}

fn read_response(stream: &mut UnixStream) -> Result<(), String> {
    let deadline = Instant::now() + RESPONSE_TIMEOUT;
    let mut bytes = Vec::new();
    let mut chunk = [0; 1024];
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or("read response: timed out")?;
        if let Err(error) = stream.set_read_timeout(Some(remaining)) {
            // macOS can reject SO_RCVTIMEO with EINVAL after the helper has
            // closed its write side, even while response bytes remain queued.
            // Reading can no longer wait for more peer data in that state, so
            // preserve the protocol-level EOF/framing error. Other socket
            // option failures still abort the exchange.
            if error.kind() != std::io::ErrorKind::InvalidInput {
                return Err(format!("read timeout: {error}"));
            }
        }
        let count = match stream.read(&mut chunk) {
            Ok(0) => return Err("read response: helper closed before a complete response".into()),
            Ok(count) => count,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(format!("read response: {e}")),
        };
        let newline = chunk[..count].iter().position(|&b| b == b'\n');
        let used = newline.map_or(count, |index| index + 1);
        if bytes.len() + used > MAX_FRAME {
            return Err("helper response too large".into());
        }
        bytes.extend_from_slice(&chunk[..used]);
        if newline.is_some() {
            break;
        }
    }
    let parsed: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid helper response: {e}"))?;
    if parsed.get("ok").and_then(serde_json::Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(parsed
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("helper command failed")
            .to_string())
    }
}

fn retry_busy(
    mut attempt: impl FnMut() -> Result<(), String>,
    mut pause: impl FnMut(Duration),
) -> Result<(), String> {
    for index in 0..3 {
        match attempt() {
            Err(error) if error == BUSY && index < 2 => {
                pause(Duration::from_millis(150 * (index + 1)))
            }
            result => return result,
        }
    }
    unreachable!("the third attempt always returns")
}

pub fn send(
    json: &str,
    mut connect: impl FnMut() -> Result<UnixStream, String>,
) -> Result<(), String> {
    retry_busy(|| exchange(connect()?, json), std::thread::sleep)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_local_listen_backlog_is_a_bounded_connection_failure() {
        use std::os::fd::AsRawFd;
        unsafe extern "C" {
            fn listen(fd: i32, backlog: i32) -> i32;
        }
        let path = std::path::Path::new("/tmp").join(format!(
            "amh-{}-{:x}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
        // This only changes the backlog of our temporary test socket.
        assert_eq!(unsafe { listen(listener.as_raw_fd(), 1) }, 0);
        let mut connected = Vec::new();
        let mut saturated = false;
        for _ in 0..8 {
            match connect_with_timeout(&path, Duration::from_millis(20)) {
                Ok(stream) => connected.push(stream),
                Err(error) => {
                    assert!(matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::ConnectionRefused
                    ));
                    saturated = true;
                    break;
                }
            }
        }
        assert!(saturated);
        let started = Instant::now();
        assert!(matches!(
            connect_with_timeout(&path, Duration::from_millis(30))
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::ConnectionRefused
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
        drop(connected);
        drop(listener);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn only_exact_predispatch_busy_is_retried_and_backoff_is_bounded() {
        let mut calls = 0;
        let mut delays = Vec::new();
        let result = retry_busy(
            || {
                calls += 1;
                if calls < 3 {
                    Err(BUSY.into())
                } else {
                    Ok(())
                }
            },
            |delay| delays.push(delay),
        );
        assert!(result.is_ok());
        assert_eq!(calls, 3);
        assert_eq!(
            delays,
            vec![Duration::from_millis(150), Duration::from_millis(300)]
        );
        for reason in [
            "read response: timed out",
            "send: broken pipe",
            "token mismatch",
            "helper_busy: details",
            "",
        ] {
            let mut attempts = 0;
            assert!(retry_busy(
                || {
                    attempts += 1;
                    Err(reason.into())
                },
                |_| panic!("must not retry uncertain outcome")
            )
            .is_err());
            assert_eq!(attempts, 1);
        }
    }
    #[test]
    fn repeated_busy_stops_after_three_attempts() {
        let mut calls = 0;
        assert_eq!(
            retry_busy(
                || {
                    calls += 1;
                    Err(BUSY.into())
                },
                |_| {}
            ),
            Err(BUSY.into())
        );
        assert_eq!(calls, 3);
    }
    #[test]
    fn overload_response_is_read_even_after_request_write_fails() {
        let (client, mut server) = UnixStream::pair().unwrap();
        server
            .write_all(b"{\"ok\":false,\"error\":\"helper_busy\"}\n")
            .unwrap();
        server.shutdown(std::net::Shutdown::Read).unwrap();
        assert_eq!(exchange(client, "{\"cmd\":\"disable\"}"), Err(BUSY.into()));
    }
    #[test]
    fn incomplete_response_is_not_success_or_retryable() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            let mut request = [0; 256];
            let _ = server.read(&mut request);
            server.write_all(b"{\"ok\":true}").unwrap();
        });
        let error = exchange(client, "{}").unwrap_err();
        assert!(error.contains("complete response"));
        writer.join().unwrap();
    }
    #[test]
    fn successful_response_preserves_the_existing_protocol() {
        let (client, mut server) = UnixStream::pair().unwrap();
        let writer = std::thread::spawn(move || {
            let mut request = [0; 256];
            let count = server.read(&mut request).unwrap();
            assert_eq!(&request[..count], b"{\"cmd\":\"ping\"}\n");
            server.write_all(b"{\"ok\":true}\n").unwrap();
        });
        assert!(exchange(client, "{\"cmd\":\"ping\"}").is_ok());
        writer.join().unwrap();
    }
}
