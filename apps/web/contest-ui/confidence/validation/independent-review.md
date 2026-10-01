# Independent review — contest confidence first batch

Reviewed 1 October 2026 by a verification agent that did not edit application source. **Approved for this frontend batch**, with the limitations below.

## Evidence

- Final disposable Chrome run: [manifest](../browser/2026-10-01T18-09-41-845Z/manifest.json). **66 checks passed**, 28 captures, five viewport sizes: 1440×1000, 1280×800, 900×700, 390×844, 320×640.
- 338 sampled visible text contrast comparisons passed; minimum measured ratio 6.51:1. No runtime exceptions or unexpected console errors. Two expected console errors came from explicitly injected submission-history HTTP failures.
- [Source review](../source-review.json): 42 checks passed against the working-tree snapshot taken immediately before this batch. 128 protected files checked; existing changes are confined to seven declared contest frontend files. The 84 protected API-client/native/other non-contest files remain unchanged. Native/media/lockdown/paper-loading calls and unaffected existing handlers are preserved.
- [Regression runner](../../../../../scripts/contest-confidence-verify.mjs) uses the real rendered client, CodeMirror input, real handlers and browser-only API fixtures. Rendered security/connection branches also use React state dispatch. Media and native checks remain pending; only synthetic exit stubs resolve during finish tests. The user's visible preview session is never finished.

## Verified behavior

- Read-only reaches CodeMirror, blocks actual insertion, survives switching between main/scratch files and questions, and becomes writable again after connection recovery. File creation and language changes are disabled while locked.
- Run/Submit explicitly identify the selected file. An actual scored submission sends the scratch file's source. Historical acceptance makes no unsupported source-match claim; a locally witnessed successful submission shows a match, then reports subsequent edits or file changes correctly.
- Rejected and non-successful support requests retain the entered detail and show a retryable error. Pending requests do not claim delivery; a successful response alone shows Report sent.
- Finish review lists both questions, explains draft saves versus judged submissions, starts focus on the safe return action, traps forward/backward Tab, handles Escape despite the existing lockdown listener, restores trigger focus, and returns to a selected question. Mandatory security overlays take priority.
- Unavailable and stale submission history are explicitly qualified. Missing history does not imply zero submissions.
- Recovery fixtures use a real persisted local answer buffer with a newer revision than the server. Recovered source reaches the editor and a restoration notice appears; that source is not described as saved to the server merely because it was restored locally.
- Actual finish handlers distinguish pending, confirmed and unconfirmed outcomes. Successful session finishing with a failed draft save shows the independent draft warning. Failed finishing exhausts four existing bounded attempts and does not promise an unattended background retry.
- Narrow layouts have no horizontal page overflow. The editor remains reachable through actual wheel scrolling. The finish dialog stays within viewport width and its content/actions remain scrollable.

## Regression found and fixed during review

A delayed autosave response could clear the dirty flag after a newer edit, cancel that edit's pending debounce and prevent its next save. This was reproduced with actual CodeMirror input: first type while a PUT is pending, type again, then resolve the older PUT before the next debounce. The initial failing evidence is retained under `browser/2026-10-01T18-07-29-100Z`.

The parent fixed completion handling to compare the returned source with the latest active question/file/source/language. An old completion no longer clears a newer edit's dirty state or local buffer. The same browser regression now passes: the newer source reaches a subsequent PUT. Final source review includes this narrowly scoped frontend fix.

## Visual review and limits

Manually inspected desktop workspace, 320px finish review, stale-history review, and confirmed finish with unconfirmed draft. Spacing and hierarchy remain consistent with the Astryx contest workspace; alerts distinguish acknowledgment uncertainty without an unsupported success statement.

These browser fixtures verify frontend behavior and layout, not production API availability, actual judge results, native security effectiveness, real camera behavior, or real server delivery. Source matching is intentionally limited to attempts whose submitted source was observed in the current mounted client. The existing recovery algorithm and its server-draft-key coverage are not expanded by this batch. Unrelated recommendations from the earlier broader audit remain outside this first batch.
