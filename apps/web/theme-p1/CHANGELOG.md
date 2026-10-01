# P1 change log — shared theme and primitives

Started 2026-09-30. Status: complete and independently reviewed. Scope: Phase 1 of `exectuion-page-wise.md`. P0 baselines remain immutable; page-specific redesigns continue in P2–P8.

## Baseline and ownership

- Source baseline: merge `c4c67ac` plus the user's existing uncommitted files. Pre-P1 tracked diff recorded at `/tmp/ams-access-before-p1.patch`.
- The desktop app uses port 3000 and `NEXT_PUBLIC_DEV_API_URL` from ignored `.env.local`; API/auth configuration is outside this theme change.
- Theme workstream: canonical Astryx source/generated artifacts, global cascade and legacy compatibility aliases. Detailed log: [theme-log.md](theme-log.md).
- Primitives workstream: shared component boundary, Home primitive adapters and theme toggle. Detailed log: [primitives-log.md](primitives-log.md).
- Integration: fonts, provider/pre-paint synchronization, direct runtime dependencies, verification and this log.
- Independent review: [review.md](review.md), completed after integration and visual checks.

## Implementation record

### Discovery and design decisions

- Re-read AGENTS, P0 discovery, P0 page budgets and P1 acceptance criteria before editing.
- Keep existing saved theme preference and route locks authoritative. Astryx receives effective mode; the root wrapper inherits the HTML color scheme so SSR's default-dark snapshot cannot flash dark on a saved-light page.
- Preserve authentication, session, judging, proctoring and native-enforcement contracts.
- Use supported Astryx component APIs and generated theme CSS. Ordinary primary buttons are monochrome; purple is reserved for focus, small active/brand details and the explicit Submit variant.
- Bundle Geist locally to avoid the existing development font-download timeouts and to support exported/offline rendering.

Further implementation, commands, findings and final verification results will be appended as work completes. A checked item in the execution plan will mean implemented and verified, not only edited.

### Font and provider integration

- Added direct web dependencies `@astryxdesign/core@0.1.8`, `@astryxdesign/theme-neutral@0.1.8`, and `geist@1.7.2`; shared UI declares core directly. Ran one coordinated `pnpm install --no-frozen-lockfile` using Node 24.4.1. Existing root Astryx dependencies were preserved.
- Replaced Inter/JetBrains Next Google font loaders with Geist package local-font loaders. Both variable classes are attached to HTML so root tokens resolve correctly. Bundled the font OFL notice under `public/licenses` and added dependency attribution without changing the legal page layout.
- Added `AccessThemeProvider` and pure `theme-bridge-core` helpers. The pre-paint script sets Astryx name/effective-mode attributes after existing preference and route-lock scripts. Theme preference updates and route navigation also synchronize attributes; no extra storage key was added.
- Existing Home field IDs and native event contracts are retained through an adapter; canonical controlled Astryx fields are exported for deliberate page migrations. Existing Home overlay surface stays within its current stacking model.
- Extended the P0 capture harness with an optional evidence directory and computed theme properties; original baseline images/manifests are unchanged.

### Independent review and compatibility corrections

- Fixed a self-referencing legacy transition alias and invalid whole-shadow `light-dark()` expressions. Shadow mode selection now applies to the color portion.
- The reviewer calibrated the new contrast helper against black/white (21:1) and `#777777`/white (4.478089:1). An earlier secondary-text failure was a **test-helper gamma error**, not a verified UI defect. The retained darker secondary text remains valid under the corrected calculation.
- Root visual review found a separate, genuine regression: fixed white text on legacy solid accent fills no longer matched the new dark accent. Paired those controls with `--color-on-accent` in global action classes and exact Home/preflight/resolve/contest style properties. Geometry, event handlers and disabled states remain unchanged.
- Removed the Home Resume button's imperative purple repaint on hover/leave, retaining the shared monochrome foreground/background/border contract.
- Excluded P0/P1 evidence directories from Tailwind source scanning so screenshots, generated native fixtures and logs do not keep rebuilding development CSS.
- The browser verifier now uses real CDP pointer/key events, including Enter character data; this avoids false failures from programmatic click focus or incomplete key synthesis. It distinguishes native browser-chrome focus boundaries from actual background controls, preserving strict opener-restoration checks.
- Initial screenshot runs during active development encountered transient invalid development bundles. Final route evidence is captured from the production static export, avoiding concurrent hot-reload mutation. Failed intermediate runs are not the authoritative baseline.

### Verification commands

```sh
pnpm --filter @ams/web test
pnpm --filter @ams/web typecheck
pnpm --filter @ams/shared-ui typecheck
pnpm --filter @ams/web build
AMS_THEME_EVIDENCE_DIR=apps/web/theme-p1/baselines node scripts/theme-p0-capture.mjs http://127.0.0.1:4319
node scripts/theme-p1-verify.mjs http://127.0.0.1:3000
```

Full regression suite after all compatibility repairs: **339 passed, 0 failed**. Native probe scripts and explicit limits are in [native/README.md](native/README.md). Final build, screenshots and reviewer acceptance are recorded below when complete.

### Final verification and handoff

- Full web tests: **339/339 passed** ([log](validation/tests.log)); web and shared UI typechecks passed ([web](validation/web-typecheck.log), [shared](validation/shared-typecheck.log)).
- Production static export: **passed**; 6.80 MB of 45 MB allowed, largest JS chunk 0.45 MB of 0.49 MB allowed ([build log](validation/build.log)). Temporary preview route absent.
- Final exported-route matrix: **78 screenshots**, two desktop sizes, **8/8 assertions**; no capture failures. Both Geist families load from the exported same-origin WOFF2 assets on relevant pages with external HTTP blocked. The original P0 artifacts remain unchanged.
- Interactive verification: **27/27 assertions**, nine images, no runtime exceptions or harness failures. Includes actual pointer activation, keyboard tabs, tooltip, native dialog background-control isolation and opener restoration, saved/system/storage preference, SPA locks and pre-hydration modes.
- Independent Linux WebKit probe: **6/6 cases**, ordinary and fallback-only CSS in light/dark/locked modes; actual SSR markup, local font data, computed style equality and legacy-action foreground checks. Detailed platform limitations remain explicit.
- Removed superseded/failed generated P1 capture runs; `latest.json` is authoritative in each evidence directory. Persisted source hashes and export provenance in [source-fingerprint.json](validation/source-fingerprint.json).
- Existing baseline categories remain: 28 headless media permission errors and two onboarding dry-run hydration errors in the route matrix. No new theme runtime exception appears in the isolated interaction checks. Existing light Help/title and other page-local work remain assigned to P2 onward.
- Native desktop development app relaunched on port 3000 with a separately persistent frontend and hot reload. No API, auth, judging, session or native-enforcement behavior changed.
