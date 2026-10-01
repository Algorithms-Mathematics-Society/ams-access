# Dashboard UI change log — 2026-09-30

Scope: the app's `/home` dashboard and its preflight/recovery surfaces. API client, backend, native commands, credentials, routing policy, contest entry gates, session lifecycle and telemetry behavior remain unchanged. Existing unrelated work is preserved.

## Astryx discovery and layout

Read repository AGENTS.md; ran `astryx build` and studied the detail-page / AppShellTopNavWithSideNav templates, layout and token guidance, and component APIs before implementation. The delegated contest audit also identified the incident-console template. No dependency installation or custom UI compiler was needed.

Frame: Astryx AppShell/TopNav, expandable 260 px SideNav / compact rail, a fluid contest column and a 320 px readiness widget. Columns wrap when their minimum budgets no longer fit. Astryx's mobile navigation drawer replaces the rail below its `md` breakpoint. The page has one main scroll region; modal surfaces scroll separately.

## Changed presentation

- `DashboardShell.tsx`: new Astryx shell/navigation, retained Access mark wrapped in Icon, explicit Sign out button, consistent Home/Settings/Device headings, safely truncated candidate name. Removed gradient avatars and the unfinished rail placeholder.
- `home/page.tsx`: compose the shell around existing data and action handlers. Added local search state; show the existing query error distinctly from an empty result. No request, retry or authentication changes.
- `ContestsPanel.tsx`: real case-insensitive search by contest or organization; loading, empty, no-match and unavailable states; removed absent invite-code instructions; local filtering makes no new requests.
- `ContestCards.tsx`: dashboard entries use Astryx List/ListItem rows, Token statuses, Icon metadata, StatusDot readiness context and neutral Astryx actions. Practice is explicitly untimed. Long organization names truncate with Astryx's accessible tooltip. Existing entry policy, timers, results gates, duplicate-click guard and action callback retained.
- `SessionActionsPanel.tsx`: a secondary recovery section, compact status token, visible verification/request messages, neutral refresh/resume/help controls. Existing approval and verification guards retained.
- `ReadinessPanel.tsx`: Astryx Card + List checklist with explicit Passed / Needs action / Checking text, specific accessible Resolve labels, visible readiness explanation, neutral Settings/Test setup actions. No changes to how checks run or resolve.
- `SessionReadinessModal.tsx`: Astryx Card, responsive Grid and buttons; visible required/advisory status text; removed ambient gradient. Missing reports show Not verified and a retry explanation. Content scrolls rather than shrinking in short windows. All entry conditions and handlers retained.
- `ResolveModal.tsx`: Astryx Card and buttons; bounded scroll surface. Existing close-app confirmation, help nesting, focus trap and native action handlers retained.
- Color guards: removed the four obsolete literal-white hover exceptions; migrated pages no longer require literal purple-fill styles. Existing palette AA checks remain.
- `globals.css`: exclude dashboard evidence artifacts from Tailwind's source scanner so captures do not trigger rebuild loops.

## Review sequence

Three subagents were assigned contest/resume, readiness/dialog and independent review work. They completed discovery and a pre-edit audit/snapshot, then all hit the session usage limit before implementation. Implementation, source comparison, browser/native checks and final visual review were completed by the primary agent. This is not a completed independent subagent sign-off.

Review fixes included the initial API error appearing as an empty list; missing-report percentages; short-height modal compression; responsive required/advisory columns; and long organization text escaping the main scroller. The review compares existing handlers, effects, API imports, modal actions and entry gates to the snapshot captured before these edits.

Final validation results and evidence are recorded in [README.md](README.md) and [review.md](review.md).

## Placement and spacing review — follow-up

- Measured the original layout at 1440, 1280, 1024, 800, 390 and 320 px wide before editing. Evidence is retained under `spacing-before/`.
- Moved search into the contest section and made it fill that column. Contest and readiness headings now share a baseline, and the search frame aligns with the readiness card top.
- Standardized major section/column gaps to 24 px and internal control gaps to 8–12 px. Removed the extra contest-row inline inset, the duplicate recovery separator and its extra 24 px top padding.
- Reduced readiness card padding from 20 to 16 px and used Astryx compact checklist rows with aligned gutters. The right column retains its 320 px width budget.
- Placed resume controls beside session details when space allows; wrapped actions remain end-aligned. Contest actions keep the same end alignment while readiness changes state. Readiness dots now center against their text.
- Moved the navigation drawer breakpoint to 1024 px so a medium desktop window can still show the contest and readiness columns side by side.
- Removed the preflight header's nested 20/22 px padding. Its label/progress row, full-width title and description now align with the dialog's 24 px content gutter and wrap naturally in narrow windows.
- Only presentation/composition changed. API calls, effects, entry gates, handlers and native operations remain unchanged. Final measurements and validation are in `spacing-review.md`.

