# Access frontend review — final v1

Reviewed 23 October 2026 against `ams-access` commit `ba834d99ff7fa50d37980ed930552ba9575a0555` (v4.1.0 source).

## Outcome and scope

The most valuable work is correcting stale async state and misleading feedback before micro-optimizing rendering. The review found a reproduced sign-out cache race, overlapping submission refreshes, a blank startup state, and several smaller interaction defects. The top-left horizontal logo can be reduced by 10% without violating its documented minimum size.

This is an analysis and implementation brief. No application code, backend, native/platform code, architecture, dependencies, assessment policy, or API contract was changed. Every recommended fix is confined to existing frontend components/helpers. Native permission, lockdown, media enforcement, heartbeat and security polling changes are excluded.

Three subagents independently reviewed performance, frontend edge cases, and UX/branding. The primary reviewer cross-checked key code paths and added help-dialog findings. Guidance: `ams-access/AGENTS.md`, `DESIGN.md`, and `apps/web/UI.md`. All source references below are relative to `ams-access/`.

Evidence labels:

- **Reproduced:** actual source exercised with a controlled mock harness.
- **Source-confirmed:** reachable condition traced in code; full browser reproduction remains to be done.
- **Design proposal:** sizing calculations or editorial judgment; rendered/user validation remains necessary.

No browser screenshots, live assessment, production network benchmarks, or user research were performed. “AI slop” is treated as a request for restraint, specific language, and consistent visual hierarchy—not an objective defect label. No millisecond savings or behavioral improvement is claimed without measurement.

## Priorities

P1 means address before cosmetic work because stale data can mislead candidates. P2 means meaningful usability/recovery work. P3 means a small optimization or optional polish.

| ID  | Priority  | Finding                                                            | Evidence         |
| --- | --------- | ------------------------------------------------------------------ | ---------------- |
| F01 | P1        | Late requests restore another candidate's cleared cache            | Reproduced       |
| F02 | P1        | Overlapping submission refreshes can regress displayed verdicts    | Source-confirmed |
| F03 | P2        | Request deadline ends before JSON body consumption                 | Source-confirmed |
| F04 | P2        | Startup can become blank while checks are pending                  | Source-confirmed |
| F05 | P2        | Optional metadata storage failure looks like failed authentication | Source-confirmed |
| F06 | P2        | Blank login fields still send a request                            | Source-confirmed |
| F07 | P2        | Help dialog reopens with an old sent state                         | Source-confirmed |
| F08 | P2        | Help email validation and failure messages are ambiguous           | Source-confirmed |
| F09 | P2        | Background refresh resets the selected testcase                    | Source-confirmed |
| F10 | P2        | Cached contests plus unmatched search show the wrong error state   | Source-confirmed |
| F11 | P2        | Automatic handle suffix lacks an accessible explanation            | Source-confirmed |
| F12 | P2 polish | Reduce horizontal logo and balance existing clear space            | Design proposal  |
| F13 | P3        | Attempt grouping repeatedly copies growing arrays                  | Source-confirmed |
| F14 | P3        | Attempts list applies the same filter twice per render             | Source-confirmed |
| F15 | P3 polish | Replace repetitive promotional copy with next-action guidance      | Design proposal  |

## F01 — Prevent cache resurrection after sign-out

**Evidence:** `apps/web/src/lib/api-client.ts:71–73` clears only the cache Map. Completion paths at `190–203` and `244–255` then write success/error unconditionally. Home uses identity-free `contests:invited` with 30-second freshness at `apps/web/src/app/home/page.tsx:310–322`; sign-out clears at `828`.

**Trigger:** candidate A has a slow contest request, signs out, and the old response arrives after cache clear. Candidate B signs in shortly afterward. B can receive A's cached list as fresh data. This is a frontend display/data-isolation defect; it does not prove the server grants B access to A's contests.

**Bounded fix:** before completion writes and notifications, verify that the cache entry still owns that exact pending promise. A cleared or replaced entry must not be resurrected. Apply to success and rejection in both existing paths. Keep deduplication, endpoints, and retry policy unchanged.

**Verification:** resolve/reject A after clear; resolve A after B starts a replacement request; verify no stale data/error/notification enters B's cache. Normal deduplication and refresh must still work.

**Reproduction:** `/tmp/access-cache-repro.cjs` transpiles the actual module with installed TypeScript and minimal React-hook stubs. It starts A's mutation, clears cache, resolves A, then initializes B's query. Output, independently rerun by the primary reviewer:

```json
{ "nextCandidateInitialData": [{ "id": "candidate-A-contest" }] }
```

No network or live account was used.

