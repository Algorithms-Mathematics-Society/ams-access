# Theme mechanism (Phase 1.1) — design spec

**Status:** approved design, pre-implementation.
**Scope:** the canonical dark/light theme state mechanism for the candidate desktop app (`apps/web`).
Proven on the pre-auth entry screens (welcome + login). Not the styling slices (done: welcome,
login, results, help) and not the route-gating (1.2) or home unification (2a).

## Goal

Introduce the **first and canonical** theme-state mechanism. Today the `.dark`/`.light` class layer is
**dormant** — nothing sets `html.className`; the app renders off `:root` dark defaults, and home's
`theme` useState drives only its JS-prop ternaries. 1.1 builds the single source of truth that the
toggle, the FOUC script, and (later) 2a's unified home all read/write.

## Decisions (locked)

- **First-visit default = system preference** (`prefers-color-scheme`). No stored value ⇒ follow the OS,
  live (re-evaluate on OS change). Explicit toggle ⇒ stored value wins and OS changes are ignored.
- **Storage is binary + sparse:** persist `"dark"`/`"light"` **only** on explicit toggle; absent =
  follow system. No `"system"` tri-state is stored.
- **Canonical key = `STORAGE_KEYS.THEME` (`"ams_theme"`)** — reuse the existing constant, do not invent
  `ams-theme`.

## Existing-key reconciliation (prerequisite — the single-writer boundary)

`"ams_theme"` already exists and is **abused as a force-dark pin**. For the module to be the single
writer, 1.1 MUST neutralize the competing writers:

| File:line                 | Current                                                | 1.1 action                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login/page.tsx:110`      | `localStorage.setItem("ams_theme","dark")` (useEffect) | **Remove** — login has no theme state to preserve; this pin fights the toggle.                                                                                         |
| `home/page.tsx:233`       | `localStorage.setItem(STORAGE_KEYS.THEME,"dark")`      | **Remove the localStorage write only.** Leave `setTheme("dark")` (line 232) — home's internal JS state stays dark until 2a; we only stop it clobbering the shared key. |
| `onboarding/page.tsx:24`  | `getItem("ams_theme")` (read)                          | **Leave** — read-only; onboarding is gated dark in 1.2 and migrated in 2b. Harmless.                                                                                   |
| `contest/client.tsx:1868` | `EDITOR_THEME_KEY`                                     | **Out of scope** — separate Monaco editor-theme key (slice 2d).                                                                                                        |

**Existing stored `"dark"` — decided: A now, B at end of Phase 2.** Current users carry
`"ams_theme"="dark"` written by the **force-pins** — a **known non-choice** (nobody selected it). The
resolution is staged, gated on light-mode coverage, NOT on whether stored-dark is a "real preference":

- **1.1 / now → A (no migration).** Keep the stored `"dark"`. The reason is **not** that it's a genuine
  preference (it isn't) — it's that **light mode is still partial**: clearing it now would flip a
  system-light existing user into light and straight onto unmigrated home/onboarding/contest. We
  temporarily honor a value nobody chose, purely to avoid surprising users with light on screens that
  aren't themed yet. The module treats `storedTheme()` uniformly; no special-casing — A is simply "don't
  clear."
- **End of Phase 2 → B (one-time clear).** Once **every** screen is migrated and light is universally
  safe, run a one-time clear of the stale force-pinned value so existing users get their **genuine system
  preference** on a fully-themed app, with no half-broken routes.

> **DEFERRED TRIGGER (record — do not forget):** _Clear the stale force-pinned `ams_theme` value once
> Phase 2 completes (all screens migrated, light universally safe)._ This is the only thing that converts
> the temporarily-honored non-choice back into the intended system-default behavior. Owner: whoever lands
> the final Phase 2 (2d) slice. If this is skipped, every pre-1.1 user is silently pinned dark forever.

## Architecture

### 1. `src/lib/theme.ts` — single source of truth (the ONLY writer of `html.className` / `localStorage`)

```ts
export type Theme = "dark" | "light";
import { STORAGE_KEYS } from "@/constants/storage-keys"; // THEME = "ams_theme"

function systemTheme(): Theme; // matchMedia('(prefers-color-scheme: light)').matches ? 'light':'dark'
function storedTheme(): Theme | null; // localStorage[THEME], validated to 'dark'|'light' else null
export function resolveTheme(): Theme; // storedTheme() ?? systemTheme()    ← THE RULE

function apply(t: Theme): void; // THE ONLY DOM writer: html.classList remove other, add t
export function setTheme(t: Theme): void; // localStorage[THEME]=t; apply(t); notify()
export function toggleTheme(): void; // setTheme(getSnapshot()==='dark'?'light':'dark')

