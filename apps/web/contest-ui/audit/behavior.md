# Contest behavior audit — 2026-10-02

Independent source audit focused on question/file navigation, draft writes, recovery, execution feedback, finishing, and support. No backend/native/API contract changes.

## Verified findings and fixes

1. **High: deferred save could change its target question.** The former global coordinator looked up the live `doSaveRef` when a pending write started. Start autosaving A, edit A again, then switch to B before the first response: the pending outgoing-A save becomes B. The latest A source was neither sent nor reliably buffered. `handleSave` now captures its render's immutable source/question closure and buffers synchronously; a serial queue coalesces pending writes only within the same question. Deterministic tests prove A-old → A-new → B preserves all targets, and a failed A does not strand B.
2. **High: recovery skipped questions with only a local draft and discarded scratch files.** Bootstrap enumerated only server draft rows and extracted only the active source into one main tab. It also cleared all local tabs when a single active-file server save succeeded. Bootstrap now enumerates the paper, restores local-only questions (including when loading server drafts fails), and restores the entire valid file workspace. Matching drafts retain scratch tabs without a false recovery notice; newer server answers take precedence while retaining unsynced scratch work. Clean saves retain multi-tab buffers.
3. **Medium: switching to another existing file did not mark its server draft for saving.** After a clean save, activating another file left the dirty flag false. File selection now buffers/saves the outgoing file and schedules the active file's draft normally. Read-only inspection does not schedule new edits.
4. **Medium: malformed local file records could reach the editor.** The buffer reader checked only that `files` was an array. It now rejects missing/invalid file fields, empty workspaces and duplicate IDs, and resolves a missing active ID to the first file.
5. **Recovery race follow-through:** local buffers update on editor changes, and acknowledged queued saves advance their revision baseline without replacing newer source. This prevents a slower older save from making the latest local edits appear older than the server at restart. Language-only changes at the same revision are also treated as changes.

The global-coordinator shape and recovery weaknesses existed before this audit; these are not attributed to the latest presentation-only tool changes.

## Validation

- Eight new deterministic tests in `draft-workspace.test.mjs` cover queue identity/order/coalescing, failure result routing, local-only/scratch restoration, server precedence, language-only changes, and invalid local data.
- Those eight tests plus the 16 existing answer-buffer tests passed (24/24).
- Root review owns browser reproduction, integration/typecheck, complete regression suite, and final independent review. This report does not claim real-server/native delivery certification.

## Remaining behavior boundary

The server still stores one active-file draft per question; other tabs are device-local. Existing UI communicates that scope. Actual delivery and native protection remain outside these fixture/unit checks.
