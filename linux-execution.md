# Linux execution plan

Status: A–F have local implementation and automated evidence. The pre-G review repairs are implemented locally on `linux/pre-phase-g-review-20261021`. **Do not treat previous 3.2.0 artifacts as validation of the newer review fixes.** Phase G local fault rehearsal is in progress for the v4.0.0 candidate; installed desktop and real backend acceptance remain open. Previous integrated checks passed: 684 web tests; 112 platform, 89 desktop, 43 core and 48 helper Rust tests; 47 packaging scenarios; web build/typecheck, formatting and Clippy.

Follow-up recovery validation: **689 web tests passed**, including five new regression scenarios; web typecheck and diff whitespace checks passed. Native and packaging checks above are from the preceding integrated run.

This is the implementation and acceptance plan. [audit-test.md](audit-test.md) is the incident briefing; [linux-review.md](linux-review.md) records each review finding, alternatives and disposition. Detailed historical material is preserved locally in [the execution archive](reports/linux-review/archive/execution-before-review.md); its statuses are historical. Logs and scratch captures under `reports/` are intentionally excluded from Git.

## Priorities before Phase G

1. Restore advisory entry behavior without weakening required policy or acknowledged review evidence.
2. Close late-operation and crash-recovery races; never remove another running instance's protections.
3. Correct desktop coverage/restoration and shared-lab journal behavior.
4. Verify monitor/camera recovery messages against actual probe semantics.
5. Run integrated tests, review the bounded changes, then build fresh candidate packages. Real desktop acceptance remains mandatory.

Shared backend capacity, synchronized start, admission timing and submission idempotency remain separate contest-wide release blockers. Linux repairs cannot establish those guarantees.

## Phase A — Reproduce and classify

- [x] Inspect October 21 chat evidence and distinguish source-confirmed defects from hypotheses about affected machines.
- [x] Capture native command, socket and rendered component fixtures without changing host desktop/firewall settings.
- [ ] Reproduce the reported Arch/Wayland Settings renderer freeze and Mint/Ubuntu capture failure on affected hardware.
- [ ] Record distro, desktop/session, WebKitGTK/GStreamer versions, camera class and exact artifact SHA. Do not collect candidate images or device serials in diagnostic logs.

## Phase B — No-face scan deadline and recovery

- [x] Bound no-face scanning; show Retry and an explicitly unverified review route; reject late callbacks from previous attempts.
- [x] Preserve a review request until session-bound evidence recording is acknowledged. A best-effort telemetry fix must not waive this requirement.
- [ ] Verify real camera/model inference, no-face deadline, retry and review delivery through installed Stage 8 → Stage 9 flow.

## Phase C — Onboarding policy and entry

- [x] Apply organizer policy to camera/display continuation and preserve unknown states rather than inventing success.
- [x] Keep keyboard guidance honest about aggregate versus individually verified coverage.
- [x] Restore advisory network/ordinary recorder behavior and preserve loaded waivers during a failed final refresh.
- [x] Separate cancellation, timeout and ownership transfer so late native work cannot undo a successful contest transition or survive an abandoned attempt unhandled.
- [x] Retain secure-start rollback through verification failure, timeout and cancellation; hold retry probes until late startup and cleanup settle. Regression fixtures exercise the actual final-entry callback.
- [ ] Exercise installed entry with slow DNS, denied helper authorization, failed recorder, stale/updated waivers, cancellation and retry. Required policy failures must still block.

## Phase D — Settings and cameras

- [x] Bound listing/acquisition/preview operations; retain actual native/browser ownership until requests settle.
- [x] Persist exact camera selection across Settings, onboarding and contest; prevent silent substitution.
- [x] Explain when a saved camera is unavailable and offer reconnect/reselection. Hidden IDs or a listing error are not proof it disappeared.
- [x] Preserve contest hotplug recovery after preview release and exhausted reopen retries, while Settings release and exam exit still stop automatic capture.
- [ ] Test RGB/IR devices, unplug/replug, changed IDs, denied permission, stalled frames, repeated navigation, and camera/mic indicators on real WebKit builds.
- [ ] Keep the Arch renderer-freeze investigation separate from a merely pending JavaScript promise; no speculative global GPU/portal workaround.

## Phase E — Desktop controls and safe restoration

- [x] Use live KDE shortcut APIs with journal-before-mutation and verified readback; separately handle KWin modifier-only Meta.
- [x] Determine coverage from discovered action families, not a fixed count of version-specific names. “Active” covers those controls, not every possible escape shortcut.
- [x] Isolate GNOME's bounded advisory work from the outer fatal probe status. A slow host may report partial coverage; required organizer policy remains authoritative.
- [x] Preserve exact overrides and later conflicting user changes. Ignore foreign legacy journals without deleting them; keep malformed owned recovery evidence strict.
- [x] Preserve touchpad settings; do not force-enable an intentionally disabled touchpad.
- [ ] Test Plasma 5/6 live Meta/KGlobalAccel behavior, GNOME partial timeout, conflicting changes, crash/relaunch and restoration in disposable desktop accounts.
- [ ] Cinnamon remains unsupported until a separate adapter and acceptance matrix pass; one workspace does not prove gesture prevention.

