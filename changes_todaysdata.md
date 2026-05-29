# Changes Today's Data

Date: 2026-05-30

## Security Policy Source of Truth

Implemented the first P0 readiness-policy pass from the audit. The main goal was to move session readiness decisions out of React and into a typed Rust/core policy path.

### What Changed

- Added a core readiness policy model in `packages/core-rs/src/exam/mod.rs`:
  - `SessionPolicy`
  - `EnforcementProfile`
  - `ReadinessRequirement`
  - `DeviceState`
  - `ReadinessReport`
  - `ReadinessCheck`
  - `EnforcementDecision`
  - failure reason codes
  - recovery actions
- Added pure `evaluate_readiness(...)` logic in `core-rs`.
- Added strict blocking behavior for required checks in strict contest mode.
- Added practice/internal-pilot warning behavior for non-strict profiles.
- Added required/optional check grouping in readiness reports.
- Added contest/device identity checks to strict readiness policy.

### Tauri / Native Bridge

Updated `apps/desktop/src-tauri/src/lib.rs` with typed readiness commands:

- `collect_device_state`
- `evaluate_session_readiness`
- `start_secure_session`

`start_secure_session` now acts as a final native gate before entering the contest surface. If the core policy returns `blocked`, contest launch is denied.

Also shortened native network readiness latency by changing the TCP samples from sequential 3-second probes to concurrent 900ms probes.

### Shared API Client

Updated `packages/api-client/src/index.ts` with typed readiness contracts and wrappers:

- readiness report types
- session policy types
- device-state types
- `sessionPolicy(...)`
- `strictContestPolicy()`
- `collectDeviceState(...)`
- `evaluateSessionReadiness(...)`
- `runSessionReadiness(...)`
- `startSecureSession(...)`

React can now consume typed readiness reports instead of calling raw Tauri commands for policy decisions.

### Frontend Integration

Updated `apps/web/src/app/home/page.tsx`:

- Home readiness now derives UI status from a `ReadinessReport`.
- Dashboard scans use an `internal_pilot` policy so general readiness can warn without requiring a contest ID.
- Preflight scans use strict contest policy when a contest ID exists.
- The session readiness modal now gates proceed behavior on the Rust/Tauri readiness decision.

Updated `apps/web/src/app/session/onboarding/page.tsx`:

- Added final strict native readiness gate before routing to `/session/contest`.
- Removed the Google fallback from the network validation stage.
- Network validation now probes the configured AMS API host instead of hardcoded `supabase.com`.

### Platform Type Updates

Updated `packages/platform-rs/src/linux/mod.rs` and `packages/platform-rs/src/windows/mod.rs` to return owned `String` fields for readiness probe metadata, matching the serializable core model.

### Specialist Review

Subagents were used as requested:

- Rust policy expert: implemented and verified the core readiness policy model.
- React/frontend specialist: identified the smallest safe integration points for report-driven UI.
- Latency engineer: identified duplicate scan and network-probe risks; recommendations were applied to the native network probe and report-based Home readiness path.

### Verification

Passed:

- `cargo test -p core-rs`
- `cargo check --workspace`
- `cargo fmt --all -- --check`
- `pnpm --filter @ams/api-client typecheck`
- `pnpm --filter @ams/web typecheck`
- `pnpm --filter @ams/web build`

Note: pnpm reported a Node engine warning because the local Node version is `v18.19.1`, while the project wants `>=20`. The typechecks and build still completed successfully.

