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

Login and organizer-approval creation synchronously own their pending request,
including multiple submit events before React rerenders. Failed attempts release
ownership for explicit retry; successful login keeps ownership through navigation.
Approval ownership is released on completion, including responses invalidated by
sign-out. Existing server-directed login cooldown and recovery identity checks
remain authoritative. These guards add no automatic mutation retries.

### Approval before re-entry setup

Home Enter and Resume reach the same early onboarding authorization gate before
device checks. `POST /participant/sessions` sends an `entry_attempt_id` UUID;
only a matching successful POST echo for the expected contest and a pending or
active session permits setup. A GET session, approval status, saved face scan or
local nonce alone never authorizes checks. An approved grant is consumed by an
explicit entry action. Checking pending approval status only reads the decision.
First entry and practice remain supported; a dry-run rehearsal creates no session.

The nonce survives refresh and setup retry in this window's session storage.
Home starts a fresh nonce before a new entry, and Exit setup/sign-in changes clear
its ownership. Storage failure blocks progression rather than reusing an earlier
attempt. Final launch reuses the same server-authorized nonce, preserves face
review delivery, and records a completed setup handoff immediately before opening
the workspace. The contest route checks that handoff and reauthorizes the same
nonce; it cannot adopt an early setup session record as completed setup.

There is no approval poller in onboarding. Home polls only pending requests,
delays the first read after validation, then reads every 15–20 seconds with one
request at a time. Failures wait at least 30 seconds plus jitter and respect longer
Retry-After values. Polling stops on approval or a terminal decision; explicit
status checks remain available. At 3,000 pending clients the sustained healthy bound is
200 reads/second averaged over polling intervals and the expected rate is about
171/second, excluding initial
validation and deliberate manual actions. These client tests do not prove server
capacity: staging must validate synchronized entry bursts, approval reads and
transactional grant consumption at 3,000 participants.

Deploy the companion `ams-api#43` entry-attempt contract first. New clients fail
closed if a server does not echo the nonce. Nonce-upgraded graded sessions reject
legacy writes without a nonce; require the API's enforcement flag for all graded
sessions after the client rollout. Do not claim global enforcement while legacy
compatibility remains enabled. The normal web test script includes executable
authorization, lifecycle, handoff and polling regressions. Installed native
behavior and production load remain separate acceptance checks.

Startup keeps a visible status after the intro while version and sign-in checks
finish. Empty credentials are checked before requesting sign-in, and the login ID
field accepts short IDs or full handles. Optional display metadata storage failures
do not become authentication errors; inaccessible recovery data remains an
explicit warning. Cached contest search misses retain their stale-data notice
and Clear search action.

Logged-out login Help sends a one-shot issue with email, phone, name and message;
organization code is not requested. It shows a sent confirmation and never opens
a conversation. A pending request remains available for an idempotent retry, and
editing it starts a new request identifier.

Signed-in Help asks only for a message. Authentication supplies participant
and contest organization, while organizers reply through
the organization-wide Support inbox rather than a contest-only incident view.
Conversation capabilities and pending request/message identifiers use this
window's session storage so closing the dialog, navigating and reloading can
resume the same signed-in conversation. A full window close ends local recovery;
confirmed messages remain on the server. Storage failures show a warning and
preserve the mounted conversation in memory; leaving the page, reloading or
closing that chat may lose access. Unconfirmed sends retry with their original
identifier. Replies refresh every 8–12 seconds while open and visible; errors
retain the last history. Resolved conversations remain readable and keep any
unconfirmed message visible for acknowledgement retry. Late responses preserve
newer conversations and pending messages from other help surfaces. Forget chat /
new request removes this window's access to the previous conversation.

During an assessment, Help renders the same chat inside the existing
ContestOverlay and focus trap. Mandatory security, network and expiry overlays
suspend it; chat does not pause the exam clock or remount the workspace. The
existing device incident report with diagnostics shares the chat action row,
aligned left with Close and Send on the right; actions wrap in narrow windows.
See [participant support](../../SUPPORT.md) for rollout and
validation limits.

