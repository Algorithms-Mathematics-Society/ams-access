# v4.0.0 candidate and Phase G acceptance

## Source reconciliation

Desktop source: `Algorithms-Mathematics-Society/ams-access`, branch `release/v4.0.0`.
Team baseline: `3288672`, including all nine `aezyus` commits since `85ef18e`.
Linux review baseline: `c519bd6`, including the four A–F/review commits and follow-up entry/camera fixes.
Website: `Algorithms-Mathematics-Society/amsaccess`, separate clean checkout based on `f692351`. Original dirty checkouts are preserved.

Merge decisions: retain bounded device operations and exact camera selection, migrate the team's preference key, keep their Stage 8/contest camera picker features, retain all warning/battery/Windows typing improvements, and use required desktop-resource recovery with a failed-cleanup latch. Retain both branches' regression test lists. The admission timing review below identifies a fairness blocker that must be resolved before publication.

## Acceptance record

- [x] Team commits fetched and reconciled; source manifests set to 4.0.0.
- [x] Exact tag-to-manifest release gate added; releases remain drafts.
- [x] Final integrated `pnpm test` passed: 697 web tests, 18 desktop JavaScript tests and API-client tests; root typecheck and exact v4.0.0 tag/version check passed.
- [x] Web production build and size budgets passed (22.01 MB static export).
- [x] Local browser fault rehearsal: production-export contest audit 33 checks / 11 captures / zero failures or runtime exceptions; login fixtures 36 checks / four captures / zero failures; onboarding scroll six viewport sizes. These use synthetic API/native/media responses. Full onboarding production flow and real backend/native acceptance remain open.
- [x] Native suites: 117 platform, 43 core, 48 helper, 89 desktop; formatting/Clippy passed. Installer mocks: 9 post-install and 24 pre-remove; 17 artifact validator tests passed.
- [ ] Fresh CI-built installers tied to immutable commit, size and SHA-256; Linux payload and container install/remove validation.
- [ ] Installed Linux desktop/camera/helper/packet acceptance across declared supported configurations.
- [ ] Real nonproduction roster: login → checks → capture/review → entry → Run → Submit → Finish → verified restoration, with backend evidence for retry/idempotency/token restart.
- [ ] Admission delay and clock fairness approved against the actual backend/contest configuration.
- [ ] Website exact-artifact requirement/evidence registration and public download verification after publication.

No nonproduction roster or endpoint was supplied or discovered in the candidate repository. Local fixture tests are appropriate for fault injection; production API is not a substitute. These fixtures cannot establish actual judge processing or native desktop restoration. Do not mark the remaining acceptance items complete from unit tests or historical v3 packages.

The live website was checked read-only: `amsaccess.com` redirects to `www.amsaccess.com`, and `app.amsaccess.com/api/releases/latest` serves published v3.4.0 with platform assets/hashes. Its release lookup excludes drafts, so preparing v4.0.0 need not switch public downloads before acceptance.

## Phase G: isolated backend and timing findings

The safest rehearsal target is a disposable local deployment of `AccessGolang/ams-golang`, not the production URL in the example frontend configurations. Its load harness can seed an organization, active contest, question and synthetic candidates. It bypasses OTP and does not seed the immutable judge bundle, so it cannot certify the full candidate journey by itself.

Required setup before real backend acceptance:

1. Start disposable PostgreSQL on loopback port 55432 using the documented separate admin/runtime/migration roles and `AMS_TEST_DATABASE_DISPOSABLE=1`. Pin the server major to the deployment being certified.
2. Use a throwaway candidate signing secret, hard candidate authentication, loopback CORS, a test project, Firebase Auth emulator and disabled autoscaling. Do not load production credentials or production frontend example configuration.
3. Provision Pub/Sub topics/subscriptions and local storage buckets; verify emulator routing before API/worker startup. Seed problem inputs and the immutable cxxprobe projection/bundle, with exact binary version, commit and SHA-256.
4. Seed emulator login credentials, then exercise login, onboarding, entry, Run, Submit and Finish. Capture API/worker logs, attempt/idempotency records, verdict and restoration evidence.
5. Run burst and scheduled-readiness cohorts, including early, on-time, late and near-end arrivals. The existing load harness supports a 150-second ramp but is only a capacity component of this rehearsal.

No complete emulator orchestration or judge-ready seed exists in the inspected repositories. This remains an acceptance gap, not a passing end-to-end result.

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

The exact DEB passed clean Ubuntu 22.04 container installation/removal, dependency and executable checks, complete shared-library resolution, camera-rule permissions/removal, and absence of an activated privileged helper. Reports are under `reports/v4-linux-artifacts/run-39663690332/`. Container results do not certify a graphical desktop, physical camera, or packet restoration.

Both workflows collect all three payload reports before failing the aggregate gate; failure-only package retention lasts three days. Invalid packages still cannot proceed to installer smoke tests or release upload. Fresh CI and draft release builds must pass against the final source revision before these diagnostic artifacts can be superseded as release evidence.
