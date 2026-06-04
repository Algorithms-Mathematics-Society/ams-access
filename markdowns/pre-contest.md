# Pre-Contest Flow Audit

Date: 2026-06-02  
Scope: login gate, contestant hub, session-code/resume flow, readiness modal, Settings tabs, Diagnostics, Security Logs, and onboarding before contest entry.

## Completed Fixes Removed From Active Priority

- Active session resume now treats localStorage as an unverified crash-recovery hint, validates stored sessions against `/sessions/:id` on hub load and before resume, clears invalid records, and only routes with the server-confirmed contest id.
- Session-code resolve now sends an explicit `Content-Type: application/json` request instead of hiding CORS/preflight issues behind a plain JSON body.
- Camera test retry now uses a bounded low-latency loop with one busy lifecycle, an in-flight guard, a 180ms release-race backoff, and non-blocking device-list refresh after stream acquisition.
- Settings and Diagnostics now share one TTL-bound native telemetry query with in-flight request deduplication and matching last-scanned timestamps.
- Readiness modal now gates directly from `ReadinessReport.required_checks` and renders required vs optional policy checks separately; optional warnings no longer confuse the proceed gate.
- Security Operations Log no longer seeds simulated platform/process/firewall events, synthetic heartbeat entries, or a forever-running fake feed interval. It now renders observed local events from actual scans, session-code validation, readiness checks, and media tests.
- Hub contest entry rules now use a shared entry-state path with server confirmation before proceeding, so `DRAFT` and too-early contests are no longer active preflight candidates.
- Onboarding no longer assumes a hardcoded 20-minute verification window. It consumes `verification_window_minutes` from synced contest metadata and `/session-window`, with the server window check remaining authoritative.

## Additional Product Context

Contest definitions are not meant to be invented by the desktop/web client. The upstream source of truth is the AMS Access organizer/admin contest record, for example:

- `https://www.amsaccess.com/org/contests/54f1f8de-4b73-46b0-b575-69609788904a`
- `contest-web-side.md` documents the org portal contract: `start_at` and `end_at` are UTC ISO strings, `timezone` is display context, `DRAFT` is not student-visible, session codes are distinct from invites, and contest fields travel from the org/backend record into the contestant app.
- Screenshot context: contest title, description, start/end time, timezone, status, scoring type, allowed languages, questions, invites, students, live/compute state, and settings are managed there.
- The team has already synced and set up the GCP/backend path for this data.

That changes the implementation guidance: fixes should consume the existing synced contest/session APIs and organizer policy. The contestant app should not hardcode contest windows, allowed languages, scoring mode, question count, status transitions, or compute/judge readiness. Any local logic should be a display fallback only, and server/GCP-synced state should win when available.

## Executive Summary

The pre-contest experience has a strong, coherent "secure operations" look, but several panels currently overstate how real or authoritative their checks are. The highest-risk problems are not visual polish issues; they are mismatches between UI claims and actual enforcement:

- Several onboarding checks warn but still auto-advance, including camera bypass, VM warning, microphone failure, and network warning.
- Settings/Diagnostics duplicate native scans and use a module-level cache that can show stale security state.
- The login page exposes a hardcoded development bypass in production-facing UI.

Recommended best fix: create a single shared pre-contest readiness model that is fed by server window policy plus native telemetry, then make Home, Settings, Diagnostics, Security Logs, and Onboarding read from that model. Preserve the current UI, but change the source of truth underneath.

Given the organizer/GCP context, server window policy means the existing synced AMS Access contest/session data path, not a new parallel policy store.

## Reviewed Surfaces

- `apps/web/src/app/page.tsx`: login and system logs.
- `apps/web/src/app/home/page.tsx`: contestant hub, session code, resume, settings, diagnostics, security logs, readiness modal.
- `apps/web/src/app/session/onboarding/page.tsx`: full pre-contest secure setup flow.
- `apps/web/src/lib/api-client.ts`: local request cache/dedupe layer.
- `packages/api-client/src/index.ts`: Tauri IPC readiness helpers.

## Critical / High-Risk Findings

### 1. Hardcoded dev login bypass is visible and functional

Evidence:

- `TEST_EMAIL` and `TEST_PASSWORD` are hardcoded in `apps/web/src/app/page.tsx:8-9`.
- Matching credentials route directly to `/home` with `DEV_BYPASS` in `apps/web/src/app/page.tsx:142-145`.
- The credentials are also rendered in the login UI at `apps/web/src/app/page.tsx:291-292`.

Impact:

- Anyone with the desktop/web app can enter the hub as `tester@ams.local`.
- This can contaminate local active session state, unlocked contests, and support/debug flows.
- It undermines any security wording in the rest of the app because the first gate is intentionally bypassable.

