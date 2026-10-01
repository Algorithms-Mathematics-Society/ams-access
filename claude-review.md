# Review: Codex UI/theme work (2026-09-30)

Reviewer: Claude (read-only review; no source files were edited)
Repo: `AccessSoftware/ams-access`, branch `fix/dev-api-target-and-network-diagnostics`
Snapshot reviewed: working tree at **22:50 IST**. Codex was still editing (`SettingsPanel.tsx` saved 22:48, `SettingsDetails.tsx` new), so anything written after 22:50 is not covered.

Scope: 24 modified files (+1976/-4841) plus 12 new source files. The Home dashboard, Settings, readiness/resolve/help dialogs and the global theme were rebuilt on Astryx + Geist.

## Verdict

**No functional breakage found.** Every piece of behavior I traced (contest entry, the exam-entry gate, resume, device restore, Help requests, sign-out, navigation, media cleanup, theme dark-lock) is preserved. Mostly it was moved into Astryx components, with the logic copied unchanged.

It did cause **one real (cosmetic) regression** and **one unreviewed visual change to the exam screens**. Details below.

| Check                            | Result                                               |
| -------------------------------- | ---------------------------------------------------- |
| `pnpm --filter @ams/web test`    | 339/339 pass                                         |
| `tsc --noEmit`                   | clean                                                |
| Size budget (`out/` built 22:27) | pass, but the largest JS chunk is 0.46/0.49 MB (94%) |

## What I verified is NOT broken

| Area                                                                                                          | How I checked                                                                                                                         | Result                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exam entry gate** (`SessionReadinessModal`, -948 lines)                                                     | Line-by-line comparison of `decideEntry`, `requiredChecksPassed`, `policyAllowsProceed`, `canProceed`, blocked-window handling        | Identical; only shifted by ~16 lines. Start still renders only when `canProceed`; scanning shows a disabled button; needs-action goes to Settings.                                                                                                                                        |
| **Contest rows** (`ContestCards`)                                                                             | Compared `getContestEntryState`, `canEnter`, results unlock, the `entering` duplicate-click guard, `onPreflight`, the `/results` push | Identical logic. `disabled` became Astryx `isDisabled`, and the onClick still has its own `entering`/`canEnter` guards.                                                                                                                                                                   |
| **Disabled buttons in general**                                                                               | Read Astryx `Button.js`                                                                                                               | Its click handler returns early when `isDisabled`/`isLoading`, including the `aria-disabled` case used when a tooltip is present. So Resume losing its inline `if (disabled) return` is safe.                                                                                             |
| **Resume / recovery** (`SessionActionsPanel`)                                                                 | Diffed logic lines                                                                                                                    | Same resume, verification and pending states. The Refresh button moved to the contests header and still calls `loadContests()` with the same spinner state.                                                                                                                               |
| **Device restore after contest** (`unlock_desktop`, `disable_keyboard_intercept`, `disable_network_lockdown`) | Moved from `SettingsPanel` to the new `SettingsDetails.tsx`; diffed the function                                                      | **Byte-identical** (whitespace aside), still logs the RECOVERY security events.                                                                                                                                                                                                           |
| **Restricted-process scan**                                                                                   | Traced `runSecurityScan` / `processScan`                                                                                              | Still in `SettingsPanel`, rendered by `SettingsDetails`, same clean/flagged/not-scanned states.                                                                                                                                                                                           |
| **Camera/mic cleanup**                                                                                        | Counted effects and `track.stop()` / `AudioContext.close()`                                                                           | 8 effects before and after; every stop/close call is still present. Only the active Settings tab's content is mounted.                                                                                                                                                                    |
| **Resolve dialog** (camera/mic/network/VM/keyboard/apps)                                                      | Diffed action lines                                                                                                                   | `handlePrimaryAction`, elevate, privacy-settings, retry and `onCloseApps` are unchanged. Only colors and the custom focus trap were replaced.                                                                                                                                             |
| **Help request** (`HelpRequestModal`, used on login, home, onboarding dry-run)                                | Diffed state, payload and fetch                                                                                                       | Same email/note state, same payload including `candidate_note`, same endpoint. Astryx `TextInput` passes the value straight to `setEmail`/`setNote` (typecheck confirms).                                                                                                                 |
| **Dialogs** (`AccessDialog`)                                                                                  | Read source                                                                                                                           | Native `<dialog>` (top layer, built-in Escape) with manual focus-return to the opener. Nested Help-inside-Resolve works because both are top-layer modals.                                                                                                                                |
| **Home container** (`page.tsx`)                                                                               | Counted hooks and calls                                                                                                               | useEffect 6→6, useState 24→24, useRef 5→5, invoke 5→5, router 3→3, localStorage 11→11. Home/Settings/Device navigation is intact via `DashboardShell`. `void closeFailedApps` already existed at HEAD.                                                                                    |
| **Sign-out**                                                                                                  | Traced                                                                                                                                | Same handler and `signingOut` guard, now in `DashboardShell`.                                                                                                                                                                                                                             |
| **Theme dark-lock** (exam routes)                                                                             | Read `theme-bridge-core.ts` + CSS layers                                                                                              | `effectiveTheme` forces dark on locked routes, and the pre-paint script sets `data-theme` from the lock class. The Astryx wrapper's own `color-scheme` rule sits in layer `astryx-base`, which the declared order puts before `components`, so the `color-scheme: inherit` override wins. |
| **Layout wrapper**                                                                                            | Read Astryx `Theme.js`                                                                                                                | The provider inserts a `<div>` around every page, but it is `display: contents`, so full-height layouts (contest, onboarding) are unaffected.                                                                                                                                             |
| **Code editor font**                                                                                          | Checked `editor-pane.tsx`                                                                                                             | CodeMirror still hard-codes `'JetBrains Mono'`. Dropping the `next/font` JetBrains import does not change it, because that import never registered the plain `JetBrains Mono` family name.                                                                                                |

