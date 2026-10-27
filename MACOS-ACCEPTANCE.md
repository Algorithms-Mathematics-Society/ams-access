# MAC-01–MAC-10 acceptance handoff

Owner for native verification: @Rasesh2005. These issues stay open until the
required GUI evidence is recorded. Linux unit tests and browser fixtures do not
establish macOS installation, permission, kiosk or hardware behavior. Record the
commit, app version, macOS version, architecture and installation route for each run.
Use synthetic contest accounts. Never include passwords or support capabilities.

## MAC-01 / #196: installation and identity

The release workflow now verifies the final Mac bundle before collecting it for
publication: expected version, bundle ID, CPU slice, Developer ID signing team,
strict signature verification and Gatekeeper assessment. A rejected check stops
publication. The four portable regression cases exercise rejection paths; actual
Apple signing/assessment still requires the macOS release runner.

GUI checklist:
- [ ] Download the intended release normally, keep Gatekeeper/quarantine intact,
      install into Applications and launch as a standard user.
- [ ] Repeat clean installation and upgrade on every advertised architecture.
- [ ] Open via Applications, Spotlight and an existing Dock shortcut; Settings
      must show the expected version and the same installed app must open.
- [ ] Opening directly from the DMG should give the existing move-to-Applications
      guidance. Do not use quarantine removal or ad-hoc signing to pass this test.
- [ ] Interrupt a download, retry through the official route and verify a usable
      final installer. Record any prompt or launch failure exactly.

Technical evidence, if needed: run `python3 scripts/verify-macos-release.py`
with `--app`, `--version`, `--arch` (`arm64` or `x86_64`) and `--team` matching the
release. It only inspects the bundle; it does not alter security settings.
Apple's verification guidance: https://developer.apple.com/library/archive/technotes/tn2206/

Scale: build-time validation adds no candidate requests or runtime polling.

## MAC-02 / #197: signed-out exit

Welcome and Login now show a Mac-only Quit button. It calls local native shutdown,
which retains the existing restoration path; no login or API request is needed.
Concurrent clicks are coalesced. Native refuses the idle action during an active
exam or an in-progress lifecycle transition. Windows/Linux/browser controls are
unchanged. Component regressions cover platform gating, duplicate clicks and
readable refusal. Native Cmd+Q/menu/window-close acceptance remains required.

GUI checklist:
- [ ] On Welcome and Login, turn connectivity off and click Quit; the app exits,
      Dock/menu bar/input work, and reopening is usable without signing in.
- [ ] Repeat with Cmd+Q, application-menu Quit and the window close control.
- [ ] From Home, setup failure, approval wait, active contest, reconnect and Finish,
      exercise each existing exit control; the correct confirmation is retained.
- [ ] Close a Reference/help modal and then exit; repeat three enter/exit cycles.
- [ ] Verify no duplicate finish submission, stranded fullscreen or required login
      after an offline/failed cleanup. Capture any restore guidance.

Scale: one cached platform lookup and one local IPC per click; no backend traffic.

## MAC-03 / #198: fullscreen and focus recovery

Timed-out AppKit dispatch now cancels work that has not begun. Previously a
queued operation could run after its caller timed out and started recovery.
Already-running native calls cannot be interrupted; a timeout still means
unverified, never successful. Three portable tests cover cancellation, single
execution and start/cancel races. Actual window transitions need a Mac.

GUI checklist:
- [ ] Enter from a normal window and a macOS fullscreen Space; verify one visible,
      usable contest window, with editor and dialogs above the correct surface.
- [ ] Trigger failed setup/entry, then Back to contests; Dock, menu bar, switching,
      window movement and fullscreen controls work again.
- [ ] Repeat rapid entry/cancel/exit three times; no late refocus or return to kiosk.
- [ ] Request a missing permission; its prompt or recovery guidance stays reachable.
- [ ] Connect an unsupported extra display; read the guidance, correct it, retry,
      and exit without a stranded black/off-screen window.

Scale: local atomic state per dispatched job; no backend requests or new polling.

## MAC-04 / #199: retired network-lockdown check and legacy cleanup

This issue was already closed for feature removal. It is not reopened here.
The fetched main still contains the old enforcement path; full removal is separate
work and must not be claimed shipped from this branch. This change only makes Mac
helper uninstall clear its existing scoped rules before stopping/deleting the
service. Failed cleanup retains the helper for recovery and reports the error.
It does not disable PF globally, flush other anchors or reintroduce enforcement.

