# Dashboard Astryx component audit

Date: 2026-09-30. Scope: dashboard overview, its navigation, calendar and directly opened dialogs. The installed library is Astryx 0.1.8; the reference screenshots show 0.6.3. This audit uses the installed component source and CLI, without changing dependencies.

The catalog is a set of available interaction patterns, not a checklist of widgets to add. Each adoption must support a task the current product already offers. Existing API calls, payloads, verification checks, contest entry decisions, native actions and resume guards must remain unchanged.

## Catalog fit

| Catalog family | Appropriate dashboard usage | Deliberate limits |
| --- | --- | --- |
| Action: Button, Button Group, Icon Button, Link, Toolbar | Existing contest, setup, settings, recovery and support actions already use Astryx Buttons. Group related dialog actions with Stack or Button Group. Keep icon buttons for compact, clearly named utilities such as calendar month navigation and dialog close. | Primary destinations need visible text. Do not hide contest entry or device repair inside More Menu/Dropdown. Segmented Control and Toggle groups require real alternate views or selectable modes; none should be invented. |
| Chat components | None on the current dashboard. | A support incident form is not a chat thread. Do not introduce composer/messages/tool calls without product capability. |
| Container: Card, Collapsible | Readiness and the calendar are discrete widgets; Card is appropriate. Passed checks and technical details can use Collapsible. | Do not wrap every contest row in a Card. Carousel, Clickable Card and Selectable Card add interaction semantics that the current list does not need. |
| Content: Heading, Text, Icon, Token, Timestamp | Existing typography and semantic contest status use Heading/Text/Token. Dates need explicit local context. Icons supplement labels. | No decorative avatars, thumbnails or badges. Code/Code Block can suit existing diagnostic logs, but a broader log rewrite is outside this dashboard pass. Markdown, citations, blockquotes and Kbd have no current overview content to represent. |
| Feedback: Banner, Skeleton, Spinner, Status Dot, Progress Bar | Inline load failures can use Banner; contests can use Skeleton during existing loading state. Readiness keeps truthful text plus StatusDot. Existing scan progress can use ProgressBar when it represents actual existing data. | Badge is for counts. Do not invent a readiness score, silently treat unknown as passed, or replace persistent failures with a transient Toast. |
| Form controls: Calendar, Field, Text Input, Text Area | Add the requested single-month Calendar with selected-day schedule derived from assigned contests already in memory. Search remains TextInput. Help fields should use TextInput and TextArea with labels. | Calendar selection must not reschedule contests, change permissions, or call a new endpoint. Date/Date Range/Date Time inputs imply editable dates and are unnecessary here. No new selectors, sliders, file inputs or switches without an existing editable setting. |
| Layout: App Shell, Layout, Layout Panel, Layout Content/Footer, Stack, Grid, Section, Divider | Keep AppShell and use a text-first navigation LayoutPanel with SideNav. Allocate a consistent side column to readiness/calendar. Use Dialog's Layout slots for a header, scrollable body and reachable actions. | Avoid double padding from a LayoutPanel plus its children. Resize Handle is unnecessary for this small navigation. Aspect Ratio has no media content to constrain. |
| Navigation: Side Nav, Top Nav | Retain the three actual destinations: Home, Settings, Device. Make labels visible in desktop navigation; use the existing responsive drawer on narrow windows. | No invented tabs, mega menus, breadcrumbs or pagination. There are only three flat destinations and a local contest list. |
| Overlay: Dialog, Tooltip | Replace the bespoke readiness/resolve/help overlay frames with genuine Astryx Dialog semantics. Explicit names, Escape handling, focus restoration and scroll behavior are required. Tooltip may clarify utilities. | Imperative dialog hooks are optional; existing controlled open state is already suitable. Do not add a Command Palette or hover-only essential information. Bottom Sheet is unnecessary if the responsive Dialog fits and scrolls correctly. |
| Table & List: List, Metadata List | Contest and readiness collections remain rows. MetadataList is appropriate for labeled diagnostic details and existing contest facts. | Table/Tree List would overstate the complexity. OverflowList must not hide required repair actions or contest eligibility details. |
| Utility | Reuse library focus, date and interaction behavior where compatible. | Do not alter backend/native code to accommodate a visual pattern. |

## Dialog implementation findings

The old readiness and resolve overlays used a document-level capture listener through `useFocusTrap`. Help was an ordinary fixed-position element inside the parent overlay. Astryx Dialog uses `HTMLDialogElement.showModal()` and the browser top layer. Migrating the parent alone leaves Help outside the active top layer and unusable.

A safe compatible migration renders the parent Dialog and Help Dialog as sibling elements, preserves the parent's open state while Help is shown, and removes the old capture-level focus trap from migrated parents. The nested support flow still works, but Escape reaches only the active native dialog. Rendering the Help dialog as a DOM descendant of the parent dialog is unsafe with this library version: its keydown event can bubble into the parent dialog listener and close both.

