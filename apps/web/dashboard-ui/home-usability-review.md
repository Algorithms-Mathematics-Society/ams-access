# Home usability review

Completed the seven accepted improvements within Home. Application changes are restricted to home/page.tsx and its home/components files; existing API/backend/native operations and entry rules are unchanged. Earlier unrelated local edits were preserved.

## Behavior and layout

Verified available recovery leads the main column; pending or unverified recovery stays below contests. The keyed sections retain component state when their order changes. Assigned contests prioritize live graded contests, then nearest upcoming, untimed practice, and inactive records. Date, exact local start time with timezone, and countdown remain together in wrapping metadata. Draft labels now read “Not published yet.”

Readiness uses full-row native button actions, retaining one keyboard target per failing check. Refresh sits beside Assigned contests and calls the original handler. Quiet empty recovery is one supporting line; actionable errors and approval/validation states remain visible. Get help is always available on Home and opens the unchanged shared form as a general request, without unrelated session identifiers.

Calendar agenda buttons clear a hiding search, focus and scroll to the existing contest row, and apply a temporary 2.5-second tint. They never trigger contest entry or a request. Navigation respects reduced motion, repeated selections reset the highlight, and leaving Home clears the target. The existing neutral search focus treatment remains intact.

The 280px desktop navigation/calendar panel, 24px main gutters and section gaps, and 320px readiness budget remain. Content wraps at narrow widths; metadata and action controls stay inside their columns. No new cards or decorative widgets were added.

## Review and validation

Three subagents implemented contest/readiness changes and independently verified source, interactions, and layout. Integration caught an incorrect Astryx Icon prop before completion; the final typecheck and rendered checks pass.

- TypeScript and production build: passed. Export 6.94 MB / 45 MB; largest JavaScript chunk 0.46 MB / 0.49 MB.
- Existing regression suite: 339 passed. Five additional sorting tests passed (stable input, chronological priority, phase changes, practice and missing dates).
- Production browser interactions: 157 checks passed, 54 screenshots. Includes calendar filtering/focus/highlight/keyboard/reduced motion, readiness keyboard activation, Help layering/Escape/focus return, refresh, unpublished/loading/error states, and verified/pending/unverified/empty recovery.
- Production responsive layout: 117 checks passed, 31 screenshots at 320, 390, 800, 1024, 1280 and 1440px, including long labels and quiet empty recovery. Independently reviewed representative desktop/narrow screenshots.
- Enabled visible text contrast: 644 samples, minimum 6.51:1. This targeted sampling is not a complete accessibility audit.
- Protected-source comparisons: 27 passed. Preserved data/action handlers, API imports, existing timers, entry/resume guards, and shared Help submission. Refresh relocation is explicitly matched to its original callback.
- WebKitGTK 2.52.6: six exported-route stages passed, including dashboard, readiness/Help layering and Escape. All recorded viewports were 1280×800; the offscreen resize attempt did not change the measured viewport. Responsive coverage comes from the Chromium layout suite above.

Browser checks use disposable fixtures and block external requests; no real credentials, submissions or native security commands were used. The only recorded exception category in successful browser runs is the existing denied-media NotAllowedError. The native desktop process remains running, and the development app is live at http://localhost:3000 with hot reload.

## Evidence

- [Desktop](home-usability-evidence/2026-09-30T16-57-56-595Z/1280x800-dashboard.png)
- [Interaction and contrast manifest](home-usability-evidence/2026-09-30T16-57-56-595Z/manifest.json)
- [Responsive layout manifest](home-usability-layout/2026-09-30T16-58-04-760Z/manifest.json)
- [Protected source audit](validation/home-usability-source-review.json)
- [Build log](validation/home-usability-build.log), [regression log](validation/home-usability-tests.log), [browser log](validation/home-usability-browser.log)
- [WebKit results](native/home-usability/results.json)
- [Change log](CHANGELOG.md)