## Minimal dashboard redesign — 2026-09-30

User-directed visual iteration after the spacing pass. The earlier checklist remained too repetitive and the workspace gave too much prominence to navigation and secondary status information.

- Reviewed Taste Skill and Apple as references for restrained hierarchy and intentional whitespace. GetCracked's live reference returned HTTP 429 during this pass; no claim of a fresh visual comparison. External skill installers were not run.
- Delegated readiness implementation, contest presentation, and independent review to three subagents. The primary agent owns the shell, recovery surface, integration, browser validation, and this log.
- `DashboardShell.tsx`: navigation defaults to its expandable compact rail; a centered 1200px workspace uses responsive 16–40px gutters and 32px major gaps. Larger overview heading and shorter introduction establish the page hierarchy. Existing navigation destinations and sign-out remain available.
- `ContestsPanel.tsx` / `ContestCards.tsx`: quiet search styling, Assigned contests heading, stronger semantic contest titles, restrained status/organization eyebrow, generous row spacing, compact metadata, and end-aligned actions. Practice status is neutral. Repeated per-row readiness warnings and decorative metadata/action icons are removed; the readiness panel retains the authoritative explanation. Rich label wrappers were replaced by semantic list rows after independent review caught invalid nested flow content.
- `ReadinessPanel.tsx`: heading integrated into a borderless surface; actionable checks remain visible, passed checks move into an accessible disclosure. Counts reflect existing check state; detailed policy context remains visible. Repeated status labels and heavy row dividers are removed. Named chevron controls preserve Resolve actions. Test setup and Open settings retain their original callbacks.
- `SessionActionsPanel.tsx`: recovery becomes a quiet inset utility section. Verified status uses plain status text instead of a large green banner; failure messages remain alerts. Approval, verification, disabled state, and resume/help callbacks are unchanged.
- Review refinement: compact readiness rows keep six failing checks and both footer actions inside the normal desktop viewport. Corrected an invalid radius token during integration. No API, backend, native command, credential, policy, or data-fetch changes.

Validation and screenshots for this iteration are recorded in `premium-review.md`.

## Calendar, labeled navigation, and Astryx component audit — 2026-09-30

- Added an Astryx Calendar with a selected-day contest agenda. It reads assigned contests already in memory, uses local dates/times consistently, provides Today and next-contest navigation, excludes untimed practice from dated events, and handles missing dates/loading/stale or unavailable data. Selection never changes eligibility or schedules and makes no requests.
- Replaced the compact icon rail with a stable 280px labeled LayoutPanel/SideNav. On Home, the calendar sits beneath navigation, leaving contests and readiness visible beside it. At 1024px and below, navigation becomes a drawer and the calendar moves into the main page flow. Main gutters and column gaps are 24px (16px on narrow windows); readiness is 320px at desktop sizes.
- Replaced bespoke empty states, loading content, and error presentation with Astryx EmptyState, Skeleton, and Banner. Search remains local. Contest dates, timing, and question counts now use semantic MetadataList items.
- Added shared AccessDialog using Astryx Dialog, DialogHeader, Layout, and scrollable LayoutContent. Migrated readiness, issue resolution, and Help to native dialogs. Help is a sibling top-layer dialog; Escape closes only the active layer. Stable opener capture handles conditional unmounts and React StrictMode replay.
- Help form fields now use labeled TextInput and TextArea; status/error/reference content uses Text, Banner, and MetadataList. Its submit handler, payload, endpoints, and response handling are unchanged. This shared visual improvement also applies to existing Login and dry-run Help consumers.
- Migrated recovery diagnostic values to MetadataList and ordered instructions to List. Readiness uses Stack/Grid/Text/Spinner with the original technical-details toggle and all existing checks/actions.
- Three subagents handled calendar implementation, component/dialog content migration, and independent audit/review. The primary agent integrated navigation, shared dialogs, verification, and documentation.
- Independent review caught and fixed Section's negative spacing compensation inside the readiness grid, plus lost return focus during StrictMode effect replay. Long calendar titles now clamp to two lines with the library tooltip.
- No dependency upgrade was needed: the app already uses Astryx 0.1.8; supplied examples show 0.6.3. Used the APIs verified in the installed package. No API/backend/native security operation was changed.

Full catalog mapping and decisions: `component-audit.md`. Final measurements, validation and screenshots: `calendar-review.md`.

## Search focus refinement

Removed the duplicate purple outline applied by the global focus-visible rule to the dashboard search's inner input. The existing field border now becomes a subtle neutral emphasis on focus, without a glow or layout shift. This is scoped to contest search; other keyboard focus indicators are retained.

