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
