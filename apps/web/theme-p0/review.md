# P0 independent review

Reviewed 2026-09-30 against Phase 0 of `exectuion-page-wise.md` and `AGENTS.md`.

**Verdict: P0 preparation accepted.** No blocking defects remain in the preparation artifacts. This accepts the inventory, discovery, and baseline evidence; it does not certify the existing UI or native runtime as error-free. P1 styles have not been implemented.

## Evidence checked

- Read both capture scripts, installed-theme discovery output and `astryx-discovery.md`, page/state/layout inventory, and README.
- Independently validated [the authoritative manifest](baselines/2026-09-30T12-57-03-333Z/manifest.json): 78 unique PNG files exist, 39 at each viewport, and each PNG header exactly matches its recorded 1280×800 or 1440×1000 dimensions. All eight browser assertions passed; zero capture-harness failures. `latest.json` points to this run.
- Inspected representative final-run images: 1280×800 populated A Attempts, empty B Attempts, Login Help light, Home error, and 1440×1000 Settings Hardware. Also inspected the earlier Login light capture while reviewing the harness.
- Verified test log: 321 tests passed, zero failed/skipped/cancelled. Reviewed the completed typecheck log (`next typegen && tsc --noEmit`). Both capture scripts passed Node 24 syntax checks.
- Confirmed no Git diff in `apps/web/src` or `packages/shared-ui`; no production styling or authentication/exam behavior was changed for P0. Existing package and lockfile edits predate this P0 work.
- Confirmed the live preview still returns HTTP 200 at `http://localhost:3000`.

## Review findings resolved during P0

1. Baseline runs now use separate timestamped directories with a successful-run pointer, preventing stale screenshots from appearing to complete a failed run. The manifest records commit, worktree status, and tracked diff hash.
2. CDP blocks non-local HTTP requests and same-origin API fallthrough. Browser fixtures intercept actual API fetch calls; Request-object methods are recorded correctly. Fake storage and credentials exist only in a disposable profile, and the app imports neither capture script. Fixture requests include login, heartbeat and draft saves, but remain in-memory responses rather than server writes.
3. Normalization checks explicitly identify programmatic input instead of claiming an operating-system clipboard paste test. Attempts checks now verify a populated A and an empty B excluding A's attempt, using the actual post-pull UI wording.
4. Text matching accounts for uppercase rendered controls. Complete capture count is asserted before advancing `latest.json`.
5. The inventory now correctly identifies the intentionally visible formatted password (`type="text"`) with no visibility toggle.

## Existing UI observations carried forward

- **Home error presentation:** the fixture returns a 503, but the current page displays “No contests yet,” including the stale invite-code instruction. This is an observed error-to-empty fallback, not a distinct connection-error UI. A Next development issue badge is visible in this baseline. Address error/empty distinction in P3.
- **Help light contrast:** the modal's pale heading remains difficult to read against its white surface. P2/shared-dialog work must correct it.
- **Attempts:** A visibly contains the accepted fixture attempt; switching to B shows “No attempts on B yet” and the explanation scoped to B. This verifies basic filtering, not an artificially delayed stale-response race.
- **Hardware:** disconnected camera and uninitialized audio states remain visible, along with the unfinished theme placeholder. No real camera or microphone success was fabricated.
- **Browser runtime exceptions:** the manifest contains 28 `NotAllowedError: Permission denied` entries and two onboarding hydration mismatches (server “Before you begin” versus client “Practice run”). These arise in the current browser baseline; zero harness failures does not mean zero runtime exceptions. Investigate permissions/error handling and dry-run first-render consistency during their planned slices. Screenshots show the recovered client-rendered state.

## Evidence limits and next-phase gates

Only onboarding intro and the browser fullscreen-stage appearance were captured. The remaining native stages are source/state inventory, not screenshots proving successful native checks. Fullscreen enforcement, keyboard restrictions, application closing, monitor/VM detection, helper installation, real media/face/audio operation and teardown require Tauri testing.

Fixtures and screenshots establish presentation; they do not validate the real authentication, organizer-support, judging, autosave, session or API contracts. No organizer message or real exam submission was sent. The user's live browser retains normal app configuration, rather than receiving the screenshot fixture session.

The discovery correctly leaves actual Astryx CSS installation and computed-style verification for P1. Follow its explicit reset/layer ownership, existing saved-preference/dark-lock bridge, generated-theme/SSR approach and offline-font requirements. Verify native WebView support for `@scope` and `light-dark()` before relying on them in shipped screens. Keep the existing login-casing inconsistency separate from presentation changes until its API contract is established.
