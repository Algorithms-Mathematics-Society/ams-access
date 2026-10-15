# Windows low-level keyboard hook diagnostics and renewal

`platform_rs::windows::keyboard_hook_delivery_diagnostics()` reports passive
callback evidence for the current enable lifecycle: callback count, monotonic
last-callback time and age, and one of these snake_case states:

- `installed_unverified`: installation succeeded, but this lifecycle has no
  observed callback. Expected while idle; not a failure.
- `callback_observed_recently` / `callback_observed_stale`: a callback was
  delivered. Stale means no callback within the 30-second freshness window,
  not that Windows removed the hook.
- `starting`: the owner startup handshake is in progress.
- `thread_dead`: the lifecycle is active but its owner exited. Its lifecycle
  watchdog attempts a restart on the next five-second check.
- `install_failed`: initial installation or the latest renewal failed. On a
  renewal failure the prior handle remains as best-effort protection, readiness
  is false, and renewal retries after five seconds. Success clears this state.
- `inactive`: interception is not requested.

Counters reset on a new enable lifecycle. Cancelled callbacks pass through and
cannot intercept for, or increment the counters of, a replacement lifecycle.
Enable/disable operations are serialized, and each owner/watchdog holds only its
own session state. Cancellation during installation retires the returned handle
without publishing readiness. No input probes are generated.

## Recovery limits

Microsoft documents that a timed-out low-level hook may be silently removed
while its owner thread remains alive, and that applications cannot query whether
this occurred. A thread ID and a successful past installation are insufficient
proof of current delivery. See [LowLevelKeyboardProc remarks](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelkeyboardproc#remarks).

The owning thread therefore installs a replacement every five seconds,
independently of input activity, then retires the previous handle. This limits
exposure to silent removal under normal scheduling; it is mitigation, not a
health detector or uninterrupted-interception guarantee. Scheduler delays,
suspended threads, a blocked callback, OS/API failures, and repeated removals can
extend the interval. A bounded message batch prevents posted-message traffic
from indefinitely delaying the next deadline. The message-aware wait wakes for
input and checks cancellation within 50 ms while idle. Neither idle callbacks
nor diagnostic freshness trigger recovery.

The desktop read-only IPC command exposes the snapshot:

```javascript
await window.__TAURI__.core.invoke("get_windows_hook_diagnostics");
```

Other platforms return `null`. Consumers should treat `install_failed`,
`thread_dead`, or `starting` during a secured session as degraded protection.
Recent callbacks and successful renewals attest past events only. Diagnostics
contain no key codes or candidate input.

## Verification and remaining VM gates

Deterministic fake-adapter tests simulate silent OS removal while the owner is
alive and its installation flag is stale, idle renewal, replacement failure and
bounded retry, cancellation during initial install/renewal, and stale-owner
cleanup after a replacement lifecycle begins. These tests never install real
hooks, call `SendInput`, or manipulate the host keyboard/desktop.

Physical timeout removal and recovery have not been reproduced on Windows by
this change. Qualification still requires disposable Windows 10/11 VMs with a
snapshot, no active exam, and console/recovery access:

1. Record OS/build, app build and timestamped diagnostic transitions. Establish
   delivery with ordinary manually typed input in the VM.
2. Reproduce timeout removal using a separately reviewed VM-only fault-injection
   method; never add callback blocking or input injection to production or CI.
3. Measure actual recovery delay and manually confirm delivery resumes after
   renewal. Idle time alone cannot establish failure or recovery.
4. Qualify repeated enable/disable, delayed startup, denied initial/replacement
   installation, sleep/resume, owner exit, message traffic, and normal shortcuts
   across renewal boundaries. Check degradation reaches the session policy.
5. Save measurements without key data and restore the VM snapshot.
