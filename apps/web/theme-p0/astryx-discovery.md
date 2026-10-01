# P0 — Astryx discovery and theme ownership

Completed: 2026-09-30. Scope: installed-source and CLI discovery only. No application code, package manifest, theme output, authentication, or native behavior changed. Raw CLI output is in [discovery](./discovery/); browser baselines and route layout budgets are separate P0 artifacts.

## Evidence and commands

Read `AGENTS.md` and `exectuion-page-wise.md` before discovery. All CLI calls used Node 24.4.1 by prefixing `PATH=/home/user/.nvm/versions/node/v24.4.1/bin:$PATH`; the default shell resolves Node 18. Commands ran from the repository root.

First Astryx command:

```sh
pnpm exec astryx build "neutral desktop exam app with minimal purple accents"
```

Result: no exact page template; recommended `blank`, `AppShell`, `TopNav`, `SideNav`, `Layout`, `useMediaQuery`, and the foundation stack/grid/text/button components. `build` is a read-only discovery operation; it did not scaffold a UI.

Follow-up commands, with exact output retained:

```sh
pnpm exec astryx template blank --skeleton
pnpm exec astryx template blank
pnpm exec astryx docs layout
pnpm exec astryx docs tokens
pnpm exec astryx docs theme
pnpm exec astryx docs styling
pnpm exec astryx hook useMediaQuery
```

Ran `pnpm exec astryx component <Name>` for AppShell, SideNav, TopNav, Layout, Button, TextInput, Dialog, TabList, StatusDot, Token, VStack, HStack, Grid, StackItem, Card, Section, Text, Heading, Icon, Badge, Divider, List, Item, and Table. All commands exited 0. Future component subparts must be individually discovered when implemented.

## Installed setup verified

- `@astryxdesign/cli`, `@astryxdesign/core`, and `@astryxdesign/theme-neutral` are installed at **0.1.8**, declared as root devDependencies. `apps/web/package.json` has no direct Astryx runtime dependencies. P1 must declare the packages actually imported by the web app and preserve the lockfile; root resolution during development is not a sufficient deployment contract.
- `apps/web/src/app/layout.tsx` imports `globals.css` and KaTeX CSS, initializes Inter/JetBrains Mono via `next/font/google`, runs pre-paint theme/dark-lock scripts, and renders `DarkLockController`. There is no Astryx reset, core CSS, theme CSS, or provider import anywhere in app/shared UI source.
- Current PostCSS uses Tailwind v4. Repository guidance prohibits introducing new utility/StyleX-authored layouts despite the installed CLI documentation demonstrating both. Follow AGENTS: component props first, then supported `style`/`className` with token references. No StyleX compiler is configured or needed to consume published precompiled components; do not add Babel/StyleX to make ordinary components work.
- Package exports confirm `@astryxdesign/core/reset.css`, `@astryxdesign/core/astryx.css`, `@astryxdesign/core/theme`, `@astryxdesign/core/theme/tokens`, component subpaths, and `@astryxdesign/theme-neutral/{built,theme.css}` exist. Importing `Theme` from core and `defineTheme` from core/theme is supported.
- Actual neutral-theme source differs from its CLI summary: it uses **Figtree**, not system-only typography. Its body colors are light `#f1f1f1` / dark `#1b1b1b`; surface is white / `#262626`; accent is monochrome `#262626` / `#ebebeb`. This is a starting palette, not the finished Access theme.
- Neutral inherits component overrides that explicitly make accent StatusDot and ProgressBar blue. A purple token change alone will not update those. P1 must review inherited component overrides as well as tokens.

Installed source inspected: `node_modules/@astryxdesign/core/src/{reset.css,tailwind-theme.css,theme/Theme.tsx,theme/tokens.stylex.ts,theme/defineTheme.ts}`, core exports/dist CSS, and `node_modules/@astryxdesign/theme-neutral/src/neutralTheme.ts` plus built CSS.

## Cascade collision analysis

Simply importing the three required styles would create mixed ownership:

1. Astryx reset is in `@layer reset`, core styles in `astryx-base`, and generated theme overrides in `astryx-theme`. Existing `globals.css` rules are mostly **unlayered**, which wins over all normal layered declarations irrespective of specificity. In particular the global `*` margin/padding reset can erase component padding; `main {height:100%;position:relative;z-index:1}` affects AppShell's own main; generic button/input rules affect component internals.
2. Text/password/email inputs force JetBrains Mono, appearance, and no box shadow with `!important`; placeholders force font, weight, spacing, and 0.35 opacity. These beat tokenized controls and can erase focus/status treatment. Moving an important declaration into an earlier layer does not fix it: important layer priority reverses. Remove the obsolete important declarations or scope them to legacy controls as those controls migrate.
3. Exact duplicate token definitions between current globals and Astryx core defaults are `--color-accent`, `--color-error`, `--color-success`, `--color-text-primary`, `--color-text-secondary`, `--color-warning`, and `--transition-fast`. Remove their legacy ownership when installing the theme. New aliases must point **from** legacy roles **to** canonical tokens; never point canonical tokens back into legacy aliases.
4. Tailwind owns a larger overlapping namespace: `--font-mono`, `--radius-sm/md/lg`, `--text-xs/sm/base/...`, and `--color-*`. Astryx's preferred font and radius names are `--font-family-body/code/heading` and `--radius-inner/element/container/full`, so those do not collide directly. Keep this distinction. Avoid importing the optional Tailwind bridge during P1: it registers `--color-accent` as a text-accent alias and reinterprets existing utilities, expanding migration scope without being needed by component props.
5. `<Theme>` renders a `display: contents` wrapper, explicitly sets its own color-scheme, and the root provider writes `html[data-theme]` and `html[data-astryx-theme]`. The current app writes `.light`/`.dark` for saved preference and `.theme-dark-locked` for effective route rendering. Defaulting Astryx to `mode="system"` would bypass saved preference and route locks inside the wrapper, while old pages still read the legacy classes.
6. Generated theme CSS uses `@scope` and `light-dark()`. Support must be checked in the preview browser and the actual deployed Tauri WebKit/WebView versions in P1/native verification. Browser preview cannot certify that support across supported desktop platforms.

### Recommended migration order and ownership

1. Keep the existing preference store and route-lock resolver authoritative. Compute effective mode as route locked ? dark : saved/system-resolved preference. Pass that exact mode to one root Astryx provider. Do not add another localStorage key or independent system-preference subscriber.
2. Extend the pre-paint initialization to synchronize initial effective mode/theme attributes before first paint; keep `.light`/`.dark` as preference and `.theme-dark-locked` as policy during compatibility. Account for SSR hydration: the existing `useSyncExternalStore` server snapshot is dark, so a light first paint must not momentarily acquire a dark Theme wrapper at hydration. Verify refresh, client navigation, system change, and storage events rather than assuming an effect fixes initial paint.
3. Use a custom `defineTheme` derived from `neutralTheme`, then compile through `pnpm exec astryx theme build <source-file>` **in P1**. Keep generated artifacts distinct from the source import so TypeScript does not accidentally import the unbuilt source instead of the generated built module. Pair built theme and generated CSS; runtime-only injection flashes component overrides in SSR.
4. Establish an explicit layer prelude before any import, following the documented order: `reset, theme, base, astryx-base, astryx-theme, components, utilities`. Retain Tailwind's theme/preflight/utilities only for existing consumers. Split the current unlayered reset into `reset`, inspect existing page styles before moving them into `components`, and delete/scope global selectors that leak into new components. Merely declaring layer names while leaving old rules unlayered is insufficient.
5. Import Astryx reset/core CSS and the custom generated theme CSS once through the app's global style entry. Treat this infrastructure as required theme setup under AGENTS, not permission to create new hand-written page styles. Preserve KaTeX import and offline font asset processing.
6. Canonical `--color-*`, font, radius, spacing, and component overrides belong to `defineTheme`. Compatibility aliases (`--theme-*`, `--home-*`, `--surface-*`, `--elevation-*`) can remain temporarily and resolve to canonical tokens in the active theme scope. Remove old dark/light literal definitions in the same change; otherwise they continue overriding aliases. Do not put canonical color overrides in `:root`.
7. Leave unrelated legacy route overrides in place until their page slice. Audit a legacy and a migrated page side by side before declaring P1 complete. CSS plumbing is global, so untouched pages require a visual smoke check too.

## Old-to-new role mapping

These are migration targets, not claims that the existing values are equivalent. All right-hand canonical token names below were verified in installed Astryx 0.1.8. Legacy aliases with the same canonical spelling must be removed, not assigned to themselves.