Session-creation request deadlines cover response-body consumption. Submission
history refreshes are serialized within a session, and equivalent testcase
updates preserve selection. The horizontal header logo is 180px wide with
existing page gutters and built-in artwork clear space preserved.

Sign-in labels match the credential slip: Login ID and Password. Short IDs and full
`@access` and `@access.amsaccess.com` handles accept case changes and surrounding
whitespace. Internal whitespace, punctuation, unknown domains and overlong IDs
are preserved for server rejection rather than silently selecting another identity.
The password starts masked,
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

An unconfirmed submission freezes its full request and idempotency key for that
session and problem. An explicit retry resends those bytes even if the candidate
has edited since; later edits remain in the workspace for a new attempt after
acknowledgement. Finish waits for an outstanding solution request to settle,
not for judging. Unconfirmed finishes release device controls while retaining
session recovery and offering Retry finish. Home keeps recovery data through
transient verification failures and offers Retry verification.

Run results survive question navigation. One bounded Run poll remains active
per client, and output polling never changes the participant's selected tab.
Accepted submission receipts remain visible while history refresh recovers.
Reset code asks for confirmation, restores the current language's starter, and
saves through the existing draft path without changing other questions or attempts.

The multi-file editor is capability gated by the problem projection and remains
off until the API and judge rollout is complete. When enabled, source and header
tabs belong to one workspace with a named C++ entrypoint. Run, scored Submit,
device drafts and server backups carry the entire editable file set plus its
compilation units. New paths are bounded and validated before an attempt; all
source files are compiled, while published reference documents open read-only
and never enter drafts or attempts. A missing capability flag preserves the
single-source workflow. This adds no polling or teammate fetches.

The app does not scan, join or manage Wi-Fi networks and does not ask for Location
permission. After 12 seconds of a continuous observed connection failure, the
recovery dialog offers **Check Again** and **Exit Contest**. Check Again rechecks
the session; Exit Contest uses the existing draft-save confirmation and local
restoration path. Candidates reconnect through OS settings and resume under the
contest's current entry rules. Exiting does not Finish or submit the attempt.
A browser offline event starts the 12-second grace immediately; a server-only
failure starts it when the existing heartbeat reports failure. No extra polling
is added, so the grace is not a promise of detecting every server outage in 12 seconds.

Device setup lets AppShell own page scrolling to avoid nested viewport-height
scroll regions. The MediaPipe loader routes its exact CPU delegate startup
notice to console.info; all other stderr remains error output.

The offline C++ reference is prepared by the web dev and build hooks. First setup
downloads the pinned cppreference archive, verifies its checksum, and packs it into
`public/cppref/`; later builds reuse a validated bundle. For setup without network
access, set `CPPREFERENCE_ARCHIVE` to the pinned archive or `CPPREFERENCE_SOURCE`
to its extracted directory containing `reference/`. Run
`node scripts/setup-cppreference.mjs --check` from `apps/web` to check the bundle.
Installed apps read the embedded index and bounded Brotli blocks through native
`read_cppref_asset` IPC; development servers use the existing Brotli response headers.
Missing bundles fail preparation rather than producing a broken installer. Reference
load errors offer Retry, and rejected index/block loads remain retryable.
Reference HTML is sanitized before rendering: scripts, forms, frames, inline styles,
event handlers and external image sources are removed. Article anchors carry only
controlled navigation metadata, so clicks, keyboard activation and middle-clicks
cannot open external URLs. Only bundled article paths and image assets are allowed.
Build preparation strips external CSS/SVG resource references and omits upstream
JavaScript; bundle checks reject unsafe copied assets. Native top-level navigation
is restricted to the app origin (or the configured development origin), and the
external-browser command refuses requests while native exam lockdown is active.

A native resume of an active session on the same device skips the introduction
and reuses a passed face scan for at most five minutes when the camera is unchanged.
Presence, media permissions, displays, applications, network and lockdown are
checked again. Reusing the scan takes a fresh reference photo during presence
verification, saves it through the native face-image command and uploads it through
the existing session identity-photo endpoint. Capture, save or upload failure runs
the full face scan. Missing or invalid recovery data runs complete setup.