## Home usability — 2026-09-30

Home-page UI only. Implemented the seven accepted recommendations with delegated contest, readiness/recovery, and independent usability/layout review:

- Verified, available session recovery appears before assigned contests. Pending/unverified recovery stays below; keyed panels retain state. Original resume guards remain authoritative.
- Assigned contests prioritize live graded contests, nearest scheduled contests, then untimed practice and inactive records. Ordering uses the existing entry phases and updates at existing time boundaries.
- Graded rows show exact local start time and timezone alongside the date and countdown. Candidate-facing Draft labels read “Not published yet.”
- Failed readiness rows have one full-row, keyboard-accessible action with a descriptive accessible name and a decorative chevron. Static passed/checking rows stay noninteractive.
- Empty recovery becomes one quiet text line; validation/failure/approval messages remain visible. Refresh moves beside Assigned contests and invokes its original callback.
- Home has a quiet Get help action using the existing form with kind OTHER and no unrelated session/contest identifiers. The shared form and transport were not edited.
- Calendar agenda entries clear a hiding search, scroll to and focus the matching contest, and highlight it for 2.5 seconds. Repeated selection works, reduced motion is respected, and leaving Home cancels stale navigation. Selecting an agenda entry never enters a contest.

Changed application files are limited to home/page.tsx and home/components: ContestCalendar, ContestCards, ContestsPanel, ReadinessPanel, SessionActionsPanel, plus home-contest-presentation and use-home-contest-navigation. Existing shared styles, Settings/Device content, API/backend/native operations and entry policy were preserved.

Validation and final evidence: [home-usability-review.md](home-usability-review.md).

## Settings Astryx migration — 2026-09-30

- Rebuilt Hardware, Permissions, Security and About in the same neutral Astryx style as Home. Short accessible tabs, stable associated panels, token spacing, borderless settings cards, and restrained status color replace bespoke layout and decorative treatments.
- Hardware uses a responsive camera preview/control arrangement with Selector, MetadataList and Banner; microphone and speaker cards use ProgressBar, Slider and neutral buttons. Camera measurements come from the active track; microphone level is a percentage. Removed the unfinished theme placeholder.
- Permission rows describe current readiness without claiming every failure is a denied OS permission. Desktop prompts are explained without fabricating an OS notification grant. Recovery retains its original commands, success/failure details and manual recovery text.
- Security separates device metadata, measured check results and restricted apps. Missing data stays unverified, skipped network probes are labeled Not checked, process placeholders no longer claim clearance, and platform-specific metadata is only shown where applicable.
- About keeps the existing privacy, terms and license routes in clear clickable rows; removed stale hardcoded version metadata.
- Running microphone monitoring remains visible when moving to another Settings tab, with a shortcut back to its stop control. Existing media lifecycle is preserved.
- Review fixes: Settings header action wraps below the title on narrow windows; permission descriptions span the row instead of squeezing beside status; long camera options wrap within a viewport-bounded popup. Shared header adjustment is conditional on Settings; Home and Device layout remain unchanged.
- Application scope: SettingsPanel.tsx, new SettingsDetails.tsx, and the one Settings-specific layout expression in DashboardShell.tsx. Media, telemetry and recovery handlers/native commands/API/backend code are unchanged.

Final validation and screenshots: [Settings review](settings-review.md).

## Device diagnostics — 2026-09-30

- Matched Device to the neutral Home/Settings Astryx style with a scan summary, divided setup checks and responsive metadata widgets.
- Added meaningful startup integrity status, honest unmeasured-network copy, stale-result feedback, a Settings shortcut, and collapsed technical detail.
- Made support actions easier to find; retained existing report contents and added local clipboard failure feedback.
- Rebuilt Recent activity using full wrapping messages, textual severity, All/Needs attention filters and keyboard-accessible bounded scrolling.
- Kept application changes scoped to the two Device components and two exact integration edits. API/backend/native behavior remains unchanged.
- Two independent subagent reviews found and helped resolve summary omissions. Final validation: 339 tests, typecheck/build, 95 browser assertions, 27 captures, 1,839 contrast samples, 20 source checks and WebKit rendering passed. See [Device review](device-review.md) for evidence and limitations.

## Login Astryx migration — 2026-09-30

- Replaced the decorative split screen with a form-first responsive layout and useful contest preparation guidance, matching Home/Settings in dark and light themes.
- Added Astryx fields, neutral action, aligned handle suffix, scoped single focus border, accessible error associations and a clear help area.
- Retained all authentication/API behavior, credential formatting and Help payloads. No backend, native or shared component changes.
- Two implementation subagents and one independent reviewer completed the work; suffix alignment and main landmark findings were corrected.
- Validation: 339 tests, typecheck/build, 143 production browser assertions, 32 captures, 328 contrast samples, 42 source checks and WebKit rendering passed. [Full review](login-review.md).