| Existing role or token | Canonical target / migration decision |
| --- | --- |
| `--theme-bg`, `--surface-0`, `--color-bg-base`, `--color-obsidian-base` | `--color-background-body` |
| `--theme-card-bg`, `--surface-1`, `--home-activecard-bg`, `--color-bg-elevated` | `--color-background-card`; remove gradient value |
| `--theme-sidebar-bg` | `--color-background-body` for unified navigation; divider establishes region |
| `--theme-inner-bg`, `--surface-2`, raised controls | `--color-background-surface` |
| `--home-modal-surface` | `--color-background-popover` |
| `--home-modal-inner`, `--theme-row-bg` | `--color-background-muted` |
| `--theme-text`, `--color-text-primary` | `--color-text-primary` |
| `--theme-text-muted`, `--theme-text-muted-strong`, `--theme-console-text`, `--text-soft/dim/faint` | `--color-text-secondary`; consolidate readable secondary tiers, use primary for stronger text |
| `--home-text-disabled`, disabled hints | `--color-text-disabled`; do not use for required reading |
| `--theme-text-faintest` | Decorative use only; meaningful labels must become secondary text |
| `--theme-border`, `--color-border-base` | `--color-border` |
| `--theme-border-strong`, `--color-border-input`, `--home-border-control/hover` | `--color-border-emphasized` |
| `--theme-hover`, `--home-overlay-btn-hover` | `--color-overlay-hover` |
| Neutral selected rows / pressed controls | `--color-overlay-pressed` or `--color-background-muted`, selected indicator separately |
| Modal backdrop | `--color-overlay` |
| `--theme-accent`, `--color-accent-base`, `--home-accent-dot` | `--color-accent` for the few approved accent roles |
| `--theme-accent-text`, `--color-accent-light/bright` | `--color-text-accent`; contrast-tested separately from fill |
| `--theme-accent-light`, `--color-accent-faint` | `--color-accent-muted`; retain only where the agreed accent budget permits |
| `--theme-accent-border`, `--color-border-focus` | `--color-accent` for focus or `--color-border-purple` for small indicators, not whole-panel tinting |
| General primary button fill/text | `--color-background-inverted` / `--color-background-body` through `components.button['variant:primary']`; verify contrast |
| Contest Submit fill/text | `--color-accent` / `--color-on-accent`; dedicated theme-defined button variant, compiled with generated TS augmentation |
| Success status/dot, `--theme-dot`, `--home-status-ok` | `--color-success` for status; `--color-text-green` for explanatory text; `--color-success-muted` for small status backgrounds |
| Error/status, `--theme-error-text/bg`, `--home-status-error` | `--color-error`, `--color-text-red`, `--color-error-muted` according to role |
| Warning/status, `--theme-warn-text`, `--home-status-warn` | `--color-warning`, `--color-text-yellow`, `--color-warning-muted` according to role |
| Semantic status borders | `--color-border-green/red/yellow`; consolidate opacity variants instead of one alias per alpha |
| `--theme-shadow`, `--elevation-1` | `--shadow-low` |
| `--theme-shadow-hover`, `--elevation-2`, `--home-shadow-card` | `--shadow-med`; remove purple glow |
| `--elevation-3`, `--home-shadow-panel` | `--shadow-high` |
| `--home-shadow-cta` | Remove decorative elevation; ordinary buttons do not require a shadow |
| `--radius-sm/md/lg/pill` | `--radius-inner/element/container/full` respectively; visual geometry changes intentionally |
| `--density-compact/standard/relaxed` | `--spacing-3/4/6`; standard moves from 18 to 16 px |
| `--font-sans`, hardcoded Inter | `--font-family-body` and `--font-family-heading` |
| `--font-mono`, hardcoded JetBrains Mono/Fira Code | `--font-family-code` |
| `--text-base`, `--text-xs` | `--text-body-size` (14 px base), `--text-supporting-size` (12 px base) |
| Existing 11/13 px and heading scales | Choose appropriate `--font-size-*` / `--text-heading-*-size`; override supported size tokens in defineTheme where exact size matters. Astryx xs defaults to 10 px, so **do not blindly map existing 12 px xs to Astryx xs**. |
| `--transition-fast` | Canonical `--transition-fast`; remove duplicate legacy definition |
| Editor syntax/verdict specialties | Preserve editor preferences and meaningful verdict colors; migrate chrome to canonical surface/text tokens. Use `resolveThemeTokens` or `useTheme` for JS values, not CSS var strings where CodeMirror expects resolved colors. |

