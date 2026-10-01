# Claude review — verified resolutions

Review pass: 2026-10-01. Source: [claude-review.md](claude-review.md). Each finding was checked against the current working tree before editing. Two implementation subagents handled Settings and Login; an independent reviewer checked source preservation and final screenshots. The original review remains unchanged.

## General findings

| Item | Assessment and resolution |
| --- | --- |
| B1 | **Confirmed, fixed.** Restored `--transition-slow` using the existing duration/easing tokens. Production browser checks confirm a nonzero computed duration. Existing consumers retain their animations. |
| B2 | **Partly confirmed.** Global tokens do affect exam screens. Earlier P0/P1 browser and WebKit evidence exists, so these screens were not wholly unreviewed. Enabled Submit's dark text on pale purple is intentional and readable. Replaced disabled Submit's hardcoded white with the muted semantic foreground; enabled and disabled buttons have different fills and need different foregrounds. New production captures cover preflight, onboarding intro/first check, and enabled/disabled contest Submit. WebKit renders Login/onboarding/contest without horizontal overflow. Full native OS exam-flow validation remains outstanding; these checks do not certify lockdown or camera behavior. |
| B3 | **Confirmed, fixed.** Added the five home presentation tests to the normal web test command: 344 tests now run and pass. |
| B4 | **Confirmed process risk, mitigated.** Added targeted ignores for root scratch screenshots, `disk-check.txt`, and `.playwright-mcp/`. Preserved intentional nested evidence. Created an external working-tree archive and tracked patch under `/home/user/AccessSoftware/review-checkpoints/`. This is a local checkpoint, not a commit or remote backup. The user's existing dirty branch is preserved; no automatic commit, push, or branch rewrite was performed. |

## Settings findings

| Item | Assessment and resolution |
| --- | --- |
| S1 | **Confirmed.** About now reads the real native app version through the existing API-client invoke adapter, using the same `plugin:app|version` command as Tauri `getVersion()`. Browser/unavailable states show “Not available”, never a fabricated package version. Restored this criterion in the plan. The original all-media-on-tab-change criterion was **not met**: camera stops when leaving Hardware, microphone monitoring persists across Settings tabs with visible status, and both clean up on unmount. This existing behavior is retained within the UI-only scope and explicitly recorded as a deviation, not silently marked complete. |
| S2 | **Confirmed, fixed.** Removed the unverified Windows keyboard/firewall capability claim. Platform identity alone does not establish that security operations are available. |
| S3 | **Confirmed, fixed.** Kept the tablist/tab/tabpanel pattern and removed Astryx's competing `aria-current` attribute via the tab element ref. Selection, panel IDs, controls and keyboard navigation remain intact. Browser checks verify no tab carries `aria-current`; this is not a claim of manual screen-reader certification. |
| S4 | **Confirmed, fixed.** Removed unused `camStats` state and its dead camera-settings read/fallback. Camera stream setup and cleanup handlers remain unchanged. |
| S5 | **Confirmed, fixed.** Applied sentence case, “Not scanned yet”, accurate unavailable/stale scan guidance, and neutral “your contests” About copy. Error guidance no longer assumes the user is outside the desktop app. |
| S6 | **Confirmed, corrected.** Moved retained source/hash snapshots from `/tmp` into [review-baselines](review-baselines/README.md) and updated audit paths. These are pre-slice working-tree baselines, **not Git HEAD**. Historical reports describe their captured end state; later authorized fixes may invalidate rerunning a historical assertion against today's tree. A new independent audit checks this review slice against its own durable baseline. |
| S7 | **Confirmed historical interruption, workflow fixed.** Added `scripts/build-web-isolated.mjs`, which builds a copied web workspace and exports under `/tmp`. The live Next server on port 3000 remained running during this review's production build. Changing Next's export/dist directory alone does not isolate its live build artifacts. |

## Device findings

| Item | Assessment and resolution |
| --- | --- |
| D1 | **Confirmed, fixed.** Copy/export use the actual native version or explicit unknown/null, with a version source. Removed hardcoded `0.1.0` and unsupported `release-production` metadata. Tests now assert an injected native version and the missing-version fallback. No server or API contract was changed. |
| D2 | **Confirmed, fixed.** An errored rescan with retained data now says “Showing your last scan”; a first failure says “Device scan unavailable”. Stale data cannot produce a current “looks good” headline. |
| D3 | **Confirmed, fixed.** The copied summary uses the same seven setup rows as the page, including restricted apps and startup integrity. Export includes all seven checks and scan timestamp/status. VM reporting uses actual virtualization telemetry; unavailable telemetry remains unknown. Copy/export are local support artifacts, not API requests. |
| D4 | **Confirmed configuration, clarified without changing it.** Native scans still use `networkHost: null`; no network probe was enabled. The card now explicitly explains that probing is disabled and device scans do not measure connection quality. Measured/offline test cases are hypothetical injected states, not evidence of current production measurements or backend availability. |
| D5 | **Confirmed, fixed.** Shared parsed log text now inherits its parent's font family, size and line height, and restores bold status text. Production preflight checks assert inheritance and weight; an independent visual review checked the shared consumer. Parsing and message content are preserved. |
| D6 | **Confirmed, fixed.** Removed the live-region role from the changing event counter, avoiding an announcement on each appended log line. |
| D7 | **Confirmed, fixed.** Removed unused theme props, kept one separate copy-success status with a stable button label, and declared startup integrity in the row literal. The plan now records the report-content correction explicitly; previous blanket checkbox edits are not treated as proof of acceptance. |