### Files Changed

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/web/src/app/home/page.tsx`
- `apps/web/src/app/session/onboarding/page.tsx`
- `packages/api-client/src/index.ts`
- `packages/core-rs/src/exam/mod.rs`
- `packages/platform-rs/src/linux/mod.rs`
- `packages/platform-rs/src/windows/mod.rs`
- `apps/web/tsconfig.tsbuildinfo`

## Latency, Startup, and Crash-Avoidance Pass

Date: 2026-05-30

Worked as lead latency engineer with a second senior latency engineer reviewing the code paths in parallel. The focus was build/startup cost, runtime render loops, native probe latency, media/ML cost, and graceful fallback behavior.

### Build and Startup Latency

- Removed MediaPipe setup from normal `dev` startup.
- Changed `apps/web/package.json` so `prebuild` runs `setup-mediapipe.mjs --if-used` only.
- Added explicit `mediapipe:setup` for manual asset setup when MediaPipe is intentionally used.
- Reworked `apps/web/scripts/setup-mediapipe.mjs`:
  - skips entirely when active source does not reference MediaPipe runtime assets/APIs
  - hashes source/destination WASM files and copies only changed files
  - supports `--skip-model` / `AMS_MEDIAPIPE_SKIP_MODEL=1`
  - downloads the model to a temporary file and renames it into place to avoid corrupt partial files after crashes
- Audited runtime usage and confirmed current onboarding uses TFJS BlazeFace, not MediaPipe runtime assets.
- Removed the unused public MediaPipe payload from the build output path.

Result after rebuild:

- `apps/web/out`: about 2 MB, down from about 38 MB
- `apps/web/public/mediapipe`: 0 MB / absent unless explicitly regenerated
- `.next`: still about 454 MB, mostly build/cache output

### Size Budgets

- Added `apps/web/scripts/check-size-budgets.mjs`.
- Added `size:check` script for `@ams/web`.
- Web build now runs `next build && node scripts/check-size-budgets.mjs`.
- Added release CI size-budget check in `.github/workflows/release.yml`.

Current budgets:

- static export `out/`: 45 MB
- `public/mediapipe/`: 40 MB
- largest JS chunk: 350 KB

Current build passes:

- `out/`: 1.94 MB / 45 MB
- `public/mediapipe/`: 0 MB / 40 MB
- largest JS chunk: 0.28 MB / 0.34 MB

### Runtime UI Latency

Updated `apps/web/src/app/session/contest/client.tsx`:

- Moved contest countdown rendering into a memoized `CountdownBadge` leaf component.
- Stopped countdown interval after reaching zero.
- Avoided countdown state updates when the rendered label/urgency did not change.
- Removed `key={previewSrc}` from the preview iframe so debounced preview updates do not force a full iframe remount.
- Added camera acquisition timeout for contest proctoring so a hung camera permission/device path reports a fallback error instead of staying unresolved.
- Added in-flight protection to the periodic process scan so slow native scans cannot overlap.
- Added violation-log throttling so the same blocked-app set does not spam `log_violation` every scan cycle.

Updated `apps/web/src/app/home/page.tsx`:

- Replaced one interval per scheduled contest card with one shared ticker in the contest panel.
- Scheduled contest cards now format their countdown from the shared tick timestamp.

### Onboarding Media and Native Probe Fallbacks

Updated `apps/web/src/app/session/onboarding/page.tsx`:

- Wrapped native onboarding calls with UI-level timeouts and graceful warn/fallback behavior:
  - keyboard lockdown
  - setup verification keyboard check
  - process scan
  - VM detection
  - network stability
- Replaced synchronous `canvas.toDataURL("image/png")` face snapshot capture with async `canvas.toBlob(...)` plus `FileReader` conversion before saving through Tauri.
- Throttled microphone level React state updates to roughly 8 Hz instead of updating every animation frame.
- Removed `Date.now()` from the per-bar audio render path to avoid extra render churn.

### Native Probe Latency

Kept the previous native network optimization:

- `check_network_stability` now runs three TCP samples concurrently with 900ms timeouts instead of three sequential 3-second waits.
- Onboarding network validation probes the configured AMS API host instead of hardcoded `supabase.com` and no longer falls back to Google.

### Verification

Passed:

- `node apps/web/scripts/setup-mediapipe.mjs --if-used`
- `pnpm --filter @ams/web typecheck`
- `pnpm --filter @ams/api-client typecheck`
- `cargo check --workspace`
- `pnpm --filter @ams/web build`

Note: pnpm still reports a local Node engine warning because this machine is running Node `v18.19.1`, while the project declares `>=20`. The typechecks and build completed successfully.

### Files Changed In This Latency Pass

- `.github/workflows/release.yml`
- `apps/web/package.json`
- `apps/web/scripts/setup-mediapipe.mjs`
- `apps/web/scripts/check-size-budgets.mjs`
- `apps/web/src/app/home/page.tsx`
- `apps/web/src/app/session/contest/client.tsx`
- `apps/web/src/app/session/onboarding/page.tsx`
- `apps/web/tsconfig.tsbuildinfo`
