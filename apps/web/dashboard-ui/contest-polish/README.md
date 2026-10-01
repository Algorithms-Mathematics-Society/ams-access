# Home contest list organization — 2026-10-02

Scoped presentation refinement of the Home assigned-contest list. Entry handlers, readiness checks, API/backend calls, native protection and timing calculations remain unchanged.

## Changes

- Give the list one quiet surface and outer border, with straight dividers between its rows.
- Apply equal internal padding on all sides of each contest. Align status, organization, title, description and schedule to that inset.
- Group title and description together; organize date, exact local start/timezone and question count into evenly sized metadata columns.
- At narrow row widths, switch metadata to aligned label/value rows rather than squeezing or free-wrapping the fields.
- Place timing/helper text and the existing entry/results action in a consistent footer. Practice keeps its untimed format and existing Start practice action.
- Preserve calendar highlighting and row focus; round only the outside corners of the first/last row.

Implementation uses Astryx List, Stack, MetadataList, Text, Heading and Button, following the ListItemWithMetadata reference. CSS is scoped to home contest classes. No separate nested cards were introduced for list rows.

## Verification

**177 browser checks passed**: 157 existing Home usability checks and 20 focused layout checks. The focused checks cover equal padding, list boundaries, straight dividers, button containment, horizontal overflow and text contrast at 1440, 1280, 390 and 320px. Both saved theme preferences were exercised; Home retains its existing dark-lock behavior. Typecheck passed.

Visually inspected desktop and narrow contest layouts. Existing regressions cover search, calendar selection/focus/highlight, refresh, practice labels, draft/unavailable/ended states, recovery placement, navigation, support and preflight dialogs.

The existing regression harness recorded media-permission-denial events from its readiness probing (no camera footage was rendered). The focused final run explicitly holds media requests pending and has zero runtime exceptions or console errors. These are disposable fixture-browser checks, not verification of real backend availability or physical devices. No backend/native implementation changes were made.

- [Focused layout evidence](layout/2026-10-01T19-29-18-720Z/manifest.json)
- [Home regressions](regression/2026-10-01T19-26-06-425Z/manifest.json)
- [Typecheck](validation/typecheck.log)