Best fixes:

1. Build-time dev-only bypass, hidden in production.  
   Use `NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true"` or `process.env.NODE_ENV !== "production"` to show autofill and allow the bypass. This is the fastest safe fix.

2. Organizer-issued demo mode.  
   Replace static credentials with a backend-created demo token that has restricted contest access. This is safer for demos and QA.

3. Remove bypass entirely.  
   Cleanest security posture, but slower for local testing unless fixtures are improved.

Recommendation: option 1 immediately, then option 2 if demos matter.

### 2. Onboarding warnings auto-advance through checks that look blocking

Evidence:

- Camera failure offers `BYPASS_CAMERA_VERIFICATION [WARN]` at `apps/web/src/app/session/onboarding/page.tsx:1176`.
- VM detection warns but calls `onPass` after delay.
- Microphone failure displays "No microphone found - continuing anyway" at `apps/web/src/app/session/onboarding/page.tsx:2184`.
- Network validation marks unreachable/poor as `warn` and still advances via `Stage12_NetworkValidation` at `apps/web/src/app/session/onboarding/page.tsx:2191`.

Impact:

- A user can reach final launch with failed proctoring inputs, only to be blocked later by `startSecureSession`, or worse, enter with degraded enforcement depending on native policy.
- The flow teaches users that warnings are decorative, not policy.

Best fixes:

1. Enforce stage outcomes locally.  
   Do not advance from required stages unless they pass or an organizer override token exists.

2. Continue collecting warnings but block only at `startSecureSession`.  
   Simpler, but wastes user time and makes failures late.

3. Policy-driven stages.  
   Server/native readiness policy tells each stage whether `pass`, `warn`, or `fail` is allowed to advance.

Recommendation: option 3. It aligns messaging, stage behavior, and final enforcement.

## Medium-Risk Findings

### 3. Settings permissions are inferred from readiness, not actual browser permission state

Evidence:

- Permissions tab shows Webcam/Microphone based on `readiness.camera === "ok"` and `readiness.mic === "ok"`.
- Those values can come from `enumerateDevices`, native readiness, or previous settings tests, not `navigator.permissions` or an active permission grant.

Impact:

- UI can show `GRANTED` when the browser still prompts on real `getUserMedia`.
- UI can show blocked when permissions are fine but no device is attached.

Best fixes:

1. Use `navigator.permissions.query({ name: "camera" | "microphone" })` where supported, plus active `getUserMedia` validation.

2. Split labels into "Device detected" and "Permission granted".

3. Only show permission state after an explicit media test.

Recommendation: option 2. It avoids browser API inconsistencies and is clearer.

### 4. Diagnostics report includes hardcoded/assumed values

Evidence:

- Diagnostics labels Model Asset CDN as "Not checked" at `apps/web/src/app/home/page.tsx:4048`.
- Exported report hardcodes `client_version: "0.1.0"` and `sandboxed_webview: true`.
- Login and About also hardcode version-ish/product state.
- Contest-facing cards also risk showing locally derived status/count/window data unless all fields are taken from the synced organizer contest record.

Impact:

- Support reports can be misleading or stale.
- Browser/dev-server runs may report sandboxed webview even when Tauri is unavailable.
- Contestants may see state that differs from the organizer page, such as schedule/status/question count/language constraints.

Best fixes:

1. Load version/build/channel from package/build env and expose `isTauri` accurately.

2. Keep contest metadata read-only from the synced backend/GCP source. If a field is absent, show `pending sync` or omit it instead of fabricating values.

3. Remove unknown rows until probes exist.

4. Implement real asset probe for model/CDN readiness.

Recommendation: options 1 and 2 immediately; option 4 before requiring model assets in production.

### 5. Home route is a very large client component

Evidence:

- `home/page.tsx` contains hub, cards, settings, diagnostics, logs, modals, and many inline SVG/style objects in one client file.

Impact:

- Larger route chunk and slower parse/compile on low-end machines.
- State updates in parent can still touch broad subtrees despite memoization.
- Harder to test and isolate pre-contest failures.

Best fixes:

1. Split into route-local components: `ContestHub`, `SettingsPanel`, `DiagnosticsPanel`, `SecurityOperationsLog`, `SessionReadinessModal`.

2. Lazy-load Settings/Diagnostics/Security Logs when those tabs are opened.

3. Move repeated inline styles to CSS classes for static parsing.

Recommendation: options 1 and 2. Do not change visual design; just split and lazy-load.

### 6. API cache has no eviction and can retain errors/data for the app lifetime

Evidence:

- `queryCache` is a module-level `Map` at `apps/web/src/lib/api-client.ts:24`.
- `fetchJson` stores data/errors by `dedupeKey` at `apps/web/src/lib/api-client.ts:103-123`.

Impact:

- Long desktop sessions can accumulate cache entries.
- Errors may remain visible unless a caller explicitly mutates or changes keys.
- Stale unlocked contest fetches can persist longer than intended.

Best fixes:

1. Add TTL eviction and `clearQueryCache(prefix?)`.

2. Replace custom cache with SWR/TanStack Query.

3. Keep custom cache but scope it to specific hub data only.

Recommendation: option 2 if dependency budget allows; otherwise option 1.

## Recommended Fix Plan

### Option A: Minimal hardening, 1-2 days

- Hide/remove dev login bypass outside development.
- Add TTL to cached security scan and show "last scanned at".
- Fix camera retry busy-state loop.

Pros: fastest, minimal UI churn.  
Cons: still leaves duplicate readiness logic and some late policy failures.

### Option B: Shared readiness source of truth, 3-5 days

- Create `usePreContestReadiness(contestId?)`.
- It combines the existing synced contest/session API state, `/session-window`, `runSessionReadiness`, `get_full_telemetry`, media permission/device status, and active session validation.
- Home cards, readiness modal, Settings, Diagnostics, and Onboarding all render from this model.
- Security Logs become a real event log from readiness transitions.
- Readiness modal already renders required vs optional checks from `ReadinessReport.required_checks` and `optional_checks`; remaining work is to feed the same shared model into Settings, Diagnostics, and Onboarding.
- Contest schedule/status/question/language/scoring metadata remains read-only from the organizer/GCP-backed source.

Pros: fixes most correctness issues while preserving the look.  
Cons: needs careful migration and tests.

### Option C: Full platform-grade preflight state machine, 1-2 weeks

- Move pre-contest flow to a finite state machine with explicit states: `idle`, `loading_window`, `too_early`, `scanning`, `blocked`, `ready`, `waiting_for_start`, `launching`.
- Back each stage with typed events from Tauri and backend.
- Add telemetry/event replay for support.
- Add Playwright coverage for too-early/live/ended/blocked paths.

Pros: most robust, easiest to reason about long-term.  
Cons: largest implementation.

## Best Recommendation

Choose Option B now.

It preserves the current high-agency UI while fixing the most important reliability problem: multiple panels currently invent or infer their own truth. The right architecture is a shared pre-contest readiness model feeding the existing surfaces.

With the AMS Access org contest page and GCP sync in place, the readiness model should compose existing upstream data rather than replace it. The desktop/web client should behave like a secure contestant shell over synced contest data, not like a mini contest admin system.

The implementation should prioritize:

1. Production-safe auth gate.
2. Shared readiness hook/store.
3. Policy-driven onboarding stage blocking.
4. Component splitting/lazy loading for Settings and Diagnostics.

## Safe Execution Priority

This is the order I would execute as a staff-level platform web engineer. The principle is simple: remove misleading behavior first, centralize truth second, enforce policy third, and only then optimize structure. Each step should be small enough to review and verify independently.

### P0 - Safety Rails Before Behavior Changes

Goal: prevent the contestant app from lying or granting unintended access.

1. Gate dev login/autofill behind an explicit development flag.
   - Safe change: keep the developer workflow available only when `NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true"` or local development is detected.
   - Do not remove real login.
   - Do not change visual layout except hiding dev-only credentials/autofill when disabled.
   - Verify: production-like env cannot enter via `tester@ams.local / access2025`.

2. Add an explicit contest-metadata unavailable state.
   - Safe change: if synced contest metadata is missing or incomplete, show a disabled/pending state instead of falling back to mock/web/default assumptions.
   - Do not invent contest type, allowed languages, question count, schedule, or scoring type locally.
   - Verify: missing `scoring_type`, schedule, or allowed-language data does not silently turn into HTML/CSS/JS mode.

3. Keep mock contests and mock sessions behind explicit dev flags.
   - Safe change: prevent mock contest IDs or fixture paths from appearing in production-like builds.
   - Verify: production-like hub only shows contests from the synced backend/GCP path or invite-code resolution.

### P1 - Shared Readiness Source Of Truth

Goal: stop Settings, Diagnostics, readiness modal, and onboarding from running separate versions of the same truth.

1. Add a shared `usePreContestReadiness(contestId?)` hook/store.
   - Compose existing synced contest/session state, `/session-window`, `runSessionReadiness`, `get_full_telemetry`, media availability, and active session validation.
   - Return data plus timestamps: `readinessReport`, `telemetry`, `sessionWindow`, `lastScannedAt`, `isStale`, `refresh`.
   - Safe change: first wire it to read-only displays while preserving current component visuals.
   - Verify: Settings and Diagnostics show the same platform/process/network result and the same scan timestamp.

