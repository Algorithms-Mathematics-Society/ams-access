# Onboarding progress follow-up — 2026-10-01

The bar's numeric value already updated. Its neutral fill was effectively invisible against the track: RGB 119 versus RGB 118. The fix uses the existing theme's high-contrast foreground variant, with a visible completed-step count and matching accessible value text. The same correction applies to microphone activity and face-capture progress.

## Correctness fixes

- Progress counts completed pass/warn results before the current step. Retrying a check no longer shows stored future results as completed. Stored security results are untouched.
- Warnings remain visible within active and completed phases. Policy blocks show Needs action. Missing checks are not labeled complete.
- Step 13 remains at 12/13 while entry or rehearsal finalization is pending. Practice finalization now has guidance and a spinner instead of an empty card.
- Fixed a pre-existing frontend transition race: changing the completion callback during the 300ms animation restarted stage effects, duplicating check rows. Late timers from previous stages could then advance the current stage.
- Completion callbacks are now stable per visit, with a synchronous duplicate-call lock and a distinct identity for each visit, including retries. Old callbacks cannot skip a stage or overwrite its result. Transition timers are cancelled on unmount or stage change. External stage changes clear stale dimming. Finalization is invoked outside React's state updater through the latest committed callback.
- Browser testing caught a native timer receiver requirement during implementation; global timer wrappers and a dedicated regression test cover it.

## Accepted verification

| Check | Result |
| --- | --- |
| Full regression suite | 362 passed, including 8 progress and 10 transition regression tests |
| Browser checks | 159 passed; 10 screenshots at 1280×800 and 320×640 |
| Runtime/console errors | None in accepted run |
| Progress geometry and contrast | Numeric value matches rendered width at every step; fill/track contrast exceeds 3:1 |
| Stage transitions | Real completion callbacks exercised with duplicate and late invocations; each advances once |
| Retry and interruption | Real Run checks again action resets displayed progress; interrupted transition does not leave the new stage dim |
| Meters | Microphone updates 25→75; face progress renders 45; values match actual fill width |
| Production build | Passed, including TypeScript; isolated copy preserves live hot reload |
| Source audit | 133 passed; four existing source files changed from this follow-up baseline, all within onboarding |

[Browser manifest](progress-evidence/2026-10-01T17-03-18-993Z/manifest.json) · [Tests](validation/progress-tests.log) · [Source audit](validation/progress-source-review.json) · [Build](progress-validation/build.log)

## Review and scope

A subagent investigated and implemented the transition guard; the root agent reviewed the implementation and exercised the actual browser callbacks. A second subagent independently reviewed progress semantics/layout and identified the missing practice finalization UI, which was corrected before the accepted run. Desktop and compact screenshots were visually inspected.

The source audit compares the working tree captured immediately before this follow-up. Every existing stage effect, handler, timer, media operation and native command is unchanged. Entry policy, finalizer implementation and API calls are unchanged. Only the frontend completion coordinator and the rendered progress/pending states changed. No backend, API-client or desktop/native source changes were made.

These browser tests use isolated fixtures and real frontend callbacks, not a live contest: hardware/media operations are held pending and intermediate states are seeded in disposable browser documents. They verify frontend progress and transition behavior, not native lockdown or camera inference. No application debug bypass was introduced. The existing API outage is outside this fix.

Earlier failed/intermediate manifests remain investigation evidence; the accepted run is the linked manifest above. The initial migration's separate 344-test/137-source-check evidence is historical and does not claim that this follow-up preserves the old transition coordinator.
