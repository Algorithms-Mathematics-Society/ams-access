# Windows low-level keyboard hook diagnostics

`platform_rs::windows::keyboard_hook_delivery_diagnostics()` provides passive
callback-delivery evidence for the current hook lifecycle. Its serializable
snapshot reports callback count, the monotonic time and age of the most recently
observed callback, and one of these snake_case states:

- `installed_unverified`: installation is reported, but no callback has been
  observed in this lifecycle. This is expected while idle and is not a failure.
- `callback_observed_recently` / `callback_observed_stale`: at least one callback
  was delivered. “Stale” only means no callback arrived within the 30-second
  diagnostic freshness window; it does not mean the OS removed the hook.
- `starting`: the hook thread startup handshake is still in progress.
- `thread_dead`: startup has completed, but the hook thread is no longer
  registered while the lifecycle is active.
- `install_failed`: the hook installation API failed.
- `inactive`: interception is not active.

The callback count and timestamp reset at the start of a new enable lifecycle.
Each hook thread carries its session generation, so a delayed callback from an
older thread cannot increment the new session's counters.
No diagnostic state triggers recovery, reinstallation, input, or logging.
Callbacks continue through the existing nonblocking hook path; this telemetry
records delivery even for callbacks with negative hook codes and does not record
key codes or key data.

## Reading from the desktop app

In a test build with developer tools enabled, this read-only native command
returns the snapshot without installing a hook or generating keyboard input:

```javascript
await window.__TAURI__.core.invoke("get_windows_hook_diagnostics");
```

On other platforms it returns `null`. A recent callback is evidence of past
callback delivery, not a guarantee that interception remains effective now.

## Reproduction-first investigation

No silent OS hook removal has been reproduced by this change. There is no
in-process fault-injection harness: forcibly blocking a low-level hook callback
or manipulating real keyboard input can affect the developer's desktop and is
not safe for automated tests. Do not test by installing a real hook, using
`SendInput`, blocking the callback, or switching desktops on a normal developer
machine.

To investigate safely, use a disposable Windows VM with a snapshot, no active
exam session, and a second recovery path (for example, VM console access):

1. Record the app build, Windows version/build, session lifecycle, hook thread
   ID, `HOOK_INSTALLED`, and `keyboard_hook_delivery_diagnostics()` before the
   test. Do not include key codes or candidate input in logs.
2. First establish normal delivery through ordinary, manually typed input only
   in the disposable VM; verify the callback count advances. Avoid synthetic
   input tools.
3. Reproduce the suspected timeout/removal using a separately reviewed,
   narrowly scoped fault-injection method in that VM only. Do not add an
   injection mechanism to production or run such a test in CI.
4. After the suspected event, observe installation/thread flags and callback
   diagnostics while the VM is otherwise idle, then repeat ordinary manual
   input and check whether delivery resumes. Idle time alone cannot establish
   hook failure.
5. Save OS/build details and timestamped state transitions, then restore the
   VM snapshot. Only measured evidence should inform any future recovery design.

Until this controlled experiment demonstrates a specific failure mode, the
existing callback queue, install handshake, and watchdog behavior remain
unchanged. These diagnostics do not guarantee hook liveness during idle time.
