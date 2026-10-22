# Phase G acceptance: candidate, invigilator and evidence checklist

Status: **in progress for published v4.0.1**. Public artifact distribution was explicitly authorized with the remaining acceptance gaps disclosed; it does not satisfy the operational rollout decision below. This document separates verified source/fixture evidence from acceptance that still needs an installed build, physical hardware or the real service path. It is an operator checklist, not a certification. Do not reuse v4.0.0 artifact hashes for v4.0.1.

## Release identity to record before any rehearsal

Fill this from the immutable candidate and retain it with the run evidence.

| Field | Required value |
| --- | --- |
| Source | Exact 40-character commit; current reviewed source before fresh builds is `ab23bc6c93e30a273c3d1d8042880725c047ee2e` |
| Release | Tag, GitHub release ID, workflow run ID and publication state; a draft is not a published release |
| Artifact | Asset ID, exact filename, byte size and independently computed SHA-256 |
| Manifest | Exact checksum-manifest filename and whether its installer entry matches the independently computed hash |
| Environment | Distribution/version, desktop and version, X11/Wayland, kernel, WebKitGTK, GStreamer, camera type, package format and clean/upgrade install |
| Policy | Contest ID in isolated staging, required/advisory checks, camera/display/keyboard/network settings, approved waivers and their expiry |
| Result | Expected and observed result, timestamps, visible candidate message, invigilator evidence, restoration result and remaining uncertainty |

Use test labels for cameras such as `RGB`, `IR` and `USB hotplug`; do not record device serials or candidate images in diagnostic logs.

## Evidence matrix

| Area | Verified evidence | Still required for Phase G acceptance |
| --- | --- | --- |
| Integrated source | 718 web, 18 desktop JavaScript and 3 API-client tests; typecheck and production web build passed on `ab23bc6`. The integrated source also passed 306 native tests and strict Clippy. All ten CI jobs and all four release builds passed; all seven installers/four manifests passed independent hash verification. | Physical and deployed-service acceptance remains open. |
| Candidate UI | Production fixtures passed 102 responsive Settings checks and four practice checks. Practice reaches completed display readiness, live camera readiness and Stage 8. Recovery fixtures cover confirm, cancel, scoped discard, unrelated recovery and operation failure. | Installed WebKit interaction, permission prompts, focus/accessibility and recovery on the supported desktop tuples. |
| Camera policy | Source/tests preserve exact camera selection, keep the working track until replacement and preference storage succeed, reject late/superseded tracks and retain contest hotplug recovery. The Stage 8 manual-review route stays unverified and must retain session-bound evidence; it does not set `face_verified` or bypass required native camera/display policy. | RGB/IR choice, denied permission, stalled frames, unplug/replug, changed IDs, model/no-face deadline, review acknowledgement and Stage 8 → Stage 9 delivery on physical cameras. |
| Entry and recorder | Source fixtures cover advisory/required outcomes, bounded recorder binding before a lockdown failure is recorded, visible session-binding failure, cancellation, late completion, retry and ownership transfer. | Installed slow DNS, recorder failure, 4xx/429/5xx, denied helper authorization, stale/updated waivers and required-policy blocking. Verify visible failures do not silently navigate away. |
| Linux recovery | Native tests cover private ownership, journals, conflict-safe restore, discard/archive, single-instance exclusion and token-based firewall cleanup. | Duplicate GUI launch, visible rejection and state-permission repair passed on the CI DEB in isolated Ubuntu22/Xvfb/Openbox. Real desktop crash/relaunch, conflicting settings, hotspot/network change, token/helper failure and full restoration remain open. No host workstation mutation is evidence. |
| Packaging | Published v4.0.1 passed four platform builds and independent verification of all seven installers/four manifests. Exact DEB/RPM clean install/remove and DEB/AppImage headless launch passed; see `release-v4.0.1.md` and `release-v4.0.1-integrity.json`. | Physical-device acceptance and AppImage FUSE mounting remain unverified. |
| Judge path | Current API `df1b0f9` plus retry fix `c40e758` passed login/open/Run/Submit/duplicate callback/Finish through real worker `e6d07c0`, Moto S3/SQS and checksum-verified official cxxprobe v0.14.0 in an isolated KVM guest: two AC results and two completed jobs. | Installed-client and production HTTP/TLS traversal, user-visible verdict and deployed-version confirmation. The API layer in the isolated rehearsal used TestClient; it is not a production capacity test. |
| Capacity | The former client jitter was removed; actual entry remains gated by the authoritative start. | Measured synchronized-start admission/capacity, late arrival and short-contest behavior. Removing jitter does not prove capacity. |

## Candidate rehearsal

Use a disposable staging invitation and the exact candidate artifact above.

