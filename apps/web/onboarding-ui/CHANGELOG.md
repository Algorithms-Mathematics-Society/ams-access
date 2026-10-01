# Pre-contest onboarding UI change log

## 2026-10-01 — Astryx presentation migration

Scope: the onboarding route and its shared presentation components, twelve check/review components, progress and rehearsal summary. Application edits are limited to sixteen existing onboarding files. Backend, API-client, policy/support helpers, security commands, media ownership, face detection, timers and stage advancement are preserved.

### Layout and hierarchy

- Used Astryx's content-only AppShell reference and composed the wizard from appropriate components. The installed catalog's `Stepper` lookup resolves to NumberInput rather than a setup wizard, so the progress view uses accessible status rows and ProgressBar instead of assuming an unavailable API.
- Page budget: up to 1120px, 16–40px outer gutters, a 256px progress rail and 40px gap. Below 960px the rail becomes compact progress above the active check. The active panel uses 16–32px padding and vertical scrolling owned by the viewport-constrained shell.
- Moved Exit setup and its shortcut into a normal-flow header, eliminating overlap with the old fixed controls. Removed the extra viewport-height stage container below the progress header.
- Rebuilt the introduction as purpose/guidance beside an ordered preparation list and one clear Begin setup action. Practice mode remains explicit.
- Applied neutral surfaces, sentence-case headings, readable body text, consistent status feedback and restrained purple for current progress. Removed duplicate heading spacing after independent review.

### Stage changes

| Screens | Presentation changes |
| --- | --- |
| Fullscreen, display, keyboard | Measured metadata, compact status rows and readable recovery actions; removed unmeasured capability claims. |
| Environment, apps, virtualization | Clear checking/unavailable/flagged states and wrapping process details; removed fake Linux/x86 metadata. |
| Camera, face, presence | Responsive previews, aligned guidance and feedback, wrapping fallback action. Face canvas keeps its original 320×240 intrinsic geometry and detection coordinates. |
| Microphone | Live input activity using Astryx ProgressBar. Removed the invented decibel threshold and unmeasured background-noise claims; access/advance behavior is unchanged. Replaced the built-in dim label after a measured contrast failure. |
| Connection | Clear progress and helper feedback. Missing latency reads Not measured instead of nullms. Existing probe/helper behavior is unchanged. |
| Final review and entry | Neutral result labels, accurate blocked/incomplete/warning/success banner, preserved Continue visibility guard. Waiting/preparation wording no longer promises completion before the existing state confirms it. |
| Rehearsal results | Visible missing results are Not checked; review/transition steps are not presented as measured checks. Preserved the existing Help request payload and actions. |

### Hydration and accessibility

- Added a mount-only presentation scaffold so query-dependent practice copy does not differ between server output and the first client render. Query parsing and every existing native/API effect still run as before.
- One main landmark supplied by AppShell, visible status text alongside color, descriptive progress labels and responsive media bounds.
- Source audit explicitly checks event bindings and their visibility conditions, stage props, state/ref initialization, effect bodies, native/media calls, timers, policy helpers and emergency exit.

### Review corrections

- Initial AppShell auto-height let long content extend beyond the globally clipped document. Programmatic scrolling could hide this defect; a mouse-wheel test exposed it. The shell now fills the viewport and owns an actual scroll region, and the runner tests wheel scrolling and lower action reachability.
- Header spacing and the microphone label were corrected before the accepted captures. Earlier intermediate captures are retained as investigation evidence, not final acceptance.

### Boundaries

- No new debug route, bypass, mock server or application fixture was added. Browser state injection exists only in the disposable verification runner.
- Existing behavior outside UI scope remains: virtualization's null-result path, restricted-app retry/auto-advance timing, and the legacy rehearsal Help payload's absent-result mapping. These are not claimed fixed by presentation work.
- Browser/WebKit fixtures are not a live contest or hardware/OS lockdown certification. No real API availability claim is made.
- Production builds run in isolated temporary copies; the live development server is left running.

Accepted verification: 344 tests, TypeScript/production export, 137 source checks, 572 browser assertions across 97 states, 701 passing contrast samples and 13 production WebKit captures. Independent visual review approved the final layout, including wheel-accessible lower actions. See [README](README.md) and [independent review](review.md) for evidence and limits.


## 2026-10-01 — Progress and transition follow-up

- The main bar value already changed with completed checks, but the neutral fill (RGB 119) and track (RGB 118) were visually indistinguishable. Applied the existing theme’s high-contrast foreground variant to setup, microphone and face-capture progress. No new brand color or global theme override.
- Added a visible and accessible completed-step count. Secure entry stays pending at 12/13; the UI does not invent a completed entry.
- Retry progress ignores old results for the current and later steps, without modifying those stored results. Missing checks, warnings and policy blocks now retain truthful phase labels.
- Fixed a pre-existing frontend race: completion callbacks changing during the 300ms transition restarted check effects, while late callbacks from old steps could advance a new step. Added a guarded transition lifecycle, preserving check implementations and the entry finalizer.
- Added visible pending guidance while practice finalization completes; independent review found the previous card could be empty.
- Accepted follow-up: 362 tests, 159 browser checks, 133 source comparisons and production build passed. Details and boundaries: [progress review](progress-review.md).
