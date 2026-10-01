# Login Astryx review

> Historical slice report. The [2026-10-01 item-by-item review](../../../claude-review-resolution.md) supersedes earlier claims where noted, including report metadata, focus, landmarks and acceptance criteria. Source comparisons use pre-slice working-tree snapshots retained in [review-baselines](../../../review-baselines/README.md), not Git HEAD. Figures below describe the original captured run; later fixes have their own evidence.

Completed 2026-09-30. Login now matches Home and Settings with neutral surfaces, a monochrome primary action, restrained purple branding, clearer typography and responsive spacing. Both dark and light themes remain available.

## Layout and components

- AppShell with a compact Access/theme header and a semantic main landmark.
- The sign-in form comes first in reading order, with a 400px maximum width. On desktop a second column explains the actual sign-in → setup → contest sequence. Narrow windows stack the guide below the form and help action.
- Stack, Heading, Text, List and Divider replace decorative branding blocks. Spacing uses Astryx tokens; the page uses flexible columns, clamped outer padding and no fixed content height.
- Field wraps the existing native credential inputs, preserving their IDs and input semantics. Astryx TextInput generates its own IDs, so retaining native inputs avoids changing existing contracts. The handle suffix is vertically centered; the focused wrapper has a single neutral border without an inner purple glow.
- Button provides the primary sign-in and quiet help action. Banner presents the server's exact error text and optional diagnostic; both inputs reference the alert. The existing Astryx Help dialog is reused without changing its implementation.

## Scope and independent review

Application edits are limited to `login/page.tsx`, `login/components/BrandPane.tsx`, `login/components/SlipForm.tsx` and new `login/login.module.css`. The CSS is scoped to the Login page. Existing shared styles, other pages, backend code, API client, credential formatters and native commands are unchanged.

Two subagents implemented the shell/guidance and form; a third independently audited source and reviewed desktop/narrow screenshots. Review identified suffix alignment and a missing main landmark; both were corrected. Final independent review found no blocking issues.

The exact authentication handler, error branches, local-storage writes, success redirect, Help payload and field bindings are preserved. The password remains intentionally visible and formatted as before; this change does not add masking or a visibility toggle. API failure wording, loading guard, fixed suffix, normalization, autofill attributes, field limits and form submission semantics remain intact.

## Validation

- All 339 existing tests, TypeScript and production build passed.
- 42 source checks passed; all 257 protected source files outside the three original Login presentation files remain byte-identical to the task baseline.
- 115 production Chromium assertions and 28 screenshots passed across 1440×1000, 1280×800, 1024×800, 800×700, 390×844, 320×700 and a short 900×500 window.
- Additional narrow dark/light checks: 28 assertions and four captures for maximum-length handles, Help geometry, keyboard navigation and Escape/focus restoration.
- 328 enabled-text contrast samples passed; minimum measured ratio 6.23:1.
- Covered formatted full-handle input, visible password, native Enter submission, duplicate-submit prevention, invalid credentials, unreachable server diagnostics, upgrade/rate-limit errors, long messages, theme switching, Help submission payload/password exclusion, and successful redirect/storage.
- WebKitGTK 2.52.6 rendered the actual exported Login and Help dialog at 1280×800 without horizontal page overflow.
- Production browser manifests contain no runtime exceptions or console warnings. Static export is 7.00 MB / 45 MB; largest chunk is 0.46 MB / 0.49 MB.

All login/support requests used disposable intercepted fixtures; no real credentials or requests were sent to an organizer. Input paste behavior was exercised through CDP text insertion, not the system clipboard. Native OS authentication/permissions were not exercised. During native-dialog Tab cycling Chromium briefly reports body as the active element; keyboard assertions check that background controls are never reached rather than claiming every transition stays on a dialog element. The shared dialog was not changed.

The app is live at http://localhost:3000/login/ with hot reload. The existing native desktop process was left running.

## Evidence

- [Production manifest](login-evidence/2026-09-30T18-11-16-493Z/manifest.json) · [Narrow edge cases](login-edge-evidence/2026-09-30T18-13-57-534Z/manifest.json)
- [Desktop dark](login-evidence/2026-09-30T18-11-16-493Z/1440x1000-login-dark.png) · [Desktop light](login-evidence/2026-09-30T18-11-16-493Z/1440x1000-login-light.png)
- [Narrow login](login-evidence/2026-09-30T18-11-16-493Z/320x700-login-dark.png) · [Narrow light Help](login-edge-evidence/2026-09-30T18-13-57-534Z/320x700-help-light.png)
- [Source review](validation/login-source-review.json) · [Build](validation/login-build.log) · [Tests](validation/login-tests.log) · [Typecheck](validation/login-typecheck.log)
- [WebKit results](native/login/results.json)
