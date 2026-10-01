# Contest confidence first batch — 2026-10-01

Scope: the accepted first batch of contestant-facing improvements. Changes are confined to contest frontend components/helpers, test registration, verification scripts and documentation. Backend, API-client implementations, endpoint payloads and native protection code are unchanged.

## Implemented

- Forward the existing editor lock into CodeMirror and apply both DOM and command-level read-only settings after every question/file recreation. Disable code-changing controls while locked; retain selection, reading and externally supplied draft updates.
- Support reports show success only after a successful HTTP acknowledgement. Network failures, timeouts and unsuccessful responses retain the details and show an explicit retry/error message. Remove the delayed automatic success/close behavior and guard duplicate sends.
- Label the active filename as the sole source used by Run and Submit, with an explicit scratch-file notice. Keep the editor instance stable across status updates.
- Separate active-file server draft status from the last submitted attempt. Compare server-returned source and language instead of assuming an error-free state means saved. Keep historical acceptance labelled as an accepted submission. Rename the output summary from “Latest” to “Last submission”.
- Record successful submission source snapshots in memory by the acknowledged attempt ID. Show matching/changed-since-submission wording only when that exact snapshot exists. Historical API rows omit source, so they make no equivalence claim.
- Add a finish review with question-by-question submission coverage, pending judging, review links, active-file save status and explicit saved-versus-submitted guidance. Unknown history is shown as unknown; a failed refresh marks existing history as last loaded.
- Add safe initial focus, Tab containment, Escape handling compatible with the existing shortcut guard, focus restoration and suspension beneath required dialogs. Once finish starts, the receipt owns focus during teardown; the existing exit/unlock path still runs on failed acknowledgement.
- Separate “finishing”, confirmed session finish and unconfirmed session finish. A session acknowledgement does not imply the final draft save succeeded. Preserve an earlier acknowledged final draft across retries. A deadline-ended response does not prove finish acknowledgement. Remove unsupported background-upload, safe-to-leave-while-sending and fixed 48-hour result promises.
- Show a dismissible notice for a draft actually recovered from this device, scoped independently per question, and separately state whether its active file matches the server draft. Do not claim local storage writes always succeed.

## Review corrections

- A delayed-save browser scenario reproduced an existing race: an older successful PUT could clear the dirty flag during a newer edit’s debounce and cancel that newer save. The completion now checks the latest question/file/source/language before clearing dirty state or the local buffer; a newer active draft keeps its autosave scheduled. The regression uses real editor input and deferred mocked responses.
- Preserve a confirmed final draft save if a later retry is rejected after the session has already finished.
- Keep receipt visibility and focus ownership consistent, and prevent a suspended dialog’s cleanup from stealing focus from a higher-priority dialog.
- Do not present unavailable submission history as zero submissions.

## Boundaries

Finishing uses the existing finish endpoint; submitting a solution uses the existing submission endpoint. No new server guarantees are inferred. Per-attempt source comparisons survive only for this mounted workspace because historical responses do not contain source. Checks use disposable browsers and synthetic API/media/native fixtures; they do not certify a live server, physical camera, OS lockdown or a real candidate submission. At short desktop heights the output can be collapsed to reclaim editor space; editor preferences and additional workspace resizing remain outside this batch.

See [validation overview](README.md) and the adjacent validation/browser/native evidence.
