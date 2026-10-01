# P1 — shared theme and primitives

P1 installs the neutral Access theme, locally bundled Geist fonts, and shared Astryx controls. The native desktop development app uses `http://localhost:3000` with hot reload. Page-specific layout redesigns continue in P2–P8.

## Change record and review

- [Detailed change log](CHANGELOG.md) — scope, decisions, compatibility fixes, commands and verification.
- [Theme implementation log](theme-log.md) — canonical palette, CLI generation, cascade and fallback.
- [Primitive implementation log](primitives-log.md) — shared controls and preserved caller contracts.
- [Independent review](review.md) — source review, findings, fixes and evidence limits.
- [Execution plan](../../../exectuion-page-wise.md) — phase status and subsequent work.

## Implemented

- One generated Astryx theme owns neutral canvas/panel/control/text/border roles, semantic statuses, purple focus/selection/Submit, and monochrome general primary actions.
- Legacy variables resolve to canonical roles. Reset and component layers have explicit ordering; broad input/reset overrides were removed. Generated compatibility CSS preserves legacy RGB consumers and supplies an explicit-mode fallback for single-root themes.
- Existing saved preference, system preference and exam-route dark locks drive the root provider. Pre-paint attributes and inherited wrapper color scheme preserve saved-light rendering before hydration.
- Geist Sans and Mono use package-local variable WOFF2 files via Next's local font loader. The export carries the fonts and their OFL notice.
- Shared UI exports standard buttons, fields, selects, tabs, status, tooltips and dialog/layout primitives. Existing Home controls and the theme toggle consume them. Native input IDs/events and existing exam-overlay ordering are preserved through compatibility adapters.
- Solid accent actions in legacy pages now use the matching foreground token. Home Resume's imperative hover styling also preserves the neutral primary pair.

## Verification evidence

- [Exported route screenshots](baselines/latest.json): 78 images at 1280×800 and 1440×1000, plus eight handle/Attempts assertions. Captured from a static export served locally, with external requests blocked and fixture-only APIs.
- [Interactive browser verification](verification/latest.json): both modes, control actions, disabled state, keyboard tabs, tooltip, native modal background-control isolation and focus restoration, SPA route locks, storage/system updates and pre-hydration rendering. The script temporarily mounts the isolated fixture then removes the route; it is absent from the production export.
- [Native WebKit evidence](native/README.md): six cases compare actual SSR control markup with normal versus fallback-only styles in WebKitGTK 2.52.6. Geist loads without network; light/dark/locked modes and legacy action foreground pairing are checked.
- Full web regression suite: **339 passed, zero failed**. Final typecheck and production-build outcomes are recorded in the change log.

Native HTML dialogs can expose a BODY focus sentinel at the browser-chrome boundary. Keyboard verification requires the dialog to stay modal, rejects any background control receiving focus, checks focus returns inside, and checks the opener receives focus after Escape. It does not claim to prevent leaving browser chrome.

The route matrix still records the P0 categories of browser-only media permission errors and onboarding dry-run hydration mismatch. These are carried forward to their page slices. The existing light Help title, fixed legal palette, page-local fonts/actions and specialized editor colors are not all migrated in P1. Native enforcement/media workflows and older macOS/Windows WebViews are not certified by the isolated theme probe.

## Reproduce

Run from repository root with Node 24.4.1:

```sh
pnpm theme:build
pnpm --filter @ams/web test
pnpm --filter @ams/web typecheck
pnpm --filter @ams/web build
```

Stop the development process before building: Next dev and production build share `.next`. For exported screenshots, serve `apps/web/out` locally, then run:

```sh
python3 -m http.server 4319 --bind 127.0.0.1 --directory apps/web/out
AMS_THEME_EVIDENCE_DIR=apps/web/theme-p1/baselines node scripts/theme-p0-capture.mjs http://127.0.0.1:4319
```

For interaction checks, run a separate web development server on 3000, then:

```sh
node scripts/theme-p1-verify.mjs http://127.0.0.1:3000
```

The verifier uses a disposable Chrome profile. Its temporary `/theme-preview` route is created exclusively and removed in cleanup. If interrupted outside normal cleanup, remove only that generated route and its generated `.next/types/app/theme-preview` directory before a production build. Do not ship the review fixture as an application page.