1. Confirm the organizer name, contest, start/end time and device policy. Close older Access versions before launch.
2. Sign in with a dummy candidate account. Confirm errors for wrong, expired and already-used credentials do not expose another account.
3. Complete every readiness stage. Check the selected display and exact camera, permission guidance, required versus advisory labels and keyboard coverage wording.
4. For no-face/manual review, confirm the UI says the result is unverified, the evidence is bound to this session and an invigilator decision is still required. Do not treat continuation as identity verification.
5. Enter only after the authoritative start. Confirm late entry adds no random delay and never extends the backend deadline.
6. Run a harmless sample, edit it, submit once, retry under a controlled transient failure and finish. Record the submission ID and one final persisted verdict; never use production questions or candidate data.
7. Exercise only the assigned fault case: denied permission, camera disconnect, recorder/backend error, helper denial, application crash or network change. Capture visible messages and service-side events without images or secrets.
8. Exit and verify camera/microphone indicators stop and owned keyboard/network settings restore. If recovery remains pending, use **Try again** first. Use **Discard saved keyboard recovery** only after the invigilator explains that prior keyboard settings will no longer be restored, current settings remain unchanged, evidence is archived, and firewall/session recovery is unaffected.

## Invigilator rehearsal

1. Use a dummy organizer account with access only to the isolated contest. Record the policy and waiver set before admitting candidates.
2. Verify each candidate maps to one staging identity/session. Review display, camera and manual-review evidence as separate facts; an unverified review request is not `face_verified`.
3. Observe admission timestamps around start, retry/backoff responses, recorder events, Run versus Submit, the final verdict and Finish. Reconcile client, API, queue/worker and judge identifiers.
4. For a required check failure, confirm entry remains blocked. For an advisory failure, confirm the warning/evidence remains visible without being mislabeled as success.
5. After cancellation, crash and normal finish, verify recovery status and the original/current setting comparison. Escalate unresolved firewall/helper recovery; never instruct a blind firewall flush or deletion of another user's journal.
6. Export only the minimal evidence ledger: dummy account label, session/submission IDs, timestamps, status codes, artifact hash, environment and pass/fail observations. Remove tokens, cookies, faces, credentials, device serials and production identifiers.

## Staged roster and fault method

Create one isolated contest with synthetic content and at least these dummy accounts: `candidate-normal`, `candidate-late`, `candidate-retry`, `candidate-camera`, `candidate-recovery` and `invigilator-phase-g`. Use unique test email aliases or a local mail sink; do not send to real recipients. Give the organizer only this contest. Use fake object-storage/mail credentials where the service permits and confirm cloud metadata access is disabled in disposable environments.

Run normal flow first, then one fault per account so evidence is attributable. Record whether the API endpoint layer uses TestClient or real HTTP and whether storage/queue/judge are actual isolated services. Recreate rather than recycle accounts when a credential/session lifecycle is part of the test. Delete the isolated contest, credentials, media and storage objects after retaining the redacted evidence ledger.

## Physical Linux tuples

| Tuple | Required observation |
| --- | --- |
| Ubuntu/Fedora GNOME on Wayland and X11 where supported | Installed launch, schema/writability discovery, partial-timeout wording, overview/shortcut behavior, touchpad preservation, camera/model path, crash recovery and exact restoration. |
| Plasma 5 and Plasma 6 on Wayland/X11 where supported | Discovered KGlobalAccel families, modifier-only Meta change and live KWin reconfigure, camera flow, conflicting user edit preservation and exact restoration. |
| Mint Cinnamon | Explicit unsupported keyboard coverage; do not infer GNOME support or allow a required keyboard policy to pass without an approved waiver. |
| AppImage plus native package baseline | Launcher, WebKit/GStreamer/V4L2 loading, helper authorization/lifecycle, upgrade/remove behavior and documented helper cleanup. |

## Rollout decision

**Go** only when the candidate is immutable, every published installer and manifest is independently matched, source/native/package gates are green, the supported physical tuples pass required-policy and restoration checks, the real judge path persists one authoritative result, synchronized-start observations meet the agreed capacity threshold, and candidate/invigilator instructions match observed behavior.

**No-go** for any hash or metadata mismatch; missing fresh artifact; required policy that continues without an approved waiver; hidden session-binding/recorder failure; camera substitution; unacknowledged manual review; duplicate or missing judged result; unresolved keyboard/firewall recovery; settings overwritten after a conflicting user edit; startup/capacity result outside the agreed threshold; or evidence collected against a different source/artifact/environment.

A fixture, container package check, one shim-judge pass or prior-release hash cannot close a physical-device or deployed-service row. Record limitations as open rather than converting them into certification language.