## F02 — Coalesce submission refreshes and reject stale completions

**Evidence:** `apps/web/src/app/session/contest/client.tsx:721–757` applies every `listMySubmissions` completion; `773–786` refreshes on question changes and every two seconds while the active problem has pending submissions. No in-flight or response-generation guard exists in this callback. The session-wide request is not deduplicated by its API helper.

**Trigger:** a refresh lasts longer than two seconds, or the candidate changes questions while it is pending. A newer completed verdict can be overwritten by an older RUNNING snapshot. An unrelated completion can also clear loading state.

**Bounded fix:** use an in-flight ref and session/request ownership checks in the existing callback, including error/finally updates. Coalesce extra refresh requests into one follow-up where needed. Preserve explicit post-submit refresh and current freshness behavior; do not touch separate Run polling or introduce a new query system.

**Verification:** delayed older RUNNING response versus newer accepted response; rapid question switches; session change/unmount; failures; submit during an existing refresh. Coalescing should limit simultaneous list GETs to one and still fetch after a new submission. Do not claim this speeds up judging; it removes redundant client requests and stale UI transitions.

## F03 — Keep the request deadline active through body reading

**Evidence:** `apps/web/src/lib/api-client.ts:108–115` clears its timer when fetch returns headers; `147–162` consumes response JSON afterward. A live caller is session creation at `apps/web/src/app/session/onboarding/page.tsx:568–588`, with a separate 60-second outer wait and cached pending promise (`api-client.ts:140–141,182–191`).

**Trigger:** headers arrive but body delivery stalls. The outer wait can restore an error UI, yet the inner promise remains pending. Retry may attach to that same promise through its dedupe key. This is not an unbounded UI spinner: the outer deadline already exists.

**Bounded fix:** preserve the existing per-attempt deadline through success/error body consumption, clearing it in finally after processing. Final failure must release pending ownership. Retain retry counts, session identity, error classification, and existing POST semantics. Client cancellation does not prove the server canceled a request; do not promise that or add extra retries.

**Verification:** fake fetch resolves headers immediately but stalls body; body abort settles the helper; after final failure a new invocation is not attached to the old promise. Check success, malformed JSON, and binding-error responses. The separate `proctor-api.ts` request implementation already keeps its timer through body reading and does not need this fix.

## F04 — Keep a visible startup status after the intro ends

**Evidence:** `apps/web/src/app/page.tsx:99–101` supplies null children during checking/signed-in. `StartupAnimation.tsx:21–42` can finish independently through Skip, reduced motion, or its 2.1-second fallback. Version checking alone has a six-second deadline (`lib/client-update.ts:57–62`), followed by stored-token validation.

**Trigger:** slow startup, Skip intro, or reduced motion exposes empty content while network checks are pending. A candidate may interpret this as a crash and restart, adding more waiting.

**Bounded fix:** render an existing accessible loading/status treatment while checking or routing. Keep version/token gate order, intro timing, skip, reduced-motion behavior, and update precedence. Do not conceal the wait by lengthening animation or expose an entry button prematurely.

**Verification:** hold each gate promise independently; skip intro and enable reduced motion; status remains visible and is replaced by the correct welcome/update/redirect outcome. This improves perceived responsiveness, not network latency.

## F05 — Separate presentation-storage errors from authentication

**Evidence:** `apps/web/src/app/login/page.tsx:59–73` writes contest/display metadata after successful authentication but inside the authentication catch. Home reads storage unguarded at `apps/web/src/app/home/page.tsx:739–741`; cleanup at `754` can throw again. Token persistence already has its own guarded handling.

**Trigger:** storage quota or access failure after valid credentials produces “Something went wrong signing in,” or a failed read interrupts Home hydration.

**Bounded fix:** independently handle noncritical display-name/title storage and use empty presentation defaults on read failure. Complete identity hydration. Keep active-session persistence failures explicit and preserve required persistence checks before assessment entry. Never silently imply that draft recovery is safe when storage failed.

**Verification:** throw separately on metadata reads/writes/removal; successful authentication remains distinguishable from storage failure, the dashboard remains usable where safe, and required recovery checks cannot be bypassed.

## F06 — Validate empty credentials before sending

**Evidence:** `apps/web/src/app/login/components/SlipForm.tsx:52` sets `noValidate`; required attributes therefore do not block submit. `login/page.tsx:51–59` checks loading but not blank fields. The submit action is available when empty.

**Bounded fix:** add only a submit-time nonempty check, a concise field-specific error, and focus on the first missing field. Keep handle formatting and authoritative server errors. Do not invent password rules, trim passwords, or claim client validation proves valid credentials.