## Public sign-in help

Login opens `LoginHelpDialog` without reading participant authentication or sending
an incident. Bundled topic guidance, the public support URL and `team@amshq.in`
remain readable offline. The fixed HTTPS contact link opens the browser with
Support selected; only the website composes and sends a message. Copying/opening
never claims delivery or organizer notification. Credential reissue remains with
the organizer's identity-verification process.

Optional native version metadata is read only while help is mounted. Candidates
can review the exact bounded troubleshooting summary before copying: coarse
browser-reported platform, validated app version, help-open device time and a
fixed error category. No login ID, password, free-form server errors, storage or
raw logs are included. Clipboard failure keeps selectable text and manual
instructions. Closing help preserves login fields; reopening starts fresh local
help state. Authenticated `HelpRequestModal` and its receipts are unchanged.

Production inbox receipt/staff coverage and packaged browser handoff on Windows,
macOS and Linux require separate acceptance; browser tests do not establish them.

## Contest controls and connectivity

The active toolbar offers Help and Finish contest, but no Leave contest or Contest
info action. Recovery dialogs retain their safe exits, including Check Again and
Exit Contest after detected disconnection. Exit does not mean Finish.

Public service-status banners/dialogs and their `/client/status` polling are removed.
Local connectivity, request errors, bounded retries, support and contest announcements
remain independent. Home lists every non-passing advisory from its policy report by
name and detail, including displays, remote access and clock checks.

## Local exit and restoration

Leave contest restores local controls without requesting attempt completion.
Finish remains a separate server acknowledgement. Both routes preserve truthful
draft/recovery outcomes; network requests and evidence upload never gate local
recovery. Login/home/update screens offer normal Close app, with pending restoration
shown before explicit shutdown. Browser preview does not claim native recovery.

Shared release bounds presentation waits and retains native operation ownership
after timeout. Setup stops progression before release; late acquisitions own their
rollback. Settings must retain network/window uncertainty even when desktop-only
status succeeds. Packaged OS restoration, real latency and participant comprehension
remain release acceptance checks.

## Candidate confidence and result authority

Readiness distinguishes unavailable checks from advisory warnings. Setup progress counts required checks rather than estimating a percentage. Approval requests remain single-flight and accepted even if local persistence fails; unavailable status retains explicitly last-known context and help stays reachable. Existing polling and entry policy remain unchanged.

Contest info opens the schedule and rules from an icon-only circled information button with an accessible label and tooltip, without polling. Reference search keeps arrow-selected results visible without stationary hover overriding selection; opening a result focuses the scrollable article. Reference shows publication time. Result summaries require an authoritative overall verdict and keep zero-row judging failures visible. Compiler diagnostics belong to the selected attempt.

Support previews and submits the same allowlisted automatic context. User-entered contact and message remain explicit fields, with credential-sharing guidance. Update screens describe an official-download handoff without claiming installation success. Native behavior and candidate comprehension remain acceptance checks.

The Login ID field shows a fixed, selectable @access suffix beside the editable handle. Full-ID paste keeps the existing normalization; typed spaces are blocked without intercepting paste or silently deleting internal characters from pasted IDs.

## Windows and Linux team voice (issues #294 / #300)

The contest mounts `TeamVoiceControls` only after authorized entry, for an active
non-dry-run session. The adapter runs in supported Windows and Linux x86_64 desktop WebViews; it
reads the published team projection and uses `phase.voice_open` as authority.
A solo-round 404 stops polling; an unpublished-team 404 continues checking.
Unknown failures close local voice and require a fresh successful team read.
An active connection resumes once after a transient poll failure when the server
confirms the window is open; explicit Leave, terminal voice states and auth
rejection do not resume automatically. HTTP 401/403 stop polling.
Team GETs use ETags, an eight-second deadline, no overlap, completion-scheduled
3–5 second jitter when visible and 15 seconds when hidden. At 3,000 active
visible participants the average is approximately 750 GETs/second (a 1,000/s
minimum-interval upper bound), plus the initial entry burst; ETags save payload,
not database work. Staging must measure these requests alongside existing
contest polling before rollout. Hidden clients average at most 200 GETs/second.

