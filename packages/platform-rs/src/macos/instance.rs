//! One AMS Access per user. Startup restores whatever a crashed exam left
//! behind, and a second copy (`open -n`, or one run from the disk image while
//! another runs from Applications) would do that under a live exam and lift
//! its firewall and trackpad lock. The lock is an flock, so the kernel drops it
//! when the owner dies, and Rust opens files close-on-exec, so the watchdog the
//! app spawns never inherits it.

use std::fs::File;
use std::io::{Read, Seek, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

const LOCK_EX: i32 = 2;
const LOCK_NB: i32 = 4;
const EWOULDBLOCK: i32 = 35;

extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

pub enum Refused {
    /// Another instance holds the lock; its pid when it wrote one.
    Running(Option<u32>),
    /// The lock file could not be opened or locked at all.
    Failed(String),
}

/// Hold the instance lock for the app's lifetime. `wait` covers a relaunch,
/// where the old process may still be exiting when the new one starts.
pub fn acquire(wait: Duration) -> Result<File, Refused> {
    let dir = super::system_settings::state_dir()
        .ok_or_else(|| Refused::Failed("HOME is not set".into()))?;
    acquire_at(&dir.join("instance.lock"), wait)
}

fn acquire_at(path: &Path, wait: Duration) -> Result<File, Refused> {
    let failed = |error: std::io::Error| Refused::Failed(error.to_string());
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(failed)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)
        .map_err(failed)?;
    let deadline = Instant::now() + wait;
    while unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(EWOULDBLOCK) {
            return Err(failed(error));
        }
        if Instant::now() >= deadline {
            let mut text = String::new();
            let _ = file.read_to_string(&mut text);
            return Err(Refused::Running(text.trim().parse().ok()));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // The pid lets a second launch bring this window forward.
    let _ = file
        .set_len(0)
        .and_then(|()| file.rewind())
        .and_then(|()| write!(file, "{}", std::process::id()));
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_owner_is_refused_with_the_first_pid_then_reacquires() {
        let dir = std::env::temp_dir().join(format!("ams-mac-instance-{}", std::process::id()));
        let path = dir.join("instance.lock");
        let first = acquire_at(&path, Duration::ZERO).ok().unwrap();
        match acquire_at(&path, Duration::from_millis(250)) {
            Err(Refused::Running(pid)) => assert_eq!(pid, Some(std::process::id())),
            _ => panic!("a second owner must be refused"),
        }
        drop(first);
        assert!(acquire_at(&path, Duration::ZERO).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
