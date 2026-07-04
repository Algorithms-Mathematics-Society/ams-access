# apps/web — Directory Map & Component-Breakdown Migration Tracker

Living doc for the page-breakdown migration. Update the checklist + regenerate the map stamp every merged PR.

## 1. Discipline (binding — every block)

- **Re-parent only.** JSX/logic moves verbatim into new files; ALL state/effects/handlers/refs stay in the parent page and flow down as props. No logic edits, no renames, no "improvements" during a move.
- **Props:** one flat exported `Props` interface per component; destructure with the parent's exact identifier names (setters stay `setX`). Never synthesize new grouping objects; existing objects/refs pass as-is. Procedure: move the code, let `tsc --noEmit` enumerate unresolved identifiers, add each as a prop/import.
- **Tauri invoke call text moves byte-verbatim.** Inventory before/after (gate 5) must be identical.
- **Frozen files (never moved/renamed):** `session/contest/{submit-button,save-indicator,save-coordinator,save-edit-state,submission-state,autosave-timing,countdown}.ts` + their `.test.mjs` (hardcoded in `package.json` "test"; `submit-button.test.mjs` source-scans its own module). No new files under `app/home/` with raw colors (`home-color-completeness` directory scan). `globals.css` structure untouched (two scanner tests).
- **No barrels** (index.ts re-exports) — keeps chunking identical for the size-budget check.
- Git: branch per PR off `main`; `git add` explicit paths only, **never `git add -A`** (parallel session).

### Gate block (run after every task)

```bash
pnpm --filter @ams/web lint      # next typegen && tsc --noEmit
pnpm --filter @ams/web test      # full guard family
pnpm --filter @ams/web build     # includes check-size-budgets.mjs
git diff --color-moved=blocks --color-moved-ws=allow-indentation-change   # pure moves only
grep -rhoE 'invoke\("[a-z_]+"' <area files> | sort | uniq -c              # identical before/after
```

## 2. Current directory map — stamped 2026-07-04 @ `0fc3d82` (main, post-PR#27)

```
src/app/
├── layout.tsx 48 · page.tsx 7 · WelcomeScreen.tsx 58 · globals.css 1916
├── login/page.tsx 605
├── home/
│   ├── page.tsx 1410 · loading.tsx 23
│   └── components/  (THE MODEL — already decomposed)
│       SettingsPanel 1594 · SessionReadinessModal 977 · ContestCards 672 · ResolveModal 648
│       utils.ts 557 · DiagnosticsPanel 425 · SessionActionsPanel 404 · ui-primitives 391
│       ReadinessPanel 266 · ContestsPanel 173 · readiness-context 169 · types 155
│       SecurityOperationsLog 101 · hooks 58 · SignOutButton 48
├── session/
│   ├── onboarding/  page.tsx 4771 (14 inline StageN_* components) · support.ts 262 · loading.tsx 23
│   └── contest/     client.tsx ~7400 · editor-pane.tsx 925 · page.tsx 14 · loading.tsx 23
│                    + 7 frozen pure modules w/ tests (see §1)
├── results/page.tsx 751
└── privacy 159 · terms 146 · licenses 93 · legal-page 194
src/components/  MarkovEditor 666 · HelpRequestModal 219 · ThemeToggle 53
src/lib/         api-client 308 · presence-monitor 114 · VerdictBadge 117 · theme* · verdict ·
                 candidate-auth · gating · abort-timeout (+ guard tests)
```

## 3. Migration order (user-decided 2026-07-04: contest FIRST, overriding the after-finals default)

Contest breakdown executes now on `refactor/contest-components`. **Finals freeze note:** merging contest-refactor PRs before finals (2026-07-11) is an explicit user call per PR; each contest block re-runs the behavioral rig scenarios before merge. Onboarding → results → login → shared shell follow.

## 4. Contest breakdown — `session/contest/` target

`client.tsx` keeps: all ContestPageClient state/effects/handlers/refs, the `dynamic()` EditorPane wrapper, fetch helpers (`fetchJsonOrNull`/`fetchContestQuestions`/`createContestSession` — they read module-scope `API_URL`), the trailing `<style>` block, region composition. Target ~3,000 lines.