## Login findings

| Item | Assessment and resolution |
| --- | --- |
| L1 | **Confirmed, fixed.** Added one scoped 2px focus outline with 2px offset around each field wrapper. Removed the inner outline/shadow to avoid the old doubled glow. Computed focus contrast is 6.40:1 in dark and 5.23:1 in light in the production browser check. |
| L2 | **Confirmed, fixed.** Removed the nested page `main` from Login and the same duplication on Welcome. Astryx AppShell supplies the single main landmark. Harnesses now count both semantic `main` elements and `role=main`. |
| L3 | **Partly confirmed, fixed.** Restored the email cue while retaining the supported printed-slip path. Explicitly states the exam is proctored and camera/device setup occurs before entering a contest. Authentication instructions remain consistent with the actual flow. |
| L4 | **Confirmed, fixed.** Removed obsolete global Login CSS and the unused spinner rule after migrating the last input classes to scoped module styles. Native input attributes, credential formatting, submit behavior and error associations are preserved. |
| L5 | **Technical leftovers fixed; brand choice retained.** Removed the ignored generic-element ARIA label and renamed field classes to generic field names. Kept the minimal visible “Access” identity and useful preparation guidance requested for this redesign. The omitted slogan is an intentional copy/layout choice, not a functional defect; no separate product approval is claimed. |

## Verification and limits

- **344/344 tests**, TypeScript, and isolated production export passed. Export: 6.99 MB / 45 MB budget; largest JS chunk 0.46 MB / 0.49 MB budget.
- **369 browser assertions passed**: Login 121, Settings 134, Device 104, and production shared-consumer checks 10. Recorded 97 screenshots across these runs. The page suites exercise responsive, dark/light, failure, version, keyboard and support-report states using fixtures.
- **44 independent source checks passed** against 264 baseline files. Exactly 12 existing protected source files changed and one read-only version hook was added. Authentication, credential formatting, entry policy, recovery, media effects and scan handlers are preserved. API-client, backend/native and shared UI sources match this review's baseline.
- **Three WebKitGTK 2.52.6 route renders passed** at 1280×800 with local assets and no page-width overflow. These are fixture renders without a native command bridge, not full Tauri OS integration tests.
- Independent screenshot review found no new layout or data-honesty regression in Login focus/narrow layout, Settings unavailable/About, Device stale/narrow overview, disabled Submit and preflight typography.
- The production onboarding dry-run still emits the previously documented React hydration error 418. It is recorded in the manifest and predates this review ([P1 review](apps/web/theme-p1/review.md)); this pass does not claim an exception-free onboarding workflow. A preexisting green “blocked” label in the technical console also remains; the main readiness UI reports the blocked state correctly.
- The earlier `api.amsaccess.com` connectivity outage remains unresolved. Fixture login checks do not establish live authentication success; no hosting access, server changes or backend fix is claimed.

Evidence: [source audit](apps/web/dashboard-ui/validation/claude-source-review.json), [tests](apps/web/dashboard-ui/validation/claude-tests.log), [typecheck](apps/web/dashboard-ui/validation/claude-typecheck.log), [build](apps/web/dashboard-ui/validation/claude-build.log), [Login run](apps/web/dashboard-ui/validation/claude-login-browser.log), [Settings run](apps/web/dashboard-ui/validation/claude-settings-browser.log), [Device run](apps/web/dashboard-ui/validation/claude-device-browser.log), [production manifest](apps/web/dashboard-ui/claude-review-evidence/2026-09-30T18-57-24-527Z/manifest.json), [WebKit results](apps/web/dashboard-ui/native/claude-review/results.json).

## Later onboarding UI follow-up — 2026-10-01

The subsequent onboarding presentation task addresses the query-dependent hydration mismatch noted above using a mount-only scaffold. See the [onboarding review](apps/web/onboarding-ui/README.md) for its separate evidence and native-flow limits. The historical Claude-resolution results above are unchanged.
