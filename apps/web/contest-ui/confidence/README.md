# Contest confidence first batch

Completed the first batch approved after the contestant/accessibility/recovery audit. The app remains live with hot reload on localhost:3000; the existing browser-only contest preview can be refreshed. No production deployment or push was performed for this batch.

## What changed

The editor respects its existing lock, including after switching questions/files. Support reports distinguish acknowledgement from failure. Draft saves, submitted source and historical results are separate. Run/Submit identify their active file. A keyboard-accessible finish review summarizes questions, pending judging and draft status; the receipt distinguishes session acknowledgement from draft acknowledgement. Recovered drafts are announced per question.

The review also reproduced and corrected an older-save/newer-edit autosave race. See the [complete change log](CHANGELOG.md) for the implementation and review corrections.

## Verification

- **372 tests passed**, including source-comparison/finish-retry regressions and CodeMirror command locking: [test log](validation/tests.log).
- **TypeScript passed**: [log](validation/typecheck.log).
- **Isolated production build passed**, leaving the live dev build intact: [build log](validation/build.log), [export metadata](validation/isolated-build.json). Static export 6.98 MB against a 45 MB budget; largest JavaScript chunk 0.46 MB against 0.49 MB.
- **66 browser checks and 28 captures passed**: [accepted manifest](browser/2026-10-01T18-09-41-845Z/manifest.json). Desktop 1440×1000 and 1280×800, stacked 900×700, narrow 390×844 and 320×640. Zero browser exceptions or unexpected errors.
- Browser interactions include actual typing under read-only states, file/question recreation, duplicate/pending/failed/successful support requests, actual active scratch submission and subsequent source mismatch, server-source matching, restored local drafts, unavailable/stale history, focus wrapping/Escape/restore, mandatory overlay precedence, and finish success/failure/final-draft warning states.
- The autosave regression defers an actual fixture PUT, edits again before its response, and verifies a subsequent PUT contains the newer editor text. Earlier failing manifests remain investigation evidence; `browser/latest.json` identifies the accepted run.
- **13 WebKitGTK production captures passed**: [results](native/production/results.json), [scope and reproduction](native/README.md). Includes 1280×800, 1024×600 and 390×844, support and finish dialogs, narrow scrolling, dark-lock behavior and no hydration/runtime errors.
- Protected-source comparisons cover **128 baseline files** and **84 API/native hashes**, with no changes outside contest source in the protected baseline: [hash review](validation/protected-source-review.json). Seven existing contest files changed, plus new local helpers/tests. Package test registration and documentation are additional scoped changes.

Implementation was split between editor and finish-review subagents, with an independent browser/source verifier and a separate production WebKit verifier. The [independent review](validation/independent-review.md) records final findings and scope.

## Limits

Network outcomes are exercised with disposable local browser fixtures. These checks do not establish real backend availability, physical camera behavior, OS lockdown correctness or delivery of a real candidate submission. Existing backend endpoints and native code are unchanged.

Historical submission responses do not include source, so “changed since submission” is available only for source snapshots acknowledged during this mounted workspace. Finish confirmation acknowledges session completion; it does not mean a draft was scored. No background retry is promised after leaving.

At 1024×600 with output expanded, the editor shows roughly six lines; the existing output-collapse control reclaims that space. Additional editor preferences and pane resizing belong to later recommendation batches.
