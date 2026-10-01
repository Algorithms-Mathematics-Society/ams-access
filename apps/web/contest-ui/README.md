# In-contest workspace — Astryx UI

Completed on 2026-10-01 with delegated implementation and independent source/visual review. The workspace now follows Home and onboarding: neutral surfaces, readable text, consistent controls, restrained purple accents and clear separation between editing, running a sample, submitting a solution and finishing the contest.

[Change log](CHANGELOG.md) · [Independent review](validation/manual-review.md) · [Execution plan](../../../exectuion-page-wise.md)

## Layout

- A 64px desktop header separates contest identity, countdown, Help and Finish contest.
- The question rail retains its existing 220px/52px dimensions, preserving the splitter's coordinate math. Selected rows have readable titles and explicit statuses.
- The statement retains separate tabs and scrolling, with normalized markdown, examples, code blocks and marking information.
- Editor file controls and execution controls have distinct strips. Output uses a separate tabbed region, retaining collapse behavior and per-question attempts.
- Below 1000px, the same mounted panels stack inside a scrollable workspace. Editor and camera elements are not conditionally duplicated for mobile.
- The camera stays mounted and is hidden by display when the question rail collapses. The footer gives readable security, camera, connection and saving feedback.
- Support, confirmation, warning and completion surfaces use the same spacing and typography. Required overlays retain their existing priority over ordinary controls.

## Verification

| Check | Result |
| --- | --- |
| Existing regression suite | 362 passed |
| TypeScript / isolated production build | Passed |
| Export / largest JS chunk | 6.97 MB / 45 MB; 0.46 MB / 0.49 MB |
| Independent source audit | 147 passed against 264 protected hashes |
| Chrome UI checks | 49 passed across 35 captures |
| Text contrast | 388 samples passed; minimum measured 6.51:1 in accepted workspace captures |
| Chrome runtime / console errors | None in accepted run |
| Production WebKitGTK 2.52.6 | 13 captures passed; no runtime, console or hydration errors |

Chrome coverage includes six window sizes, question switching, draft retention, scratch creation/cancellation/removal, saved splitter position, editor/camera identity during collapse, support typing and focus containment, camera recovery, required-block layering, sample execution/results, hidden-test masking, compiler errors and contest completion states. Actual mouse-wheel scrolling reaches the editor on compact layouts. WebKit verifies desktop/short/narrow layouts, dialogs, dark lock and below-fold editor access.

[Tests](validation/tests.log) · [Typecheck](validation/typecheck.log) · [Source audit](validation/source-review.json) · [Build](validation/build.log) · [Accepted browser manifest](browser/2026-10-01T17-42-40-850Z/manifest.json) · [WebKit results](native/production/results.json)

## Preserved behavior and limits

No backend, API-client or desktop/native source changed. Source comparison confirms the contest's business declarations, effects, callbacks, native/API calls, timing, storage operations and child bindings remain intact. Editor changes outside presentation components are limited to three default-theme contrast values. The legacy contrast test only stops requiring inline action styles that were replaced by Astryx buttons; palette contrast checks remain active.

Native language selection and normal-DOM dialog compositions are intentional: introducing top-layer popovers/dialogs could place ordinary controls above mandatory proctoring overlays. Existing critical focus refs, confirmation actions, disabled guards and recovery paths remain with their callers.

Browser tests use disposable fixture data and seeded UI states. Production WebKit uses the same isolated data with media held pending. These checks do not certify real camera inference, native lockdown, judge execution or live server entry. The existing API availability issue is not claimed resolved. No new debug route, backend mock or security bypass was added to application code.

The existing local preview runs on localhost:3000 with hot reload in a dedicated browser profile. Production verification uses an isolated build so it does not overwrite the live development output. Intermediate failed manifests are retained as investigation evidence; the accepted manifest is linked above.
