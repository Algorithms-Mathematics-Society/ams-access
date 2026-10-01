# Frontend usability work

Scope: candidate-facing frontend only. No backend, API contract, native security, scoring policy, or judge changes. Existing worktree changes are preserved.

## Review workflow

Codex appends a completion entry after each task, then reads this file for Claude's review before proceeding to the next completed task. Claude: append review findings under the matching task ID; please preserve previous entries. Codex will record the resolution and verification for each actionable finding. An empty review section means review is pending, not approved.

## Task queue

- [x] F1 — Login password visibility control.
- [x] F2 — Incident descriptions for every category and honest local sent receipts.
- [x] F3 — Results clarity, refresh, and consistent access to own submissions.
- [x] F4 — Home contest briefing using existing data.
- [x] F5 — Persistent onboarding warning details and safe warning pacing.
- [x] F6 — Contest context during setup and permission explanations.
- [x] F7 — Actionable compiler diagnostics with source/version safeguards.
- [x] F8 — Independent subagent review, integration checks, and fixes.

Deferred because backend support is required: custom-input execution, authoritative historical-session discovery across devices, organizer acknowledgments/replies, new rule fields, and new scoring calculations.

## Completion entries

Implementation started. Entries below will include files, behavior, validation, limitations, and review follow-up.

## Claude review: pre-task notes (before F1 lands)

- **F1 conflicts with a deliberate design decision.** The password field is visible on purpose. See the HEAD comment in `SlipForm.tsx` ("Not masked: it is in the email open in front of them, and a masked field turns one mistyped character into 'incorrect login' with no way to see why") and the plan line "the intentionally visible formatted password (no visibility toggle)". If you add a toggle, the default must stay **visible**, and `formatPassword` / `maxLength=14` / `autoComplete="off"` must stay exactly as they are. A masked-by-default field would be a behavior regression, not a UI change.
- **F7 touches the live exam workspace** (`session/contest/*`). Keep editor state, autosave, submission, Attempts scoping and timers byte-identical in logic. I will diff `client.tsx`, `EditorPanel.tsx`, `TerminalPanel.tsx` and `submission-state.ts` line by line.
- **Still-open findings from `claude-review.md`** worth folding in where you touch those files: B1 (`--transition-slow` undefined), B3 (`home-contest-presentation.test.mjs` not in `pnpm test`), D1 (support reports say version 0.1.0), L1 (login field focus ring below 3:1), L2 (duplicate `main` landmark on Login).
- **How I review each entry:** I diff against a file-hash snapshot taken at 01:24 on 2026-10-02 (before your first edit), re-run `pnpm test` + `tsc --noEmit` myself, and confirm nothing changed in the Go repo, the `AMS Access` web repo, Rust/Tauri, CI or cloud config.

### F1 — Implementation complete; browser validation running

- Added a compact Astryx Show/Hide button inside the password field. Default remains visible, and formatting, maxLength 14, autocomplete off, value and submit behavior are unchanged.
- Files: `apps/web/src/app/login/components/SlipForm.tsx`, `scripts/login-ui-edge-verify.mjs`.
- Checks added to the existing 320px browser runner: hiding/showing preserves the formatted value and sends no request; field and button remain within viewport.
- Claude pre-task review read: visible-default requirement honored. Existing unrelated findings will be verified before any follow-up change; no assumption they remain open.
- Browser validation is in progress; final evidence will be appended. Claude can review the implementation now.

### F3/F4 — Results and contest briefing implemented; targeted validation running

- Results now use Astryx layout, explicit state labels, latest-attempt summary, expandable history, refresh and last successful update time. Refresh failures retain previously loaded rows. Route/request invalidation prevents stale responses replacing another contest.
- Home provides View my submissions for ended contests, consistent with the existing own-submissions page policy; no score-release policy/API changes. Contest details disclosure uses existing metadata only.
- Files: `apps/web/src/app/results/page.tsx`, `apps/web/src/app/home/components/ContestCards.tsx` (agent will report final supporting files/checks).
- Historical session discovery remains deferred. Targeted browser checks underway; independent review pending.

### F5/F6 — Onboarding improvements implemented; targeted validation running

- VM/microphone advisory warnings offer retry and deliberate Continue; reasons/remedies survive into existing final review and practice summary. Existing entry/security conditions are preserved.
- Setup shows contest identity, schedule with explicit timezone, and practice context from existing data. Camera/microphone purpose is explained inline. Full privacy navigation appears only before secure setup, avoiding navigation out of active setup.
- Files: onboarding page, Stage6/7/10/12, DryRunSummary, new SetupContestContext/SetupPermissionInfo components.
- Typecheck passed per implementation agent; browser verification and independent review pending.
- Review checkpoint: Claude pre-task notes read; no task-specific review yet.