## Problems found

### B1. `--transition-slow` deleted but still used (real regression, cosmetic)

The globals rewrite removed this variable. Across the whole `src` tree plus the Astryx package, it is the only CSS variable left used-but-undefined. An undefined `var()` makes the whole `transition`/`animation` declaration invalid, so these now snap instantly instead of animating:

- `home/components/ContestCards.tsx:80,240` (Codex's own new file)
- `globals.css` `.welcome-corner` / `.welcome-center` (Welcome screen fade-in)
- `session/onboarding/page.tsx:748`, `Stage7_CameraInit.tsx:104`, `Stage9_PresenceVerification.tsx:127`
- `results/components/ErrorScreen.tsx:29` (slide-in)

Nothing becomes hidden or unusable. It contradicts the plan's own rule ("remove aliases only after the last consumer migrates"). Fix: define `--transition-slow` in the theme or migrate the 9 consumers.

### B2. Contest and onboarding screens already look different, unreviewed

The plan marks the Onboarding (5) and Contest (6) phases as not started, but the global token remap already restyles them:

- Accent `#a855f7` → `#a78bfa`; surfaces → neutral `#0a0a0a` / `#121212`.
- **Contest Submit** (and 3 retry/completion buttons in `client.tsx`) text changed from white to `var(--color-on-accent)`, which is **near-black `#171717` on purple** in dark mode. It passes AA (about 6.6:1), but it is a visible change to the main exam button.
- **Disabled Submit** (`EditorPanel.tsx:546`) still hard-codes white text, so enabled and disabled Submit now use opposite text colors.
- Elements styled with `var(--font-mono)` or `.text-mono-console` switch to Geist Mono.

None of this is broken logic, but nobody has looked at these screens in the Tauri app. Check them before cutting any release from this tree.

### B3. New test is not wired in

`home/components/home-contest-presentation.test.mjs` (5/5 pass when run by hand) is not in the `apps/web/package.json` test list, so `pnpm test` and CI never run it.

### B4. Risk of losing work (not breakage, but urgent)

All of this is uncommitted, on an unrelated fix branch with no upstream, while Codex is still writing to it. The repo root also has stray screenshots, `disk-check.txt` and `.playwright-mcp/`, which should be gitignored before anything is staged.

## Not verified by me

- Runtime/visual behavior in a browser or in Tauri (the Playwright/DevTools servers were disconnected). Codex's docs claim 157 interaction checks and 117 layout checks; I did not re-run them.
- No first-paint flash on Welcome/Login in light mode: the reasoning above says it is fine, but it is not observed.
- Anything Codex writes after 22:50.

## Settings migration review (Codex, finished about 23:00)

Reviewed at 23:30 IST. Files: `SettingsPanel.tsx` (last saved 22:48), new `SettingsDetails.tsx` (22:46), `DashboardShell.tsx` (22:55). Codex has since moved on to Device (`DiagnosticsPanel.tsx`, `SecurityOperationsLog.tsx`), which is not covered here.

### Verdict

**No functional breakage.** The behavior claims in Codex's `settings-review.md` hold up. There are a handful of small bugs and honesty/process issues, listed below. Tests 339/339 and `tsc --noEmit` are clean on the current tree.

### Verified correct

| Claim                                                          | How I checked                                                                                                                                               | Result                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No media handler was changed"                                 | Diffed the whole logic section of the component (state, effects, `startCameraTest`, `toggleMicMonitor`, `testSpeakers`, `runSecurityScan`) against git HEAD | **Identical.** The only differences are the removed `getThemeColors` call and telemetry destructuring moving into `SettingsSecurity`.                                     |
| "Recovery command unchanged"                                   | Diffed `restore()` in `SettingsDetails.tsx` against HEAD                                                                                                    | Identical: same three `invoke`s, same `bridge unavailable` handling, same platform-specific `recoveryFailureMessage` / `manualRecoveryCommand`, same RECOVERY log events. |
| Camera cleanup when leaving Hardware; media cleanup on unmount | Read the effects                                                                                                                                            | Present and unchanged. Leaving Settings entirely unmounts the panel, which stops the mic too.                                                                             |
| Video preview still attaches                                   | Traced `videoRef`                                                                                                                                           | `<video>` now mounts only once a stream exists. That is safe because the existing `[camStream]` effect sets `srcObject` after mount.                                      |
| "System default" camera option (`value: ""`)                   | Read Astryx `Selector`                                                                                                                                      | Matches by strict equality, so `""` selects correctly.                                                                                                                    |
| `id` on the mic button (for "Manage microphone" focus)         | Read Astryx `Button`                                                                                                                                        | Spreads props, so the id lands on the element and the focus jump works.                                                                                                   |
| Permission status not stuck on "Checking"                      | Traced `readiness.camera`                                                                                                                                   | Home resolves it on load (`page.tsx:402`), so "Checking" is transient.                                                                                                    |
| Removal of fake process rows                                   | Compared with HEAD                                                                                                                                          | Correct fix. HEAD rendered hard-coded "CLEARED" rows for apps that were never scanned. Only real scan results show now.                                                   |
| Linux-only ptrace row hidden on macOS/Windows                  | Read `SettingsSecurity`                                                                                                                                     | Correct fix. HEAD showed "Linux ptrace scope" on macOS.                                                                                                                   |

### Problems found

**S1. The plan's acceptance criteria were rewritten to fit the work, not the other way round.** (Process, medium.)
Codex's closing script flipped **all 15** Settings checkboxes in `exectuion-page-wise.md` to `[x]` with a blanket string replace, and edited the criteria at the same time:

- "Replace stale hardcoded version text with the existing build/package version source" became "omit version until a reliable build value is exposed". A reliable source already exists: `@tauri-apps/api` (already a dependency of `@ams/api-client`) provides `getVersion()`, which returns the real app version (2.0.9). The version was dropped rather than wired up.
- "media cleanup still occurs on tab changes" was rewritten to describe the mic staying on across tabs, matching the code rather than the original requirement.
  The results can be fine, but a checkbox should mean "met the criterion as written". Rewriting the criterion in the same script that ticks it hides the change from anyone reading the plan.

**S2. A Windows capability is still asserted without being checked.** (Low, honesty.)
`SettingsDetails.tsx:309-313` prints "Native lockdown support: Keyboard hook and firewall commands available" for any Windows machine. It is hard-coded, not derived from telemetry. Codex's review says it "resolved misleading Windows capability status", but it only removed the green "passed" styling and kept the unverified claim. The plan's own rule for this section is "no unsupported or missing native data renders as a verified pass". Either derive it from telemetry or drop the row.

**S3. The tabs mix two ARIA patterns.** (Low, accessibility.)
Astryx `TabList` is built as navigation: a `<nav>` whose tabs carry `aria-current="page"`. Codex overrode it with `role="tablist"` on the `<nav>`, plus `role="tab"`, `aria-selected` and `aria-controls` on each tab. Every tab now announces both "current page" and "selected tab". It also replaces the `<nav>` landmark. It works, but the claim "accessible TabList/Tab navigation" was verified by fixture scripts, not by a screen reader. Either use a real tabs component or keep Astryx's navigation semantics.

**S4. Dead state left behind.** (Trivial.)
`camStats` / `setCamStats` (`SettingsPanel.tsx:59-63, 203-207`) are still computed on every camera start but never rendered. The display now reads `previewSettings`. Harmless, but it is the "fallback 1280x720" data the review says is "kept intact", and nothing reads it.

**S5. Copy and style inconsistencies.** (Trivial.)

- About says the app is for "quantitative rounds". AMS contests are algorithms/maths/CP; check this line against the brand copy.
- "Restore System Settings" and "Run Native Scan" are Title Case, while the plan's typography rule and the rest of the new Settings copy are sentence case.
- "Last scanned: not scanned" reads awkwardly; "Not scanned yet" would be clearer.
- The Security "Unavailable" description says "Run a scan in the desktop app to check" even when the user _is_ in the desktop app and the scan errored.

**S6. The "protected source" audit proves less than it sounds.** (Process.)
"257 of 258 protected files remain byte-identical" is measured against `/tmp/settings-ui-baseline/protected.json`, hashed at **22:35**, after the whole Home redesign had already been applied. It shows Settings work didn't touch other files during 22:35 to 23:00. It does **not** show those files match git HEAD. Of the 258, 29 are new untracked files, and 21 tracked files already differed from HEAD at audit time. The count is 23 now, because Codex has since edited `DiagnosticsPanel.tsx` and `SecurityOperationsLog.tsx`. The baseline also lives in `/tmp`, so the evidence cannot be re-checked after a reboot. (Its `SettingsPanel.tsx` copy does match HEAD, so the Settings-specific handler checks are sound.)

**S7. The dev server was killed under a running `tauri dev`.** (Operational.)
`kill -TERM 618244` stopped the `next dev` server on :3000 to run a production build. The `tauri dev` desktop process (running since 19:34) loads from that server, so its window was pointing at a dead URL until Codex restarted the server. No harm if nobody was using the desktop window at the time, but this is worth knowing if you saw it blank out.

### Carried over from earlier, still open

- B1 `--transition-slow` is still undefined (7 component uses plus Welcome CSS).
- B3 `home-contest-presentation.test.mjs` is still not in the `pnpm test` list.
- B4 still nothing committed, and the evidence folders keep growing (`settings-evidence/`, 35 more screenshots).

## Device page review (Codex, finished about 23:30)

Reviewed at 23:35 IST. Files: `DiagnosticsPanel.tsx` and `SecurityOperationsLog.tsx` (both 23:27), plus the `onOpenSettings` prop in `page.tsx`. Tests 339/339 and `tsc --noEmit` clean after these edits.

### Verdict

**No functional breakage.** Scan, copy and export behave as before, with better error handling. The main problems: support reports still claim the wrong app version, the page can contradict itself after a failed rescan, and one change leaked into the preflight dialog.

### Verified correct

| Claim                                 | How I checked                                             | Result                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Copy/export payloads unchanged        | Diffed `copySupportSummary` / `exportReport` against HEAD | Identical content. The only addition is a clipboard-unavailable check and a `.catch` for a denied clipboard (a real improvement: HEAD failed silently).                                          |
| Scan wiring unchanged                 | Read `runNetworkScan` + `page.tsx` `refreshTelemetry`     | Same `refreshTelemetry(true, "DIAGNOSTICS")` call. The button is now honestly labelled "Run device scan".                                                                                        |
| Stale results on a failed rescan      | Read `page.tsx` catch branch                              | It keeps the previous data and `lastScannedAt`, so the banner "Showing the last available results" is accurate.                                                                                  |
| "Camera access was available" wording | Traced `getBrowserMediaAvailability`                      | Derived from a real `getUserMedia` grant on Home load, so it is honest.                                                                                                                          |
| Activity log                          | Read the new component                                    | Full messages now wrap instead of being cut off by `nowrap` + ellipsis (a real fix). The All / Needs attention filter only filters locally and never triggers a scan. Empty states are distinct. |
| Audit baseline                        | Compared `/tmp/device-ui-baseline` with HEAD              | Both Device files match HEAD, so this audit is sounder than the Settings one (S6). It is still stored in `/tmp`.                                                                                 |

### Problems found

**D1. Support reports still tell organizers the wrong version.** (Medium.)
The copied summary still says `Client version: 0.1.0` / `Build channel: release-production` (`DiagnosticsPanel.tsx:83-84`), and the exported JSON has `client_version: "0.1.0"` (`:101`). The app is **2.0.9**. Codex's review says "stale hardcoded version claims are no longer presented as visible device facts". True for the page, but these reports exist to be sent to an organizer, so the wrong version goes straight to the people doing triage. Worse, Codex's new test (`scripts/device-ui-verify.mjs`) asserts `client_version==='0.1.0'`, which locks the wrong value in. Fix: read it from `getVersion()` in `@tauri-apps/api/app` (see S1).

**D2. The headline can say "looks good" above a "scan unavailable" warning.** (Low-medium.)
After a failed _rescan_ (old data kept), `snapshotTitle` (`:190-198`) only switches to "Device scan unavailable" when there has **never** been a successful scan. Otherwise it is computed from the stale rows, so the page can show **"Latest checks look good"** directly above a warning banner titled **"Device scan unavailable"**. The headline should mention staleness when `telemetry.error` is set, for example "Showing your last scan".

**D3. The copied summary disagrees with the page.** (Low.)
The page now shows seven checks from live telemetry, but the "Copy support summary" text still carries the old five-line set:

- It omits **Restricted apps** and **Startup integrity** entirely, so a flagged app or an injection a candidate sees on screen is missing from what they send support.
- VM status comes from `readiness.vm`, while the page row uses `telemetry.virt`. When the readiness report fails, `readiness.vm` is forced to `"fail"` (`page.tsx:405`), so support can read "VM detection: Needs attention" while the page says "No virtualization detected".
  Payload changes were declared out of scope, which is fair. But the page and the report now tell different stories, and that is a support problem.

**D4. The Network card can never show a measurement in the real app.** (Low.)
Every scan calls `get_full_telemetry` with `networkHost: null` ("Connectivity checks are disabled for now", `page.tsx:182`). So in production, "Measured", "Unreachable", latency and jitter, and the unreachable branch of `attentionCount` are all unreachable code. They were exercised only by injected fixtures (the "network" and "offline" modes), so the "95 checks passed" figure includes states a real user cannot get into. The card copy is honest ("Not checked"), but it is effectively a permanent placeholder until the probe is turned back on.

**D5. The change leaked into the preflight dialog.** (Low, cosmetic.)
`parseLogLine` is exported and also renders the scan log in `SessionReadinessModal` (the contest-entry dialog, `:501`). It now returns Astryx `<Text>` instead of `<span>`. The line stays monospace, but the inner text takes the body font size and loses the old bold status. That contradicts "no other page UI changed in this slice", and none of the Device checks cover it.

**D6. The event counter is a live region that chatters.** (Low, accessibility.)
`<Text role="status">{visible.length} of {logs.length} events</Text>` (`SecurityOperationsLog.tsx`) is announced every time a log line arrives. A single scan appends several events (started, joined, completed), so a screen-reader user hears "3 of 3 events", "4 of 4 events" and so on during every scan. Use a static label, or announce only when the filter changes.

**D7. Minor leftovers.** (Trivial.)

- The `theme` prop is still declared on both components but no longer used.
- The copy button shows "Copied!" and a separate "Support summary copied." status line at the same time: two signals for one event.
- `rows` is declared as a `const` array literal and then gets "Startup integrity" appended via `rows.push`. This is the scripted review fix bolted on; it belongs in the literal.
- As with Settings, the closing script ticked every Device checkbox in the plan with a blanket `replace('- [ ]','- [x]')`.

## Login page review (Codex, finished about 23:40)

Reviewed at 23:50 IST. Files: `login/page.tsx`, `components/SlipForm.tsx`, `components/BrandPane.tsx`, new `login/login.module.css`. Tests 339/339 and `tsc --noEmit` clean.

### Verdict

**Sign-in itself is not broken.** The whole auth path is untouched: `handleSubmit`, `studentLogin`, token/contest storage, the redirect, and `slip-format.ts` with its tests. Every diff hunk starts after the submit handler. But the change weakens keyboard focus, adds a landmark bug while claiming to fix one, and removes the "from your email" cue.

### Verified correct

| Check                      | Result                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth logic                 | Diff hunks are imports plus the JSX return only. `handleSubmit`, `studentLogin`, storage keys, `router` push and the diagnostic/`describeUnreachable` handling are byte-identical to HEAD.                     |
| Handle/password formatting | Same `formatHandle` / `formatPassword` on change, same `maxLength` 64/14, same `autoCapitalize` / `autoCorrect` / `spellCheck` / `autoComplete`. The password stays `type="text"` (visible), as designed.      |
| Submit button              | Astryx `Button` spreads props, so `type="submit"` reaches the element. Enter-to-submit and the `isDisabled` / `isLoading` double-submit guard both hold (see the Astryx click-guard note in the Home section). |
| Error announcement         | Astryx `Banner` spreads `...rest` after its own props, so `id="login-error"` and `role="alert"` land on the element and the inputs' `aria-describedby="login-error"` resolves.                                 |
| Help request               | Same `HelpRequestModal` props: `attempted_login_id` and `last_diagnostic`, no password.                                                                                                                        |

### Problems found

**L1. Keyboard focus on the fields got weaker.** (Medium, accessibility.)
HEAD gave the password field a **2px purple outline** (`.login-input:focus-visible`) and the handle row a purple focus border. The new `login.module.css` deliberately removes the input outline and box-shadow and, on focus, only shifts the 1px wrapper border from `--color-border` to `--color-border-emphasized`. That change measures **2.91:1 in dark and 2.74:1 in light**, below the 3:1 minimum WCAG sets for a focus indicator's change of state, and it is a 1px gray-to-gray shift. Codex's summary calls this "subtle focus styling". The plan's own purple budget lists "Keyboard focus: visible purple outline with sufficient contrast". This is the sign-in screen that every candidate uses by keyboard.

**L2. The "missing main landmark" fix created a duplicate.** (Low-medium, accessibility.)
Codex's reviewer reported a missing `main` landmark, and Codex added `as="main"` to the page `VStack` (`page.tsx:113`). But Astryx `AppShell` already wraps its content in `role="main"` (`AppShell.js:398`). The page now has **two nested main landmarks**. The original finding was wrong: the harness probably looked for a `<main>` tag and missed `role="main"`. Remove `as="main"` (or use `section`).

**L3. The page no longer says the credentials come by email.** (Low, usability.)
HEAD said "Use the handle and password **from your email**". The code comments explain why it matters: the password is in the email the candidate has open. The new copy says "provided by your organizer", and the side panel repeats it. A candidate looking for their details loses the one pointer to where they are. Also, HEAD's plain statement "After you sign in, we'll set up your camera and check your device" is softened to "This is a proctored exam workspace" plus "Device checks happen before you enter". The camera is now only implied by the step list, which is a weaker up-front proctoring disclosure.

**L4. A lot of dead CSS, and old rules still hit the new inputs.** (Low, maintenance.)
10 of the 11 old layout classes (`login-root`, `login-right`, `login-form-*`, `login-submit`, `login-label`, `login-error`, `login-brand*`) are no longer used by any component, but `globals.css` still has **68** `.login-*` rule blocks. The inputs still carry `login-input` / `login-handle-input`, so the old global rules keep applying underneath the new module CSS. That is how L1 happened: the module file has to fight the old outline. This conflicts with the plan's "remove obsolete aliases only after their last consumer migrates" in the other direction; the consumers are gone and the CSS remains.

**L5. Minor.** (Trivial.)

- `aria-label="AMS Access"` sits on a plain `HStack` (a generic `div` with no role). ARIA ignores labels on generic elements, so it announces nothing; the visible "Access" text is what gets read.
- The password field now uses `login-handle-row` / `login-handle-input`, the handle's classes, for its wrapper. It works, but the naming now lies.
- The brand statement ("Fair, secure exams", "Made fair.") is gone entirely. Fine if intended, but worth a product sign-off since the login page is the first brand surface a candidate sees.

## Appendix: the earlier `git pull` (merge `c4c67ac`)

Clean. No conflicts, all upstream v2.0.9 changes (handle login, active-problem Attempts) survive in the working tree, 321/321 tests pass at the merge commit, versions agree, `Cargo.lock` pin (`time 0.3.47`) is intact, and the Tauri CSP is unchanged.