## Phase F — Packaging, permissions and recovery

- [x] Declare DEB/RPM media dependencies and pkexec correctly; share tested numeric/name-aware lifecycle hooks; enable AppImage media bundling.
- [x] Validate exact package resources and deterministic AppImage helper rewriting; retain artifact hashes. Previous local DEB/RPM container install/remove checks passed.
- [x] Serialize Linux network mutation/recovery, invalidate stale preparation, and recover with the saved token before login under single-instance ownership.
- [x] Retain failed recovery state for explicit retry; never blindly flush another session's firewall.
- [ ] Build fresh DEB/RPM/AppImage after review fixes. Run payload validators and Ubuntu/Fedora install/remove checks on those exact candidates; previous artifacts are historical.
- [ ] Confirm launcher/webview, model/WASM, actual camera access, logind uaccess and authorization UI on supported desktops.
- [ ] Test helper upgrade, crashes followed by a network/hotspot change, failed cleanup, token mismatch, absent daemon, repeated recovery and duplicate GUI launches in an isolated VM.
- [ ] Test DNS/API traffic and IPv6 neighbor/router discovery, DHCPv6 and path-control behavior with real packet evidence. Source rule tests are insufficient.
- [ ] AppImage deletion does not uninstall its helper. Test/document administrator removal; the bundled dedicated polkit policy remains unused by the current installer.

## Distro acceptance matrix

| Target                           | Required checks                                                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ubuntu 22.04 build baseline      | CI build and all-format payload checks; no inference from a newer local build                                                                                           |
| Ubuntu 24.04 / Debian / Mint DEB | Dependency resolution with recommends disabled and daemon-only polkitd preinstalled; launcher, GIO/GTK/WebKit, logind camera access, install/remove and helper recovery |
| Fedora RPM                       | Current repository package names, scriptlet install/upgrade/remove counts, SELinux desktop behavior, media plugins and helper lifecycle                                 |
| Arch/Kubuntu/Fedora KDE          | Plasma 5/6 action inventories, KWin Meta reconfigure, live shortcuts and exact restoration on Wayland/X11 where supported                                               |
| Ubuntu/Fedora GNOME              | Installed schemas/writability, override absence, partial deadline, touchpad/overview behavior and conflict-safe restoration                                             |
| Mint Cinnamon                    | Honest unsupported keyboard guidance; no GNOME coverage claim                                                                                                           |
| AppImage on supported desktops   | Bundled V4L2/plugin loadability, runtime compatibility, camera/model path, helper installation/removal and ordinary launcher startup                                    |

Primary references: [Tauri AppImage](https://tauri.app/distribute/appimage/), [WebKitGTK multimedia](https://docs.webkit.org/Ports/WebKitGTK%20and%20WPE%20WebKit/Multimedia.html), [GStreamer V4L2](https://gstreamer.freedesktop.org/documentation/video4linux2/v4l2src.html). Distribution/package configuration establishes prerequisites, not runtime success.

## Phase G — End-to-end rehearsal (in progress)

- [x] Prepare a v4.0.0 release checkout including all team commits through `3288672`; reconcile camera picker/storage ownership and retain failed-cleanup recovery.
- [ ] Complete backend capacity/fairness acceptance, including late arrival and short contests. Source review confirmed that the former 150-second post-start delay loses working time against the fixed backend deadline; the v4 candidate removes this unfair wait. Client-only deadline extension is not valid. See `release-v4.0.0.md` for the isolated backend prerequisites and alternatives.
- [x] Run local synthetic browser fault checks: contest 33 checks, login 36 checks, and onboarding scrolling at six viewport sizes. These do not establish real judge/native behavior.
- [x] Reproduce CI packaging failures against retained installers; fix strict RPM extraction compatibility and AppImage destination handling. Retained payload checks and clean Ubuntu DEB installation/removal pass; final CI/release artifact acceptance remains open. See `release-v4.0.0.md` for hashes and scope.
- [ ] Run a staging roster and fault rehearsal: login → checks → capture/review → entry → Run → Submit → Finish → verified restoration.
- [ ] Validate real retry/backoff, 4xx/429/5xx behavior, stored-token restart and submission idempotency with backend evidence.
- [ ] Exercise denied authorization, advisory warnings, required failures, cancellation/retry, crashes and network changes for each supported tuple.
- [ ] Approve a support matrix and candidate/invigilator instructions tied to exact artifact hashes; publish only after release gates pass.

## Review and evidence rules

Preserve unrelated edits, stage explicit files/hunks, and review source by concern. Earlier A–F edits overlap; do not invent historical per-phase commits or claim that a reconstructed intermediate tree was tested. Keep source fixes, packaging and documentation reviewable, with the final integrated test result attached.

Run web tests/typecheck and the affected Rust suites. Installer mocks never target host paths. Actual installer/helper/desktop trials belong in disposable containers/VMs or explicitly prepared accounts. Each acceptance record needs the commit/artifact SHA, environment, expected/observed result, original-setting restoration result, and remaining uncertainty.