## Live login timeout investigation — 2026-09-30T18:21:36.326762+00:00

- User reported api.amsaccess.com TIMEOUT on the redesigned Login screen.
- Direct curl outside the app reproduced the failure. Initial DNS lookup timed out once; subsequent router, public resolver and local-stub queries returned 65.2.229.179 quickly.
- HTTPS still timed out before TCP connection/TLS, including an explicit --resolve diagnostic that bypassed DNS. TCP probes to the same host on ports 443, 80 and 22 timed out. This establishes failure below the UI/authentication layer, but does not distinguish remote host/security-group failure from a destination-specific network path failure.
- Control HTTPS requests to 1.1.1.1 and www.amsaccess.com succeeded. API configuration remains https://api.amsaccess.com. Login source-preservation audit had already verified unchanged authentication and API behavior.
- Independent read-only review found no AMS lockdown marker or session token and no recent helper failure; kernel firewall rules could not be inspected because sudo requires a password. No firewall or authentication changes were made.
- Previous browser tests intercepted API requests and therefore did not establish live backend availability. They should not be treated as live sign-in verification.
- Awaiting API hosting/SSH access from user to investigate server availability and restore connectivity. No fix has been claimed or applied to the server.

## Welcome / Enter workspace migration — 2026-09-30

- Matched the landing page to neutral Astryx Home/Login styling with a centered purpose, monochrome Enter workspace action and short credential reminder.
- Removed unverified System ready/session-security assertions and the decorative entrance timer; kept the theme control accessible in normal flow.
- Only WelcomeScreen.tsx changed in application source. Entry callback, Login destination, API/backend and shared components remain unchanged.
- Subagent implementation and independent review completed. Validation: 339 tests, typecheck/build, 115 browser assertions, 14 captures, 70 contrast samples, 14 source checks and WebKit passed. [Full review](welcome-review.md).
- This UI change does not resolve or claim to resolve the existing API connectivity outage.

## Landing layout refinement — 2026-10-01

- Studied Astryx centered-hero and AppShellContentOnly templates and adapted their headline/action/supporting-region structure.
- Fixed the locally overridden display typography, added responsive 29–42px hero type, regular-weight supporting copy, and a 44px entry target.
- Matched the Login brand header and added a compact ordered preparation guide beneath a divider; columns stack at narrow widths.
- Independent review passed. Final verification: 339 tests, production build/typecheck, 143 browser assertions, 14 captures, 168 contrast samples and WebKit dark/light/navigation checks passed. Only WelcomeScreen.tsx changed in application source; 260 protected files unchanged.
- [Updated review and screenshots](welcome-review.md).

## Claude review corrections — 2026-10-01

- Checked every B/S/D/L finding against the current implementation; retained the original review and recorded individual dispositions in [claude-review-resolution.md](../../../claude-review-resolution.md).
- Restored the slow-transition token, wired five missing tests, removed obsolete Login CSS, strengthened scoped focus, corrected duplicate main landmarks, clarified credentials/proctoring, and fixed Settings tab semantics, copy and unsupported capability claims.
- Added read-only native version display; corrected local support artifacts to seven consistent checks with actual/unknown version and scan freshness. Fixed stale headlines, shared preflight log typography, noisy live counter and redundant copy feedback.
- Preserved authentication, entry policy, scan/recovery commands, media behavior, backend/API and native source. The original all-media-on-tab-change criterion is explicitly recorded as unmet; microphone behavior remains unchanged.
- Retained durable pre-slice baselines, created a local working-tree checkpoint and isolated production builds from the running dev server. Historical reports now state their baseline and time scope.
- Validation: 344 tests, TypeScript/build, 369 browser assertions/97 captures, 44 independent source assertions and three WebKit route renders passed. Independent screenshot review passed. Existing onboarding dry-run hydration warning and API outage remain documented limitations; fixture testing is not native OS or live sign-in certification.

## Onboarding follow-up — 2026-10-01

- Migrated the pre-contest setup route to the same Astryx presentation while preserving check behavior and all backend/native code. Detailed changes and final evidence are maintained in [Onboarding UI](../onboarding-ui/README.md).
- The earlier documented query-dependent onboarding hydration mismatch is addressed by a mount-only presentation scaffold and checked in the production WebKit run. Historical reports retain their original results.

## 2026-10-02 — Home contest list organization

Refined assigned-contest row padding, boundaries, schedule metadata, timing and action alignment. Astryx components and scoped styles; 177 browser checks and typecheck passed. [Details](contest-polish/README.md).