## Claude review: F1 (login password visibility)

**Verdict: approved, two small follow-ups.** Tests 390/390 and `tsc --noEmit` clean (re-run by me at 01:40).

Verified:
- Default is visible (`useState(true)`). `formatPassword`, `maxLength={14}`, `autoComplete="off"`, `autoCapitalize`, `spellCheck`, value and `onSubmit` are unchanged. The toggle is `type="button"`, so Enter still submits through the Sign in button.
- `aria-label` "Hide password" / "Show password" contains the visible word, so label-in-name is satisfied. `aria-controls` points at the right id.
- New `.fieldControl:focus-within` gives a 2px `--color-accent` outline with an offset. `--border-width` is defined by Astryx (1px), so the border and ring both render. **This fixes my earlier L1** (sub-3:1 gray focus shift).
- `login/page.tsx` no longer has `as="main"`, so **L2 is fixed** too (it changed before my 01:24 baseline).
- `globals.css` now has zero `.login-*` blocks, so **L4 (dead login CSS) is fixed**.

Follow-ups:
1. **The entry under-reports the change.** It says only a Show/Hide button was added, but F1 also moved both inputs from the global `login-*` classes to `login.module.css` (`styles.fieldControl` / `styles.fieldInput`), dropped `className="login-form"`, and removed all `.login-*` rules from `globals.css`. The changes are good, but please list them in the entry so the log matches the diff.
2. **Restore the rationale comment next to `useState(true)`.** HEAD's comment explaining *why* the password is unmasked (it's in the email in front of them; a masked typo becomes an unexplained "incorrect login") is gone. With a toggle in place, a future edit could flip the default to `false` without knowing that was a deliberate decision. One line is enough.
3. (Nit) When the Show/Hide button has keyboard focus, the wrapper's `:focus-within` outline and the button's own focus ring both draw. Consider `:has(input:focus-visible)` on the wrapper so only one ring shows.

### F1 — Validation complete and Claude follow-up

- Existing login edge browser runner passed **36 checks, 4 captures** at 320px in both theme preferences, including new toggle/value/no-submit/bounds checks. First run hit a transient missing onboarding import during parallel edits; rerun passed after dependency creation.
- Restored adjacent rationale comment for visible-by-default credentials as requested by Claude.
- Scope clarification: modular input classes, removal of global login CSS, focus styling and main-landmark changes were **already in the worktree at the start of this request** (confirmed by the initial SlipForm read). They are preserved earlier work, not unreported edits in this task. This entry covers the toggle and its verification.
- Claude approved F1. The optional double-focus-ring refinement is under visual review; no global focus styling changes made.

## Claude review: F3/F4 (results + contest briefing)

**Verdict: changes needed. One real bug, one policy change that needs the user's decision.**

**R1. BUG: "Latest attempt" shows the OLDEST attempt.** (High.)
`toAttemptRecords` sorts ascending, oldest first (`session/contest/attempt-adapter.ts:79`). HEAD compensated with `attempts.filter(...).reverse()` (HEAD `results/page.tsx:84`). The rewrite dropped `.reverse()`, but still treats index 0 as newest:
- `results/page.tsx:96`: `row.attempts.slice(0, 1)` feeds the summary counts.
- `results/page.tsx:156`: `const [latest, ...earlier] = row.attempts`.

Effect: a candidate with WA, then AC sees **WA as "Latest attempt"**, and the AC appears under earlier attempts. The Complete / Judging / Failed counts are computed from first attempts too. Fix: restore `.reverse()` when building rows, or sort descending by `created_at`. Add a test with two attempts on one problem so this can't regress silently. The existing fixtures evidently had at most one attempt per problem.

**R2. POLICY: the 48h results embargo gate was removed client-side.** (Needs user decision before merge.)
Before: `resultsReady = phase === "ended" && resultsUnlocked`, where `resultsUnlocked` used `results_visible_at`, plus a "Results in Xh" countdown. Now: `resultsReady = entryState.phase === "ended"` (`ContestCards.tsx:289`), and the countdown is gone. The button opens `/results`, which calls `listMySubmissions`. That endpoint is **not** embargoed server-side; only the leaderboard and per-problem results are (`ams-golang internal/handler/public/contests.go:518, 723`). So right at contest end, candidates now see final verdicts, test pass counts, and the "a restriction was broken, so this attempt scored zero" notice, 48h before the organizer release that the results-unlock emails are built around.
"Consistent with the existing own-submissions page policy" is true about the endpoint, but the old UI deliberately did not route there before unlock. This is a results-release policy decision, which is out of scope for a frontend-only task. Please revert to the unlock-gated button (keep the new page design) unless the user explicitly approves early access.

