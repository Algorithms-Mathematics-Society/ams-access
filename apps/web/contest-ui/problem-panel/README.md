# Problem panel organization — 2026-10-02

Presentation-only refinement of the contest problem panel using Astryx's detail-page and metadata patterns. No client state, save logic, API, backend, or native implementation was changed.

## Changes and rationale

- Use a single consistent inset for the panel header, title, metadata, tabs and statement.
- Consolidate the repeated “Problem” / “Problem A” labels into the persistent panel header.
- Place the title and a compact, accessible bookmark toggle on one row. The filled icon, pressed state and tooltip communicate the saved reminder without taking a full content row.
- Group actual points, time and memory into one quiet metadata strip with equal columns. At narrow panel widths it becomes aligned label/value rows. Missing limits are omitted, and valid zero points remain visible.
- Move section tabs below the problem summary: identify the problem first, then choose its content section. Use Astryx's own divider to avoid duplicated border styling.
- Align scoring labels and values; fix “1 tests” to “1 test”. Keep restrictions and their scoring consequences visible.
- Remove excess final-paragraph margin and obsolete camera-sized bottom padding from the statement panel. The camera remains in its existing question-rail location.

## Verification

Typecheck passed. **91 browser checks passed**: 32 focused panel checks and 59 existing workspace regression checks, with 34 screenshots total. Checked desktop, short desktop, 390px and 320px views, long titles, partial limits, zero points, bookmark state/persistence, section navigation, contrast, overflow and reachable scoring details. Visually inspected desktop, long-title and narrow scrolled layouts. Accepted runs have no runtime exceptions.

The existing tool runner now reads the bookmark's accessible name instead of expecting a visible text button. Focused tests account for Astryx heading semantics, `aria-current` navigation and the hidden duplicate tab label used by its typography implementation; early failed harness attempts are retained separately from the accepted manifests.

These are disposable frontend browser fixtures with media/native calls held pending. No live backend or native operations were performed.

- [Focused panel evidence](browser/2026-10-01T19-15-48-229Z/manifest.json)
- [Workspace regressions](tools-regression/2026-10-01T19-13-16-195Z/manifest.json)
- [Typecheck](validation/typecheck.log)