export function subscribe(cb): () => void; // external-store subscription
export function getSnapshot(): Theme; // reads html.classList — the applied DOM truth
export function useTheme(): { theme; setTheme; toggle }; // useSyncExternalStore(subscribe,getSnapshot,()=>'dark')
export const THEME_INIT_SCRIPT: string; // pre-paint script (built from the SAME constant — see #1)
```

Client-only listeners registered once: `matchMedia` change → if `storedTheme()===null`, `apply(systemTheme())`;
`storage` event → re-resolve + apply (cross-tab). Both honor "explicit beats system."

`getSnapshot` reads `html.classList` so the module **adopts whatever the FOUC script set** — module and
script cannot desync at init. `getServerSnapshot` returns a stable `'dark'` for the static build.

### 2. FOUC pre-paint script — inlined in `layout.tsx` `<head>`

`<html suppressHydrationWarning>` + a raw inline `<script dangerouslySetInnerHTML={{__html: THEME_INIT_SCRIPT}}/>`
rendered by the root layout. CSP `script-src 'self' 'unsafe-inline'` permits it (no nonce present).
**Implementation must validate the script lands in the static HTML `<head>` and executes before first
paint** under `output: "export"` (App Router manages `<head>` via metadata; the exact injection — a
`<head>`-rendered element vs `next/script strategy="beforeInteractive"` — is verified pre-paint during
implementation, since "no flash" depends on it). The no-flash guarantee is a /code-review gate, not an
assumption.

### 3. `src/components/ThemeToggle.tsx`

Thin `"use client"` UI over `useTheme()`. Sun/moon button → `toggle()`. `aria-label`, `aria-pressed`,
focus-visible. **No internal theme state.** Mounted-gate: render a neutral icon until hydrated to avoid a
one-frame _icon_ flicker (the page never flashes — the FOUC script guarantees that). Placed in a corner of
welcome + login.

## #1 — Provable script ↔ resolveTheme() parity (no-flash depends on it)

Two code paths compute the same rule (TS `resolveTheme()` + vanilla-JS string). Guards against drift:

- **Shared key:** `THEME_INIT_SCRIPT` is built by interpolating `STORAGE_KEYS.THEME` — the key literally
  comes from the same constant, so it cannot drift.
- **Parity test** (`src/lib/theme-init-parity.test.mjs`, matching the repo's `*.test.mjs` + `node --test`
  convention): evaluate `THEME_INIT_SCRIPT` against `resolveTheme()` over the full input matrix —
  `stored ∈ {absent, "dark", "light", "garbage", ""}` × `system ∈ {dark, light}` (10 cases) — with
  mocked `localStorage`/`matchMedia`; assert identical resolved class. Drift fails CI.
- **Cross-reference comments** on both paths pointing at each other and at this test.
  This is checked duplication, not hoped-for.

## #2 — getServerSnapshot='dark' causes no visual wrong-render (verified against code)

A system-light first-visit user must not see a dark frame. Confirmed: the entry screens theme **only via
the CSS class cascade**, never by branching render on a theme value.

- `WelcomeScreen.tsx`: 0 theme reads (only a `shown` animation flag), 0 inline color literals — pure
  class-based. ✓
- `login/page.tsx`: 0 theme-value reads in render (its only theme line was the force-write being removed).
  ✓
- The **only** `.theme`-reading component in 1.1 is `<ThemeToggle>` — and it is mounted-gated, so the
  `getServerSnapshot='dark'` value never drives a visible render.
  **Invariant:** no entry-screen component may branch its render on `useTheme().theme`; theming is via CSS
  class only. If a future component needs the value in render, it must mounted-gate like the toggle.

## #3 — The 1.1 surface is actually sealed (cascade-proof)

`apply()` sets the class on `<html>`, which cascades to **every** route — so a system-light user reaching
an unmigrated route would half-break it, toggle or not. Two independent seals:

- **Flow seal (1.1 proof):** welcome + login are **pre-auth**; home/onboarding/contest are **post-auth**
  (`login → router.push("/home")` fires only after auth). The 1.1 proof surface therefore cannot reach
  the unmigrated routes — they are unreachable from the test surface, satisfying your condition (a).
- **CSS seal (1.2, specified now so it's real scoping):** a `.theme-dark-locked` class that **re-declares
  the full dark token block** (`--theme-*`, `--surface-*`, `--text-*`, `--verdict-*`) is applied to the
  **root element of each unmigrated route** (home, onboarding, contest). Because CSS custom properties
  cascade from the nearest ancestor, this descendant declaration **overrides `html.light`** for that
  subtree → the route renders dark regardless of the `<html>` class. This is real CSS scoping, not "hide
  the toggle."

**Hard ship invariant:** no user-facing build enables the global theme apply (FOUC script + visible
toggle) until every unmigrated route carries `.theme-dark-locked`. 1.1 and 1.2 are built/reviewed
sequentially but **ship as a unit**; 1.1's proof is confined to the pre-auth surface.

## Data flow (cold load — the no-flash path)

build → static HTML, `<html>` no theme class → **FOUC script** resolves (`stored ?? system`), sets class
pre-paint → first paint already correct → React hydrates, `suppressHydrationWarning` ignores the `<html>`
diff, module `getSnapshot` reads DOM truth → toggle / reload / OS-change / cross-tab all flow through the
module.

## Error handling

`localStorage` blocked (private mode / Tauri) or `matchMedia` absent → `try/catch` → fall back to `dark`.
Module and script guard independently.

## Files touched

- `src/lib/theme.ts` (new) · `src/components/ThemeToggle.tsx` (new) · `src/lib/theme-init-parity.test.mjs`
  (new)
- `src/app/layout.tsx` (suppressHydrationWarning + inline script)
- `src/app/WelcomeScreen.tsx`, `src/app/login/page.tsx` (drop in `<ThemeToggle>`; remove login force-write)
- `src/app/home/page.tsx` (remove the line-233 localStorage write only)

## Test plan / /code-review focus (the mechanism, weightier than a slice)

single-source-of-truth (only `theme.ts` writes class/storage; competing writers removed) · **script↔module
parity test passes** · no-flash both modes on cold load · persistence survives reload · system-default
with no stored pref · **no hydration warning** under static export · CSP allows the inline script · no
entry-screen render branches on `.theme`.

## Out of scope (explicit)

1.2 route-gating implementation (the `.theme-dark-locked` application) · 2a home unification (collapsing
the JS-prop ternary system into this module) · the light Monaco editor theme (2d).