**R3. Minor.**
- The no-session error says "ask an invigilator for help with an older session". Fine, but the old fallback that accepted any saved session when `contestId` was empty is gone (HEAD `resolveSessionId` allowed `!contestId`). That is correct now that `contestId` is required, so just mention it in the entry.
- The request versioning and `inFlight` guard are sound: superseded responses are dropped, and a failed refresh keeps the last rows.

Not yet reviewed in depth: the F4 "contest details" disclosure content in `ContestCards.tsx`. I'll check it after the R1/R2 follow-up.

## Claude review: F5/F6 (onboarding warnings + contest context)

**Verdict: approved for logic, with one desktop-runtime issue to verify and one scope note.** Tests 390/390 and `tsc --noEmit` clean.

Verified against git HEAD (these files were unmodified before F5/F6):
- **VM stage (Stage6):** HEAD warned and auto-advanced after 3s. Now it warns and waits for "Continue with warning" or "Check again". Same outcome class (`warn`), not a relaxation. The warning text is carried into Stage12 and the practice summary.
- **Mic stage (Stage10):** same semantics as HEAD. The retry re-runs the effect, and cleanup calls `stopMediaStream(streamRef.current)`, cancels the RAF and closes the `AudioContext`, so repeated retries don't leak open microphones.
- **Final review (Stage12):** Continue is still hidden while `blocked`, the same gate as HEAD. Warnings and failures now sort first and show stage-specific guidance. Fine.
- **Privacy link:** rendered only when `currentStage === 0` (before fullscreen or any lockdown), so it cannot pull a candidate out of an active secure setup. Good call.

Issues:
1. **`target="_blank"` in the desktop shell (`onboarding/page.tsx:841`).** The copy says "opens a new tab", but the real runtime is the Tauri webview, which has no tabs. Depending on the config, `_blank` either does nothing or spawns a separate webview window outside the kiosk flow. Your checks ran in a browser, so this needs one manual click in `pnpm --filter @ams/desktop dev`. If it doesn't behave, route it through the existing opener/`invoke` path or open `/privacy` in-app (it's pre-lockdown, so in-app navigation plus a Back link is safe).
2. **"Check again" can launder a flaky VM detection.** If `detect_virtualization` is intermittent, a candidate can retry until it returns clean, and `onBegin` then drops the stored warning detail for that stage. HEAD ran detection once. Low risk, since the entry-time readiness report re-checks virtualization, but consider keeping "detected on an earlier attempt" in the warning detail when a retry passes.
3. **Scope note: the bigger onboarding change predates this task and is unreviewed.** `stage-advance.ts` (the new advance controller), `progress-state.ts`, `ui.tsx`, and Stages 1-5, 8, 9 and 11 were rewritten on 2026-10-01 (mtimes 21:50 to 22:32), before my baseline. `page.tsx` diffs at -693 lines against HEAD. I have not reviewed that state-machine rewrite yet. It is the riskiest part of the whole tree for exam entry, and it has only been exercised in browser fixtures. A full Tauri onboarding walkthrough (real camera, fullscreen, keyboard lock, Exit setup) is needed before any release. I will review `stage-advance.ts` + `page.tsx` next if you want; say so here.

### F2 — Incident details and local receipts implemented

- All incident categories now accept descriptive text through the existing detail payload; Other issue retains its required-description validation. Category and detail controls freeze while sending; existing in-flight guard/timeout/error handling preserved.
- Successful HTTP acknowledgment records category and sent time, visible after reopening the dialog. Clearly labeled last ten receipts for this visit/session only; reload clears them. No invented organizer acknowledgment, reply, persistence or reference number.
- Files: contest `client.tsx`; existing `scripts/contest-confidence-verify.mjs` extended with description payload and reopened receipt checks.
- Independent onboarding-agent code review found no F1/F2 issue. Browser suite initially blocked by a transient invalid Next development chunk; downloaded chunk now passes syntax check. Rerun after integration settles.

### F3/F4 and F5/F6 — Validation / Claude checkpoint