Join is explicit and starts muted. The voice session owns only cloned proctor
microphone tracks, or an audio-only capture requested by Join when no live track
exists. A disabled shared track is cloned without changing the original. Mic
mute and Ctrl+Shift+M affect voice only; peer volume affects local listening.
Output selection appears only when supported by the WebView and enumerated
outputs; playback/permission failures expose retry actions. Peer identity comes
from signaling member IDs; roster display names never establish presence.
Authentication changes, page exit, unmount, local session end, and the server
voice window closing stop the session and abort its requests. Mandatory overlays
make the controls inert and dismiss the voice popover. The workspace shows a
compact mic toggle and peer speaking indicators inside the existing TopBar.
Voice opens member volume, output selection and Leave in a popover; leaving
requires confirmation. The expanded lobby presentation and compact workspace
share a mounted session owner, so changing presentation does not reacquire media
or add polling or signaling requests.

The team lobby/selection screen shares one projection and voice owner across
secured entry and assigned workspace. Relay-only transport still requires a
functioning TURN deployment and an approved destination allowlist. Missing WebRTC
shows unavailable voice without blocking the lobby. No native media or capacity
certification is claimed. Installed Windows and Linux release checks remain required: two and five member teams,
mute/shortcut and permission-denial recovery, output hotplug/autoplay recovery,
replaced-login/auth switch, contest expiry/exit during capture, and proof that
voice teardown leaves proctor audio/video alive. Confirm relay candidates under
lockdown/firewall and verify bounded reconnect and API load at 400 voice users
and 3,000 contest participants. This slice does not roll out macOS, mobile or browser team rooms.

The contest camera preview stays mounted in the content region above the status
footer. The expanded question rail always shows the available preview inside it,
with space reserved below the question list and no preview-toggle button. Only
the minimized rail shows the camera button, which toggles the pop-out preview
beside the rail without changing capture or microphone ownership.

Voice status uses candidate-facing sentences. Microphone denial, missing devices,
relay failures and lost connections have distinct recovery advice. A replaced
voice session requires an explicit “Move voice back to this window” action;
closed rounds do not offer Join. These presentation changes add no polling or
automatic retries. Installed-device and staging load gates above still apply.

The voice roster shows one row per published member. The API's additive
`members[].member_uid` matches signaling identity; display names never establish
presence. Connected rows show muted, speaking, in voice, or not in voice, with
peer volume on that same row and the candidate's own mute state. Older servers
without IDs and interrupted signaling show remote status unavailable rather than
misidentifying duplicate names. This adds no requests or polling. Deploy the API
member-ID addition first; real two/five-member native acceptance remains required.

Team voice attempts to join once when the authorized voice window first opens,
starting muted. Failed joins, intentional leaves, and replaced sessions require
an explicit action; polling never repeatedly requests microphone access. The
mic control reads Muted/Live. A local-only analysis clone provides input level
and a muted-speech hint at four samples per second; it is never attached to a
peer connection or audio output and is stopped with the voice session. If the
WebView suspends Web Audio until a gesture, Enable microphone meter resumes it
without unmuting. Native permission/autoplay and five-member load checks remain
required before event acceptance.

Lobby phase boundaries show only the pending phase status at zero, and part claim/release requests announce their action while pending. Unpublished-team guidance appears once in the lobby. Hidden audio output names explain microphone permission and the System default fallback. An open voice window ending announces its end for five seconds in the toolbar, including when local contest expiry disables voice. These notices add no requests or retries; installed-device timing and screen-reader acceptance remain required.

Lobby part rows retain their Part/label and holder, with an authored title heading
and plain-text summary when supplied by the API. Descriptions wrap within the row;
missing or invalid optional metadata keeps the legacy label/holder presentation.
Summaries are organizer-authored metadata, never inferred from hidden statements.
This uses the existing board projection and adds no requests or polling.

Unsupported native platforms show the team-round restriction on Home and in device readiness. Selecting a contest makes one abortable, eight-second team probe before setup state or navigation; only an authoritative solo result proceeds. Other results remain on Home with explicit retry advice. There is no per-card polling, automatic retry, or extra request on supported platforms/browser.