### P2 - Honest Logs And Diagnostics

Goal: every `live` or `diagnostic` surface should be backed by a real event or clearly marked as unavailable.

1. Make diagnostic export factual.
   - Safe change: include `is_tauri`, app version/build channel, scan timestamps, and unknown/null for unprobed values.
   - Do not hardcode `sandboxed_webview: true` or model/CDN readiness.
   - Verify: browser/dev mode export does not pretend to be a Tauri-secured shell.

2. Split device detection from permission grants.
   - Safe change: Settings should distinguish `camera detected`, `permission granted`, and `stream verified`.
   - Verify: unplugged camera, denied permission, and busy camera produce different statuses.

### P3 - Policy-Driven Onboarding

Goal: onboarding should not auto-advance through checks that policy considers blocking.

1. Convert warning auto-advance stages to policy-aware gates.
   - Camera, microphone, network, VM, restricted apps, platform, and keyboard should consult the same readiness policy.
   - Safe change: warnings can continue only when policy marks them optional or organizer override exists.
   - Verify: a required camera failure cannot proceed via a generic bypass button.

2. Move bypass actions behind explicit organizer/dev override.
   - Safe change: keep emergency exit, but do not let contestants bypass required proctoring checks in production.
   - Verify: production-like env has no contestant-visible bypass for required checks.

3. Preserve recovery affordances.
   - Safe change: for each block, show `rescan`, `go to settings`, and specific remediation text.
   - Verify: a user can recover without restarting the whole app when possible.

### P4 - Rendering And Bundle Work

Goal: reduce latency and maintenance cost after correctness is fixed.

1. Split `home/page.tsx` into route-local components.
   - Safe change: move code without changing DOM layout or styling.
   - Verify: screenshots and route behavior remain visually equivalent.

2. Lazy-load Settings, Diagnostics, Security Logs, and heavy onboarding/media logic.
   - Safe change: keep loading states visually aligned with the current shell.
   - Verify: hub first-load JS decreases and tab transitions remain instant enough.

3. Move repeated inline style clusters to CSS/classes only where stable.
   - Safe change: no redesign, no palette changes, no layout changes.
   - Verify: visual diff is negligible.

## What I Would Do First

I would continue with P0 and P1, in this exact order:

1. Gate dev login/autofill and mock-only entry paths.
2. Add explicit metadata-unavailable states for incomplete synced contest records.
3. Keep mock contests and mock sessions behind explicit development flags.
4. Add the shared readiness hook/store for Settings, Diagnostics, readiness modal, and Onboarding.
5. Render required vs optional checks from the readiness report instead of hand-maintained local gates.

That sequence is safe because it does not require new backend endpoints, does not redesign the UI, and reduces the chance of a contestant seeing stale or invented local state.

I would not start by refactoring the giant Home file or rewriting onboarding. Those are tempting, but correctness and source-of-truth alignment matter more right now.

## Stop Conditions

Pause implementation and ask for backend/product confirmation if any of these are true:

- The synced contest API does not expose verification-window metadata or session-window state.
- Contest status names differ from the frontend assumptions.
- The backend has no authoritative active-session validation endpoint.
- Organizer override rules are not defined for camera/mic/network/VM/keyboard failures.
- The frontend cannot distinguish dev/mock contests from production contests.

## Implementation Guardrails

- Do not hardcode contest IDs, start/end dates, timezone, status, scoring type, allowed languages, question count, invite counts, judge/compute state, or verification windows in the contestant app.
- Do not create a second client-side contest policy model that can drift from the organizer page.
- Treat client-side time math as UX preview only; server/GCP-synced session-window state should decide entry.
- If synced contest metadata is temporarily missing, show an explicit loading/sync-unavailable state rather than substituting mock values.
- Keep mock contests and dev bypasses behind explicit development flags only.
- Any pre-contest fix should preserve the current visual style and change the data/behavior layer underneath.

## Suggested Test Coverage

- Unit tests for `getContestEntryState` with custom verification windows.
- Unit tests for readiness score/gating from `ReadinessReport.required_checks`.
- Component tests for Home card CTA states: draft, scheduled too early, verification open, live, ended.
- Playwright flow for session code validation and blocked/allowed readiness modal.
- Onboarding tests for camera denied, mic denied, VM detected, restricted app found, network unavailable.
- Native IPC mocked tests for `get_full_telemetry` timeout and stale-cache refresh.