- Results/briefing agent: 36 browser checks, 12 captures at 1440/1280/390/320, zero browser exceptions; typecheck passed. Extra section alignment check added after visual review.
- Onboarding agent: 24 browser checks, 6 captures at 1280/390/320, covering actual VM/mic warnings, retry, warning retention, gates, context and overflow. Removed delayed review-row animation that moved actions as rows appeared.
- Claude R1 investigated: current attempt adapter sorts **descending** by creation time. Two-attempt fixture explicitly verifies older WA, newest RUNNING then AC. Reversing would introduce the reported bug. Keeping regression evidence.
- Claude R2 accepted as scope concern: restore Home's existing results release gate/countdown, retaining wording/layout improvements. Release timing is not being changed in this frontend-only task. Existing finish-screen path remains as before; broader release-policy consistency deferred.
- R3: explicit contest ID is required to avoid retrieving an unrelated saved session; intentional.
- Cross-agent review underway; results agent investigating SE/IE summary labels and verifying practice copy.

## Claude review: pre-baseline onboarding/contest rewrite (follow-up to F5/F6 point 3)

Done while waiting for F7. These changes were made 2026-10-01 21:50 to 2026-10-02 01:05, before the F-task baseline.

**Onboarding `stage-advance.ts`: approved.** One advance per visit, timers cancelled on deactivate, and a late child callback cannot advance a later visit (`active !== run`). I traced every `setCurrentStage` in `onboarding/page.tsx`: 12→13 (Continue), 13→12 (gate block), 12→4 ("Run checks again"), 0→1 (Begin). Each one changes the stage number, so each gets a fresh run object. In-stage retries (VM/mic "Check again") reuse the still-active run, which is correct. Its 10 tests and `progress-state.test.mjs` are in `pnpm test`. **B3 is fixed:** `home-contest-presentation.test.mjs` is in the list too.

**Contest `answer-buffer.ts`: approved.** The stricter `read()` validation (non-empty files, string id/name/content, unique ids, active id must exist) accepts every buffer the v2.0.9 `write()` produces (same `BufferedFile` shape), so an update won't discard a candidate's local recovery copy. The new language comparison in `chooseRestore` only applies on an equal-revision, equal-content tie, where preferring the local language is harmless.

**Contest workspace: still unreviewed and large.** Before the baseline: `TerminalPanel` -923, `EditorPanel` -547, `QuestionRail` -255, `FooterTrustStrip` -188, `BlockedOverlay` -178, `ProblemPane` -152, `CameraTile` -142, `TopBar`, plus new `draft-workspace.ts` (save queue + multi-tab restore), `editor-lock.ts`, `execution-output.ts`, `WorkspaceControls.tsx` and `WorkspaceResizeHandle.tsx`. F7 now adds `client.tsx` changes (+368/-1195 vs HEAD in total) and `compiler-diagnostics.ts`. This is the exam surface. When you log F7, please say which `client.tsx` hunks are F7 versus the earlier rewrite, and I'll review the save-queue/restore path (`createDraftSaveQueue`, `restoreDraftWorkspace`) and the submit path as part of F7.

## Claude review: F2 (incident details + local receipts)

**Verdict: approved. This fixes a real honesty bug in HEAD.** Tests 395/395 and `tsc --noEmit` clean (re-run 01:5x).

- HEAD's `handleSendSupportReport` **always** showed "Report sent": it swallowed every error (`.catch(() => {})`), waited a fake 1.2s, and posted to `/sessions/unregistered/incidents` when there was no session. The new handler only reports success on `response.ok`, keeps the category and text on failure with a clear retry message, has an in-flight ref guard, a 10s timeout, and refuses without a session instead of posting to `unregistered`. Good.
- The payload shape is unchanged (`category`, `detail`, `telemetry`, same endpoint). The only difference is that `detail` is now sent for every category, not just `other`. That is the same field, so no API change. The required description for `other` is kept.
- Receipts are filtered by the current `sessionId`, capped at 10, and in memory only. The copy doesn't promise organizer acknowledgment. Matches the entry.
- `postJsonKeepalive` already drops `keepalive` above 60KB, so a long description won't hit the browser keepalive body limit.

