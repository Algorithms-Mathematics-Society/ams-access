# v4.0.1 release and Phase G acceptance

Status: source fixes merged through PR #148 (`5b379fb`); all ten CI jobs passed on tested source `ab23bc6`. The user explicitly authorized v4.0.1 after the earlier approval-review rejection. Annotated tag `v4.0.1` now points to verified source `ab23bc6c93e30a273c3d1d8042880725c047ee2e`; draft release workflow `39730820957` passed its source gate and all four platform builds. Published release `420358050` contains seven installers and four manifests; independently downloaded sizes, SHA-256 digests and all installer manifest entries match. Published on 2026-10-22T06:29:38Z after explicit user authorization and independent subagent integrity/Linux reviews; exact assets are unchanged. Publication does not constitute Phase G operational acceptance. Do not overwrite the published v4.0.0 tag or assets. Phase G remains open until its actual acceptance evidence is recorded.

## Source scope

- Review repairs: `24f9ade`, including practice policy, recorder ordering, visible entry errors, atomic camera switching, keyboard recovery, GNOME coverage, startup feedback and mobile Settings layout.
- Team history: all nine commits included in v4.0.0 plus `74c1f2a`, `e212716`, and `677d2cf`, merged without squashing their history.
- Version authority: Cargo workspace 4.0.1; desktop, web and API-client manifests must agree; Tauri must not override it.

## Evidence and limits

Before the latest team merge: 703 web, 18 desktop JavaScript, 3 API-client and 306 native tests passed. Strict workspace Clippy passed. Production browser fixtures passed 102 Settings layout assertions and four practice-flow assertions. These fixtures do not establish installed runtime or physical-device acceptance.

Local backend contract checks cover authoritative timing, duplicate open/finish, run/submit isolation, cooldown and duplicate worker-result idempotency. The current API, shared local Moto S3/SQS service, actual worker and official cxxprobe v0.14 in an isolated KVM guest passed the full local Run/Submit/result/Finish chain described below. No production roster or credentials were used. Backend PR #7 is merged as `ba906a7`; Python 3.12/3.13 CI and migration checks passed. Deployment to the running server remains separate and unverified.

## Completion checklist

- [x] Integrated-source tests (718 web, 18 desktop JavaScript, 3 API-client), typecheck and production build.
- [x] Native tests (306), formatting and strict Clippy on integrated source `ab23bc6`.
- [x] Four platform builds and source gate passed (`39730820957`); all seven installers/four manifests independently verified.
- [x] Exact draft DEB/RPM installation/removal; DEB headless startup/ownership recovery and AppImage extraction-mode startup. Physical-desktop acceptance remains separate.
- [x] Real current API → Moto queue/storage → worker → judge → result persistence rehearsal (isolated local integration; not production capacity).
- [ ] Installed camera, desktop restoration and required-policy acceptance on supported environments.
- [ ] Synchronized-start/backend capacity acceptance or explicitly documented remaining limitation.
- [x] Publish the verified follow-up with the same seven installers/four manifests and explicit remaining acceptance limits.
- [ ] Verify deployed website metadata and all seven download routes against the published assets.

Do not convert incomplete checks into passes based on unit tests, browser fixtures or older installer evidence.

## Historical team/release recheck (before draft creation)

On 22 October, remote desktop main was `677d2cf`; all three commits beyond the v4.0.0 source are ancestors of this branch. Public v4.0.0 still resolves to source `092897b` (annotated tag `cef1ab7`); all eleven live asset IDs and SHA-256 digests match the earlier verified candidate. No v4.0.1 tag existed at this check. A fetch reported an unrelated historical `v0.10.3-shell-alpha` tag mismatch; no tag was force-updated. Website main advanced to `14799e2` and is being integrated separately.

Integrated production browser recheck at `ab23bc6`: 4/4 practice checks and 102/102 Settings layout checks passed (`reports/v401/`). These remain fixture-only checks.

## Current backend and website evidence

The current Python API baseline is `df1b0f9`, worker `e6d07c0`, and the deployment script pins official cxxprobe v0.14.0 (binary SHA-256 `e27ae236197b146700277b0a42845fa4d3d3b35f52220a6fd32316464fb8b5f9`). The stale local v0.10 checkout is not deployment authority.

