# Contest workspace tools — 2026-10-02

This implements the next approved contestant-facing batch. Scope is the contest frontend, local preferences, test registration, verification and documentation. Backend/API/native implementations are unchanged.

## Features

- **Mark for later:** a neutral bookmark action under the active problem title, a count and indicators in expanded/collapsed question navigation, and a personal-reminder label in finish review. Marks persist by session on this device and never affect judging, submission counts or acceptance.
- **Problem limits:** actual supplied points, time and memory appear in a compact Astryx metadata row under the title. Zero points remain valid; missing, invalid or nonpositive time/memory values are omitted.
- **Workspace controls:** one header button contains Focus editor/Restore workspace, direct navigation to Problem/Code/Output, and Reset layout. Focus mode keeps the editor and camera mounted and preserves the prior rail/output collapse state. The existing security footer and timer remain visible.
- **Resizable panes:** Astryx ResizeHandle supplies pointer and keyboard controls for the problem/editor split and output height. Bounded proportions persist locally. Reset restores the original 35% statement and 34% output defaults. A lower output minimum gives short desktop windows more editing room.
- **Editor preferences:** the existing settings panel now includes 12–20 px font size, word wrap, existing themes, reset and an explicit close button. Validated local preferences reconfigure CodeMirror compartments without losing text, selection, undo/redo or read-only behavior. Theme/preferences reapply after switching files/questions.
- **Execution results:** public sample mismatches use separately labelled expected/actual preformatted blocks, preserving whitespace and horizontal scrolling. Explicit hidden/false/non-sample kinds never expose output/checker details; legacy unflagged payloads retain existing handling. Empty output and absent judge data are different states. Run status and historical submission status remain distinct.
- **Result provenance:** show the captured filename/problem for a run and warn when code or language differs from that snapshot. Progress uses Queued → Judging → Result, without inventing a compiling phase that the existing data does not report.

## Review corrections

- Suppress late presentation updates when a run from question A completes after switching to another question; server execution is not cancelled or modified.
- Normalize the existing run response through the existing attempt adapter, retaining verdict, compiler diagnostics and timings. Use that run’s returned testcases; the submission-history endpoint excludes runs and cannot supply their samples.
- Do not fall back to an earlier submission’s compiler output when showing a newer run that has no compiler diagnostics.
- Ordinary Workspace/preferences popovers close beneath higher-priority dialogs and do not steal focus back. Escape works alongside the existing shortcut guard.
- Clamp Workspace popovers to the viewport. Bound preferences to the viewport as well, fixing a visually detected narrow-screen case where the workspace/footer clipped the panel. Long preferences remain internally scrollable.
- Use the stable AC status key for the accepted question dot after its label changed in the prior batch.

## Evidence and limits

See [validation overview](README.md) and [independent review](validation/independent-review.md). All backend responses and media in browser tests are synthetic. No real candidate data is submitted, no native protection commands are exercised and backend availability is not certified.

The existing typed API does not promise expected/actual text for every run. Comparisons appear when returned data supplies them; available verdicts, diagnostics, checker messages and timings are shown without fabricating missing output. Local marks/preferences apply to this device and depend on browser storage; marks remain usable in memory when storage is unavailable.
