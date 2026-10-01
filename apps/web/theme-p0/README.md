# P0 — theme migration preparation

The app is running at **http://localhost:3000** with Next.js hot reload. P0 establishes the evidence and implementation contract for the neutral GetCracked-inspired theme with minimal purple. The visual theme installation begins in P1.

Source baseline: `c4c67ac80d495ab943f561cff078ed8125cdb1d3` (merge of `origin/main` through `a5d9093`), web 2.0.9. Existing local changes are preserved. Each capture manifest records the worktree status and tracked diff hash as well as the commit.

## Deliverables

- [Page/state inventory and layout budgets](page-inventory.md): every route, all onboarding stages, shared overlays, style owners, current geometry and proposed allocations at both desktop sizes.
- [Astryx discovery and token mapping](astryx-discovery.md): actual installed APIs, CLI evidence, token collisions, reset/cascade ownership, theme/route-lock bridge and font plan.
- [Discovery command outputs](discovery/): reproducible API evidence from the installed 0.1.8 packages.
- [Independent review](review.md): findings, corrections and remaining implementation gates.
- [Current baseline run](baselines/latest.json): pointer to the authoritative timestamped folder and its `manifest.json`, including screenshot names, route text, scroll regions, request logs and assertions.
- [Execution plan](../../../exectuion-page-wise.md): P0 checklist and subsequent page-wise slices.

## Baseline coverage

The complete capture matrix contains 78 PNGs: 39 at 1280×800 and the same 39 at 1440×1000. It includes Welcome and Login in dark/light; normalized handles, help, submitting and errors; Home normal/empty/loading/error and blocked preflight/Resolve; Hardware, Permissions, Security, About and Device; onboarding intro and the browser fullscreen stage; Contest workspace, populated A Attempts, empty B Attempts, editor settings, support, exit confirmation, collapsed panes and load error; Results dark/light/empty/loading/error; all three legal pages.

Eight browser assertions cover handle normalization with fixed suffix in both themes and A→B attempt filtering at each viewport. Input is injected through native input setters/events: this is not an operating-system clipboard test. The A→B check establishes basic filtering, not late-response race correctness. The inventory separately lists states still requiring later interactive/native verification.

Captures use a disposable Chrome profile with fake participant/session data. The application does not import the fixture code. Injected API responses stay in that browser, and CDP blocks non-local HTTP plus same-origin API fallthrough. The preview in the user's own browser continues to use its normal configuration. Native checks are never reported as successful by fixtures; no organizer request or real submission is sent.

## Verification

- Existing web test suite: **321 passed, 0 failed** under Node 24.4.1.
- Web typecheck: **passed** (`next typegen && tsc --noEmit`).
- Both capture scripts syntax-checked under Node 24.
- Screenshot completeness, dimensions and key states checked against the manifest.
- Production UI source unchanged in P0; existing package/lockfile changes preserved.

Browser screenshots demonstrate presentation only. Fullscreen enforcement, keyboard/app restrictions, monitor/VM detection, helper installation, real camera/face/audio behavior and teardown require the Tauri runtime in later phases. Most onboarding stages have source/state coverage here rather than screenshots of fabricated successful checks.

Existing browser findings are retained in the evidence: Home API-error fixtures fall back to empty-list copy, light Help has low-contrast text, media permission requests fail in headless Chrome, and onboarding dry-run entry reports a server/client heading hydration mismatch. These are baseline findings for the relevant implementation slices; zero capture failures does not mean an error-free app runtime.

## Decisions carried into P1

1. One Astryx-defined palette owns canonical roles; legacy variables point to those roles during migration. Remove conflicting global resets and `!important` type rules deliberately, after inspecting computed styles.
2. Preserve saved light/dark preference, first-paint initialization and route dark locks when introducing the Theme provider.
3. Bundle Geist Sans/Mono. General primary buttons become monochrome; purple is limited to small brand details, focus, active indicators and the Contest Submit action. Keep semantic success/warning/error and syntax colors.
4. Use the recorded page budgets to fix scroll ownership, especially onboarding, Results/legal pages, Settings and collapsed contest panes.
5. Preserve the current handle/suffix, intentionally visible formatted password and active-problem Attempts behavior. The source audit found API login uppercasing versus form lowercasing; investigate that separately against the auth contract before changing it.

## Reproduce

Run from the repository root using Node 24.4.1:

```sh
pnpm --filter @ams/web dev --hostname 127.0.0.1 --port 3000
node scripts/theme-p0-capture.mjs http://127.0.0.1:3000
pnpm --filter @ams/web test
pnpm --filter @ams/web typecheck
```

The capture runner requires the installed `/usr/bin/google-chrome` and creates an isolated profile in the system temporary directory. A successful run updates `baselines/latest.json`; a failed run leaves a failure manifest in its own directory without replacing that pointer. Stop only the capture browser when the run ends; the live preview remains running.
