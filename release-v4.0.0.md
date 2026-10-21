# v4.0.0 candidate and Phase G acceptance

## Source reconciliation

Desktop source: `Algorithms-Mathematics-Society/ams-access`, branch `release/v4.0.0`.
Team baseline: `3288672`, including all nine `aezyus` commits since `85ef18e`.
Linux review baseline: `c519bd6`, including the four A–F/review commits and follow-up entry/camera fixes.
Website: `Algorithms-Mathematics-Society/amsaccess`, separate clean checkout based on `f692351`. Original dirty checkouts are preserved.

Merge decisions: retain bounded device operations and exact camera selection, migrate the team's preference key, keep their Stage 8/contest camera picker features, retain all warning/battery/Windows typing improvements, and use required desktop-resource recovery with a failed-cleanup latch. Retain both branches' regression test lists. The admission timing review below records the corrected fairness defect and remaining backend capacity gate.

## Acceptance record

- [x] Team commits fetched and reconciled; source manifests set to 4.0.0.
- [x] Exact tag-to-manifest release gate added; releases remain drafts.
- [x] Final integrated `pnpm test` passed: 697 web tests, 18 desktop JavaScript tests and API-client tests; root typecheck and exact v4.0.0 tag/version check passed.
- [x] Web production build and size budgets passed (22.01 MB static export).
- [x] Local browser fault rehearsal: production-export contest audit 33 checks / 11 captures / zero failures or runtime exceptions; login fixtures 36 checks / four captures / zero failures; onboarding scroll six viewport sizes. These use synthetic API/native/media responses. Full onboarding production flow and real backend/native acceptance remain open.
- [x] Native suites: 117 platform, 43 core, 48 helper, 89 desktop; formatting/Clippy passed. Installer mocks: 9 post-install and 24 pre-remove; 17 artifact validator tests passed.
- [x] Fresh CI source `092897b` passed all native/web/package jobs; Linux DEB/RPM/AppImage payloads and clean DEB/RPM installation/removal passed in run `39667744005`.
- [x] Replacement draft release `420029337`, run `39669622379`: all four builds passed; seven installers and four checksum manifests independently downloaded and verified against API sizes/digests and manifest entries.
- [ ] Installed Linux desktop/camera/helper/packet acceptance across declared supported configurations.
- [ ] Real nonproduction roster: login → checks → capture/review → entry → Run → Submit → Finish → verified restoration, with backend evidence for retry/idempotency/token restart.
- [ ] Admission capacity and clock fairness verified against the deployed backend/contest configuration.
- [ ] Website exact-artifact requirement/evidence registration and public download verification after publication.

No nonproduction roster or endpoint was supplied or discovered in the candidate repository. Local fixture tests are appropriate for fault injection; production API is not a substitute. These fixtures cannot establish actual judge processing or native desktop restoration. Do not mark the remaining acceptance items complete from unit tests or historical v3 packages.

The live website was checked read-only: `amsaccess.com` redirects to `www.amsaccess.com`, and `app.amsaccess.com/api/releases/latest` serves published v3.4.0 with platform assets/hashes. Its release lookup excludes drafts, so preparing v4.0.0 need not switch public downloads before acceptance.

## Phase G: isolated backend and timing findings

The selected runnable rehearsal is the Python `ams-api` contract suite against a uniquely named disposable PostgreSQL database. Its `/participant/sessions` routes and `server_time`/`remaining_ms`/`ends_at` response fields match the desktop client. The separate `AccessGolang/ams-golang` load harness can seed an organization, active contest, question and synthetic candidates, but bypasses OTP and lacks the immutable judge bundle. Its `/sessions` handlers are separate; passing Python tests does not establish deployed Go behavior. Neither production URLs nor cloud-default development configuration are a safe substitute for isolated staging.

Requirements for an eventual complete Go API/judge rehearsal, if that is the deployment being certified:

1. Start disposable PostgreSQL on loopback port 55432 using the documented separate admin/runtime/migration roles and `AMS_TEST_DATABASE_DISPOSABLE=1`. Pin the server major to the deployment being certified.
2. Use a throwaway candidate signing secret, hard candidate authentication, loopback CORS, a test project, Firebase Auth emulator and disabled autoscaling. Do not load production credentials or production frontend example configuration.
3. Provision Pub/Sub topics/subscriptions and local storage buckets; verify emulator routing before API/worker startup. Seed problem inputs and the immutable cxxprobe projection/bundle, with exact binary version, commit and SHA-256.
4. Seed emulator login credentials, then exercise login, onboarding, entry, Run, Submit and Finish. Capture API/worker logs, attempt/idempotency records, verdict and restoration evidence.
5. Run burst and scheduled-readiness cohorts, including early, on-time, late and near-end arrivals. The existing load harness supports a 150-second ramp but is only a capacity component of this rehearsal.

