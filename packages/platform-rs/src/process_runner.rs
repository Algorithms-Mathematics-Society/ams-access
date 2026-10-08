//! Synchronous subprocesses with real child deadlines, bounded output, and no
//! detached pipe-reader threads. Also included by the Unix network helper.
use std::cell::{Cell, RefCell};
use std::io::{self, Read, Write};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::time::{Duration, Instant};

pub const MAX_OUTPUT: usize = 1024 * 1024;
const MAX_INPUT: usize = 64 * 1024;
thread_local! {
    static DEADLINE: Cell<Option<Instant>> = const { Cell::new(None) };
    static FAILURE: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Nested command groups share the earlier deadline. Native OS APIs and file
/// reads are not interruptible through this subprocess budget.
pub struct Budget {
    previous_deadline: Option<Instant>,
    previous_failure: Option<String>,
    _thread: std::marker::PhantomData<std::rc::Rc<()>>,
}
impl Budget {
    pub fn new(timeout: Duration) -> Self {
        let requested = Instant::now() + timeout;
        Self {
            previous_deadline: DEADLINE.with(|slot| {
                let previous = slot.get();
                slot.set(Some(previous.map_or(requested, |old| old.min(requested))));
                previous
            }),
            previous_failure: FAILURE.with(|slot| slot.borrow_mut().take()),
            _thread: std::marker::PhantomData,
        }
    }
    pub fn failure(&self) -> Option<String> {
        FAILURE.with(|slot| slot.borrow().clone())
    }
    pub fn expired(&self) -> bool {
        let expired = DEADLINE.with(|slot| slot.get().is_some_and(|end| Instant::now() >= end));
        if expired {
            FAILURE.with(|slot| {
                if slot.borrow().is_none() {
                    *slot.borrow_mut() = Some("native scan budget exhausted".into());
                }
            });
        }
        expired
    }
}
impl Drop for Budget {
    fn drop(&mut self) {
        DEADLINE.with(|slot| slot.set(self.previous_deadline));
        FAILURE.with(|slot| {
            if let Some(previous) = self.previous_failure.take() {
                *slot.borrow_mut() = Some(previous);
            }
        });
    }
}

/// The failure a probe has recorded so far on this thread, if any.
///
/// `optional` throws the reason away along with the failure, which is the
/// right default for a probe nobody is waiting on. A caller that reports
/// per-probe status needs the reason as well as the isolation, and reading
/// the slot from inside an `optional` block is how it gets both: the value
/// is observed before the restore wipes it.
pub fn current_failure() -> Option<String> {
    FAILURE.with(|slot| slot.borrow().clone())
}

pub fn optional<T>(work: impl FnOnce() -> T) -> T {
    struct RestoreFailure(Option<String>);
    impl Drop for RestoreFailure {
        fn drop(&mut self) {
            FAILURE.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _restore = RestoreFailure(FAILURE.with(|slot| slot.borrow().clone()));
    work()
}

pub trait CommandDeadlineExt {
    fn bounded_output(&mut self) -> io::Result<Output>;
    fn bounded_status(&mut self) -> io::Result<ExitStatus>;
    /// Required probes must distinguish an unsuccessful command from a clean,
    /// empty result. Queries where nonzero means "absent" use bounded_output.
    fn bounded_checked_output(&mut self) -> io::Result<Output>;
    fn bounded_output_with_timeout(&mut self, timeout: Duration) -> io::Result<Output>;
}
impl CommandDeadlineExt for Command {
    fn bounded_output(&mut self) -> io::Result<Output> {
        output(self, Duration::from_secs(3), None)
    }
    fn bounded_checked_output(&mut self) -> io::Result<Output> {
        let out = self.bounded_output()?;
        if out.status.success() {
            Ok(out)
        } else {
            let message = format!(
                "{} exited unsuccessfully ({})",
                self.get_program().to_string_lossy(),
                out.status
            );
            record_failure(message.clone());
            Err(io::Error::other(message))
        }
    }
    fn bounded_status(&mut self) -> io::Result<ExitStatus> {
        self.bounded_output().map(|out| out.status)
    }
    fn bounded_output_with_timeout(&mut self, timeout: Duration) -> io::Result<Output> {
        output(self, timeout, None)
    }
}

#[cfg(unix)]
mod native {
    use super::*;
    use std::os::fd::AsRawFd;
    use std::os::unix::process::CommandExt;
    unsafe extern "C" {
        fn fcntl(fd: i32, command: i32, ...) -> i32;
        fn kill(pid: i32, signal: i32) -> i32;
    }
    #[cfg(target_os = "macos")]
    const NONBLOCK: i32 = 0x4;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: i32 = 0x800;

    pub fn prepare(command: &mut Command) {
        command.process_group(0);
    }
    pub fn nonblocking(pipe: &impl AsRawFd) -> io::Result<()> {
        // SAFETY: the borrowed pipe keeps this valid descriptor open; fcntl
        // operates only on its flags and does not retain any Rust pointers.
        let flags = unsafe { fcntl(pipe.as_raw_fd(), 3) };
        if flags < 0 || unsafe { fcntl(pipe.as_raw_fd(), 4, flags | NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    pub struct Group(i32);
    impl Group {
        pub fn attach(child: &Child) -> io::Result<Self> {
            Ok(Self(child.id() as i32))
        }
        pub fn terminate(&self) {
            // SAFETY: the child was spawned in a new group whose id is its pid.
            // A negative pid targets only that owned group, never our process.
            unsafe {
                kill(-self.0, 9);
            }
        }
    }
    pub fn read(pipe: &mut (impl Read + AsRawFd), buf: &mut [u8]) -> io::Result<usize> {
        pipe.read(buf)
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Pipes::PeekNamedPipe;

    pub fn prepare(_command: &mut Command) {}
    pub fn nonblocking(_pipe: &impl AsRawHandle) -> io::Result<()> {
        Ok(())
    }
    pub struct Group(HANDLE);
    impl Group {
        pub fn attach(child: &Child) -> io::Result<Self> {
            // SAFETY: owned handles/initialized structures are valid for these
            // synchronous APIs; the job is closed on every path.
            unsafe {
                let handle = CreateJobObjectW(None, None).map_err(io::Error::other)?;
                let group = Self(handle);
                let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &limits as *const _ as *const std::ffi::c_void,
                    std::mem::size_of_val(&limits) as u32,
                )
                .map_err(io::Error::other)?;
                AssignProcessToJobObject(handle, HANDLE(child.as_raw_handle()))
                    .map_err(io::Error::other)?;
                Ok(group)
            }
        }
        pub fn terminate(&self) {
            unsafe {
                let _ = TerminateJobObject(self.0, 1);
            }
        }
    }
    impl Drop for Group {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    pub fn read(pipe: &mut (impl Read + AsRawHandle), buf: &mut [u8]) -> io::Result<usize> {
        let mut available = 0;
        // Peek prevents a synchronous anonymous-pipe ReadFile from blocking.
        if let Err(error) = unsafe {
            PeekNamedPipe(
                HANDLE(pipe.as_raw_handle()),
                None,
                0,
                None,
                Some(&mut available),
                None,
            )
        } {
            if error.code().0 as u32 & 0xffff == 109 {
                return Ok(0);
            }
            return Err(io::Error::other(error));
        }
        if available == 0 {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        let count = buf.len().min(available as usize);
        pipe.read(&mut buf[..count])
    }
}

struct Running {
    child: Child,
    group: Option<native::Group>,
}
impl Drop for Running {
    fn drop(&mut self) {
        if let Some(group) = &self.group {
            group.terminate();
        }
        let _ = self.child.kill();
        // Reap the direct child; no background waiter survives this operation.
        let _ = self.child.wait();
    }
}

#[cfg(unix)]
fn drain(pipe: &mut (impl Read + std::os::fd::AsRawFd), bytes: &mut Vec<u8>) -> io::Result<bool> {
    drain_with(bytes, |buf| native::read(pipe, buf))
}
#[cfg(windows)]
fn drain(
    pipe: &mut (impl Read + std::os::windows::io::AsRawHandle),
    bytes: &mut Vec<u8>,
) -> io::Result<bool> {
    drain_with(bytes, |buf| native::read(pipe, buf))
}
fn drain_with(
    bytes: &mut Vec<u8>,
    mut read: impl FnMut(&mut [u8]) -> io::Result<usize>,
) -> io::Result<bool> {
    let mut chunk = [0; 8192];
    // Do not let an endlessly chatty child starve deadline checks.
    for _ in 0..8 {
        match read(&mut chunk) {
            Ok(0) => return Ok(true),
            Ok(count) => {
                if bytes.len() + count > MAX_OUTPUT {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "native command output exceeded limit",
                    ));
                }
                bytes.extend_from_slice(&chunk[..count]);
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => return Ok(false),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => (),
            Err(e) => return Err(e),
        }
    }
    Ok(false)
}

/// Captures at most 1 MiB per output stream. Unix input is written without
/// blocking and capped at 64 KiB; Windows probes do not use stdin input.
/// Propagate required native/file probe failures to an enclosing readiness
/// budget, even when a compatibility return type cannot itself carry errors.
pub fn record_failure(error: impl Into<String>) {
    FAILURE.with(|slot| {
        let mut failure = slot.borrow_mut();
        if failure.is_none() {
            *failure = Some(error.into());
        }
    });
}

pub fn output(
    command: &mut Command,
    timeout: Duration,
    input: Option<&[u8]>,
) -> io::Result<Output> {
    let result = output_inner(command, timeout, input);
    if let Err(error) = &result {
        record_failure(format!(
            "{}: {error}",
            command.get_program().to_string_lossy()
        ));
    }
    result
}

fn output_inner(
    command: &mut Command,
    timeout: Duration,
    input: Option<&[u8]>,
) -> io::Result<Output> {
    if input.is_some_and(|bytes| bytes.len() > MAX_INPUT) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "native command input exceeded limit",
        ));
    }
    #[cfg(windows)]
    if input.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "stdin input is supported only for Unix helper commands",
        ));
    }
    let own_deadline = Instant::now() + timeout;
    let deadline = DEADLINE.with(|slot| {
        slot.get()
            .map_or(own_deadline, |outer| outer.min(own_deadline))
    });
    if Instant::now() >= deadline {
        return Err(io::Error::new(
            io::ErrorKind::TimedOut,
            "native command budget exhausted",
        ));
    }
    native::prepare(command);
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut running = Running {
        child: command.spawn()?,
        group: None,
    };
    running.group = Some(native::Group::attach(&running.child)?);
    let mut stdout_pipe = running.child.stdout.take().expect("piped stdout");
    let mut stderr_pipe = running.child.stderr.take().expect("piped stderr");
    native::nonblocking(&stdout_pipe)?;
    native::nonblocking(&stderr_pipe)?;
    let mut stdin_pipe = running.child.stdin.take();
    if let Some(pipe) = &stdin_pipe {
        native::nonblocking(pipe)?;
    }
    let mut written = 0;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut status = None;
    loop {
        let out_done = drain(&mut stdout_pipe, &mut stdout)?;
        let err_done = drain(&mut stderr_pipe, &mut stderr)?;
        if let Some(pipe) = &mut stdin_pipe {
            let bytes = input.unwrap_or_default();
            match pipe.write(&bytes[written..]) {
                Ok(count) => written += count,
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                    ) => {}
                Err(e) => return Err(e),
            }
            if written == bytes.len() {
                stdin_pipe = None;
            }
        }
        if status.is_none() {
            status = running.child.try_wait()?;
            if status.is_some() {
                // No background descendant may keep a captured pipe open after
                // its command exits. Owned group/job cleanup prevents that hang.
                if let Some(group) = running.group.take() {
                    group.terminate();
                }
                stdin_pipe = None;
            }
        }
        if let Some(status) = status {
            if out_done && err_done {
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "native command timed out and was terminated",
            ));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    fn shell(script: &str) -> Command {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", script]);
        cmd
    }
    #[test]
    fn captures_output_exit_and_stdin_without_reader_threads() {
        let out = output(
            &mut shell("cat; printf error >&2; exit 7"),
            Duration::from_secs(2),
            Some(b"hello"),
        )
        .unwrap();
        assert_eq!(out.stdout, b"hello");
        assert_eq!(out.stderr, b"error");
        assert_eq!(out.status.code(), Some(7));
    }
    #[test]
    fn required_nonzero_probe_propagates_failure_to_outer_budget() {
        let outer = Budget::new(Duration::from_secs(2));
        {
            let inner = Budget::new(Duration::from_secs(1));
            assert!(shell("printf partial; exit 7")
                .bounded_checked_output()
                .is_err());
            assert!(inner.failure().unwrap().contains("exited unsuccessfully"));
        }
        assert!(outer.failure().unwrap().contains("exited unsuccessfully"));
    }

    #[test]
    fn query_nonzero_exit_remains_available_for_absence_checks() {
        let budget = Budget::new(Duration::from_secs(2));
        let out = shell("exit 1").bounded_output().unwrap();
        assert_eq!(out.status.code(), Some(1));
        assert!(budget.failure().is_none());
    }

    #[test]
    fn hanging_child_is_terminated_and_reaped_at_deadline() {
        let started = Instant::now();
        let error =
            output(&mut shell("exec sleep 30"), Duration::from_millis(50), None).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn descendant_holding_pipe_does_not_delay_parent_exit() {
        let started = Instant::now();
        let out = output(
            &mut shell("sleep 30 & printf done"),
            Duration::from_secs(2),
            None,
        )
        .unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"done");
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn output_limit_terminates_a_chatty_child() {
        let error = output(&mut shell("exec yes x"), Duration::from_secs(2), None).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }
    #[test]
    fn nonreading_stdin_cannot_hold_the_caller_past_deadline() {
        let error = output(
            &mut shell("exec sleep 30"),
            Duration::from_millis(50),
            Some(&vec![b'x'; MAX_INPUT]),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }
    #[test]
    fn failed_nested_command_is_visible_to_the_outer_scan_budget() {
        let outer = Budget::new(Duration::from_secs(2));
        {
            let inner = Budget::new(Duration::from_millis(10));
            let _ = output(&mut shell("exec sleep 30"), Duration::from_secs(1), None);
            assert!(inner.failure().is_some());
        }
        assert!(outer.failure().unwrap().contains("timed out"));
    }
    #[test]
    fn optional_discovery_failure_does_not_hide_prior_or_create_new_scan_failure() {
        let budget = Budget::new(Duration::from_secs(2));
        optional(|| {
            let _ = output(
                &mut Command::new("/ams-nonexistent-tool"),
                Duration::from_millis(10),
                None,
            );
        });
        assert!(budget.failure().is_none());
        let _ = output(
            &mut Command::new("/ams-nonexistent-required-tool"),
            Duration::from_millis(10),
            None,
        );
        let previous = budget.failure().unwrap();
        optional(|| {
            let _ = output(
                &mut Command::new("/ams-another-missing-tool"),
                Duration::from_millis(10),
                None,
            );
        });
        assert_eq!(budget.failure(), Some(previous));
    }

    #[test]
    fn shared_budget_prevents_later_commands_from_starting() {
        let budget = Budget::new(Duration::from_millis(20));
        std::thread::sleep(Duration::from_millis(30));
        assert!(budget.expired());
        assert_eq!(
            output(&mut shell("exit 0"), Duration::from_secs(2), None)
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }
}

#[cfg(test)]
mod isolation_tests {
    use super::*;

    // A failure recorded by one probe lives in a thread-local the whole scan
    // shares. get_full_telemetry used to read that slot once at the end and
    // discard every result if it was set, so one probe took the rest down
    // with it -- including two that are pure reads and cannot fail. On macOS
    // that showed as five "The scan could not complete" items at once and an
    // operating system reported as "Not available".

    #[test]
    fn a_failure_inside_optional_does_not_escape_it() {
        let _budget = Budget::new(Duration::from_secs(5));
        optional(|| record_failure("one probe went wrong"));
        assert_eq!(
            current_failure(),
            None,
            "an isolated probe must not poison the shared slot"
        );
    }

    #[test]
    fn the_reason_is_readable_from_inside_the_isolation() {
        // Isolation alone is not enough: a card that says "unavailable"
        // without saying why is a quieter version of the same problem.
        let _budget = Budget::new(Duration::from_secs(5));
        let mut seen = None;
        optional(|| {
            record_failure("ps exited unsuccessfully");
            seen = current_failure();
        });
        assert_eq!(seen.as_deref(), Some("ps exited unsuccessfully"));
        assert_eq!(current_failure(), None, "and it still must not escape");
    }

    #[test]
    fn one_probe_failing_leaves_a_later_probe_reporting_clean() {
        let _budget = Budget::new(Duration::from_secs(5));
        optional(|| record_failure("first probe failed"));
        let mut second = None;
        optional(|| {
            second = current_failure();
        });
        assert_eq!(
            second, None,
            "the second probe must not inherit the first one's failure"
        );
    }
}
