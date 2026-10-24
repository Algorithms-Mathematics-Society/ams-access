# Candidate UI guide

Updated 19 October 2026. [DESIGN.md](../../DESIGN.md) is the visual reference;
this guide maps the current app, its integration boundaries and how to check it.
The Next.js frontend is statically exported into the Tauri desktop app.

## Screens and ownership

| Surface                             | Entry point                                                          | What must stay intact                                                                         |
| ----------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Welcome `/`                         | `src/app/WelcomeScreen.tsx`                                          | Shared logo, theme toggle, workspace entry and preparation guidance.                          |
| Login `/login/`                     | `src/app/login/page.tsx`                                             | Organizer-issued login ID/password, password visibility, diagnostics and help.                |
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

### Startup intro

`src/components/StartupAnimation.tsx` wraps Welcome on `/` only. Its CSS sequence
uses the supplied `Logo system/Startup_animation.mp4` as a reference, reversing
the spire's growth anchor from its base to its apex. The original SVG artwork
stays sharp; no video decoder, external media or new runtime dependency is needed.
The stacked wordmark retains the supplied Geist letter outlines, with the
reference's “Let the work speak.” tagline.

The monochrome intro lasts about 1.8 seconds, offers **Skip intro**, and plays
once per document/app window. In-app navigation back to Welcome does not replay
it; a full reload starts a new launch. Device reduced-motion preference bypasses
the intro, including when enabled mid-animation. Welcome is inert during client
playback; skipping with the keyboard restores focus to **Continue to sign in**.
A 2.1-second timer releases the screen if `animationend` is missed, and effect
cleanup handles unmounts and React Strict Mode. Direct login, home and contest
routes never mount the intro.

Preview with `pnpm --filter @ams/web dev:hosted` and reload `/`. Use normal motion
to inspect the top anchor, then reduced motion to verify immediate entry.
The regular web suite includes `src/components/startup-animation.test.mjs` for
skip/focus, repeat navigation, reduced motion, effect replay and timeout recovery.

### Shared artwork

`src/components/AccessLogo.tsx` exports the two supported UI placements:

- `AccessLogo`: welcome, login, dashboard and device-setup headers.
- `AccessMark`: compact contest header beside the contest title.
- `AccessWordmark`: standalone outlined lettering for the stacked startup composition.

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

- `TopBar`: compact brand, title, countdown, native battery/charging status, support and finish review. Devices without a reported battery omit the indicator.
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

## Camera settings and recovery

Settings camera listing has explicit loading, empty and unavailable states with Refresh. Choosing a camera saves it for setup and contest use; a missing saved camera requires reconnection or explicit reselection. Blank device labels use Camera N, while hidden device IDs remain unverified. Stage 7 exposes the same choice without relaxing required camera policy.

Camera capture and decoded preview readiness have separate deadlines; a live handle alone is not a verified preview. Settings microphone timeout/cancel restores retry and stops late grants. Video switching preserves shared audio, and Settings exit releases its owned preview. Sustained frame-stall guidance is diagnostic only and does not inspect pixels or determine presence. Verify these behaviors with synthetic tests and separately on packaged Linux builds; the reported Arch/Wayland renderer freeze remains a hardware acceptance item.

Linux keyboard setup checks are temporary native probes with restoration before completion. Show aggregate capability separately from individual shortcut enforcement: individual rows remain “Not individually verified.” Keep one pending probe, discard late results after navigation, and provide warning/continuation according to contest policy after the presentation deadline. A successful settings check must not imply gesture prevention, complete shortcut coverage, or Cinnamon support.

## Helper setup and verified recovery

A failed network-helper setup stays on the connection stage with Retry connection check and Continue with warning. Preserve the actual warning and let final contest policy decide entry; never convert a dismissed or failed admin prompt into a pass. Give distinct guidance for unavailable authorization, missing packaged files, absent systemd, startup timeout and an installer already running. Navigation does not cancel an elevated native installation.

Restore success requires a successful status query confirming no pending restoration. A rejected restore or unavailable status must remain actionable, and Linux network recovery instructions must not imply desktop settings were successfully restored. Manual network instructions concern only the application's named firewall rules.