A deterministic PostgreSQL race reproduced `UniqueViolation` before repair when concurrent requests shared a submission idempotency key. Backend commit `c40e758` uses a savepoint and returns the winning submission before S3/SQS side effects. Its regression proves one UID, one row, one source write and one enqueue. Focused checks passed 3 tests; broader session/run/idempotency checks initially passed 50; final focused checks including unrelated integrity-error propagation passed 62, with full Ruff lint/format checks. The separate backend PR is [ams-api #7](https://github.com/Algorithms-Mathematics-Society/ams-api/pull/7).

On that repaired current API, the full local rehearsal passed login → open → Run → real worker/judge → Submit → duplicate result callback → Finish. It produced two AC submissions, two unique persisted results and two completed jobs; package cache miss then hit. Judge runs took 3.471s and 2.695s. PostgreSQL 16 and Moto used disposable loopback resources and dummy credentials. The API used in-process TestClient with the actual internal bearer contract; S3/SQS and judge crossed real service/VM boundaries. This is not a production HTTP/TLS or capacity test. Evidence: `reports/phase-g-kvm/full-chain/` in the parent workspace.

Website PR [amsaccess #1](https://github.com/Algorithms-Mathematics-Society/amsaccess/pull/1) merged as `a6a4ca2` after preserving team main `14799e2`. All 85 website tests and production build passed. Vercel production deployment succeeded; the live release API, download page and seven identity-bound download endpoints match published v4.0.0 assets. The preview was SSO-protected, so anonymous preview route checks were unavailable; production route checks passed. No speculative v4.0.1 asset metadata is registered.

## Installed Linux runtime

CI run `39727386367` passed all ten jobs, including Linux payload validation, clean DEB/RPM installation/removal and Windows MSIX certification checks. Its Ubuntu 22.04 DEB is 14,726,694 bytes, SHA-256 `3efeb7984f430d71c20890724021c38c44f2722d4d8a6d647a5833c71ec9c42f`. In an offline, disposable Ubuntu 22.04/Xvfb/Openbox/D-Bus container, installed launch passed; owned state permissions tightened from 0755 to 0700; the first process remained alive; a second process displayed a GTK ownership error dialog and did not disturb the first. Evidence: `reports/v4-phase-g/installed-launch/ci-ab23-ubuntu22/`.

A locally built Ubuntu 24.04-linked DEB failed on Ubuntu 22.04 due to newer GLIBC requirements and passed on Ubuntu 24.04. It is not the CI release-baseline artifact and must not replace it. Neither headless smoke establishes GNOME/KDE/Wayland controls, physical cameras, real authorization or network restoration. Those remain explicit acceptance gaps.

## Artifact identity

See [the integrity record](release-v4.0.1-integrity.json) for all eleven asset IDs, exact filenames, byte sizes and SHA-256 values. Tag object `766e13d8acead81b31f28000ebb1a69ef8cd0959` resolves to source `ab23bc6c93e30a273c3d1d8042880725c047ee2e`. Release metadata was checked before and after download; asset identities stayed unchanged while it was a draft. The publication record below supersedes that state; public v4.0.0 is preserved.

## Exact draft validation

Release workflow [39730820957](https://github.com/Algorithms-Mathematics-Society/ams-access/actions/runs/39730820957) built the [v4.0.1 release](https://github.com/Algorithms-Mathematics-Society/ams-access/releases/tag/v4.0.1). All seven installers and four checksum manifests were downloaded independently and matched GitHub sizes/digests; every installer matched its manifest. Asset identities remained stable across download.

Fresh draft DEB SHA-256 `3edd2debaa08f2776676669dee5d1ff64b7c6eab2257d9a22b84ccfe6b184f63` passed clean Ubuntu 22.04 installation/removal, isolated Xvfb/Openbox/D-Bus startup, owned-state permission repair from 0755 to 0700, and a visible duplicate-instance error without disturbing the first process. The RPM passed clean Fedora 43 installation, package verification and removal. The AppImage rendered the home screen and remained alive in an offline Ubuntu 22.04 container using `--appimage-extract-and-run`; FUSE mounting was not tested. Release CI payload reports matched these exact Linux artifact hashes and sizes. Helper comparisons in those reports are CI provenance, not an independent local helper rebuild.

Windows EXE/MSI metadata reports 4.0.1 and x64 application/helper payloads; both installers are unsigned. The NSIS outer launcher is i386, which does not change the x64 payload architecture. Both macOS bundles report 4.0.1, minimum macOS 12, and their expected ARM/Intel application architectures; both bundled network helpers are universal x86_64/arm64. Apple build logs show accepted notarization, app stapling and signed DMGs. These are metadata and CI signing checks, not physical Windows/macOS runtime or independent Gatekeeper acceptance.

Before tagging, desktop main was `5efea1d61bc00858c9914953593b57f69dde8752` (documentation/merge changes after tested source); backend main was `ba906a781b8ddc88a1e34f2c62d7fbd4e35037ad`. All twelve relevant team commits are included. The public release API and download page still advertise v4.0.0, and all eleven public asset identities match the previous snapshot. This was the pre-publication snapshot; see the publication decision below for current status.

Physical cameras, GNOME/KDE/Wayland controls and restoration, real authorization/network-helper recovery, backend deployment verification and synchronized production capacity remain open Phase G gates. Detailed machine-readable validation accompanies the asset identity record; raw local logs are under `reports/v401-draft-integrity/`.

## Publication decision

The user explicitly requested public release after being told that physical-device and production-capacity acceptance remained incomplete. Independent agents rechecked all eleven artifact identities, local file hashes, tag/source/workflow identity and Linux evidence. All executed release gates passed; unexecuted Phase G checks remain open. Remote main `9d5672298ce1e5f979e2ae192617a28075f873ba` differs from tested source only in documentation/evidence. This authorizes artifact distribution, not certification of required-policy restoration or production capacity. The formal Phase G rollout criteria remain unchanged.

Published release: https://github.com/Algorithms-Mathematics-Society/ams-access/releases/tag/v4.0.1 at 2026-10-22T06:29:38Z. Tag, installer bytes and v4.0.0 assets were preserved. The publication API response and latest-release identity were checked after publication.

Anonymous post-publication verification at 2026-10-22T06:32:45Z passed: latest-release identity, all eleven asset URLs (HTTP 200 and exact Content-Length), API identities, and full downloads/hashes of all four checksum manifests. Public v4.0.0 retains its original eleven asset identities and digests.