Geist plan: bundle Geist Sans/Mono using the existing Next font pipeline (build-time acquisition, emitted static assets) or checked-in local font assets. Use distinct loader variables such as `--font-geist-sans`/`--font-geist-mono`, then reference those from `--font-family-body/heading/code` in defineTheme; avoid a `--font-mono` alias cycle. Verify the exported app offline. Do not set a runtime Google Fonts URL in theme typography.

Purple strategy: define accent/text/on-accent roles in the custom theme, override ordinary primary buttons to monochrome, and define an explicit Submit variant using the accent pair. Audit selected-state washes and inherited blue overrides. This keeps the same semantic accent available for focus and thin selection markers without making every default primary action purple.

## APIs established for later slices

| Area | Supported API and important contract |
| --- | --- |
| Theme | `Theme({theme, mode: 'system'|'light'|'dark', children})`; `defineTheme({name, extends, tokens, components, typography, ...})`; token light/dark tuples supported. Prefer built CSS for SSR. |
| Non-CSS consumers | `resolveThemeTokens(theme, {mode})` from `@astryxdesign/core/theme/tokens`; `useTheme()` from core/theme returns resolved tokens + mode. Alias this hook import to avoid collision with the app's existing `useTheme`. |
| Page shell | `AppShell` with topNav/sideNav/mobileNav/banner slots, `height="fill"` or `"auto"`, `contentPadding={0|...}`, variant wash/surface/section/elevated. It already renders main and supplies responsive navigation. |
| Sidebar | `SideNav` header/footer/children, controlled or uncontrolled `collapsible`, optional resizable width. Discover SideNavItem before implementing links; do not invent props. |
| Multi-pane workspace | `Layout` and LayoutContent/LayoutHeader/LayoutFooter/LayoutPanel; panel width, resizable, divider and scroll props in captured API. Use this inside the shell. |
| Buttons | `Button` requires `label`; variants primary/secondary/ghost/destructive; `isLoading`, `isDisabled`, `type="submit"`, `onClick`, optional async `clickAction`. Navigation remains a link. |
| Fields | `TextInput` requires label/value; `onChange(value, event)` differs from raw input's event-only handler. Status is `{type, message}`; `htmlName` sets name. Discover InputGroup/InputGroupText for fixed `@access` suffix and preserve paste/autocomplete/password controls. |
| Tabs | `TabList` requires value/onChange/children, supports hasDivider, size/layout/orientation. Discover Tab and panel association before implementation. |
| Dialog | `Dialog` requires isOpen/onOpenChange/children; purpose info/form/required governs dismissal. **Use onOpenChange, not onClose**: a broad styling-doc example is stale. Critical exam overlays need priority review before converting to native dialog top layer. |
| Status | `StatusDot` requires variant success/warning/error/accent/neutral and accessible label; still pair with visible text. `Token` requires label and supports color variants; Badge remains counts/enumerated states. |
| Layout primitives | VStack/HStack/Grid/StackItem for layout; Section/Card only for genuine groups/widgets; List/Item/Table for dense rows. Props use spacing steps, not arbitrary new raw wrappers. |

## Review gates before P1 is accepted

- Re-run exact component discovery for every additional subcomponent used; prefer per-component subpaths to keep bundling reviewable.
- Verify computed padding, font, foreground/background, focus, and field status with both legacy and migrated content after adding the CSS layer stack. Baseline screenshots alone do not prove an unintroduced reset is safe.
- Ensure light preference + locked route yields dark on HTML, Theme wrapper, menus/dialogs, and editor chrome; returning to Welcome/Login restores saved preference. Inspect pre-hydration and post-hydration.
- Preserve native WebView compatibility: check @scope/light-dark support and native dialog behavior on actual supported platforms. No native validation was performed in this P0 discovery.
- Confirm generated theme has no unexpected blue attention/progress accent, purple shadows, or remote font URL. Measure final text/control contrast, especially monochrome button pairs and purple fills/text.
- Existing theme tests inspect CSS literal assumptions. Update only obsolete presentation expectations during implementation; preserve dark-lock/persistence behavior and source-coverage checks.

P0 outcome: installed APIs, collision inventory, old-to-new roles, and explicit ownership/cascade approach documented. The theme has **not** been installed into the running app yet; that is P1.
