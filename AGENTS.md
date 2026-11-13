# AGENTS

Project-specific guidance for AI coding agents.

Changes must account for at least 3,000 concurrent contest participants. Review
request rates, bounded polling/retries, duplicate prevention, memory growth and
backend/judge costs. Verify request bounds for affected flows; do not equate
mocked client tests with production capacity. Record any required staging load
verification in the PR.

For current UI work, read [DESIGN.md](DESIGN.md) and
[apps/web/UI.md](apps/web/UI.md). The shared AccessLogo/AccessMark components and
the supplied monochrome brand artwork own product branding. Old migration plans
point to these guides; historical reviews and browser-check scripts remain
available as evidence and optional tools, not current design instructions.

<!-- ASTRYX:START -->

Astryx v0.1.8 · 153 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:

1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:

- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else style/className with tokens — var(--color-_|--spacing-_|--radius-\*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-\* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-_|--spacing-_|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
search "<query>" find any component / hook / doc / template / block
component --list 153 components by category
template --list page + block recipes
docs <topic> color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
swizzle <Name> eject component source for deep customization
upgrade --apply run after any @astryxdesign/core bump

<!-- ASTRYX:END -->

## Issue and pull-request workflow

- Before opening a PR, search the repository's existing open and closed issues for the same scope. Reuse a relevant issue; create a focused issue only when the work is not already tracked.
- Record the problem, acceptance criteria, implementation progress, validation evidence, and remaining checks in the issue.
- Link every PR to its issue(s). Use `Closes #N` only when that PR fully satisfies the issue; use `Refs #N` for partial work or outstanding device/deployment acceptance.
- Update related issues when the PR or validation status changes. Passing CI alone does not prove native-device, production, or capacity acceptance.
- Before closing an issue, verify its acceptance criteria and merged PR. Preserve any explicit user requirement to confirm closure first.
- Keep independently testable fixes separate from unfinished feature work. Never include local operator notes, secrets, or unrelated changes in a PR.
- Use `gh` CLI for GitHub operations.