No complete emulator orchestration or judge-ready seed exists in the inspected repositories. Python seed tooling also requires an absent `~/ams-ascent` problem/package source and defaults to cloud object storage; the Go judge performs cloud synchronization at startup. This remains an acceptance gap, not a passing end-to-end result.

The selected scratch-database rehearsal passed **12/12** focused tests at Python source `f48d7065dc6344a1476c5c2220e5ed0c1995f166`, with PostgreSQL 16 image digest `postgres@sha256:a902560563d3a5661228585f53474c5065e7f273b21ffd77e555a8b5682c5690`. Tests covered verification-window/late admission, early refusal, fixed remaining time, authoritative clock response, repeated session creation, pending-to-active transition, finish idempotency, repeated draft revision, deadline enforcement and finish/resume preserving one session. The unique database passed its disposable-name guard; fake storage credentials and disabled cloud metadata prevented production access, and the container was removed. Exact commands, test names and logs are under `reports/v4-backend-contracts/`. This does not cover duplicate judged-submission creation, OTP, the Go implementation, real judge processing or native restoration.

### Confirmed timing defect

The existing client adds up to 150 seconds after readiness, while the backend uses a fixed contest end and scores elapsed time from the fixed start. Thus the statement that nobody loses exam time is incorrect: late and on-time candidates can lose almost 150 seconds (about 75 seconds on average). A client-only extension would conflict with backend enforcement. A server-issued admission schedule or per-session duration would require coordinated backend policy changes. The narrow client remedy is to remove the intentional post-start delay; late arrivals receive no additional random wait. Actual session entry remains gated by the official start. Moving an idle timer earlier does not spread actual admission work, so backend capacity under this corrected policy still requires measurement.

### Additional defects reproduced during integrated checks

- Formatter: a standalone CodeMirror state may have an incomplete syntax tree, leaving later code unformatted. Ensure parsing finishes within a 100 ms budget, publish the completed parser context, then indent in one undoable transaction. If parsing cannot finish, retain the original source. Regression covers code after a long comment prefix.
- Editor preferences: hidden dialog markup incorrectly owned Escape. Only rendered, visible, non-hidden and non-inert dialogs now take priority; browser checks cover both hidden and visible-dialog cases and focus restoration.
- Windows supervised runtime staging: Node 24 on Linux rejected directory-link cleanup with `ERR_FS_EISDIR`. Use `unlinkSync` only after the existing symlink/target identity guard. An adversarial replacement test verifies an unrelated runtime is preserved. No recursive directory cleanup is introduced.

## CI compatibility follow-up

The first cross-platform CI run exposed four compiler checks absent from the local Linux compiler: macOS saw an unused Linux helper; Windows saw an unused Linux keyboard wrapper and rejected an underscore lock binding; newer Linux Rust deprecated `fetch_update`. Commit `9ef8793` scopes production-only helpers correctly while retaining keyboard unit tests, uses a named lock guard through the native call, and replaces the atomic decrement with a checked compare-and-swap loop. Local exact Clippy, coordinator tests (7), keyboard ownership tests (5) and formatting pass. Windows/macOS CI remains the platform compilation authority.

The initial installer run `39659653926` was cancelled before any draft release assets existed. Its `3069657` tag revision must not be used as installer acceptance. The unpublished v4.0.0 tag will be refreshed only after the corrected source gates pass; the old source commit remains in branch history.

Browser evidence at `3069657` has a clean worktree and empty diff hash: contest 33 checks / 11 captures and login 36 checks / four captures. The subsequent compatibility patch changes Rust only. Six viewport scrolling checks cover the practice/review summary, not the full onboarding journey; their metadata explicitly records a generated Next development-type reference change, which was restored afterward.

## Linux package validator follow-up

Run `39663690332` passed native Linux/Windows/macOS checks, web checks, Windows/macOS bundles and MSIX certification. Retaining its actual Linux packages isolated two validator defects:

- Ubuntu 22.04 RPM 4.17's `rpm2cpio` exits 1 even after emitting the complete archive. The package passes header/payload SHA-256 verification, Fedora RPM 6.0.2 extracts it successfully, and Ubuntu 22.04 `bsdtar` extracts it successfully. Fully draining the producer disproved the earlier pipe-race hypothesis. The final implementation verifies digests with `rpm -K --nosignature`, then extracts with `bsdtar`, requiring both commands to succeed. This avoids ignoring extraction errors or maintaining a custom producer pipeline. CI/release install `libarchive-tools`.
- Ubuntu 22.04 `unsquashfs` rejects the validator's pre-created destination. AppImage extraction now creates its own fresh directory. A real SquashFS regression checks that contract; no force-overwrite or recursive cleanup is needed.

All 17 validator regressions pass, including digest rejection before extraction and the real SquashFS test. The retained RPM passes all 11 payload checks on Ubuntu 22.04. The retained AppImage passes all payload checks locally; its helper reference comes from the exact-hash DEB already validated against source in CI. This is cross-format diagnostic evidence, not final release-build acceptance.

Retained package identities (source `bb38a88`, run `39663690332`):

| Format   |     Bytes | SHA-256                                                            |
| -------- | --------: | ------------------------------------------------------------------ |
| DEB      |  14715848 | `8df86920d65f937be741b6c672db9fa73f1640244d69e0ab8b72e50db02fe9c1` |
| RPM      |  14721441 | `49198ff85bf94f507cc6dce5b4ce9c61bdc8728956068d45d6d71c5eac7f7a34` |
| AppImage | 103447032 | `ff17ab614292f64c7f0db9b419729f38727cc8617ec9ffc0f73ef00924e7d25a` |

The exact DEB passed clean Ubuntu 22.04 container installation/removal. The exact RPM passed the equivalent Fedora 43 container rehearsal. Both passed dependency and executable checks, complete shared-library resolution, camera-rule permissions/removal, and absence of an activated privileged helper. Reports are under `reports/v4-linux-artifacts/run-39663690332/`. Container results do not certify a graphical desktop, physical camera, or packet restoration.

Both workflows collect all three payload reports before failing the aggregate gate; failure-only package retention lasts three days. Invalid packages still cannot proceed to installer smoke tests or release upload. Fresh CI and draft release builds must pass against the final source revision before these diagnostic artifacts can be superseded as release evidence.

## Final source CI

Run `39667744005` passed every job at immutable source `092897b5dd2e51d6ab32055e2a3a3c756b8d7054`: web, native Linux/Windows/macOS, all platform bundles, Windows MSIX certification, all three Linux payload validators, clean Ubuntu DEB and Fedora 43 RPM installation/removal. Downloaded validation reports are under `reports/v4-linux-artifacts/run-39667744005/validation/`. These CI artifacts are distinct from forthcoming signed/notarized draft-release assets.

| CI format | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| deb       | `ad1a663b88847dac9d93f1ea68e332a7f0ed2ac870a11428765f137a0d7812d3` |
| rpm       | `ee5dc2c748495a8d71e8a0bfb883636f3ae88f3ca123ec80a62f24ccb3da6149` |
| appimage  | `6df37e364efd774829c5a47d74788fbbb652b9d817c653679e66c05db792f27e` |

The unpublished tag was refreshed with an explicit lease after confirming no v4.0.0 release existed: annotated tag `cef1ab7` resolves to the green source above. Replacement draft build run `39669622379` passed its source gate and all four platform builds. Draft release `420029337` contains exactly seven installers and four manifests. All eleven independently downloaded files match API byte sizes and SHA-256 digests; every installer also matches its platform manifest. All three Linux downloads match the successful release payload-validation reports. The stable metadata and hashes are recorded in [release-v4.0.0-integrity.json](release-v4.0.0-integrity.json). The release remains unpublished (`published_at: null`); this is draft evidence, not a completed public release.

Final draft-byte container acceptance passed for both the downloaded DEB on clean Ubuntu 22.04 and RPM on clean Fedora 43: installation, declared dependency/tool/GStreamer checks, complete library resolution, camera rule mode/removal, inactive privileged helper and package removal without residue. Both exited 0. Evidence is under `reports/v4-draft-integrity/{deb-smoke,rpm-smoke}/`. These are container packaging checks, not graphical desktop, camera or network-restoration certification.
