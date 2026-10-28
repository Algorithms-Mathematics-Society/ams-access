# Combined post-4.8 fixes

One commit combines the pending Windows retry fixes, Wi-Fi removal and Mac follow-ups.
The v4.8.0 tag and its release notes remain unchanged; these app changes belong to the next release.

## Changes

- Remove Wi-Fi controls, native scan/join commands, their platform modules and the Mac Location permission step/usage declarations. Keep firewall restoration and helper uninstall recovery.
- Show the disconnected dialog after 12 seconds of continuously observed disconnection, with Check Again and Exit Contest. Browser offline events start this immediately; a server-only outage is first detected by the existing heartbeat cadence. This is not a guarantee of 12 seconds from an unobserved failure.
- Preserve draft saving, the running timer, local desktop restoration and existing resume approval rules.
- Home probes the camera only. Microphone status remains unverified until an explicit microphone check; Home no longer prompts for audio access (MAC-05).
- Block all external editor pastes, including short text copied before entry. Exact internal copy/cut and sample-button copies remain allowed. Clear clipboard provenance on session change/unmount; no clipboard content is sent to the audit service (MAC-06).
- MAC-04 already clears firewall rules before helper uninstall and returns on failure. Added a regression guard; no helper removal behavior was weakened.
- Retain server retry headers, spread healthy approval polls over 3–4 seconds, and coalesce repeated pending manual heartbeat requests.

## Validation

Web suite: 134 test files passed. Typecheck, version consistency, desktop safety tests (13), core-rs tests (43) and platform-rs clippy pass. Platform tests: 127 passed; four Unix-socket tests cannot run in this sandbox (socket creation is denied). Native Mac/Windows compilation and GUI acceptance remain required in CI/on devices.

The disconnect delay uses one local timer and adds no polling. Retry tests cover 3,000 waiters/clicks; timer tests cover teardown of 3,000 workspaces. Clipboard provenance retains only one internal copy. No production-scale rehearsal is claimed. At 3,000 approval waiters, the existing 3–4-second polling permits up to 1,000 reads/second before response time; staging must validate that capacity.

## GUI acceptance

- [ ] No Wi-Fi control on the contest toolbar or disconnected popup, and no Mac Location prompt during entry.
- [ ] Disconnect: popup after about 12 seconds from detected offline state. Reconnect sooner: no stale popup. Check Again recovers and repeated clicks share one pending request.
- [ ] Exit Contest while offline restores desktop access. Connect with OS settings, reopen/resume with required approval, and check draft/timer. Exit must not act as Finish.
- [ ] On a Mac with microphone permission reset, Home and its setup scan do not prompt for microphone. The Microphone step does; allow, deny and skip paths work. Explicit Settings microphone testing still works.
- [ ] Copy short text and multiline code outside the app before entry: Cmd-V/menu paste into the editor inserts neither and displays a notice. Copy/cut within the editor and sample Copy still paste; switching problems preserves legitimate in-session copies. Exit and re-enter: old clipboard provenance does not carry over.
- [ ] On a dedicated Mac with the old helper installed, uninstall after clearing rules and confirm ordinary connectivity. A forced cleanup failure must leave the helper installed for recovery. Do not perform this destructive fixture on a contest machine.

Attach build SHA and native results to #199, #200 and #201; testers close those issues manually.
