# Welcome / Enter workspace review

> Historical slice report. The [2026-10-01 item-by-item review](../../../claude-review-resolution.md) supersedes earlier claims where noted, including report metadata, focus, landmarks and acceptance criteria. Source comparisons use pre-slice working-tree snapshots retained in [review-baselines](../../../review-baselines/README.md), not Git HEAD. Figures below describe the original captured run; later fixes have their own evidence.

Updated 2026-10-01 after the template-guided layout refinement. The landing page now uses the same neutral Astryx styling as Login and Home, with a restrained purple Access mark, clear purpose and one monochrome entry action.

## Template guidance and changes

Studied the installed Astryx `centered-hero` and `AppShellContentOnly` templates, plus Heading/Text/Stack/Button/Divider component APIs. Adapted the hero hierarchy and supporting lower region to this app; no external images or marketing controls were added.

- Added a compact Access mark/wordmark header matching Login.
- Enlarged the hero heading to a responsive 29–42px token scale, with balanced line wrapping and a 640px hero region. The previous display prop was overridden by the app theme's level-1 heading rule. The fix is local inline token styling; shared theme rules are unchanged.
- Used calmer supporting copy and a 44px minimum-height monochrome entry action with a short next-screen hint.
- Added an 800px maximum-width preparation region below a quiet divider. Three semantic ordered steps align horizontally on desktop and stack on narrow screens.
- Kept all regions in normal flow with token gutters, so short windows scroll naturally and the entry control stays reachable.
- Readiness claims remain absent: the page explains the flow without pretending device checks have already passed.

## Scope and review

Only `apps/web/src/app/WelcomeScreen.tsx` changed in application source. `page.tsx` and its original `router.push('/login')` destination remain byte-identical. The `onEnter` interface and callback and the existing ThemeToggle are preserved. There are no new API requests, native commands, storage operations, backend changes or authentication changes.

The first pass used subagent implementation. This refinement was implemented by the primary agent and independently reviewed by a subagent across desktop, narrow and short-window screenshots. The reviewer confirmed the improved hierarchy and source preservation. No blocking findings remained.

## Validation

- 339 existing tests passed; typecheck and production build passed.
- 14 source checks passed; all 260 protected source files outside WelcomeScreen remain unchanged.
- 143 production browser assertions passed, with 14 screenshots spanning dark and light at 1440×1000, 1280×800, 1024×800, 800×700, 390×844, 320×700 and 900×500.
- Checked horizontal overflow, control geometry, semantic main/heading, absence of readiness claims, absence of API/native calls, keyboard entry, pointer entry, theme toggle and preference persistence after reload.
- 168 enabled-text contrast samples passed; minimum ratio 6.23:1.
- WebKitGTK 2.52.6 rendered both themes and navigated to the real Login route at 1280×800 without horizontal overflow.
- Production browser run recorded no exceptions or console warnings. Export: 7.00 MB / 45 MB; largest chunk: 0.46 MB / 0.49 MB.

These checks verify the landing UI and route transition, not live authentication. The previously investigated API connectivity outage remains outside this UI slice. External requests were blocked in disposable browser fixtures. The existing desktop process remains running, and the development app is live at http://localhost:3000 with hot reload.

## Evidence

- [Production manifest](welcome-evidence/2026-09-30T18-41-06-724Z/manifest.json)
- [Desktop dark](welcome-evidence/2026-09-30T18-41-06-724Z/1440x1000-welcome-dark.png) · [Desktop light](welcome-evidence/2026-09-30T18-41-06-724Z/1440x1000-welcome-light.png)
- [Narrow](welcome-evidence/2026-09-30T18-41-06-724Z/320x700-welcome-dark.png) · [Short window](welcome-evidence/2026-09-30T18-41-06-724Z/900x500-welcome-light.png)
- [Source review](validation/welcome-source-review.json) · [Build](validation/welcome-build.log) · [Tests](validation/welcome-tests.log) · [Typecheck](validation/welcome-typecheck.log)
- [WebKit results](native/welcome/results.json)