## Frontend feedback and request ownership

Startup keeps a visible status after the intro while version and sign-in checks
finish. Empty credentials are checked before requesting sign-in, and the login ID
field accepts short IDs or full handles. Optional display metadata storage failures
do not become authentication errors; inaccessible recovery data remains an
explicit warning. Cached contest search misses retain their stale-data notice
and Clear search action.

Help opens a private support conversation before or after login. The opening
form asks for email, phone, name and the issue, in that order. Contact details
are self-reported, not proof of account identity. The summary and issue become
the first message, and authorized organizers reply through the organization-wide
Support inbox rather than a contest-only incident view.

Conversation capabilities and pending request/message identifiers use this
window's session storage so closing the dialog, navigating and reloading can
resume the same conversation. A full window close ends local recovery; confirmed
messages remain on the server. Storage failures show a warning and preserve the
mounted conversation in memory. An unconfirmed send retries with its original
identifier. Replies refresh every four seconds while open and visible; errors
retain the last history. Resolved conversations remain readable. Forget chat /
new request removes this window's access to the previous conversation.

During an assessment, Help renders the same chat inside the existing
ContestOverlay and focus trap. Mandatory security, network and expiry overlays
suspend it; chat does not pause the exam clock or remount the workspace. The
existing device incident report with diagnostics remains reachable from chat.
See [participant support](../../SUPPORT.md) for rollout and
validation limits.

Session-creation request deadlines cover response-body consumption. Submission
history refreshes are serialized within a session, and equivalent testcase
updates preserve selection. The horizontal header logo is 180px wide with
existing page gutters and built-in artwork clear space preserved.

Sign-in labels match the credential slip: Login ID and Password. Short IDs and full
`@access` handles retain the existing normalization. The password starts masked,
with a Show/Hide control and a persistent format hint linked to the input.

## Contest reference sheet

A contest with published organizer guidance has a **Reference** action beside
Help. It opens a read-only, theme-matched dialog with the shared sheet title and
plain text. HTML, links and Markdown are not interpreted. The published snapshot
arrives in the authenticated contest index; opening the sheet performs no fetch.
It remains readable after a connection loss while the workspace stays mounted,
subject to mandatory connection/security overlays. This is not durable offline
storage, and reopening the app requires the usual contest load.

Opening does not remount or resize the editor. Draft, selection and workspace
scroll remain owned by the existing editor. Sheet state is local and keyed by
contest; reading position survives closing within that mount. The body is
keyboard-scrollable, Tab stays within the dialog, and Escape/Close returns focus
to Reference. Background workspace controls become inert while open. A mandatory
overlay or contest expiry dismisses it without stealing focus back. Its visible
countdown shares the existing clock; only the original countdown owns expiry.
Opening uses the fast motion token and skips animation under reduced motion.
Older WebViews use an aria-hidden fallback with the same focus trap when inert
is unavailable, and a vh height bound when dynamic viewport units are unsupported.
Readiness, onboarding, and results request metadata without reference content;
the workspace retains its one-call published-sheet preload.

Older servers or absent/invalid published guidance omit the Reference action.
The optional payload is validated at 120 title / 20,000 body Unicode codepoints;
malformed data does not prevent contest entry. Draft content is never requested.
The snapshot stays fixed until the next contest load. Timed-contest publication
is frozen at contest start on the server. Native overlay/lockdown acceptance still
requires testing in a packaged build; browser checks do not certify OS behavior.

Settings shows the installed AMS Access version above its section tabs, using native
app metadata rather than the latest server release. Browser previews or unavailable
native metadata show “Version unavailable.”

Submission retries keep their key only for the exact session, problem, language,
and source snapshot. Finish waits for an outstanding solution request to settle,
not for judging. Unconfirmed finishes release device controls while retaining
session recovery and offering Retry finish. Home keeps recovery data through
transient verification failures and offers Retry verification.

The reconnect dialog expands Wi-Fi choices inline within its scrollable content,
so network names and password controls stay inside the dialog at narrow sizes.
The contest toolbar keeps its compact Wi-Fi dropdown. Long network names wrap.