Team submission approval uses the shared lobby controller and the exact displayed
revision. The Team progress dialog shows the revision, aggregate approval count and only the
candidate's own vote state; the API does not publish individual teammate votes.
Changing revision invalidates previous approvals visibly. Conflicts refresh once
without replaying a vote; pending, expired, unavailable and submitted revisions
cannot mutate. Deadline submission stays server-owned, with no client submission
request at zero. Results show a bounded current integration summary in place;
full benchmark/flamegraph results remain a separate feature. No new polling is
introduced; staging must still verify the existing lobby rate and five-member
consensus under concurrency.

Team workspaces load only the candidate's assigned published part. Teammate
statements, samples, starter code, drafts, Run and Submit routes are inaccessible.
The assigned part supports the capability-gated multi-file editor and read-only
reference attachments. The click-time scoring guard uses the shared server clock and deadline;
the API remains authoritative if allocation changes. A previous submitted team
revision does not block a new part submission before the deadline. The own-part
Submit warning explains that a new revision resets votes. Team progress and voting
open from the compact TopBar Team progress control, reusing the existing board without new
polling. Loading a team workspace fetches only the assigned part projection
and existing statement assets once per authorized workspace load; staging must
measure this entry burst for 3,000 participants. Native layout remains unverified.

Team progress uses one navigation row: Progress, Integration, Live board and Benchmarks.
The toolbar label stays Team progress; revision numbers belong inside the panel.
Individual submission history remains under Attempts below the editor: each
attempt expands to its available per-test verdict, time and memory details.
Integration shows the current run and a distinct last finished result; the API
does not expose a complete archive of team integrations. Benchmark history lists
the returned measurements, with per-run profiles when available.
Team results lazy-load per section.
Integration detail reuses the lobby projection, separates individual verdicts from
the integration suite, and never presents substituted/reference parts as a team
pass. Missing or malformed details fail closed rather than displaying a raw AC.
The live board polls conditionally only while its section and document are visible;
benchmark history refresh is manual and generated SVG profiles render as isolated
images, never inline markup. Closing the dialog or changing sections tears down
requests and profile object URLs. Native visual acceptance and 3,000-participant
staging verification of visible-board polling and result artifact costs remain.

## Team lobby layout and Linux runtime verification

The lobby fills the available window width. Compact phase guidance and voice controls stay
above part selection in the flexible main column; a 280px right column places the
camera at the top and Members directly below it. The member roster also shows voice
presence, without a second member list or a member-list toggle. Voice updates render
from the existing voice owner without rerendering the whole contest shell or adding
polls. Ready, claim and release retain a reserved feedback row and stable action widths
so ordinary pending updates do not move the parts list. Long part descriptions can
be expanded when needed. The locked assignment action appears before the parts list.
Allocation locking, timer expiry and unanimous team readiness never navigate the
participant automatically. Once the server has locked their assignment and the
contest start/security gates permit entry, the participant clicks Ready to open
their part. Choosing-phase Ready still records team readiness; it does not grant
workspace entry. Audio stays owned by the same session across this handoff, with
the microphone and Voice controls in the workspace toolbar. Reconnection and audio
errors remain visible even when Voice settings are closed.
Help and Exit remain usable when editor
actions are locked, while mandatory overlays still suspend interaction.

Narrow windows stack main content, camera, then Members. The camera occupies a
reserved layout region and never covers an action. The existing mounted camera and voice owners continue
across entry into the coding workspace; moving presentation must not reacquire
media or add requests. Render checks cover desktop, narrow windows, phase states
and long content. They do not establish a native cross-network audio call.

Linux plugin checks alone do not establish WebRTC availability. The system
WebKitGTK 2.54 build tested on 12 November 2026 exposes camera APIs but no
RTCPeerConnection, even with the WebRTC setting enabled and all media factories
available. See DEMO.md and issue #388 for the native runtime blocker. Do not
present a passing plugin smoke test as proof that Linux voice works.