**Verification:** missing handle, missing password, and both missing make zero login calls. Valid formatted credentials submit once; server rejection and reveal behavior remain intact. This removes a complete avoidable request for a common mistake, rather than reducing the timeout for legitimate sign-ins.

## F07 — Give each help request its own dialog lifecycle

**Evidence:** `apps/web/src/components/HelpRequestModal.tsx:54–60` retains email/note/state/reference while closed; `107–120` renders the sent receipt. Home keeps the component mounted at `apps/web/src/app/home/page.tsx:988`. Completion writes at `94–97` are not associated with an opening/request generation.

**Trigger:** submit successfully, close, reopen for another issue. The old “organizer has been notified” receipt remains and there is no fresh form. Closing during a pending request can also let its late result become the next opening's state.

**Bounded fix:** explicitly separate a receipt from composing another request. Reset successful request state/reference when starting a new composition, retain an unsent draft where useful, and associate async updates with the originating request/opening. Do not simply discard a pending request on close or claim cancellation means it was not delivered. Never automatically resubmit.

**Verification:** sent → close → new issue; pending → close → reopen → late completion; error → edit → retry; context change. A visible receipt must identify the request it actually acknowledges.

## F08 — Make help-form validation and failure feedback specific

**Evidence:** `HelpRequestModal.tsx:64–67` rejects only an empty email. The email input at `133–140` is not submitted through a validating form; the send button calls the function directly at `163`. Blank and request failures share one error state and banner at `152–156`.

**Trigger:** malformed but nonempty address is sent, or an empty address receives a generic “Check your email and connection” message. The user cannot tell which action is useful.

**Bounded fix:** use ordinary email-field/form validity rather than an elaborate custom regex, show a field-level error, and distinguish validation failure from unacknowledged delivery. Preserve entered data. On timeout, say delivery could not be confirmed rather than promising it was not sent; the existing reference remains the success evidence.

**Verification:** blank, malformed and valid addresses; HTTP rejection; timeout after request submission; successful reference. Do not add a new backend delivery or idempotency requirement to this task.

## F09 — Preserve testcase selection across equivalent refreshes

**Evidence:** `attempt-adapter.ts:101,107–113` replaces testcase arrays with each new list response; `client.tsx:738–742` merges them. `components/ResultsPanel.tsx:152–169` resets selection whenever rows change identity. Paths are under `apps/web/src/app/session/contest/`.

**Trigger:** inspect case five of a completed attempt while another pending attempt keeps history polling. Equivalent data refreshes reset selection to the first failure, interrupting diagnosis.

**Bounded fix:** preserve equivalent testcase-array identity, or scope initial selection to explicit attempt/result identity and meaningful result changes. Clamp selection when cases disappear. A different attempt must still initialize correctly; case count alone is not an identity.

**Verification:** refresh identical content without moving selection; switch attempts; shorten cases; transition pending to terminal; preserve source/diagnostic ownership. Treat this primarily as interaction stability, not a measured speed gain.

## F10 — Distinguish stale assignments from search misses

**Evidence:** `apps/web/src/app/home/components/ContestsPanel.tsx:108–114` shows an error banner only when filtered rows exist; `146–151` displays “Contests unavailable” whenever filtered rows are empty and an error exists.

**Trigger:** cached assigned contests remain after a failed refresh, then a search matches none. The body says contests are unavailable, although the count can still say 0 of N, and the existing empty-state Clear search action disappears. The input's own clear affordance remains.

**Bounded fix:** base unavailable-versus-stale state on source `contests.length`, and search results on filtered length. Keep a stale-data notice plus “No matching contests” and Clear search when applicable. Do not change entry eligibility or network behavior.

**Verification:** empty source + error; cached source + error + matches; cached source + error + no matches; successful empty source; ordinary search miss.

## F11 — Explain the automatic handle suffix accessibly

**Evidence:** `apps/web/src/app/login/components/SlipForm.tsx:61–90` hides the visual `@access` suffix from assistive technology; `aria-describedby` references only a possible error.

**Bounded fix:** provide a linked field description: “Enter the part before @access, or paste your full handle. @access is added automatically.” Keep formatting and the visual suffix. Append the error description when present instead of replacing the helper. Do not label both credential fields invalid for a network outage.

**Verification:** accessible name/description with and without errors, full-handle paste, keyboard focus, and existing slip-format tests.

## F12 — Top-left logo: smaller artwork, deliberate spacing