Use `purpose="form"` for readiness/resolve when preserving their existing no-backdrop-dismiss behavior. The installed implementation always blocks backdrop dismissal for this purpose and permits Escape. DialogHeader provides a close control, but the Dialog itself still needs a reliable accessible name. A supplied `aria-label` or an `aria-labelledby` targeting the actual heading is required.

Astryx 0.1.8 restores trigger focus in its `isOpen=false` effect, with no unmount cleanup. The existing conditional mounting requires either retaining the Dialog while toggling `isOpen`, or a small cleanup that only restores focus. Do not retain the old key trap merely to restore focus.

Dialog's inner wrapper clips overflow. Use a scrollable LayoutContent with a bounded dialog height and a non-shrinking footer; test expanded technical details and small-height windows. Avoid a second padded Card inside the Dialog, which duplicates surface, border, radius and gutters.

## Calendar and layout review criteria

- Calendar uses the existing assigned-contest dates in local time, with the timezone/context stated to the user. Invalid or absent dates must not throw or fabricate schedule entries.
- Practice/no-end-date contests retain their original untimed semantics. Calendar presentation never changes the main contest entry action or availability policy.
- Selected day and visible month are understandable; next/previous month and keyboard date navigation remain usable. Date selection produces useful day details and a truthful empty state.
- At desktop sizes, navigation, contest list and the side widgets have explicit width budgets and aligned gutters. At narrower sizes, widgets stack without shrinking the calendar below its usable width.
- Main scroll, side content and every dialog must remain reachable at 320px width and short landscape height. Long titles, organization names and diagnostic values must wrap or truncate without horizontal page overflow.
- Buttons have visible focus, accessible names, adequate target size and truthful disabled state. Visible enabled text contrast should meet WCAG AA.

## Verification status

Initial source/API audit completed before implementation. Final source, interaction and visual review results are recorded below after the integration is available; this document does not itself claim those checks have passed.

### Independent review during integration

- Inspected the installed Dialog and LayoutPanel implementation, then reviewed the new Calendar, shell, contest components, shared dialog shell, readiness/resolve dialogs and Help form source.
- Re-ran the existing source-preservation audit after dialog migration: all 20 handler/effect/API/gate checks passed. The Help `submit` function and transport remain unchanged in the source diff; its shared login and dry-run consumers have no conflicting legacy focus trap.
- Reviewed the first desktop and 320px dashboard captures: text navigation, calendar, contest metadata and readiness fit their intended regions. The desktop calendar is fully visible alongside readiness.
- Reviewed Help and Resolve captures: heading, body and actions align to consistent gutters; support displays above the parent native dialog.
- Found a blocking visual issue in the first readiness capture: nested transparent Section wrappers escaped their intended Grid gutters, misaligning headers and overlapping column text. Reported it to the implementing agent for correction. Final acceptance requires a fresh capture after that correction.
- Early browser checks confirmed separate top-layer Help dialogs and return focus from Help to readiness. The first run stopped at the contrast sampler's minimum text-count assertion on the short Help form, so that run is not a passing complete validation.

### Corrected integration accepted

The readiness gutter issue was corrected by replacing the three nested Section containers with semantic VStack sections. Fresh desktop and 390px captures show aligned 24px gutters, separated required/advisory columns, correct narrow stacking and reachable actions. Help and Resolve captures have consistent spacing; the narrow Help heading wraps without colliding with its close control.

The first focus-return check also exposed React StrictMode replay capturing the dialog's own title instead of the original trigger. The shared dialog shell now retains the opener in a ref and skips cleanup restoration while that same dialog is still connected and open. The subsequent development-browser run passed nested Help Escape, return-to-parent focus, and final return to the Resolve launcher.

Reviewed evidence: `calendar-evidence/2026-09-30T16-25-24-674Z/manifest.json` reports 114 passing browser checks, 43 captures, 560 contrast samples and zero failures. The separate first layout run passed 36 checks at 1440, 1280, 1024, 800, 390 and 320 widths. Calendar selection, keyboard navigation, Today reset, empty agenda, local-only data handling, search, destination navigation, unknown-readiness blocking, nested support layers and short-window scrolling are included in browser coverage.

Independent review finds no remaining blocking source or visual issue in this integration. These counts describe the reviewed development-browser runs; production build, final production captures and native rendering validation are recorded by the integrating agent separately.

Production integration completed: build/typecheck and 339 regression tests passed; 114 production interaction checks, 42 responsive layout checks, and six WebKit dashboard/dialog stages passed. Final evidence: [calendar-review.md](calendar-review.md). This final production validation was run by the integrating agent, following the independent subagent review above.
