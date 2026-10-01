# P1 shared primitive change log

Date: 2026-09-30. Owner: `p1_primitives` subagent. Scope: shared control boundary, Home compatibility primitives, theme toggle, and Home theme helper. Root agent owns theme setup and full runtime verification.

## Discovery before implementation

Read root `AGENTS.md`, phase 1 of `exectuion-page-wise.md`, and `theme-p0/astryx-discovery.md`. Ran Astryx with Node 24.4.1 before edits:

- `pnpm exec astryx build "neutral desktop exam app shared controls with monochrome buttons and minimal purple focus accents"`.
- `pnpm exec astryx template ButtonGroupBasic` to study the recommended control composition.
- Component discovery: Button, IconButton, TextInput, Selector, TabList, Tab, Tooltip, Dialog, DialogHeader, Token, StatusDot, Card, HStack, VStack, Grid, Text.
- `component Select` reported no such component; discovered and used the actual `Selector` API instead.
- Inspected installed implementation of Button, TextInput, BaseProps, Token and Dialog for attribute/ref forwarding, input IDs, event signatures and top-layer behavior.

## Changes

| File | Change and purpose |
| --- | --- |
| `packages/shared-ui/package.json` | Declare `@astryxdesign/core` 0.1.8 as a runtime dependency. Root agent performs the single coordinated workspace installation. |
| `packages/shared-ui/components/index.tsx` | Establish a client component export boundary for Astryx buttons, text input, selector, tabs, status, tooltip, dialog/header and layout/text primitives. No new theme provider: all controls inherit the root effective theme. |
| `apps/web/src/components/ThemeToggle.tsx` | Use Astryx IconButton with ghost treatment and keyboard/hover tooltip. Preserve `useTheme`, mount-safe initial icon/name, aria-pressed, click handler and optional className. |
| `apps/web/src/app/home/components/ui-primitives.tsx` | Replace hand-built buttons with the shared Astryx Button while preserving native props, ref, children, disabled/type and handlers. Map danger to destructive and existing sizes to library sizes. Primary fill/text/border use canonical monochrome roles after legacy inline styles so old purple CTA fills cannot defeat the shared contract; preserve caller geometry. |
| Same file | Replace surface, inline alert, status and checklist rendering with Card/HStack/Grid/Text/Token/StatusDot. Canonical green/yellow/red retain status meaning; checking uses a neutral treatment. No new raw layout wrappers or utility CSS. |
| Same file | Keep `Field` as a native-input compatibility adapter with canonical tokens. Preserve arbitrary HTML input types, IDs, uncontrolled defaults, autocomplete and native event signatures. New pages use shared TextInput/Selector explicitly. Astryx 0.1.8 TextInput requires controlled strings and replaces supplied input IDs, so silently substituting it would change the exported native contract. |
| Same file | Keep Home `Dialog` surface-only through Card; do not introduce native-dialog top-layer ordering into existing exam overlays. The canonical shared Dialog/DialogHeader/Layout exports are ready for deliberate page-slice adoption. |
| `apps/web/src/app/home/components/utils.ts` | Keep the `getThemeColors` keys and argument contract but resolve values directly to canonical theme roles; no readiness, contest, API or authentication logic changed. |

## Verification

- Shared UI `pnpm --filter @ams/shared-ui typecheck`: passed.
- Web `pnpm --filter @ams/web typecheck`: passed after initial primitive edits.
- `git diff --check`: passed after initial edits.
- Independent reviewer notified of the field-ID compatibility boundary and the deliberate preservation of overlay stacking behavior.
- Root agent owns final browser, complete test-suite, theme mode, build/export and integration results. See the P1 overview/review for final evidence.

## Deliberate boundaries

P1 establishes standard APIs and migrates shared consumers; it does not replace every page-local form, select, tab or modal. Their planned page slices retain responsibility for labels, validation, keyboard navigation, panel association and exam-overlay priority checks. No new native execution, network request, authentication handler, media permission, submission behavior or session policy was added.

## Isolated primitive preview follow-up

Added `theme-p1/PrimitivePreview.tsx` at the root agent's request. It is outside `app/`, creates no shipped route, and provides deterministic controls for browser captures and keyboard checks. It covers monochrome/secondary/destructive/Submit, disabled/loading behavior, controlled/error/disabled text fields, Selector, tab panels, semantic statuses, tooltip and a dismissible dialog with header/input/footer. All actions only mutate local fixture state. Additional API discovery covered AppShell, Layout, LayoutContent and LayoutFooter. Web typecheck passed after creating the fixture.

Astryx TabList defaults to navigation semantics (`nav` + `aria-current`); the preview explicitly supplies `tablist`/`tab`/`aria-selected` with persistent labelled tab panels for its in-page content. Preserve this distinction during later page migrations.

Added the test-only `Preview locked Home` action via Next `router.push('/home/')` so verification can exercise a real SPA transition from saved light preference into a locked route, then browser-history restoration. This button exists only in the isolated fixture.

Final caller review found Astryx Button wraps `children` in a label span: legacy Home callers pass leading SVGs as children, so direct forwarding would lose their original flex alignment/gap. Added a token-spaced HStack inside that label slot to preserve icon/text alignment and existing animated icons. Caller widths, pill radii, action handlers, native titles and status-specific secondary fills remain intact; primary color ownership remains canonical.