Nits:
1. The "What happened?" `TextArea` has no `maxLength`. That's fine for the client, but the incident service's limit is unknown (it isn't in the Go repo). A 2,000-character cap with a counter would avoid an opaque server rejection showing as "Could not confirm your report was sent".
2. `closeSupport` resets the category and text only after a success, which is right. But while `isSendingReport` is true, Escape/close is ignored with no visible hint. Consider disabling the close button with the label "Sending…" so it doesn't look broken.

## Claude review: correction to F3/F4 R1 (retracted)

**R1 was wrong. Retracted.** I read only the ascending sort at `attempt-adapter.ts:79`, which assigns `attempt_no` ordinals. The function's return value is re-sorted **newest first** (`.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))`, last line). So `row.attempts[0]` is the latest attempt, and the new results page is correct. HEAD's `.reverse()` produced chronological (oldest-first) display order. Keep your two-attempt regression evidence. Thanks for checking rather than applying it.

R2 resolution (restore the release gate and countdown, keep the new layout) is what I'd hoped for. I'll verify the restored gate in `ContestCards.tsx` when you log it as done.
- **R2 verified fixed** (Claude, ~02:00): `ContestCards.tsx:289-298` restores `resultsUnlocked` from `results_visible_at`, `resultsReady = phase === "ended" && resultsUnlocked`, and the "Results in…" countdown memo. The button stays disabled until release.

### F7 — Compiler navigation implemented; review/validation underway

- Added conservative GCC/Clang/javac/Python syntax-error parsing. A compact first-error summary accompanies the complete unchanged raw compiler output.
- Navigation appears only for a matching sample run: exact problem ID, file ID/name, source text and language; diagnostic file and position must also match. Historical submissions without identity/source and judge-renamed files keep raw output without a guessed jump.
- Editor navigation changes only cursor selection/scroll/focus, never text, undo history, autosave or submission behavior. Editor revalidates source and file context before moving.
- F7-specific client hunks: diagnostic helper import; navigation request state; fileId added to existing run snapshot metadata; derived diagnostic/match/action next to submission presentation; new EditorPanel/TerminalPanel props. Existing Run/Submit request bodies, autosave queue, polling, timers and gates unchanged.
- Other files: new `compiler-diagnostics.ts` + five meaningful parser/context tests (5/5 passed), TerminalPanel summary, EditorPanel prop forwarding, editor-pane guarded selection effect; new test registered in apps/web/package.json.
- Independent review requested from onboarding agent. Integrated typecheck encountered generated .next/types corruption during concurrent dev activity (not a source TS diagnostic); clean regeneration/restart planned. Browser validation still pending.
- Claude F5/F6 feedback accepted: privacy stays in-app before setup, VM check remains single-run to avoid clearing earlier warning on retry. Mic error cleanup and stale fetched-phase label addressed by agents.

### F8 — Independent review checkpoint

- Results agent reviewed onboarding; microphone resource release on errors and fetched-phase wording corrected. Onboarding agent reviewed results; SE/IE judgment failures no longer counted Complete. F1/F2 independently reviewed without blocking findings.
- F7 independently reviewed by onboarding agent: no blocking issue; confirms request/save/submit sequencing unchanged and selection-only navigation cannot trigger docChanged autosave. Accepted precision caveat: Go to line now targets line start because compiler columns may count bytes/expanded tabs differently.
- Onboarding final targeted suite passed **25 checks/6 captures** after fixes; existing progress suite **161 checks/10 captures** plus **18 state unit tests** passed. Results adapter/home targeted tests **15 passed**.
- Applied Claude F1 optional focus-ring refinement: wrapper ring now follows input focus-visible, leaving the Show/Hide button's own focus ring alone. Login CSS is now an explicit F1 follow-up file.
- Home release gate retained. Agent confirmed current home mapping omits release time; missing release remains explicitly unavailable rather than inventing timing or allowing early access. Resolving the broader policy/data contract requires a separate decision.
- Clean generated-cache typecheck passed. Development server restarted on port 3000 for final browser verification.

## Claude review: F7 (compiler diagnostics + navigation)

**Verdict: approved. Exam-path logic is unchanged.** Tests 395/395. `tsc --noEmit` failed once (exit 2) mid-run while `.next/types` was being regenerated, then passed cleanly on re-run with no source errors.

Verified (diffed against my 01:35 source snapshot):
- **Request bodies are untouched.** `fileId` is added only to the client-side `runSourceSnapshot` state (`client.tsx:1295`). The Run/Submit payloads, polling, autosave queue, timers and gates have no diff.
- **Navigation is selection-only.** The `editor-pane.tsx` effect dispatches `{ selection, scrollIntoView }`, with no `changes`. Autosave fires only on `update.docChanged` (`editor-pane.tsx:693-694`), so a jump cannot trigger a save, change the document or touch undo history. The editor re-runs `canNavigateDiagnostic` against the live document before moving.
- **No cross-problem leakage.** The summary reads `runResult` first, and `resetRunPanelState()` clears `runResult` and `runSourceSnapshot` on every question switch (`client.tsx:1160-1167`). The `latestAttempt` fallback is already active-problem scoped (the upstream Attempts fix).
- **It can actually work in production.** The worker compiles sample runs as `main.cpp` / `main.c` / `main.py` (`ams-golang internal/worker/runner.go:1239-1291`), and the editor's main tab defaults to `main.cpp`. So the strict filename match isn't dead code, at least for C/C++/Python. Please confirm the Java main file name lines up with what the worker writes (I didn't find a `Main.java` literal there). If it doesn't, Java will always show "cannot be matched", which is safe but useless.
- **The parser fails safe.** Warnings, notes and header files are ignored, ANSI codes are stripped, Python runtime tracebacks (`, in <module>`) are excluded by the `$` anchor, and an out-of-range line or column refuses navigation.

Nits:
1. **Columns with tabs.** GCC 11+ reports *display* columns by default (a tab counts up to the next multiple of 8), while the editor offset is in characters. On tab-indented code, `Go to line` lands on the right line but the wrong column (clamped to the line end). Either navigate to the line start when the line contains a tab, or count tabs as 8 when converting.
2. **CRLF sources.** A pasted `\r\n` file makes `snapshot.source !== view.state.doc.toString()` (CodeMirror normalizes to `\n`), so the jump is refused. Safe, but normalize both sides with `.replace(/\r\n/g, "\n")` if you want it to work.

F5/F6 follow-ups verified: the VM stage no longer offers "Check again" (single run, so a warning can't be laundered), and the privacy link is now in-app (`<Link href="/privacy">`, no `target="_blank"`) and still shown only at stage 0.

## Claude review: F8 (integration checkpoint) and overall sign-off

**Verdict: approved, with one compatibility fix.** Tests 395/395, `tsc --noEmit` clean.

**Scope check:** no frontend-only violations. Compared with my 01:24 baseline:
- **Go backend (`ams-golang`):** no changes (`git status` and diff hash identical).
- **`AMS Access` web repo:** no changes.
- **Rust/Tauri/CI:** no change to `apps/desktop`, `packages/core-rs`, `packages/platform-rs`, `packages/network-helper`, `Cargo.toml`/`Cargo.lock` or `.github`. (`pnpm-lock.yaml` is byte-identical to baseline.)

Verified items from the F8 entry:
- **The Home release gate really is a pre-existing data gap, not a regression.** HEAD's `toInvitedContest` (`home/page.tsx`) never copied a release time, and the participant `ContestSummary` type has no such field. So at HEAD too, `results_visible_at` was always undefined on Home and the results button never enabled. Your "release time not announced" copy is the honest outcome. **For the user:** candidates cannot reach their own submissions from Home at all. The fix is backend (the participant contests endpoint must return `results_visible_at`), so it belongs on the deferred list.
- **F7 "Go to line" now targets the line start.** That resolves my tab/byte-column nit.

Fix needed:
1. **The `:has()`-only focus ring drops it on older macOS 12.** `login.module.css:17` now uses `.fieldControl:has(input:focus-visible)` as the *only* field focus indicator. The desktop app supports macOS 12+, and Monterey's WKWebView only supports `:has()` from Safari 15.4 (12.3). On 12.0-12.2 the rule is invalid and dropped, so the handle and password fields show **no focus ring**, the same problem as my original L1. Keep a fallback: `.fieldControl:focus-within { outline... }` first, then the `:has()` rule to suppress it when the Show/Hide button holds focus (`.fieldControl:has(button:focus-visible) { outline: none }`). Engines without `:has()` then fall back to the double ring, which is acceptable.

**Before release:** every F-task was validated in browser fixtures plus WebKitGTK only. The exam-path pieces (onboarding stages, F7 editor navigation, F2 incident send) still need one pass in the real Tauri app (`pnpm --filter @ams/desktop dev`) on a real camera and mic, as noted in F5/F6.

### Claude F7/F8 follow-up

- Read Claude's independent approval and scope audit (395 tests/typecheck; backend/native/lockfile unchanged from their baseline).
- Accepted older-WebView focus compatibility finding: restored `:focus-within` fallback and only suppress the wrapper ring via `:has(button:focus-visible)` when supported. Older engines retain visible keyboard focus even if it produces a double ring on the toggle.
- Compiler tab/byte-column nit resolved by line-start navigation. CRLF normalization intentionally remains conservative: unequal source representations refuse a jump rather than relaxing version identity. Raw diagnostics remain available.
- Native camera/microphone and secure Tauri walkthrough has not been performed in this environment; browser fixture evidence must not be represented as real hardware validation.

### F1–F7 — Completed implementation and verification

- F1 final login check: **36/36 browser assertions, 4 captures**, after compatible focus-ring follow-up (`apps/web/dashboard-ui/login-edge-evidence/2026-10-01T20-09-50-510Z`).
- F2/F7: **20/20 browser assertions, 3 captures** (`apps/web/contest-ui/usability/browser/2026-10-01T20-09-33-606Z`): failure retains report, send freezes form, specific category payload, reopened receipt; valid compiler jump, source/file/question/language/unknown-filename guards, unchanged file contents and no navigation-triggered autosave. Root visually inspected support and compiler layouts. Added narrow-dialog layout assertion for final follow-up run.
- F3/F4 final: **44/44 assertions, 12 captures** (`apps/web/results-ui/frontend-usability/2026-10-01T20-09-14-595Z`), zero runtime/console errors. Implementation agent reviewed desktop and 320px results plus expanded Home briefing. New briefing file `home/components/ContestBriefing.tsx`; browser script `scripts/results-briefing-verify.mjs`.
- F5/F6 final: **25/25 targeted assertions, 6 captures** (`apps/web/onboarding-ui/usability-evidence/2026-10-01T20-05-01-393Z`); progression regression **161 assertions, 10 captures** (`apps/web/onboarding-ui/progress-evidence/2026-10-01T20-03-23-898Z`). Cross-agent findings resolved and reviewed.
- Full web unit suite: **395/395 passed**. Final `tsc --noEmit` passed. `git diff --check` clean.
- F7 Java: local `questionFileName` explicitly uses `Main.java`, and parser supports javac locations. Worker naming cannot be independently verified in this workspace; strict matching safely refuses any unknown file mapping.
- Remaining work is final broader contest regression / narrow incident-dialog verification and final review-file checkpoint; no backend/native changes planned.

## Claude review: final follow-ups (F1 focus fallback, F7 Java)

- **F1 focus fallback: verified fixed.** `login.module.css` now has the `.fieldControl:focus-within` ring as the baseline, with `.fieldControl:has(button:focus-visible) { outline: none }` only suppressing it while the Show/Hide toggle holds focus. Engines without `:has()` (macOS 12.0-12.2 WKWebView) keep the field ring. Resolved.
- **F7 Java mapping: verified from the backend source (read-only).** The worker writes `Main.java` and runs `javac` on it (`ams-golang internal/worker/runner.go:1344-1359`). That matches the editor's `Main.java`, and `canNavigateDiagnostic` strips the temp directory from javac's absolute path, so Java "Go to line" works. Resolved.

No open blocking findings on F1-F8. Remaining items are outside this frontend-only scope: (a) the participant contests endpoint needs to return `results_visible_at` before Home can ever unlock results; (b) one real Tauri pass of onboarding, contest Run/Submit, F7 navigation and F2 incident send before release; (c) the 2026-10-01 contest-workspace rewrite (TerminalPanel, EditorPanel, QuestionRail, draft save queue) still has no Claude review beyond `answer-buffer.ts`.

### F8 — Final verification follow-up

- Narrow support dialog check passed; latest focused contest suite **21/21 checks, 4 captures** (includes 320×640 bounds). Final browser manifests preserve all generated evidence.
- Broader contest-confidence suite passed its first 59 checks (autosave/edit scope, support error/retry/receipt, finish review, security-overlay priority, layouts down to 320px), then a later reload hit `SyntaxError` in generated development `app/layout.js` before any app requests. This is recorded as a failed run, not a passed suite.
- Isolated production build started to verify bundling without rewriting live .next. Broad browser rerun disables cache to investigate the intermittent generated development asset failure. Targeted functional suites remain green.

## Claude review: F8 final follow-up (intermittent dev `layout.js` SyntaxError)

Agree with recording it as a failed run, not a pass. Likely cause: concurrent writers to `apps/web/.next`. The `next dev` server on :3000 (which also feeds the running `tauri dev`) hot-rebuilds while an agent runs `next typegen` / `tsc` / a build against the same directory, so the browser can fetch a half-written chunk. Earlier tonight `tsc` also hit corrupted `.next/types` mid-run. To get a trustworthy broad suite: run it against the static export (`next build` with a separate `distDir`, or serve `out/`) with no dev server writing, then re-run the full contest-confidence suite end to end. Until that passes, the broad contest suite should be treated as **not yet verified**, even though the targeted F2/F7 suites (21/21) are green.

### F8 — Build passed; regression harness timing corrected

- Isolated production build/static export passed with all size budgets (`apps/web/frontend-usability-validation/build.log` and `isolated-build.json`). Live dev output was untouched.
- Cache-disabled broad rerun exposed an existing test timing assumption: it checked autosave after 950ms, while configured debounce plus jitter can reach 1000ms before request work. Replaced the fixed wait with a bounded wait for the actual request, preserving the same content/payload assertions. No autosave implementation changed.
- Claude's final follow-up read: no open blocking findings; focus fallback resolved and reviewer independently verified Java worker filename mapping.

## Claude review: F8 build + harness timing fix

**Verified.** Debounce is 600ms plus up to 400ms jitter (`autosave-timing.ts:7,23`), so a 950ms fixed wait was too tight, and replacing it with a wait for the actual PUT is the right fix. `autosave-timing.ts` and `save-coordinator.ts` are byte-identical to HEAD and to my baseline, so no autosave implementation changed.

Nit: the replacement bound is `10000`ms (`scripts/contest-confidence-verify.mjs:227`) for a save the policy guarantees within about 1000ms. The unit tests already pin the exact delay, but at 10s the browser suite would no longer notice a regression that made autosave several seconds slower. Consider about 2500ms (worst case plus margin for CDP/CPU jitter).

Please paste the final pass count of the broad contest-confidence rerun here once it completes, so the "not yet verified" status in my previous note can be cleared.

### F8 — Complete: final independent review and verification

- Final broader contest regression passed **70/70 checks, 29 captures**: `apps/web/contest-ui/confidence/browser/2026-10-01T20-14-52-724Z`. Covers edits/autosave, read-only gates across files/problems, history failures, device-draft recovery, support rejection/HTTP failure/pending/success/receipt, finish acknowledgments, and layouts from 1440 to 320px. Cache-disabled rerun with event-based autosave wait passed; earlier failed runs remain recorded.
- Final focused support/compiler run passed **21/21 checks, 4 captures**: `apps/web/contest-ui/usability/browser/2026-10-01T20-12-35-548Z`.
- Final login **36**, results/briefing **44**, onboarding usability **25**, onboarding progression **161** browser assertions passed; full unit suite **395/395**, typecheck, isolated production build/static export, size budgets and `git diff --check` passed.
- Subagent implementation and reciprocal independent review completed. Claude's latest final follow-ups were read: no open blocking findings on F1–F8. Applicable findings resolved (judging failure labels, mic cleanup, warning/retry safety, setup context wording, in-app privacy, old-WebView focus fallback, conservative line navigation).
- App remains live at `http://localhost:3000` with hot reload. No backend, API contract, native runtime, judge, scoring or release-policy changes; no push made for this task.
- Deferred explicitly: release-time data required for Home results unlock, cross-device historical-session discovery, custom input execution, organizer replies/durable support tracking, new organizer policy fields. Unknown compiler mappings and mismatched source versions remain raw-output-only.
- Validation limit: browser fixtures and production web build, not a real Tauri camera/microphone/lockdown walkthrough. This task's changes are complete; native hardware checks remain a pre-release verification step.

## Claude review: final sign-off (F1-F8)

**Approved. No open blocking findings.** Independently re-verified (not taken from the entries):
- Broad contest suite manifest `apps/web/contest-ui/confidence/browser/2026-10-01T20-14-52-724Z/manifest.json`: **70 checks, 70 passed, 0 failures**. This clears my earlier "not yet verified" note.
- `pnpm test`: **395/395**. `tsc --noEmit`: clean.
- Scope: Go backend and `AMS Access` web repo unchanged since my 01:24 baseline; no changes to `apps/desktop`, the Rust packages, `Cargo.*` or `.github`.

Carried forward (non-blocking, for the user):
1. **Backend:** the participant contests endpoint must return `results_visible_at`, or Home can never unlock results (pre-existing).
2. **Pre-release:** one real Tauri walkthrough on hardware covering onboarding, Run/Submit, F7 navigation and F2 incident send.
3. **Unreviewed by Claude:** the 2026-10-01 contest-workspace rewrite (TerminalPanel, EditorPanel, QuestionRail, draft save queue), beyond `answer-buffer.ts`. It is functionally covered by the 70/70 suite.
4. Nit, still open: autosave wait bound in `contest-confidence-verify.mjs` is 10000ms (suggested about 2500ms).
5. All of this work is still **uncommitted** on `fix/dev-api-target-and-network-diagnostics` with no upstream. Commit it on a dedicated branch, staging explicit paths (the tree is full of evidence folders and screenshots).

### Publication to main

- Publishing from the clean `ams-access-main` checkout based on GitHub main, preserving the existing theme commit and excluding unrelated native commits on the live development branch.
- Includes frontend source/assets, regression scripts, execution plans and review/work logs. Generated screenshots, runtime logs, local baseline copies and environment files stay local.
- Previous final validation: 395 tests; typecheck; production export/size checks; browser suites and independent reviews recorded above. The publication checkout is checked again before push.
