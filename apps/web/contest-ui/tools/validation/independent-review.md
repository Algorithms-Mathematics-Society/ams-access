# Independent review: contest workspace tools

Reviewed by the marks/limits subagent after implementation. This agent authored QuestionRail, ProblemPane and TopBar additions, so source review of those three files is not independent; their rendered layout and interaction evidence were also checked by the parent browser runner. The review of parent-owned workspace/results integration and the other agent’s editor preferences is independent.

## Outcome

No unresolved blocking findings in the reviewed implementation. The narrow preferences clipping found during parent visual review is corrected and independently retested. Integrated TypeScript checking passed. The root’s accepted browser manifest `2026-10-01T18-37-06-981Z` has 59 checks and 27 captures with no failures. The independent production WebKit run has 32 passing captures across five viewport/theme cases. The root’s recorded unit run has 381 passing tests; isolated production build succeeds.

## Findings corrected during review

- Narrow editor preferences fit the viewport geometrically but were clipped by their parent workspace/footer. They now use fixed, viewport-bounded placement in the normal DOM. Independent WebKit hit tests verify panel bottom visibility and the scrolled Reset button across every size; the 320 px final capture was visually inspected.
- Workspace popovers could extend beyond a 320 px viewport. Their fixed placement now measures the trigger and clamps horizontally; available height scrolls. Confirmed in Chrome and production WebKit.
- Ordinary popup Escape handlers could return focus behind higher-priority dialogs. Workspace controls now suspend and close during critical/support/media/finish overlays. Editor preferences close on overlay takeover; their window capture Escape listener defers to dialogs and works with the existing lockdown capture handler.
- A run from question A could finish after switching to B and overwrite B’s output. A presentation generation now rejects stale results after save, request and poll awaits. It does not change a backend endpoint or cancel a server run. The browser regression exercises delayed A-to-B results.
- Run source warnings could imply results after a failed POST. They now require an actual run result. Captured file/source/language attribution matches the request payload.
- Run records were cast into an incompatible submission shape and their returned diagnostics/testcases discarded. The existing `toAttemptRecords` adapter now preserves normalized status, verdict, compiler output and metrics; the run’s own testcases feed the output panel. The submissions endpoint is not queried for sample details from a run. Browser checks cover a real fixture POST/GET response and compiler diagnostics.
- Explicit non-sample testcase kinds now withhold output/checker details. Hidden/false flags override sample indicators; legacy unflagged rows retain existing behavior.
- The rail’s accepted status dot compared against an obsolete label. It now uses the stable AC short label.

## Source and behavior checks

Editor preferences reconfigure a CodeMirror compartment rather than replacing the editor. Separate tests preserve text, selection, undo/redo and read-only locking. Stored font/wrap values are validated; failed storage leaves usable in-memory settings. Existing themes and editor lock remain intact.

Resize controls use Astryx pointer and keyboard handlers; proportions are bounded and persist locally. Focus/restore preserves editor identity and previously collapsed rail/output state. Navigation brings the requested region into view without removing timer/security UI. Camera remains mounted.

Personal marks are local, session-scoped reminders. They do not alter judging, acceptance, submission counts or completion rules. The active toggle exposes pressed state, the collapsed rail exposes a labelled bookmark, and finish review calls it a personal reminder. Limits appear only for supplied finite values: zero points are valid; absent/nonpositive time and memory are omitted.

Expected/actual text uses escaped React content in whitespace-preserving, horizontally scrollable preformatted blocks. Compiler messages identify whether they belong to a sample run or last submission. The existing API type does not promise expected/actual output, so comparison blocks appear only when compatible returned data supplies it; no output is fabricated.

## Visual inspection and limits

Inspected Chrome desktop metadata/bookmark layout and sample-result hierarchy, plus production WebKit desktop, short preferences, and 320 px workspace/menu/scrolled preferences. The neutral styling, compact metadata and secondary bookmark action preserve the primary Run/Submit hierarchy. Short preferences scroll; narrow actions wrap and remain reachable.

All network outcomes and media are synthetic fixture evidence. This review does not certify backend availability, native protections, physical media, or real candidate delivery. No backend/API/native implementation changes were needed for this batch.
