# Independent source review

Reviewed against `review-baselines/contest-ui-baseline` before current contest UI migration.

## Source boundary

The independent AST audit currently checks 147 invariants across 264 protected hashes. All original non-render statements in `ContestPageClient` remain unchanged, including effects, callbacks, timers, persistence, networking, native operations, question state, autosave and expiry. Original component business props, editor identity/bindings, camera video lifecycle attributes, sanitized HTML binding and disabled expressions are preserved.

Explicitly reviewed equivalents:

- Support RadioList/TextArea emit string values directly, replacing native event `.target.value` adapters with the same setters.
- Three mutually exclusive end-state branches now share identical Home/results navigation actions. They remain under `timeUpState !== "idle"`.
- Support success now provides a Back to contest action using the existing close setter. The former invented report identifier is removed.
- File close confirmation is rendered outside the horizontal file scroller. `pendingFile` resolves the same scratch file ID, preserving the main-file exclusion and deletion action.
- Astryx TabList and SegmentedControl preserve the existing problem section, output view and attempt-filter setters.
- Removed mouse handlers only changed presentation styles; run/submit action guards remain unchanged.
- Mandatory overlays remain ordinary DOM layers with original focus refs, preventing optional native top-layer controls from escaping a proctoring block.

## Findings corrected

1. Compact problem panel needs to clear its desktop max-width, otherwise 768–1000px stacked layouts remain capped at 680px.
2. Run progress Spinner must be gated by `isRunning`; a result/error keeps `shouldShowRunProgress` true and must not indicate continuing work.
3. New support diagnostics `<summary>` needs `tabIndex={0}` because the preserved focus trap includes explicit tabindex elements but not native summary elements.
4. Output tab-strip scroller shows an unnecessary vertical scrollbar; set overflow-y hidden while preserving horizontal scroll.

## Existing behavior outside this presentation change

EditorPanel already accepted `readOnly` without forwarding it to EditorPane in the baseline. This is not introduced by the migration. It was reported to the parent separately; strict preservation review does not treat it as a newly introduced regression.

## Final source and visual review

Approved source and static rendered layout for `browser/2026-10-01T17-42-40-850Z`: 35 captures and 49 passing checks, no runtime exceptions/failures. Independently inspected 1280/1024 desktop layouts, 900 stacked layout, 390/320 narrow layouts, narrow support dialogs, mandatory block above support, face block, attempts, final-submit confirmation, camera error and submitted/error end states. No clipping, overlap or readability blockers found in these captures. Desktop editor area remains usable; narrower layouts use a scrollable stacked composition. The support dialog fits 320px and keeps its actions visible.

All four reported findings are corrected. The source audit additionally proves the CodeMirror file changes only three AMS Terminal text palette entries and the legacy contrast test changes only migrated inline-action counts. Camera status text now uses the existing status label, preserving off-priority without changing media behavior.

Final targeted interaction checks pass: real CodeMirror typing and draft retention across questions; scratch creation/cancel/removal; splitter drag and stored width; keyboard access to diagnostics and focus trap; actual wheel scrolling to the editor on narrow layouts; completed-run spinner removal; hidden-test masking; compiler error display. Independently inspected the additional run-error, running, compiler-error and scratch-confirmation screenshots with no visual blockers.

The accepted Chrome run has 388 contrast samples with minimum 6.51:1 and no runtime errors. Production WebKitGTK verification (`native/production/results.json`) passes 13 fixture captures. Root verification also reports 362 tests, typecheck and isolated production build passing. Source audit remains 147/147 passing.

**Final signoff:** approved for this UI-only contest migration. No outstanding source or rendered-layout review findings. Native fixture coverage verifies the WebKit rendering engine; it does not certify real OS lockdown, live camera hardware or remote judging.

Browser fixture checks cannot certify native OS lockdown, actual camera hardware or remote judging availability.
