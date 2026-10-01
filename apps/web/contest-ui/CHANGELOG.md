# Contest UI change log

## 2026-10-01 — Astryx workspace

### Implemented

- Migrated the shell, header, question rail, statement, marking information, editor controls, output/attempts, camera framing, footer, loading/error states and overlays to Astryx components and theme tokens.
- Replaced cramped icon-only header actions with labeled Help and Finish contest controls. Kept finishing the contest distinct from submitting the active solution.
- Made question status explicit and separated question progress from the timer. Timer urgency remains driven by the original server-clock hook.
- Kept neutral primary actions consistent with Home and onboarding; purple remains restrained in the brand, selected tabs and editor highlighting. This refines the older plan's purple-submit treatment without changing the action.
- Improved statement hierarchy, markdown spacing, sample code surfaces and marking metadata while retaining sanitized HTML, math/assets and sample-copy handling.
- Reorganized editor file and execution controls, preserving the module-scope lazy editor, its identity and original props. Kept native language selection to avoid top-layer conflicts.
- Added readable output phases, sample-run context, attempt filters and dense testcase rows while preserving existing result precedence, masking and per-question scoping.
- Restyled required blocks without changing their triggers or dismissal policy. Support now has a compact issue selector, optional detail input and keyboard-accessible diagnostics disclosure. Removed the invented telemetry ticket ID from success copy.
- Added responsive panel stacking with real scrolling, retaining the original desktop splitter dimensions and persistence.
- Improved the default editor's comment/gutter/muted text contrast through three palette values. Optional syntax themes and editor behavior are unchanged.

### Review corrections

- Removed an unconditional progress spinner after completed, failed or timed-out runs.
- Removed the output tab strip's unnecessary vertical scrollbar.
- Cleared the statement's desktop max-width in stacked layouts.
- Included the support diagnostics disclosure in the existing focus trap using tabindex.
- Used the existing camera status label so turning the camera off cannot display an active-camera label.
- Corrected undefined draft theme-token names before acceptance.
- Verified actual typing and retained drafts, scratch file lifecycle, splitter persistence, identity during collapse, support keyboard behavior, narrow mouse-wheel scrolling and mandatory overlay priority.

### Evidence and boundaries

362 tests, 147 source comparisons, 49 browser checks, 388 contrast samples, TypeScript, production export and 13 WebKit captures passed. Independent agents implemented separate presentation regions and reviewed source, screenshots and WebKit output. No backend/API/native changes. Full hardware/OS security and live-server workflows remain outside this UI verification.

See [verification overview](README.md) and [independent review](validation/manual-review.md).

## 2026-10-01 — Contest confidence first batch

Implemented the accepted first batch: editor read-only propagation, truthful support feedback, distinct draft/submission status, active-file scope, finish review and acknowledgement receipt, and visible recovery feedback. Independent review also corrected a reproduced stale-save completion race, retry acknowledgement loss and unknown-history wording. These are scoped frontend behavior corrections beyond the preceding presentation-only migration; backend/API/native implementations remain unchanged.

See [detailed change log](confidence/CHANGELOG.md) and [verification](confidence/README.md). Later recommendation batches remain unimplemented.

## 2026-10-02 — Workspace tools and result clarity

Added the requested personal bookmarks, problem limits, persisted workspace resizing and focus/navigation controls, editor font/wrap preferences, and clearer execution results. Corrected run-result attribution and response adaptation while preserving backend/API/native implementations. Changes and evidence: [workspace tools](tools/README.md).

## 2026-10-02 — Contest regression audit

Completed a delegated behavior audit plus integration/layout review. Fixed outgoing draft-save races, local-only/scratch recovery, invalid local buffers, menu/focus glitches and inconsistent resize bounds. Evidence: [audit report](audit/README.md).

## 2026-10-02 — Problem panel organization

Refined title/bookmark placement, limit metadata, section navigation, inset spacing, borders and scoring rows. Added responsive label/value presentation for narrow panels. Presentation only; 91 browser checks and typecheck passed. [Changes and evidence](problem-panel/README.md).
