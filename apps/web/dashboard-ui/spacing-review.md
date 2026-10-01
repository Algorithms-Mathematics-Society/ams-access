# Dashboard placement and spacing review

Completed 2026-09-30. UI-only changes; requests, entry policy, timers, callbacks and native operations are unchanged. The app is live at http://localhost:3000 with hot reload.

## Corrections

- Search belongs to the contest section, fills its width and shares its left/right gutters with the rows.
- Contest and readiness headings align; the search control and readiness card share a top edge.
- Major section and column gaps are 24 px. Internal groups use 8–12 px spacing. No extra horizontal inset on contest/checklist rows.
- Removed the duplicated recovery separator and its additional 24 px top padding. Recovery details and actions align on one row when space permits.
- Actions stay aligned to the end of their rows, including wrapped actions and readiness transitions. Status dots center against their labels.
- Readiness uses a 320 px column, 16 px card padding and compact 49 px checklist rows. Labels and action targets remain readable.
- Navigation becomes a drawer at 1024 px, preserving a useful two-column dashboard at that window width. Narrower layouts wrap without horizontal scrolling.
- Preflight header now uses the same 24 px gutter as its contents. Label/progress, title and supporting text no longer compete with a fixed-width score block or nested padding.

## Measured desktop difference — 1280 × 800

| Region | Before | After |
| --- | ---: | ---: |
| Contest section top | 257 px | 181 px |
| Readiness bottom | 884 px | 736 px |
| Recovery bottom | 919 px | 770 px |
| Readiness height | 627 px | 555 px |
| Recovery height | 232 px | 147 px |

The normal two-contest fixture now fits the complete readiness and recovery sections in this desktop viewport, with at least 24 px below them. More contests and longer content remain scrollable.

## Verification

- 28 measured placement assertions passed at 1440, 1280, 1024, 800, 390 and 320 px wide.
- 58 interaction/layout assertions passed, with 29 screenshots including search/empty/loading/error, long text, approval states and short/narrow dialogs.
- 384 enabled-text contrast samples passed; minimum measured 6.51:1.
- All 339 existing tests passed; typecheck, production build and size budgets passed.
- All 20 protected-source comparisons still pass.
- Native WebKitGTK 2.52.6 rendering passed at 1280×800 and 800×700. Browser/native probes use isolated fixture data; they do not exercise real native lockdown or external services.

[Before measurements](spacing-before/2026-09-30T15-00-52-719Z/manifest.json) · [After measurements](spacing-after/2026-09-30T15-08-14-763Z/manifest.json) · [Interaction evidence](evidence/2026-09-30T15-08-16-739Z/manifest.json)

[Before desktop](spacing-before/2026-09-30T15-00-52-719Z/1280x800-dashboard.png) · [After desktop](spacing-after/2026-09-30T15-08-14-763Z/1280x800-dashboard.png) · [1024 px layout](spacing-after/2026-09-30T15-08-14-763Z/1024x768-dashboard.png) · [Narrow dialog](evidence/2026-09-30T15-08-16-739Z/390x844-preflight-blocked.png)

Only the previously documented denied-media rejections appear in browser fixtures. The source/API behavior has not been changed to suppress them.