```
session/contest/components/
├── hooks.ts            Block 1 — useFocusTrap, useCountdown (all call sites stay in client.tsx)
├── markdown.ts         Block 1 — MATH_TOKEN…getAvailableProblemTabs + ProblemSectionKey
├── verdict-styles.ts   Block 1 — VERDICT_COLORS, tint, VERDICT_BG, VERDICT_BORDER
├── language.ts         Block 1 — language maps, starter gens, LANGUAGE_EXTENSIONS, questionFileName
├── questions.ts        Block 1 — Question/QuestionPayload types, parseFollowUpParts, normalizers
├── CountdownBadge.tsx  Block 1 — imports useCountdown from ./hooks
├── FollowUpPane.tsx    Block 1 — deps: parseDescription, parseFollowUpParts, tint
├── MarkovPane.tsx      Block 1 — deps: MarkovEditor, parseDescription
├── GateScreens.tsx     Block 2 — leaf overlays
├── BlockedOverlay.tsx  Block 2 — contains log_violation invokes (invoke-diff mandatory)
├── FooterTrustStrip.tsx Block 2
├── TopBar.tsx          Block 3 — incl. submit-confirm dialog (useFocusTrap refs flow down)
├── QuestionRail.tsx    Block 3
├── ProblemPane.tsx     Block 3
├── EditorPanel.tsx     Block 4 — ONE file (tab strip + close-confirm + settings + Run/Submit);
│                                  EditorPane passed as prop (keeps dynamic() instance singular)
├── TerminalPanel.tsx   Block 4
└── CameraTile.tsx      Block 4 — keep-mounted <video>: conditional structure STAYS in client.tsx
```

**Contest gates per block:** gate block (§1) + invoke-diff + behavioral rig scenarios before any merge (run/submit round-trip; PR #27 cross-write check; autosave/save-indicator honesty; question switching; camera-live-through-collapse; countdown expiry) + screenshot pass vs `contest-redesign-visual-checklist.md` for JSX blocks (2–4). PR #13 (kiosk) is open and adds 2 lines to client.tsx — re-check its merge-time runtime verification after each contest block lands.

## 5. Other areas (after contest)

- **Onboarding PR** — `session/onboarding/components/`: hooks.ts (useTheme) · ui.tsx (CheckLine/Spinner/StageHeader/StatusBadge) · labels.ts (CHECK_KIND_LABELS, checkKindLabel, readinessBlockMessage, PHASE_FRIENDLY_NAME, computePhases) · tauri-globals.ts (TauriGlobals type) · ProgressBar.tsx · DryRunSummary.tsx · stages/Stage1…Stage14 (whole-component relocation — stages already own their state). Stage 9 (~1,060 lines, blazeface) moves alone. page.tsx → ~1,300 lines.
- **Results PR** — `results/components/`: types.ts · utils.ts (formatPenalty/formatCountdown) · ResultsLoading · LockedScreen · ErrorScreen · LeaderboardSection · MySubmissionsSection. `ResultsPage` Suspense wrapper untouched (static-export requirement); shared deriveds stay in `ResultsView`; `router` flows down.
- **Login PR** — `login/components/`: BrandPane · OtpForm · PasswordForm · SsoModal. State + handlers stay in LoginPage (~150 lines); mode toggle + footer stay.
- **Shared PR** — `src/components/RouteLoadingShell.tsx` `{variant, label}` collapses the 3 copy-pasted loading.tsx files (diff them first).
- **Home** — document-only; it IS the model.

## 6. Migration checklist

### PR A — contest Block 1 (`refactor/contest-components`)

| Task                                                                | Files              | Status |
| ------------------------------------------------------------------- | ------------------ | ------ |
| A.0 dir.md created                                                  | apps/web/dir.md    | ☑      |
| A.1 pure modules (hooks/markdown/verdict-styles/language/questions) | 5 new + client.tsx | ☐      |
| A.2 inline components (CountdownBadge/FollowUpPane/MarkovPane)      | 3 new + client.tsx | ☐      |
| A.3 gates + binding review ×2 + rig scenarios                       | —                  | ☐      |

### PR B–D — contest Blocks 2–4 · PR E onboarding · PR F results · PR G login · PR H shared

(expand each table when its block starts)

## 7. Deferred / rejected

- **Deferred:** SettingsPanel.tsx split (1594) · home/page.tsx split (1410) · onboarding IntroScreen extraction · `<CameraPreview>` unification (the 4 `<video>` sites are NOT byte-identical — different attrs/overlays/keep-mounted invariants; unifying = attribute homogenization, not a re-parent) · results `BackToHomeButton` (3 instances differ; no cross-page consumer).
- **Rejected:** promoting `home/components/ui-primitives.tsx` to `src/components/` — moving it out of `app/home/` breaks the color-scan ledger (`KEEP_FFFFFF` count) · barrels/index re-exports (chunking).

## 8. Verification playbook

- **Contest rig:** scratchpad `mock-api.mjs` (`NEXT_PUBLIC_API_URL=http://localhost:8123`, `RUN_VERDICT_DELAY_MS` knob, q1/q2) + Playwright; scenarios in §4.
- **Onboarding smoke:** full dry-run in Tauri dev shell with webcam (stages 8–10), emergency-exit, readiness-block screen.
- **Results smoke:** normal/locked/error/loading branches + back-nav from each.
- **Login smoke:** OTP flow, mode toggle, TEST_EMAIL/TEST_PASSWORD, SSO modal, focus rings.
- **Guard inventory:** `submit-button.test.mjs` (save-identifier ban, source-scan) · `home-color-completeness` (home dir scan) · `home-tokenize-aa` + `theme-dark-lock-coverage` (globals.css scans) · rest are pure-logic guards.