GUI checklist (use a disposable Mac profile/device for legacy-helper cases):
- [ ] Upgrade from a build with the helper installed. Restore settings, uninstall
      the helper, then verify ordinary internet access and a clean app restart.
- [ ] Cancel the administrator prompt; the app stays usable and reports failure.
- [ ] With a recorded lockdown but unavailable helper, uninstall must fail visibly,
      not claim successful restoration. Restore the helper before retrying.
- [ ] On the eventual removal build, setup must not block on Network Lockdown or
      ask to install a network helper. Verify other firewall rules remain intact.

Validation: inspected the helper disable/marker lifecycle and native Rust formatting.
Native administrator/PF behavior requires Mac acceptance. No new polling or API load.

## MAC-05 / #200: contextual optional microphone permission

Mac startup now requests camera only. The optional microphone check asks native
TCC for audio permission when reached, waits for its result before opening audio,
and retains the existing continue-with-warning path on denial/timeout. Leaving
the stage before the response prevents late stream acquisition. Native waiting
runs off the main thread with a 60-second bound. Other OS permission paths retain
their existing behavior. Native TCC requires Mac CI and device verification.

GUI checklist:
- [ ] In a clean standard-user profile, launch: no unsolicited microphone prompt
      on Welcome/Login; camera permission remains available.
- [ ] Reach Microphone check, allow the prompt, and see audio activity. Deny in a
      separate clean profile: Continue without microphone remains available.
- [ ] Leave the stage while its prompt is open; answering later must not reopen
      audio, advance another page or leave a recording indicator on.
- [ ] Revoke camera/Accessibility permissions in System Settings, retry, then
      grant and reopen when prompted; recovery must be actionable, not a loop.
- [ ] Upgrade the official app in place and verify granted permissions, Settings
      links and optional-mic behavior. Do not reset TCC to manufacture success.

Scale: one local bounded native request per microphone-check attempt, no API traffic.

## MAC-06 / #201: input regression coverage

The existing Mac shortcut table is now exercised directly by portable tests,
without changing its decisions. Coverage protects typing, undo/redo, selection,
word navigation, editor Escape and the contest clipboard policy, while preserving
blocked system shortcuts. This is regression coverage, not evidence that native
trackpad/IME/modal behavior has passed. No new runtime polling or requests.

GUI checklist:
- [ ] Type, select, undo/redo, indent and navigate code with the built-in keyboard
      and an external one; verify the caret stays visible during scrolling.
- [ ] Test permitted copy/paste and denied external paste separately. No draft
      disappears when switching questions or returning from a modal.
- [ ] Use autocomplete/search Escape, then help/Reference/finish modal controls;
      keyboard focus returns to the expected control/editor. Record modal Escape
      behavior explicitly, including whether native restrictions intercept it.
- [ ] Scroll statement/editor/results with the trackpad, select text, and test
      an IME/input source required by participants on actual hardware.
- [ ] After exit, system shortcuts and normal trackpad gestures are restored.

## MAC-07 / #202: delayed work cannot own the next session

Mac desktop entry and exit now advance a generation. The delayed kiosk reapply
belongs to the generation that scheduled it, so exit/re-entry on the same window
cannot make old work valid again. This addresses a concrete lifecycle race; the
reported blackout's cause is still unconfirmed. Existing recovery journals and
single-instance ownership remain intact. No backend changes or additional timers.

GUI checklist:
- [ ] Enter, exit immediately, and re-enter repeatedly; no delayed focus jump,
      off-screen window or fullscreen change belongs to the previous session.
- [ ] Sleep/wake during a synthetic contest: the window is usable, server time
      remains authoritative, drafts survive and reconnect does not duplicate work.
- [ ] After ordinary exit, sleep/wake again; AMS must not seize desktop focus.
- [ ] On a disposable test device, terminate the process during a synthetic
      contest, relaunch and inspect restoration. Record exact reproduction steps,
      native logs and the screen state for any blackout; do not call it resolved
      merely because reopening works.
- [ ] Launch a second installed copy during the first session; it must not alter
      the first session's controls or restoration ownership.

Validation: source-level lifecycle review and Rust formatting. AppKit/sleep/crash
acceptance still requires native CI and hardware; no claim of blackout reproduction.
