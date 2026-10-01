# Pre-contest onboarding — Astryx UI

Completed and independently reviewed on 2026-10-01. The onboarding route now follows Home's neutral Astryx styling, with a clearer preparation introduction, responsive progress, consistent check panels, camera guidance, recovery feedback and final review.

[Change log](CHANGELOG.md) · [Independent review](review.md) · [Execution plan](../../../exectuion-page-wise.md)

## Progress follow-up

The subsequent progress-bar check found and fixed an almost invisible fill, stale completion indicators after retry, and frontend completion callback races. See [progress fix and verification](progress-review.md). That follow-up intentionally changes the frontend transition guard; the initial migration evidence below describes the earlier presentation-only slice.

## Initial migration scope

Sixteen existing onboarding source files changed. Backend, API-client, native code, entry policy, check callbacks, timers and media/detection behavior are preserved. A mount-only presentation scaffold fixes the previously observed query-dependent hydration mismatch. The viewport-constrained shell owns scrolling so lower recovery and continuation actions stay reachable.

## Verification

| Check | Result |
| --- | --- |
| Regression tests | 344 passed |
| TypeScript and isolated production export | Passed |
| Export size / largest JS chunk | 6.98 MB / 45 MB; 0.46 MB / 0.49 MB |
| Independent source audit | 137 passed; 16 changed files out of 266 baseline files, all within onboarding |
| Browser layout, interaction and reachability | 572 passed across 97 screen states, including actual wheel scrolling |
| Text contrast sampling | 701 passed; minimum measured 6.29:1 |
| Browser runtime/hydration errors | None; an existing Next smooth-scroll configuration warning remains on return to Home |
| Production WebKitGTK 2.52.6 | 13 captures passed; one main landmark, no horizontal overflow, dark lock preserved, usable vertical scroll regions, zero hydration/console errors |

Browser coverage includes the intro, all twelve check/review screens, final preparation/countdown, incomplete rehearsal results and permission/fallback states. Viewports: 1440×1000, 1280×800, 900×500, 390×844 and 320×640, plus focused 320px error screens. Independent review corrected a low-contrast meter label, duplicate heading spacing and inaccessible lower controls before acceptance.

[Tests](validation/tests.log) · [Typecheck](validation/typecheck.log) · [Build](validation/build.log) · [Source audit](validation/source-review.json) · [Browser manifest](browser/2026-10-01T16-39-05-704Z/manifest.json) · [Narrow error states](error-browser/2026-10-01T16-41-25-347Z/manifest.json) · [WebKit results](native/production/results.json)

## Screenshots

- [Preparation introduction](browser/2026-10-01T16-39-05-704Z/1280x800-intro.png)
- [Camera setup](browser/2026-10-01T16-39-05-704Z/1280x800-stage-07.png)
- [Final review](browser/2026-10-01T16-39-05-704Z/1440x1000-stage-12.png)
- [Narrow rehearsal actions](browser/2026-10-01T16-39-05-704Z/320x640-rehearsal-summary-incomplete-bottom.png)
- [Narrow camera recovery](error-browser/2026-10-01T16-41-25-347Z/320x800-camera-permission-error-bottom.png)

## Limits

These are isolated fixture renders and source comparisons, not live contest or hardware/OS lockdown certification. Browser-only state injection exists in the verification script, with no new application debug bypass. Production WebKit covers intro/first-stage rendering and hydration; later stage states are reviewed in Chrome fixtures. Real camera inference, native security operations and server entry still require native end-to-end testing.

The audit baseline is the pre-task working tree, not Git HEAD. Original support payloads and existing behavioral edge cases are preserved and documented in the change log. The API connectivity outage is not claimed resolved. The live app remains on http://localhost:3000 with hot reload; production builds used isolated temporary copies.
