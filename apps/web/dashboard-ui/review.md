# Dashboard review — 2026-09-30

Accepted for this UI-only scope after source, production-build, browser, native-rendering and visual checks.

## Findings corrected

1. Decorative search had no behavior. Astryx TextInput now filters title and organization locally, includes a clear button, keeps focus after clearing, and distinguishes no-match from empty data.
2. Initial query failures were visually indistinguishable from an empty list. Rendering now uses the existing query error value; request/effect/retry code is untouched.
3. Contest rows and recovery controls had competing purple fills and custom hover mutations. Astryx supplies neutral actions, Token/StatusDot states and consistent focus behavior.
4. Readiness used small all-caps statuses and hover-only details. The checklist now has explicit visible status text and distinct accessible names for each Resolve action.
5. Null-ended practice entries could display clock-derived copy. Their presentation is explicitly untimed while the existing practice entry rule is unchanged.
6. Long unbroken organization text escaped the internal scroller even when body overflow appeared correct. Astryx truncation now bounds the text; review now checks internal layout overflow as well.
7. Preflight's fixed grid and minimum height failed narrow/short windows. Astryx Grid reflows the check columns; Card bounds the scroll area and a content Stack prevents shrinking sections.
8. Missing preflight reports resembled an unfinished or partially complete report. The dialog now shows Not verified and a recovery explanation. Authorization still requires the original matching report, required-pass/blocking checks, decision and entry-window conditions.
9. Recovery dialogs lacked a maximum-height scroller. Their shared Card surfaces now remain inside short viewports. Focus restoration and Escape dismissal pass in the browser checks.
10. Four old literal-white hover exceptions were removed along with custom modal buttons. Color guards now require zero such exceptions.

## Protected behavior

The reviewer subagent saved a 65-file Home/lib baseline before edits. AST-normalized comparisons preserve all named handlers, effects/timers, API/policy imports, modal click handlers, contest click handlers, resume click handlers and selected entry gate expressions. Twenty comparisons pass; 56 baseline files are byte-identical. Files changed outside that audited set are the new shell, UI evidence/scripts, plan, change log and the evidence-scanner exclusion. No API client/backend/native implementation was edited.

## Validation boundaries

See README for the exact accepted capture run and logs. Browser tests use synthetic data, blocked external traffic, real pointer events for controls and keyboard Escape for dialog dismissal. Source comparison provides coverage for protected native actions that cannot be meaningfully exercised in browser fixtures.

The three subagents stopped on usage limits after initial discovery/audit. Final review is by the primary agent, not an independent subagent approval. Existing denied-media promise rejections remain; this UI change does not modify media acquisition or permissions. Full Settings/Device redesign and results availability/API reconciliation remain separate work.
