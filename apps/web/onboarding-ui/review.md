# Independent onboarding presentation review

The review compares this onboarding slice with `review-baselines/onboarding-ui-baseline`, a snapshot of the working tree immediately before this task. It does not compare against Git HEAD or claim that unrelated historical working-tree changes belong to this task.

## Scope and method

- Source audit: TypeScript AST comparisons of every stage's effects, state initialization, refs, non-render helper bodies, timers, native/media calls, actionable event handlers and their visibility conditions. The orchestrator's entry decisions, secure-start callback, stage advancement, emergency exit, organizer override calls, native policy commands and stage props are compared with the baseline. Existing support and policy helpers are hash-identical.
- Browser review: disposable Chrome profile, local assets only, intercepted fixture requests, native/media commands held pending. The real Begin setup action is clicked. Later screens are rendered using browser-only React state dispatch; this exists exclusively in the verification script and does not introduce an application debug route or bypass.
- Render coverage: introduction, each of the 12 visible steps, policy error, incomplete rehearsal results, secure-start preparation, countdown waiting, and selected permission/application errors. Five viewports cover 1280×800, 1440×1000, 390×844, 900×500 and 320×640.
- Layout assertions: one main landmark, no horizontal body overflow, controls and media fit the viewport, Exit setup remains rendered, and incomplete rehearsal results are not described as passed. Long pages have supplemental full-height captures.

## Deliberate presentation differences

- A mount-only presentation scaffold prevents the server's empty query string and the browser's practice-run query string from producing mismatched initial markup. Query parsing, API calls, gates, and all original effects remain unchanged.
- Progress and rehearsal summaries display absent results as pending/not checked. The existing help request's report payload is unchanged; this review does not silently alter that API contract.
- Final preparation and waiting wording reflects the existing `readyForStart` state instead of claiming verification is complete while secure start is still preparing.
- New Astryx wrappers, responsive media geometry, accessible status presentation and token colors change presentation only.

## Final results — approved for this UI slice

- **137 independent source checks passed**, covering 266 baseline files. Only the 16 onboarding presentation files changed within that protected snapshot.
- **572 browser checks passed across 97 captured states**: the main five-viewport suite contributes 531 checks and 91 states; the additional 320px permission/fallback suite contributes 41 checks and 6 states. Supplemental bottom-of-page screenshots record actual wheel scrolling and reachable actions.
- **701 visible text contrast samples passed**. The lowest measured ratio was **6.29:1**, above the 4.5:1 requirement for normal text.
- No runtime exceptions, hydration errors, or console errors occurred. Each suite recorded one existing Next.js warning about the global smooth-scroll setting when navigating back to Home; this is outside the onboarding presentation slice.
- Real interactions covered Begin setup, unblocked review Continue reaching the existing rehearsal native-call boundary, blocked review hiding Continue, and Ctrl+Shift+Q invoking the existing restoration commands before returning Home. Native responses are fixtures, not real OS operations.

Evidence:

- [Independent source audit](validation/source-review.json)
- [Five-viewport browser manifest](browser/2026-10-01T16-39-05-704Z/manifest.json)
- [320px permission/fallback manifest](error-browser/2026-10-01T16-41-25-347Z/manifest.json)
- [Camera step at 1280px](browser/2026-10-01T16-39-05-704Z/1280x800-stage-07.png)
- [All review rows at 1440px](browser/2026-10-01T16-39-05-704Z/1440x1000-stage-12.png)
- [Rehearsal actions reached by scrolling at 320px](browser/2026-10-01T16-39-05-704Z/320x640-rehearsal-summary-incomplete-bottom.png)
- [Camera permission actions reached by scrolling at 320px](error-browser/2026-10-01T16-41-25-347Z/320x800-camera-permission-error-bottom.png)
- [Face-check fallback action reached by scrolling at 320px](error-browser/2026-10-01T16-41-25-347Z/320x800-face-proctor-fallback-bottom.png)

Independent visual review covered desktop introduction and waiting states, all media screens, final review, narrow introduction/progress/cards, the short-window camera view, incomplete rehearsal results, keyboard permission guidance, restricted applications, camera permission failure, and the proctor fallback. Alignment, consistent stack spacing, responsive previews, status labels, and the lower actions were checked. The fixed scroll region resolves the previously inaccessible lower actions without changing their handlers.

## Limits

Rendered-state fixtures do not prove hardware camera capture, face inference, operating-system lockdown, organizer override polling against a real server, or entry into a live contest. Those operations retain their original code and still require native end-to-end validation on supported operating systems. No backend changes or real contest sessions are performed by this UI harness.

## Defects caught during review

- The new microphone meter's built-in disabled label rendered at 4.18:1 on the card surface. It now has a separate readable secondary-text label and an accessible, visually hidden meter label. The final browser run samples all stages and permission/error variants, requiring 4.5:1 for normal text and 3:1 for large text.
- The initial camera-error fixture did not account for Stage 7's existing theme hook state. The harness now requires an exact hook count, discovers the theme-hook offset, and asserts that the actual camera error/retry content is visible. This was a verification-harness issue; no application behavior was changed.
- Review rows retain their original staggered appearance delay. The harness waits for all 11 check rows before reviewing final-review screenshots and Continue behavior, so incomplete animation frames are not mistaken for final page layout.

- A more serious vertical layout issue was found during visual review of the 320px permission and fallback screens: `AppShell height="auto"` expanded beyond the app's globally clipped body, leaving lower actions unreachable. The shell now uses fill mode with viewport height. The harness explicitly checks for a scrollable overflow region, scrolls it with actual mouse-wheel input, captures its bottom, and verifies that the final action is inside the viewport. This applies to the introduction, all steps, summaries, and error states; horizontal-fit assertions alone were insufficient.
- The shared stage heading had bottom margin in addition to its parent stack gap, making title-to-body spacing too large. Removing that extra margin restores a single spacing owner and reduces unnecessary vertical scrolling.