**Evidence:** `apps/web/src/components/AccessLogo.module.css:16–20` uses `calc(var(--spacing-10) * 5)` = 200px, aspect ratio 351/82. `apps/web/public/brand/access-logo.svg:1` includes clear space in its viewBox. The artwork's A cap is 51.12 SVG units; DESIGN.md requires at least 24px cap height.

| Measurement                   | Current | Proposed first pass |
| ----------------------------- | ------- | ------------------- |
| Horizontal logo width         | 200px   | 180px               |
| CSS box height                | 46.72px | 42.05px             |
| Actual A cap height           | 29.13px | 26.22px             |
| Built-in left/top clear space | 8.55px  | 7.69px              |

**Exact local proposal:** change the shared horizontal `.logo` width to `calc(var(--spacing-10) * 4.5)`. Preserve masks, aspect ratio, monochrome color, and no-shrink behavior. Do not use 160px: the 24px cap requirement implies a minimum width of about 164.79px.

**Padding and margins:** Welcome (`WelcomeScreen.tsx:29–39`), Login (`login/page.tsx:121–131`), and setup (`session/onboarding/page.tsx:1114–1135`) already use a centered 1120px frame and clamped 16–40px gutters. Keep these for the first comparison and add no logo-only margin/padding. The SVG's own clear space counts toward the visual inset. Avoid negative margins, cropped clear space, or shrinking the adjacent theme control.

Dashboard uses `TopNavHeading` (`home/components/DashboardShell.tsx:60–64`) and switches to AccessMark below 351px (`44`). Inspect its computed component padding before changing it; use existing component spacing props if a measured mismatch exists. Identical margins across different shells are not automatically better alignment.

The contest header uses a separate 48px mark box and 20px horizontal padding (`session/contest/components/TopBar.tsx:153–168`). Leave `.mark` and standalone `.wordmark` unchanged in this pass: they also serve startup. A contest-only adjustment should require an actual visual comparison and a local header class, not a global mark reduction.

**Acceptance:** compare Welcome, Login, Home and setup in light/dark at 320, 350, 351, 390, 1280 and 1440px; 200% zoom; short windows; long setup labels. Check optical centering, readable cap height, action reachability, focus targets and dashboard breakpoint. These are calculated dimensions, not screenshot measurements. This report proposes the reduction; it has not applied it.

## F13 — Remove quadratic copying in submission grouping

**Evidence:** `apps/web/src/app/session/contest/client.tsx:3467–3478` uses `grouped[qId] = [...(grouped[qId] ?? []), sub]` for each submission.

**Local replacement inside the same memo:**

```ts
(grouped[qId] ??= []).push(sub);
```

The accumulator is newly created inside the memo, so this mutates no React state or input array. Keep sorting unchanged. Grouping changes from O(sum of squared bucket sizes) copy work to O(n) appends; sorting cost remains. Normal short histories may see little practical difference.

**Verification:** compare output for empty/multiple problems, tied attempt numbers, and long history; input records/arrays remain unchanged. No new caching layer or dependency is needed.

## F14 — Filter visible attempts once

**Evidence:** `apps/web/src/app/session/contest/components/TerminalPanel.tsx:626–629` evaluates the same filter for the empty check and again for rendering.

**Bounded fix:** compute a local `visibleAttempts` once and reuse length/map. This removes one pass per render. Add memoization only if profiling justifies it and dependencies are correct; avoid custom React comparators that can freeze callbacks or source-state indicators.

**Verification:** all filter choices, empty-state text, expansion and keyboard behavior remain equivalent. Profile representative long histories before claiming the change is perceptible.

## F15 — Make language task-specific and restrained

The current UI already uses a restrained monochrome brand, shared typography and useful readiness states. It does not need a redesign to satisfy this request.

| Location                                    | Current                                    | Proposed                                                              |
| ------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `home/components/DashboardShell.tsx:95–100` | “Your next challenge starts here.”         | “Choose an assigned contest to review its schedule and entry checks.” |
| `WelcomeScreen.tsx:85`                      | “Enter workspace”                          | “Continue to sign in” for the existing welcome branch                 |
| `login/components/BrandPane.tsx:40`         | “A few steps to get your workspace ready.” | Remove this redundant sentence; keep useful steps                     |

The Welcome callback currently routes to login (`app/page.tsx:100`); if routing behavior changes, the label must follow it. Reduce redundant helper copy only when the action is still clear. Keep concrete preparation instructions, proctoring disclosures, credential-reissue help, readiness distinctions, and finish-review information.

Avoid new decorative card grids, gradients, oversized badges, motivational headings, fake progress percentages, trust claims, or extra animation. Prefer precise state language: checking, last available data, selected testcase, sent reference, and what the candidate can do next. Expected benefits are hypotheses about clarity and visual restraint, not proven trust/conversion gains.

