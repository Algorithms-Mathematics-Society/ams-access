# Page-by-page execution plan: neutral theme with minimal purple

Status: P0 and P1 complete and reviewed; page-specific migration continues with P2.

## 1. Baseline and scope

The requested direction is the restrained, monochrome visual language of [getcracked.io](https://getcracked.io/), adapted to AMS Access. Use neutral surfaces, readable typography, thin separators, compact controls, and limited purple accents.

Repository baseline for this plan:

- Working branch: `fix/dev-api-target-and-network-diagnostics`.
- Pulled `origin/main` through `a5d9093`; merge commit: `c4c67ac`.
- The current branch's two local commits and existing uncommitted files were preserved.
- Web package version after the pull: `2.0.9`.
- Post-pull verification: 34 focused login, submission-state, and theme tests passed with Node 24.4.1.
- Fresh post-pull Login and Attempts baselines are captured at both desktop sizes in [P0 evidence](apps/web/theme-p0/README.md).

Important changes from GitHub that this redesign must preserve:

1. Login uses a handle with a fixed `@access` suffix. Full-handle paste, lowercase normalization, password formatting, and existing credential behavior must survive the visual migration. The component is still named `SlipForm.tsx`, but printed-slip login is no longer the current flow.
2. Attempts are derived for the active problem. The panel now explains its scope and identifies the problem in its empty state. Preserve filtering and stale-response protection when restyling it.

This work covers presentation and the UI inconsistencies identified during review. Authentication, exam timing, session ownership, autosave, judging, proctoring enforcement, and native lockdown contracts remain implementation invariants.

Theme coverage for this pass:

| Area | Theme coverage |
| --- | --- |
| Welcome and Login | Neutral dark and neutral light |
| Home, Settings, Device | Neutral dark; retain existing route dark lock |
| Onboarding and Contest | Neutral dark; retain existing route dark lock |
| Results | Neutral dark and neutral light |
| Legal pages | Follow the shared theme instead of fixed cream styling |
| Shared dialogs/loading/errors | Follow their host page, including dark-locked routes |

Extending light mode to the complete exam workflow is a separate pass. Do not remove route locks as part of this theme migration.

## 2. Shared visual contract

### Surfaces and hierarchy

- Use a neutral near-black canvas, charcoal panels, and slightly raised controls in dark mode.
- Use white, soft neutral gray, and dark text in light mode; remove cream and lavender surface casts.
- Separate regions through spacing, a small surface step, and thin borders.
- Remove purple glows, gradient avatars, colored decorative shadows, and blue-black modal backgrounds.
- Keep shadows restrained; reserve meaningful elevation for menus and dialogs.
- Use a consistent token-based radius scale. Reserve pills for compact status/segmented controls.
- Dense data uses aligned rows and dividers. Cards remain appropriate for hardware widgets, settings groups, and focused dialogs.

### Typography

- Adopt Geist Sans for interface text and Geist Mono for code, handles, timers, and technical details.
- Bundle fonts with the exported desktop app; rendering must not depend on a runtime font download.
- Replace hardcoded Inter/JetBrains declarations in migrated UI with the shared font tokens.
- Use sentence case for ordinary controls and labels. Restrict uppercase/letter spacing to small section identifiers.
- Aim for 13–14 px ordinary interface text, 12 px supporting metadata, and 11 px only for short micro-labels, expressed through supported tokens.
- Establish heading sizes appropriate to the app; the reference site's oversized marketing headings do not belong inside the contest workspace.

### Purple usage budget

| Element | Treatment |
| --- | --- |
| Small Access brand detail | Restrained purple permitted |
| Active sidebar item | Neutral selected surface plus a thin purple indicator |
| Active content/settings tab | Thin purple underline; readable text |
| Keyboard focus | Visible purple outline with sufficient contrast |
| Contest Submit action | The main solid-purple action in the exam workspace |
| General primary actions | White on dark; black on light |
| Secondary actions | Neutral outlined or quiet text treatment |
| Panel backgrounds, avatars, shadows, inactive icons | Neutral |
| Headings and long body text | Neutral text hierarchy |

Use accessible purple variants for text and filled controls rather than forcing one shade into every role. Avoid purple washes on the editor's active line and across large selected panels.

### Status, accessibility, and motion

- Keep green for successful checks/accepted verdicts, amber for warnings, and red for failures/destructive actions.
- Preserve syntax highlighting and meaningful judge-verdict distinctions.
- Status must remain understandable through text or icons as well as color.
- Verify WCAG AA text contrast, visible focus, keyboard navigation, dialog focus restoration, and reduced motion.
- Use short transitions for hover, selection, expansion, and stage changes. Avoid decorative animation in the working exam surface.

## 3. Execution order and dependencies

Complete and verify each slice before proceeding. A checked task means implemented and verified, not just edited.

| Order | Slice | Dependency | Deliverable |
| --- | --- | --- | --- |
| 0 | Baselines and theme/component discovery | Post-pull source | Current screenshots, state inventory, token mapping |
| 1 | Shared theme and primitives | 0 | Fonts, tokens, controls, status and dialog conventions |
| 2 | Welcome and Login | 1 | Entry flow establishes the visual direction |
| 3 | Home shell, contests, readiness, resume | 1–2 | Coherent dashboard and navigation |
| 4 | Settings and Device | 3 | Complete diagnostic and configuration surfaces |
| 5 | Onboarding | 1, shared dialogs | Consistent setup sequence and recovery states |
| 6 | Contest workspace | 1, 5 | Neutral exam surface with preserved behavior |
| 7 | Results and legal pages | 1, 6 | Consistent completion and document views |
| 8 | Shared-state and responsive audit | All slices | Verified route/state/theme coverage |

## 4. Phase 0 — preparation

Relevant files: `AGENTS.md`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/theme.ts`, `apps/web/src/lib/theme-core.ts`, `apps/web/src/lib/theme-dark-lock-core.ts`, `apps/web/src/app/home/components/utils.ts`, `apps/web/src/app/home/components/ui-primitives.tsx`, `packages/shared-ui/components/index.tsx`.

- [x] Capture current screens at 1280 × 800 and 1440 × 1000. Recapture the pulled Login and Attempts changes explicitly.
- [x] Inventory the existing global, Home-specific, onboarding, contest, dialog, and editor style sources.
- [x] Record relevant normal/loading/empty/error/disabled states before changing their presentation.
- [x] Follow repository discovery before writing UI: `pnpm exec astryx build "neutral desktop exam app with minimal purple accents"`, then inspect the suggested templates, component APIs, and layout/token/theme documentation.
- [x] Verify installed Astryx reset/theme setup and the effect of introducing its required styles alongside the current Tailwind/global CSS. Establish an explicit cascade and theme ownership before migrating screens.
- [x] Budget each page's shell regions before moving content. Use the actual default desktop window as the minimum primary design target.
- [x] Keep review fixtures isolated from real participant sessions and external writes.

Acceptance: the migration has a documented old-to-new token mapping, known component APIs, and fresh visual baselines. Native-only checks are labeled separately from browser previews.

P0 evidence: [overview and verification](apps/web/theme-p0/README.md), [page/state budgets](apps/web/theme-p0/page-inventory.md), [Astryx APIs and token mapping](apps/web/theme-p0/astryx-discovery.md), [independent review](apps/web/theme-p0/review.md). Captured 78 screenshots with eight passing browser checks; 321 existing tests and web typecheck passed. Browser permission errors and onboarding dry-run hydration warnings are recorded in the review, with native checks still pending in their implementation slices.

## 5. Phase 1 — shared theme and primitives

Primary files: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/components/ThemeToggle.tsx`, `apps/web/src/app/home/components/utils.ts`, `apps/web/src/app/home/components/ui-primitives.tsx`, `packages/shared-ui/components/index.tsx`.

- [x] Define theme roles for canvas, panel, raised control, text, muted text, border, hover, selection, focus, accent, and semantic status through Astryx's supported theme/token mechanism.
- [x] Map legacy variables to the new roles during migration so untouched routes keep rendering. Remove obsolete aliases only after their last consumer migrates.
- [x] Install/bundle the selected fonts using the existing build pipeline; verify export and offline rendering.
- [x] Standardize primary/secondary/destructive buttons, fields, selects, tabs, status indicators, tooltips, and dialog structure using discovered components.
- [x] Keep theme initialization before first paint and preserve saved preference plus route dark-lock behavior.
- [x] Make shared dialog and control themes inherit from the host page.
- [x] Implement changed layouts through the prescribed components and supported tokens, without adding another collection of raw colors or page-specific theme overrides.

Acceptance: one authoritative theme controls migrated components; dark/light transitions have no mismatched surfaces or first-paint flash; unrelated page behavior remains intact.

P1 evidence: [change log](apps/web/theme-p1/CHANGELOG.md), [verification overview](apps/web/theme-p1/README.md), [independent review](apps/web/theme-p1/review.md). Shared APIs and compatibility adapters are installed; page-local adoption remains in its later slices. Verified 339 tests, web/shared typechecks, static export and size budgets, 78 exported-route screenshots, 27 interaction/first-paint checks, and six isolated native WebKit cases. Older platform engines and native exam enforcement remain separate release/page verification.

## 6. Phase 2 — Welcome and Login

### Welcome — `/`

File changed: `apps/web/src/app/WelcomeScreen.tsx`. Root navigation and shared theme styles remain unchanged.

- [x] Keep clear purpose and a single entry action, with the Access mark and product name in the header. The later user-requested Astryx layout refinement supersedes the original centered-mark placement.
- [x] Use a neutral background and restrained brand mark; remove unnecessary tint/glow.
- [x] Make Enter workspace a monochrome primary button.
- [x] Improve supporting-text contrast and normalize spacing around the centered group; remove unverified readiness claims.
- [x] Keep the theme control usable at smaller widths and heights with normal-flow placement.

Acceptance: entry and theme toggle work by keyboard and pointer; dark/light versions share geometry; short windows do not hide the primary action.

### Login — `/login`

Files: `apps/web/src/app/login/page.tsx`, `apps/web/src/app/login/components/BrandPane.tsx`, `apps/web/src/app/login/components/SlipForm.tsx`, `apps/web/src/app/login/login.module.css`. Credential formatters and shared theme styles remain unchanged.

- [x] Retain the two-column desktop layout and compact single-column narrow layout.
- [x] Increase Sign in heading prominence; use sans-serif labels and explanatory text.
- [x] Simplify brand features to neutral icons/text and subtle separators.
- [x] Restyle the handle field and fixed `@access` suffix as one coherent control.
- [x] Preserve paste/formatting behavior, autocomplete attributes, the intentionally visible formatted password (no visibility toggle), loading state, and API error wording.
- [x] Use a monochrome Sign in action and a quiet support link.
- [x] Align error/diagnostic text with the field group and maintain long-message wrapping.
- [x] Apply the shared dialog treatment to Help, correcting light-mode text contrast.

Acceptance: full-handle paste works; suffix and long handles fit; login success/error paths remain unchanged; Help works in both themes without sending test requests to an organizer.

## 7. Phase 3 — Home

Dashboard design pass: **2026-09-30**. See [change log](apps/web/dashboard-ui/CHANGELOG.md) and [review evidence](apps/web/dashboard-ui/README.md). Backend/API behavior is unchanged. Results-availability reconciliation remains pending; it was not folded into this UI-only pass.

### Shell and navigation — `/home`

Files: `apps/web/src/app/home/page.tsx`, `apps/web/src/app/home/components/SignOutButton.tsx` where used, shared navigation primitives.

- [x] Unify header/sidebar surfaces and their separators.
- [x] Use a neutral selected navigation row; remove redundant avatars and keep purple to the Access mark and focus. (Updated during the dashboard design pass.)
- [x] Remove the decorative read-only search field and unfinished bottom-rail placeholder.
- [x] Make sign-out discoverable and accessible, preserving its existing behavior.
- [x] Normalize page headings and supporting copy across Home, Settings, and Device.
- [x] Define a compact sidebar/narrow-window arrangement so content cannot be clipped by the fixed 200 px rail.

Acceptance: all three navigation destinations and sign-out remain usable; long candidate names truncate safely; no content becomes inaccessible when the desktop window is resized.

### Contest list and resume

Files: `ContestsPanel.tsx`, `ContestCards.tsx`, `SessionActionsPanel.tsx` under `apps/web/src/app/home/components/`.

- [x] Convert dense contest presentation to aligned rows with title, schedule/time remaining, status, and entry action.
- [x] Distinguish practice through its label and appropriate untimed copy.
- [x] Preserve active, scheduled, verification-open, ended, and disabled entry behavior.
- [x] Correct the empty-state reference to an invite-code field that is absent.
- [x] Verify null-ended practice contests never display `NaN` time text.
- [x] Give resume a secondary section with explicit verification/pending/approved/rejected/error states.
- [ ] Reconcile results-availability copy against the current participant API instead of retaining obsolete embargo text.

Acceptance: all contest/resume states fit the row structure; action availability remains driven by existing policy; practice and scheduled entries remain distinguishable.

### Readiness, preflight, and resolution

Files: `ReadinessPanel.tsx`, `SessionReadinessModal.tsx`, `ResolveModal.tsx` under `apps/web/src/app/home/components/`.

- [x] Present readiness as a concise checklist with aligned labels, explicit statuses, and relevant Resolve actions.
- [x] Reduce nested boxes and competing accent buttons.
- [x] Standardize preflight: summary, required checks, optional warnings, expandable diagnostics, actions.
- [x] Make unavailable readiness reports visibly distinct from successful checks.
- [x] Apply the shared recovery dialog to camera, microphone, network, keyboard, platform, VM, and restricted-app issues.
- [x] Preserve native retry/settings/close-apps actions and their existing confirmation behavior.

Acceptance: blocked entry is clear; required failures cannot resemble advisory warnings; dialogs scroll at short heights and restore focus when closed.

## 8. Phase 4 — Settings and Device

### Settings: Hardware Diagnostics

Primary file: `apps/web/src/app/home/components/SettingsPanel.tsx`.

- [x] Use a balanced camera preview/control layout with neutral framing.
- [x] Standardize device selection, initialize/rescan actions, and camera status.
- [x] Align microphone input monitoring and speaker output testing as two clear sections.
- [x] Remove the visible unfinished theme placeholder.
- [x] Simplify labels while keeping useful device details available.

Acceptance: disconnected/permission-denied/active camera states, microphone levels, and speaker controls remain legible and functional.

Original acceptance not met: “media cleanup still occurs on tab changes” applied to all media. The current implementation stops the camera when leaving Hardware but retains existing microphone monitoring across Settings tabs, with visible running status; both clean up on unmount. This is an explicit deviation retained to preserve media behavior during the UI-only migration, not a completed all-media cleanup requirement.

### Settings: Permissions Check

- [x] Use aligned permission rows with status text and concise descriptions.
- [x] Give Restore device after a contest a clearly separated action region.
- [x] Preserve platform-specific recovery behavior and honest permission reporting.

Acceptance: unavailable and denied states are distinguishable; restoration feedback is visible; theme work does not change native recovery commands.

### Settings: Security Environment

- [x] Use neutral diagnostic groups and divided process rows.
- [x] Distinguish checking, unknown/not scanned, cleared, and flagged results.
- [x] Ensure placeholder process categories cannot suggest a successful scan before evidence exists.
- [x] Make scan time, rescan progress, and failure messages easy to locate.

Acceptance: no unsupported or missing native data renders as a verified pass; process names and failure detail wrap without breaking layout.

### Settings: About / Legal

- [x] Simplify the information panel and remove the decorative corner treatment.
- [x] Align document links and supporting descriptions.
- [x] Replace stale hardcoded version text with the actual native app version; show Not available when the native bridge cannot provide it.

Acceptance: each document link opens the correct route; no stale version is presented.

### Device diagnostics

Files: `apps/web/src/app/home/components/DiagnosticsPanel.tsx`, `apps/web/src/app/home/components/SecurityOperationsLog.tsx`.

- [x] Establish order: platform/network/security summary, diagnostic details, copy/export actions, activity log.
- [x] Reduce nested cards and use readable monospace only for technical values and reports.
- [x] Improve empty/unavailable/retry states and long JSON/log scrolling.
- [x] Preserve clipboard/export behavior and diagnostic privacy boundaries.
- [x] Correct local support-report contents under the later Claude-review request: actual/unknown version, seven setup checks, telemetry-based VM status and stale-scan information. The earlier payload-immutability criterion is superseded explicitly by this requested correction.

Acceptance: large reports do not widen the page; the log stays usable; missing native telemetry is clearly reported rather than fabricated in previews.

## 9. Phase 5 — Onboarding

Files: `apps/web/src/app/session/onboarding/page.tsx`, `components/ui.tsx`, `components/ProgressBar.tsx`, `components/DryRunSummary.tsx`, and all files under `components/stages/`.

- [x] Build one shared stage frame: progress, heading, explanation, check content, feedback, and action.
- [x] Use neutral frames/buttons with small purple current-step/focus indicators.
- [x] Keep Exit setup and its shortcut visible without overlapping progress.
- [x] Prevent the progress header plus stage card from overflowing short windows; allow deliberate vertical scrolling.
- [x] Standardize progress and waiting states without changing automatic/manual advance rules.

| Stage | UI work | Required verification |
| --- | --- | --- |
| Intro / Practice run | Clear checklist, duration hint, monochrome Begin setup | Real setup and rehearsal remain distinguishable |
| 1. Secure Full-Screen | Neutral illustration and status rows | Unavailable/fullscreen/retry states |
| 2. Display Check | Readable display count and issue details | Single/multiple/unknown displays and organizer override |
| 3. Keyboard Setup | Compact progress and platform recovery actions | Native failure and macOS Accessibility guidance |
| 4. Setup Verification | Consistent check rows | Checking/pass/fail remain distinct |
| 5. Application Check | Divided process list and clear remediation | Unknown, clean, flagged, and close-app failure states |
| 6. Device Compatibility | Neutral device status block | Physical, virtualized, unavailable checks |
| 7. Camera Setup | Consistent preview and retry/settings controls | Permission denial, missing device, disconnection, success |
| 8. Face Scan | Neutral guide/crosshair with semantic tracking feedback | Loading, tracking, validation, completion, blocked/fallback |
| 9. Presence Check | Consistent preview and sampling feedback | Confirmed and recorded-for-review outcomes |
| 10. Microphone Check | Clear level meter and feedback | Waiting, detected, signal, and warning states |
| 11. Connection Check | Aligned latency/quality/helper feedback | Reachable, timeout, helper unavailable |
| 12. Final Review | Readable check summary and explicit Continue | Failed prerequisites still block entry |
| 13. Entering Contest | Neutral waiting/countdown/transition view | Verification window, ended contest, successful entry |
| Rehearsal summary | Ready/check/failed rows and relevant next actions | Nothing submitted; teardown and return home preserved |

Acceptance: all stage UIs follow one hierarchy; timers/gates/camera ownership/teardown are preserved. Native behavior must be checked in Tauri before claiming end-to-end completion.

## 10. Phase 6 — Contest workspace

Primary orchestration: `apps/web/src/app/session/contest/client.tsx`. Keep behavioral logic stable while migrating extracted presentation components.

### Workspace shell, top bar, and question rail

Files: `components/TopBar.tsx`, `components/CountdownBadge.tsx`, `components/QuestionRail.tsx`, `components/KioskBanner.tsx`.

- [x] Keep contest identity, centered timer, support, and exit controls clearly separated.
- [x] Unify shell surfaces and thin separators; remove decorative logo gradients.
- [x] Use neutral question rows and a restrained purple active indicator.
- [x] Preserve expanded/collapsed question navigation, status labels, and accessible names.
- [x] Keep destructive exit confirmation distinct from submitting the current solution.

### Problem pane

Files: `components/ProblemPane.tsx`, `components/MarkingScheme.tsx`.

- [x] Normalize statement typography, examples, constraints, code blocks, and marking information.
- [x] Keep selected tabs visible with a thin purple underline.
- [x] Preserve math rendering, statement assets, examples, and symbolic-rule/gating explanations.
- [x] Retain independent scrolling and reachable content around the camera tile.
- [x] Make pane resizing discoverable and keyboard-accessible where supported.

### Editor and execution controls

Files: `components/EditorPanel.tsx`, `editor-pane.tsx`, plus `apps/web/src/components/MarkovEditor.tsx` if it is part of the rendered editor path.

- [x] Use neutral file tabs, language controls, settings menu, gutters, active line, and editor chrome.
- [x] Keep Submit visually primary and Run neutral; the requested Home/onboarding treatment uses a monochrome primary action with restrained purple elsewhere.
- [ ] Apply Geist Mono through editor font tokens and verify measured layout after fonts load.
- [x] Preserve existing optional editor themes and High Contrast; harmonize surrounding chrome without erasing user-selected syntax themes.
- [ ] Preserve file creation/closing, active file, selection, undo history, scroll position, read-only state, and save feedback.
- [x] Do not recreate the editor instance to apply theme changes when a reconfiguration suffices.

### Output, compiler output, and Attempts

Files: `components/TerminalPanel.tsx`, `components/verdict-styles.ts`, `apps/web/src/lib/VerdictBadge.tsx`.

- [x] Normalize tabs, neutral output surfaces, filter controls, attempt rows, and expanded testcase details.
- [x] Preserve sample-run versus scored-submission distinctions and hidden-test masking.
- [x] Preserve the newly pulled active-problem scoping, problem-specific empty state, and explanation of what the list contains.
- [x] Verify rapid switching between problems cannot display another problem's attempts or latest verdict.
- [x] Keep output collapse/auto-expansion/unread behavior and queued/running/completed states intact.

### Camera, footer, and overlays

Files: `components/CameraTile.tsx`, `components/FooterTrustStrip.tsx`, `components/BlockedOverlay.tsx`, `components/GateScreens.tsx`, overlay sections in `client.tsx`.

- [x] Use neutral camera framing with semantic health feedback and accessible media controls.
- [x] Align footer status icons with the current rail geometry in expanded and collapsed modes.
- [x] Make save/connectivity/proctoring states readable without relying solely on colored dots.
- [x] Standardize support, media-warning, face-block, restricted-app, load-error, and completion/retry overlays.
- [x] Preserve critical overlay priority, focus trapping, confirmation, and recovery behavior.
- [ ] Remove stale 48-hour-results copy only after checking current results availability logic; do not invent a new release policy.

Acceptance: the full workspace is usable at 1280 × 800; panel resizing and collapse do not hide key actions; autosave, timing, submission, active-problem Attempts, and lockdown behavior pass regression checks.


Completed UI evidence: [change log](apps/web/contest-ui/CHANGELOG.md), [verification](apps/web/contest-ui/README.md), and [independent review](apps/web/contest-ui/validation/manual-review.md). 362 tests, 147 source checks, 49 browser checks across 35 captures, 388 contrast samples and 13 production WebKit captures passed. Existing editor fonts, security behavior and 48-hour-results policy copy remain preserved. Full native exam/OS verification remains separate from this UI slice.

## 11. Phase 7 — Results and legal documents

### Results — `/results`

Files: `apps/web/src/app/results/page.tsx`, `components/ErrorScreen.tsx`, `components/ResultsLoading.tsx`, shared results styles.

- [ ] Use a clear contest heading, quiet back action, and aligned per-problem summary rows.
- [ ] Preserve verdict, attempt chronology, testcase counts, and zero-score restriction explanation.
- [ ] Standardize no-submissions, unattempted, loading, missing-session, and retry states.
- [ ] Ensure long result lists scroll despite the global body overflow rules.
- [ ] Verify neutral light/dark styling and alignment on narrow screens.

Acceptance: only the candidate's own results appear; the page remains readable with many problems and attempts; return-to-home and retry behavior remains intact.

### Legal — `/privacy`, `/terms`, `/licenses`

Files: `apps/web/src/app/legal-page.tsx`, `apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx`, `apps/web/src/app/licenses/page.tsx`.

- [ ] Replace fixed cream/gradient colors with the shared theme.
- [ ] Use a comfortable reading width, consistent headings, subtle separators, and restrained links.
- [ ] Preserve document content, section anchors, and scrolling.
- [ ] Verify both themes and the Back to Access link.

Acceptance: long documents scroll naturally; no light-only surface remains when dark is selected. Legal-policy wording changes are outside this styling pass.

## 12. Phase 8 — shared states and final verification

Shared files: `apps/web/src/components/HelpRequestModal.tsx`, `apps/web/src/components/RouteLoadingShell.tsx`, route `loading.tsx` files, and all migrated dialogs.

- [ ] Check normal, hovered, focused, pressed, selected, disabled, loading, empty, error, warning, and success states where applicable.
- [ ] Align loading screens and preserve their route-specific backgrounds and stable transitions.
- [ ] Check Help in light and dark modes, including readable headings and sending/success/failure states using fixtures.
- [ ] Check modal close behavior, Escape, focus trap/return, long content, stacked critical overlays, and reduced motion.
- [ ] Search migrated files for obsolete hardcoded fonts, purple gradients/glows, old cream surfaces, and unsupported raw styling.
- [ ] Confirm theme tokens, component layouts, status indicators, and styling comply with `AGENTS.md`.

Verification matrix:

| Dimension | Checks |
| --- | --- |
| Desktop | 1280 × 800 default; 1440 × 1000; a shorter window |
| Narrow layout | Login/Welcome/Results/legal at approximately 390 px; dashboard compact navigation and reachable scroll regions |
| Dense workspace | Resize split panes, collapse rail/output, long titles, long compiler logs, many attempts |
| Themes | Both supported themes; system preference; saved preference; route changes into and out of dark locks |
| Accessibility | Keyboard-only navigation, focus visibility, dialog focus, labels, contrast, reduced motion |
| Data states | Empty/loaded/offline/error; practice/active/scheduled/ended; permission denial and missing native data |
| Native runtime | Camera lifecycle, fullscreen, keyboard/security checks, blocked overlays, exit teardown and recovery in Tauri |

Use the repository-compatible runtime (`node >=22.6`; Node 24.4.1 is installed). The default shell currently resolves Node 18, which cannot run the strip-types test command; select the supported runtime before invoking pnpm scripts.

Run checks appropriate to each slice. At final integration, run from the repository root:

```bash
pnpm --filter @ams/web typecheck
pnpm --filter @ams/web test
pnpm --filter @ams/web build
pnpm check:versions
```

The web build includes the configured size-budget check. Keep theme contrast/dark-lock checks, handle-formatting checks, and contest submission/save/clock checks meaningful; update obsolete visual assumptions to the new contract without removing behavioral coverage. Add focused regression coverage only where behavior or an identified defect changes.

## 13. Completion criteria and delivery

- [ ] Every route and Settings subpage has migrated; no mixed old/new theme remains.
- [ ] Purple is confined to the agreed roles and semantic status colors remain clear.
- [ ] Fonts, spacing, controls, dialogs, loading, and error treatments are consistent.
- [ ] Supported themes work without changing route-lock policy.
- [ ] Pulled handle-login and active-problem Attempts behavior is preserved.
- [ ] Necessary automated checks pass; any pre-existing failure is recorded separately.
- [ ] Before/after screenshots cover each page and important states.
- [ ] Browser-fixture verification and actual native-runtime verification are reported separately.
- [ ] Existing local work is preserved throughout; changes are delivered in reviewable slices following the execution order.

For each completed slice, record the affected files, screenshots, checks run, and remaining limitations. Do not mark the native flows complete solely because their browser previews render correctly.

## Dashboard visual refinement — 2026-09-30

Completed the user-requested minimal UI refinement with delegated contest/readiness implementation and independent source/visual review. Compact navigation, clearer contest typography, restrained search/status styling, actionable readiness groups with passed-check disclosure, and a quieter recovery surface are implemented. API/backend/native behavior is unchanged. Build, typecheck, 339 existing tests, 72 browser interaction checks, text contrast sampling, source preservation, and WebKit rendering passed. Other page phases retain their existing status.

See [change log](apps/web/dashboard-ui/CHANGELOG.md) and [review with screenshots](apps/web/dashboard-ui/premium-review.md) for exact scope and validation limitations.

## Dashboard calendar and component refinement — 2026-09-30

Completed the requested calendar placement, labeled navigation panel, appropriate Astryx catalog replacements, and native readiness/resolve/Help dialog migration. Three subagents contributed implementation and independent review. Production build/typecheck, 339 tests, 114 interaction checks, 42 layout checks, text contrast sampling, source-preservation checks and WebKit dashboard/dialog verification passed. API/backend/native operations remain unchanged. Other page phases keep their existing status.

See [component audit](apps/web/dashboard-ui/component-audit.md), [change log](apps/web/dashboard-ui/CHANGELOG.md), and [final review with screenshots](apps/web/dashboard-ui/calendar-review.md).

## Home usability — 2026-09-30

Completed all seven accepted home-only recommendations with subagent implementation and independent review: priority recovery/contests, exact local start times, full-row readiness actions, compact empty recovery/header Refresh, persistent Help, calendar-to-contest navigation, and unpublished copy. API/backend/native operations and existing eligibility rules are unchanged.

Validation: TypeScript/production build, 339 existing tests plus 5 sorting tests, 157 production interaction checks, 117 responsive layout checks, 27 protected-source comparisons, and six WebKit stages passed. Detailed scope, viewport limits and evidence are in [Home usability review](apps/web/dashboard-ui/home-usability-review.md); changes are logged in [CHANGELOG](apps/web/dashboard-ui/CHANGELOG.md). Other page phases retain their status.

## Settings Astryx migration — 2026-09-30

Completed Hardware, Permissions, Security and About with subagent implementation and independent source/visual review. Matched Home's neutral style, made controls responsive, clarified unverified states, and preserved media/native/API behavior. Device diagnostics remains a separate pending slice.

Validation: production build/typecheck, 339 existing tests, 122 browser checks, 28 protected-source checks, 710 text contrast samples and four WebKit Settings stages passed. See [Settings review and evidence](apps/web/dashboard-ui/settings-review.md) and [change log](apps/web/dashboard-ui/CHANGELOG.md).

### Device completion — 2026-09-30

Completed Device with a neutral Astryx summary, actual setup/network metadata, collapsed details, preserved support reports and filterable full-text activity. Two subagents independently reviewed source and responsive screenshots; summary omissions were corrected. No backend/API/native command changes. Validation and scoped change log: [Device review](apps/web/dashboard-ui/device-review.md).

### Login completion — 2026-09-30

Completed neutral dark/light Login with a form-first responsive shell, actual preparation guidance, aligned credential controls and preserved auth/error/help behavior. Two implementation subagents and an independent reviewer completed the slice. No backend/API or other page changes. Evidence: [Login review](apps/web/dashboard-ui/login-review.md). Welcome remains pending.

### Welcome completion — 2026-09-30

Completed the entry landing page with neutral Astryx composition, useful credential guidance and honest state wording. Subagent implementation and independent review completed; backend/API/navigation behavior unchanged. Evidence: [Welcome review](apps/web/dashboard-ui/welcome-review.md). Phase 2 Welcome and Login presentation slices are complete.

### Welcome layout refinement — 2026-10-01

Applied Astryx centered-hero guidance: stronger responsive typography, 44px entry action and a structured lower preparation guide. Independent review and production validation passed; backend/navigation remain unchanged. [Evidence](apps/web/dashboard-ui/welcome-review.md).

## Claude review corrections — 2026-10-01

Verified B1–B4, S1–S7, D1–D7 and L1–L5 individually; corrected confirmed defects with subagent implementation and independent source/visual review. [Item-by-item resolutions and evidence](claude-review-resolution.md). This record supersedes conflicting earlier completion claims about focus, landmarks, report metadata and the original Settings media-cleanup criterion. No blanket phase completion is inferred from test counts. Native OS integration, the existing onboarding hydration issue and API availability remain separate limitations.

## Pre-contest onboarding presentation — 2026-10-01

Completed the introduction, all twelve check/review screens, final waiting/preparation and rehearsal summary in the existing Astryx theme. The page now has a compact responsive progress region and a wider active-check panel. Native/backend/API code, policy helpers, callbacks, timers, media ownership and detection logic remain unchanged.

Independent review caught and corrected a low-contrast meter label, doubled heading spacing and a narrow-screen vertical scrolling defect. A viewport-constrained AppShell now owns scrolling inside the app's globally non-scrolling document; wheel reachability is checked separately from screenshots. A mount-only presentation scaffold resolves query-dependent initial markup without changing any checks or query parsing.

The checked items above describe presentation acceptance, not native end-to-end certification. Full hardware, OS protection and live contest-entry validation remain separate. [Change log](apps/web/onboarding-ui/CHANGELOG.md) · [Verification and independent review](apps/web/onboarding-ui/README.md).

## In-contest confidence first batch — 2026-10-01

Completed the authorized first batch of the contestant audit: read-only and support success bugs, separate active-file draft/submission status, file scope, accessible finish review with honest receipt, and recovery feedback. Corrected a browser-reproduced older-save/newer-edit race while validating those guarantees. Scope stays in the contest frontend; backend, API-client implementations and native protection code are unchanged. Later recommendations are not implied complete.

[Change log](apps/web/contest-ui/confidence/CHANGELOG.md) · [Validation and limitations](apps/web/contest-ui/confidence/README.md).

## In-contest workspace tools — 2026-10-02

Implemented the approved follow-up batch: local mark-for-later reminders, title-adjacent real limits, resizable workspace/output, focus/restore/reset and region navigation, font/wrap preferences, and clearly attributed execution results. Run presentation now rejects late results from a previously selected question and uses the existing run response for its diagnostics/testcases. Backend/API/native implementations are unchanged.

[Change log](apps/web/contest-ui/tools/CHANGELOG.md) · [Validation and independent review](apps/web/contest-ui/tools/README.md).

## In-contest regression audit — 2026-10-02

Reviewed the accumulated contest changes using a delegated behavior audit and independent integration/UI checks. Fixed save-on-navigation and recovery defects, panel resizing constraints, and preferences dismissal/focus. Verified 390 unit tests, 140 Chrome checks, 32 production WebKit captures, typecheck and isolated build. No backend/API/native implementation changes.

[Review, changes and limitations](apps/web/contest-ui/audit/README.md).

## Problem panel polish — 2026-10-02

Completed the requested spacing and hierarchy refinement within the contest problem panel. Astryx title/actions, responsive metadata and section tabs now form one organized summary; scoring is aligned below the content. [Change log and verification](apps/web/contest-ui/problem-panel/README.md).

## Home contest row polish — 2026-10-02

Added a shared list frame, equal row padding, structured schedule metadata and consistent timing/action footers. Narrow layouts use label/value rows. Home UI only; existing entry logic unchanged. [Changes and verification](apps/web/dashboard-ui/contest-polish/README.md).

## Astryx keyboard hints — 2026-10-02

Converted setup-exit, workspace-direction and existing Escape hints to Astryx Kbd. Retained exact key bindings and native handlers. [Changes and verification](apps/web/keyboard-hints/README.md).
