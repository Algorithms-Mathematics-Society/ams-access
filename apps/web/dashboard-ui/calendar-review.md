# Calendar and Astryx component review

This iteration adds the requested calendar and labeled navigation, then applies suitable Astryx components across the dashboard and its dialogs. The complete catalog audit is in [component-audit.md](component-audit.md).

## Placement and behavior

The desktop navigation panel is 280px wide. Home/Settings/Device are always labeled, and the contest calendar sits below those destinations on Home. The main area uses 24px gutters and column gaps, with a fluid contest list and 320px readiness column. On narrow windows, navigation uses the existing drawer and the calendar follows the dashboard content. There is one calendar in the DOM, with native month/day keyboard controls.

The calendar uses the assigned-contest schedule already fetched by the app. It shows starts on the selected local date, keeps practice untimed, and does not reschedule anything or alter entry rules. Selecting a date does not filter away the main contest list. Calendar selection resets when the calendar unmounts on a destination or responsive placement change.

Dialog frames now use native Astryx Dialog, DialogHeader and scrollable LayoutContent. The existing Help flow opens as a sibling native dialog above its parent. The shared wrapper preserves launcher focus even when callers unmount the dialog, including development StrictMode effect replay. Required/optional readiness groups use bounded Stack containers so library Section margins cannot bleed across grid columns.

## Review

The independent subagent reviewed source boundaries and desktop/narrow screenshots. It found the Section gutter overlap and development focus restoration issue; both were fixed and rechecked. The catalog audit records why unsupported or irrelevant controls were not added.

## Final validation

- Production build and TypeScript: passed. Export 6.94MB/45MB; largest JS chunk 0.46MB/0.49MB.
- Existing regression tests: 339 passed. Updated the obsolete style assertion from exactly two custom black scrims to zero; Astryx Dialog now owns the tokenized backdrop.
- Production browser: 114 interaction checks, 43 screenshots, zero failures. Covered calendar selection/keyboard/Today/local-only behavior, labeled navigation, search, loading/empty/error/schedule/resume states, passed-check disclosure, entry blocking, both Help layers, Escape/focus return, and short-height dialog scrolling.
- Responsive layout: 42 checks, 14 screenshots across 1440, 1280, 1024, 800, 390 and 320px widths. Verified calendar grid bounds, narrow readiness controls, shared gutters, action alignment, and minimum 24px Resolve targets.
- Text contrast: 560 enabled visible samples, minimum 6.51:1. This targeted audit is not a complete accessibility certification.
- Existing source-preservation checks: 20 passed. Two additional AST comparisons confirm unchanged Help submit payload/transport/response handling and resume approval/verification guards.
- WebKitGTK 2.52.6: six stages passed on the production export—desktop/narrow dashboard, readiness dialog, Help above readiness, closing Help alone, then closing readiness. Browser fixtures only; native security commands and real permission flows were not invoked.
- Independent subagent source and visual review: approved after the recorded fixes.

No test browser sends requests to a real backend; fixtures exist only inside disposable browser sessions. The only recorded browser exception category is the pre-existing denied-media `NotAllowedError: Permission denied`.

## Evidence

- [Desktop dashboard](calendar-evidence/2026-09-30T16-30-47-868Z/1280x800-dashboard.png)
- [Calendar at 320px](calendar-layout/2026-09-30T16-30-54-071Z/320x700-calendar.png)
- [Readiness dialog](calendar-evidence/2026-09-30T16-30-47-868Z/1440x1000-preflight-blocked.png)
- [Help above recovery](calendar-evidence/2026-09-30T16-30-47-868Z/390x844-resolve-help.png)
- [Interaction/contrast manifest](calendar-evidence/2026-09-30T16-30-47-868Z/manifest.json)
- [Layout manifest](calendar-layout/2026-09-30T16-30-54-071Z/manifest.json)
- [WebKit results](native/calendar/results.json)
- [Build log](validation/calendar-build.log), [tests](validation/calendar-tests.log), [source preservation](validation/source-review.json), [Help/resume source checks](validation/calendar-source-review.json)