## Preserve and defer

- Statement Markdown parsing is already memoized (`contest/client.tsx:3243–3268`). Keep sanitization and asset handling; do not remove them for speed.
- Editor configuration already uses stable extensions/compartments. A broad editor rewrite is outside scope.
- Attempts already remain visible during background loading (`TerminalPanel.tsx:608`). Do not add a fix for a nonexistent full-list loading flash.
- Standalone Results already guards stale requests and preserves previous rows on refresh failure (`app/results/page.tsx:51–92,175–177`). Preserve those protections.
- Draft writes serialize current multi-file content synchronously (`contest/client.tsx:3234–3241`, `answer-buffer.ts:64`). This is a profiling candidate, not a demonstrated bottleneck. Do not debounce away durability, move storage, introduce workers, or redesign persistence. Any later redundant-write removal must retain every meaningful edit and failure reporting.
- Leave security/heartbeat/media sampling intervals, native probes, entry rules, session timing, recovery ownership, backend retries/contracts and platform behavior outside this optimization effort.
- Do not shorten legitimate request deadlines simply to make failures appear faster. Fix empty requests, overlapping requests, blank feedback and repeated computation first.

## Verification performed and implementation order

**Performed:** clean baseline inspection; three independent source reviews; primary cross-checks; actual-source cache-race reproduction; existing web suite run serially on Node v24.4.1. Result: **718 tests passed, 0 failed, 0 skipped** in approximately 14.9 seconds. Log: `/tmp/access-final-v1-web-tests.log`. No production build, typecheck, browser visual review, or native validation was run for this documentation-only task. A green existing suite does not invalidate the newly found gaps.

The test runner read `apps/web/package.json`'s existing `test` script, used the Node 24 executable, and inserted `--test-concurrency=1`. The equivalent command in a Node 24 environment, from `ams-access/apps/web`, is:

```sh
node -e 'const cp=require("node:child_process"); const args=require("./package.json").scripts.test.split(" ").slice(1); args.splice(1,0,"--test-concurrency=1"); const r=cp.spawnSync(process.execPath,args,{stdio:"inherit"}); process.exit(r.status ?? 1);'
```

Recommended small implementation batches:

1. **Data correctness:** F01 and F02, with controlled async regressions.
2. **Wait/recovery clarity:** F03–F08, without changing protocol or native behavior.
3. **Interaction stability:** F09–F11, tested against the specific state combinations.
4. **Visual polish:** F12 and F15 with before/after rendered comparisons in both themes.
5. **Low-risk compute cleanup:** F13–F14; verify equivalence and measure only if claiming speed gains.

For implementation, run focused regressions and the existing frontend suite/typecheck. Use browser fixtures for presentation checks rather than starting a live assessment. Keep logo/copy changes independently reviewable from async-state fixes. If a candidate fix requires native code, an endpoint change, security-policy relaxation, or a new persistence architecture, stop that item at this scope boundary rather than expanding the task.

## P3 implementation and review — 23 October 2026

F13–F15 are implemented locally, preserving the earlier P1/P2 fixes:

- F13: submission grouping appends into fresh local buckets; descending attempt sorting is unchanged.
- F14: the Attempts tab filters once and reuses the result for its empty state and rows. Other tabs do not perform this filter.
- F15: Home explains how to choose a contest; Welcome says “Continue to sign in,” matching its existing route; Login drops the redundant introduction while keeping preparation steps and proctoring guidance. The UI guide reflects the updated focus label.

Two implementation subagents handled compute and copy separately. An independent review subagent found no actionable defects and reran the focused compute checks. Those checks covered frozen inputs, record identity, empty/multiple/tied/missing-ID histories, 12,000 records, all filters, pending attempts, empty states, and expansion callbacks/accessibility state. They establish equivalence, not a measured user-visible speed gain.

Validation: all **793 frontend tests passed**; the production build, its TypeScript validation, static export and size budgets passed; `git diff --check` passed. Browser fixtures checked Welcome, Login and Home at 320px/1280px in both themes (12 layouts before and 12 after), with no runtime exceptions or horizontal overflow after the changes. The updated Welcome action navigated to Login in both themes. Narrow screenshots were visually inspected. No live assessment or native-platform validation was performed.

Evidence: `/tmp/access-p3-tests.log`, `/tmp/access-p3-build.log`, `/tmp/access-p3-compute-check.cjs`, and `/tmp/access-p3-browser-before/` / `/tmp/access-p3-browser-after/`. No backend, platform or architectural changes; nothing committed or pushed.
