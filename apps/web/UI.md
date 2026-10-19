# Candidate UI guide

Updated 19 October 2026. [DESIGN.md](../../DESIGN.md) is the visual reference;
this guide maps the current app, its integration boundaries and how to check it.
The Next.js frontend is statically exported into the Tauri desktop app.

## Screens and ownership

| Surface                             | Entry point                                                          | What must stay intact                                                                         |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Welcome `/`                         | `src/app/WelcomeScreen.tsx`                                          | Shared logo, theme toggle, workspace entry and preparation guidance.                          |
| Login `/login/`                     | `src/app/login/page.tsx`                                             | Organizer-issued handle/password, password visibility, diagnostics and help.                  |
| Home `/home/`                       | `src/app/home/page.tsx`, `components/DashboardShell.tsx`             | Assigned contests, practice/graded states, schedule, recovery and readiness.                  |
| Settings                            | `src/app/home/components/SettingsPanel.tsx`, `SettingsDetails.tsx`   | Hardware, Permissions, Security and About tabs; media ownership and real status reporting.    |
| Device                              | Home's device destination                                            | Readiness details, diagnostics, scan state, troubleshooting and help.                         |
| Device setup `/session/onboarding/` | `src/app/session/onboarding/page.tsx`                                | Contest identity, setup introduction, staged checks, review and exit/restoration.             |
| Contest `/session/contest/`         | `src/app/session/contest/client.tsx`                                 | Question navigation, statement, editor, test/run/submit feedback, drafts, timing and support. |
| Results `/results/`                 | `src/app/results/page.tsx`                                           | Results availability, recorded attempts, detail/loading/error states and navigation.          |
| Privacy, Terms, Licenses            | `src/app/privacy`, `terms`, `licenses`                               | Current disclosures and accessible reading/navigation.                                        |
| Loading                             | `src/components/RouteLoadingShell.tsx` and route `loading.tsx` files | Announced progress and matching route structure.                                              |

Home's Settings and Device are destinations inside `/home/`, not independent
routes. Practice contests are untimed; selecting a calendar date does not change
contest entry eligibility. Device readiness, organizer policy and server state
still own entry decisions.

## Brand assets

`src/components/AccessLogo.tsx` exports the two supported UI placements:

- `AccessLogo`: welcome, login, dashboard and device-setup headers.
- `AccessMark`: compact contest header beside the contest title.

Both use `public/brand/access-*.svg` with monochrome masks in
`AccessLogo.module.css`. Their SVG view boxes preserve clear space, and the
horizontal component keeps the wordmark above the brand's minimum size.
`../desktop/app-icon.svg` is the native icon source. Tauri-generated PNG/ICO/ICNS
and Store assets live in `../desktop/src-tauri/icons`; the MSIX build copies from
that set. Browser metadata uses `src/app/favicon.ico` and `src/app/apple-icon.png`.

The supplied PDF, local logo boards and Figma references are identified in
[brand/README.md](public/brand/README.md). The previous triangle mark, uppercase
wordmark, welcome-image copies and their logo CSS have been removed. Keep new
assets centralized; do not add inline logo paths to individual routes.

## Theme and styling

`src/theme/accessTheme.ts` is canonical. The generated official Astryx theme,
explicit-mode WebView fallback and compatibility aliases are imported through
`src/app/globals.css`. The layer order keeps resets below components and utilities.
Existing compatibility aliases support remaining legacy page CSS; they are not
a second palette.

`src/lib/theme.ts` resolves the saved `ams_theme` preference or system theme.
`theme-bridge-core.ts` synchronizes `data-theme` and `data-astryx-theme` on the
document. `AccessThemeProvider` drives the Astryx provider from that same state.
Route policy is defined in `theme-dark-lock-core.ts`; no routes are currently
forced dark. `ThemeToggle` keeps its initial rendered state hydration-safe.

Palette changes temporarily disable CSS transitions until both the document and
React provider have updated. Cleanup handles rapid toggles and thrown updates;
it restores normal hover transitions. Existing reduced-motion rules still apply.
Do not reintroduce independent palette animation on logos, text or surfaces.

## Calendar and local dates

`home/components/ContestCalendar.tsx` first renders `Loading calendar…` on both
the server and the initial client render. The local calendar mounts after
hydration because its day labels, current date and timezone cannot be inferred
reliably during a static build. Its accessible day labels and selected-date
summary must use the same device environment.

`src/lib/date-time-format.ts` caches `Intl.DateTimeFormat` instances and refreshes
for timezone/language changes. Keep local timezone semantics; forcing a fixed
server locale or hiding hydration warnings does not solve device-date mismatch.

## Assessment workspace

Reuse the existing contest components rather than duplicating their state:

- `TopBar`: compact brand, title, countdown, support and finish review.
- `TerminalPanel`: separate Test Result, Testcase and Attempts views.
- `ResultsPanel`: sample/rule/behavior check tabs and selected result detail.
- Existing editor, statement, custom-case and workspace-preference modules:
  code/draft ownership, layout persistence, run recovery and sample matching.

Selected check tabs use explicit inherited font properties and a distinct
`fontWeight`. A `font` shorthand must not compete with dynamic longhand styles.
Keep tab selection and keyboard behavior while adjusting presentation.

Preserve camera/microphone request ownership, release behavior, readiness policy,
network recovery, local-write failure reporting and mandatory-overlay priority.
Browser fixtures or screenshots cannot certify these native behaviors.

## Development and builds

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @ams/web dev:hosted
```

The browser preview uses port 3001. From `apps/web`, the equivalent command is
`pnpm dev:hosted`. `pnpm --filter @ams/desktop dev` runs the native app and its
own port-3000 frontend. Do not run another server on an occupied port.

Development output is `.next-dev`; production output is `.next` and `out`.
The existing Webpack callback disables persistent caching in development to
avoid large cache-pack buffer allocations on memory-constrained machines.
Production caching and custom chunk splitting are unchanged. Expect slower
cold development compilation; increasing the heap limit is not the cache fix.

```sh
pnpm --filter @ams/web typecheck
pnpm --filter @ams/web test
pnpm --filter @ams/web build
pnpm --filter @ams/desktop test
pnpm check:versions
```

The web build performs model/WASM setup, static export and size-budget checks.
Keep the required setup and budget scripts in `apps/web/scripts`. CI and normal
regression suites remain the source of automated gates. Standalone browser
review runners, their fixture helpers and phase-specific evidence documents are
retained because they may still be useful. They are optional historical tools,
not design authority or a substitute for checking the current app. Several use
hard-coded Linux Chrome paths; review their fixtures and assertions before use.

For actual native builds and platform prerequisites, use [DEMO.md](../../DEMO.md),
[SETUP.md](../../SETUP.md), [RELEASE.md](../../RELEASE.md) and
[WINDOWS-INSTALL.md](../../WINDOWS-INSTALL.md).

## Focused verification

Run from `apps/web`:

```sh
node --test --test-concurrency=1 --experimental-strip-types scripts/next-config.test.mjs src/lib/theme-core.test.mjs src/lib/theme-dark-lock-core.test.mjs src/lib/theme-bridge-core.test.mjs src/lib/date-time-format.test.mjs src/app/home/components/contest-calendar.test.mjs
```

Use serial execution on constrained machines. These tests cover the dev-cache
boundary, preference/route synchronization, palette-transition cleanup and
locale-independent calendar server rendering. The regular web suite includes
these checks alongside contest, media, readiness, recovery and storage tests.

For a relevant UI change, inspect the actual route in both themes, at a narrow
width and a typical desktop size. For setup, include a short window and verify
scrolling/exit reachability. For contest UI, check active/inactive tabs, long
diagnostics, keyboard navigation, recoverable errors and loading states without
starting a live assessment solely to collect screenshots.

Record actual commands, failures and platform limits. Put temporary captures
outside source directories. A browser preview is a presentation check; native
lockdown, installer signatures, OS permissions and live assessment behavior need
their own explicit validation. Earlier review totals are not a current pass.

## Current validation limits

Superseded standalone UI plans and migration guidance now point to these current
guides. Historical runtime-verification records, review checklists and phase
evidence retain their original results under an archival notice. No functional
checks, fixtures, CI workflows or application code were removed by this cleanup.

The October 19 local work passed TypeScript and focused tests for the calendar,
theme and config changes. Browser checks covered both logo themes, narrow
branding, dashboard calendar hydration and the contest-to-device-setup header.
The repaired hosted dev server stayed responsive beyond the reproduced crash
interval. Native icon files were decoded and inspected.

The October 19 verification passed all 557 web tests with serial execution,
TypeScript, version consistency, 74 local documentation links and all production
export/size-budget checks. The build used process-local `CIRCLE_NODE_TOTAL=2`
to limit worker concurrency. Desktop script tests passed 15 checks with one
skipped. All 97 proposed cleanup paths remain present.

A later Windows icon check reproduced a stale embedded executable icon after
the source artwork had changed. Cargo now tracks the ICO, and the executable,
NSIS installer and uninstaller explicitly select it. Rebuilt release EXE and
NSIS setup files contain all six current icon images; the MSI Icon table matches
the ICO byte for byte. The updated desktop suite passed 17 tests with one skipped.
Those installers were not installed, and MSIX, non-Windows packages and live
assessment behavior were not retested by the agent.
