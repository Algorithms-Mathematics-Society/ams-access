# Contest audit changes — 2026-10-02

- `client.tsx`: immutable per-question save jobs, outgoing file snapshots, all-question workspace recovery, local buffering of unsaved edits and retention of scratch work after acknowledged writes.
- `draft-workspace.ts` and tests: bounded save queue, recovery precedence, complete workspace restoration, malformed storage coverage.
- `answer-buffer.ts`: validate buffered file shapes, duplicate IDs, active-file reference and revision values.
- `EditorPanel.tsx`: file activation goes through the save-aware handler; dismiss preferences outside/on resize; restore keyboard focus after theme/reset actions.
- `WorkspaceControls.tsx`: dismiss when keyboard focus leaves the menu.
- `ProblemPane.tsx`: remove conflicting width cap and flex shrink from percentage resizing.
- `WorkspaceResizeHandle.tsx`: measure the editor budget and actual output minimum before clamping divider values.
- Audit/regression runners, package test registration and evidence added. Backend/API/native implementations unchanged.

See [review and validation](README.md) for confirmed causes, evidence, ownership and limitations.
