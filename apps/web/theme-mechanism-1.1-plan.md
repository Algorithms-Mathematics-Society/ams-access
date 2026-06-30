# Theme Mechanism (Phase 1.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the canonical dark/light theme-state mechanism (single-writer module + pre-paint FOUC script + reusable toggle) and prove it on the pre-auth entry screens.

**Architecture:** Pure, import-free resolution logic in `theme-core.ts` (node-tested, incl. the script↔function parity test); a DOM/React glue module `theme.ts` that is the _only_ writer of `html.className` + `localStorage[ams_theme]`; an inline FOUC script in the layout sets the class pre-paint; a mounted-gated `<ThemeToggle>` is thin UI over the module. The existing force-dark writes are removed so the module is the sole writer.

**Tech Stack:** Next.js 15 App Router (static export, `output: "export"`), React 19, TypeScript, `node --test --experimental-strip-types` for unit tests.

## Global Constraints

- Theme classes are `"dark"` / `"light"` on `<html>`; the `.dark`/`.light`/`:root` token blocks already exist in `globals.css`. Do not edit token values.
- Canonical storage key = `STORAGE_KEYS.THEME` (`"ams_theme"`) from `src/constants/storage-keys.ts`. Never hardcode the string elsewhere.
- First-visit default = system preference; persist only on explicit toggle (sparse binary). Existing stored `"dark"` is honored for now (A); one-time clear deferred to end of Phase 2 (see spec).
- `theme-core.ts` MUST stay import-free and DOM/React-free (keeps it node-testable). DOM/React access lives only in `theme.ts`.
- Restyle nothing; this is logic. Explicit-path staging only (never `git add -A`).
- Build must stay green: `pnpm --filter @ams/web build`. Tests: `pnpm --filter @ams/web test`.
- Ship invariant: do NOT release the branch until 1.2 route-gating lands; 1.1's proof is confined to the pre-auth surface (welcome/login).

---

### Task 1: Pure theme-core + parity/unit tests

**Files:**

- Create: `apps/web/src/lib/theme-core.ts`
- Test: `apps/web/src/lib/theme-core.test.mjs`
- Modify: `apps/web/package.json` (add the test file to the `test` script)

**Interfaces:**

- Produces: `type Theme = "dark"|"light"`; `isValidTheme(v: unknown): v is Theme`; `resolveThemeFrom(stored: string|null, systemPrefersLight: boolean): Theme`; `buildInitBody(storageKey: string): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/theme-core.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveThemeFrom, isValidTheme, buildInitBody } from "./theme-core.ts";

test("resolveThemeFrom: explicit stored value wins over system", () => {
  assert.equal(resolveThemeFrom("dark", true), "dark");
  assert.equal(resolveThemeFrom("light", false), "light");
});

test("resolveThemeFrom: absent/invalid falls back to system", () => {
  assert.equal(resolveThemeFrom(null, true), "light");
  assert.equal(resolveThemeFrom(null, false), "dark");
  assert.equal(resolveThemeFrom("garbage", true), "light");
  assert.equal(resolveThemeFrom("", false), "dark");
});

test("isValidTheme", () => {
  assert.equal(isValidTheme("dark"), true);
  assert.equal(isValidTheme("light"), true);
  assert.equal(isValidTheme("system"), false);
  assert.equal(isValidTheme(null), false);
});

// Run the FOUC script body in a sandbox with mocked browser globals; return the
// class it adds to <html>.
function runInitBody(stored, systemPrefersLight, { throwOnLS = false } = {}) {
  let added = null;
  const localStorage = {
    getItem: () => {
      if (throwOnLS) throw new Error("blocked");
      return stored;
    },
  };
  const matchMedia = () => ({ matches: systemPrefersLight });
  const document = {
    documentElement: {
      classList: {
        add: (c) => {
          added = c;
        },
      },
    },
  };
  new Function("localStorage", "matchMedia", "document", buildInitBody("ams_theme"))(
    localStorage,
    matchMedia,
    document
  );
  return added;
}

test("PARITY: inline script resolves identically to resolveThemeFrom across the matrix", () => {
  for (const stored of [null, "dark", "light", "garbage", ""]) {
    for (const systemPrefersLight of [true, false]) {
      assert.equal(
        runInitBody(stored, systemPrefersLight),
        resolveThemeFrom(stored, systemPrefersLight),
        `stored=${JSON.stringify(stored)} systemLight=${systemPrefersLight}`
      );
    }
  }
});

test("PARITY: localStorage throw => script falls back to dark (safe)", () => {
  assert.equal(runInitBody(null, true, { throwOnLS: true }), "dark");
});
```

- [ ] **Step 2: Add the test file to the runner and run it (expect FAIL)**

In `apps/web/package.json`, append the new file to the `test` script's file list:
`... src/lib/candidate-auth.test.mjs src/lib/theme-core.test.mjs`

Run: `pnpm --filter @ams/web test`
Expected: FAIL — `Cannot find module './theme-core.ts'`.

- [ ] **Step 3: Implement the minimal `theme-core.ts`**

Create `apps/web/src/lib/theme-core.ts`:

```ts
// Pure theme resolution — NO DOM, NO React, NO imports. Node-testable in isolation.
// PARITY: buildInitBody() and resolveThemeFrom() MUST encode the SAME rule. The parity
// test in theme-core.test.mjs asserts the inline script and this function resolve
// identically across the full input matrix. Change one => change the other.
export type Theme = "dark" | "light";

export function isValidTheme(v: unknown): v is Theme {
  return v === "dark" || v === "light";
}

/** Resolution rule: an explicit stored value wins; otherwise follow system preference. */
export function resolveThemeFrom(stored: string | null, systemPrefersLight: boolean): Theme {
  if (isValidTheme(stored)) return stored;
  return systemPrefersLight ? "light" : "dark";
}

/**
 * Body of the pre-paint FOUC script (no IIFE wrapper, so a test can run it via
 * new Function). References the browser globals localStorage/matchMedia/document.
 * Mirrors resolveThemeFrom() — see PARITY note. theme.ts wraps this in an IIFE.
 */
export function buildInitBody(storageKey: string): string {
  return (
    `try{` +
    `var k=${JSON.stringify(storageKey)},s=localStorage.getItem(k),` +
    `t=(s==="dark"||s==="light")?s:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");` +
    `document.documentElement.classList.add(t);` +
    `}catch(e){document.documentElement.classList.add("dark");}`
  );
}
```

- [ ] **Step 4: Run tests (expect PASS)**

Run: `pnpm --filter @ams/web test`
Expected: PASS — all theme-core tests green, including PARITY (10 matrix cases + throw path).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme-core.ts apps/web/src/lib/theme-core.test.mjs apps/web/package.json
git commit -m "feat(web): pure theme-core resolution + script-parity test (Phase 1.1)"
```

---

### Task 2: DOM/React theme module (the single writer)

**Files:**

- Create: `apps/web/src/lib/theme.ts`

**Interfaces:**

- Consumes: `Theme`, `isValidTheme`, `resolveThemeFrom`, `buildInitBody` from `./theme-core`; `STORAGE_KEYS` from `@/constants/storage-keys`.
- Produces: `setTheme(t: Theme): void`; `toggleTheme(): void`; `getSnapshot(): Theme`; `subscribe(cb: () => void): () => void`; `resolveTheme(): Theme`; `useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }`.
- NOT here: the FOUC script string. `theme.ts` is `"use client"`, and the **server** layout must not import a value from a client module (it would receive a client-reference proxy, not the string). The layout builds the script from the pure `theme-core` instead (Task 3).

> No node unit test: this module imports React (`useSyncExternalStore`) and touches DOM globals, so it is not importable under `node --test`. Its behavior is verified by typecheck/build, the /code-review mechanism pass, and the 1.3 both-mode screenshots. The risk-bearing pure logic is already tested in Task 1.

- [ ] **Step 1: Implement `theme.ts`**

Create `apps/web/src/lib/theme.ts`:

```ts
"use client";
import { useSyncExternalStore } from "react";
import { type Theme, isValidTheme, resolveThemeFrom } from "./theme-core";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const KEY = STORAGE_KEYS.THEME; // "ams_theme"

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return isValidTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(): Theme {
  return resolveThemeFrom(storedTheme(), systemPrefersLight());
}

/** THE ONLY writer of the html theme class. */
function apply(t: Theme): void {
  const c = document.documentElement.classList;
  c.remove(t === "dark" ? "light" : "dark");
  c.add(t);
}

/** Reads the applied DOM truth (the class the FOUC script / apply() set). */
export function getSnapshot(): Theme {
  try {
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}

let wired = false;
function wireOnce(): void {
  if (wired) return;
  wired = true;
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (storedTheme() === null) {
        apply(systemPrefersLight() ? "light" : "dark");
        notify();
      }
    });
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) {
        apply(resolveTheme());
        notify();
      }
    });
  } catch {
    /* non-browser / SSR build — no listeners */
  }
}

export function subscribe(cb: () => void): () => void {
  wireOnce();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** THE ONLY writer of localStorage[ams_theme]. */
export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked — still apply for this session */
  }
  apply(t);
  notify();
}

export function toggleTheme(): void {
  setTheme(getSnapshot() === "dark" ? "light" : "dark");
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "dark");
  return { theme, setTheme, toggle: toggleTheme };
}
```

- [ ] **Step 2: Typecheck + build (expect PASS)**

Run: `pnpm --filter @ams/web build`
Expected: PASS — compiles, static export succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/theme.ts
git commit -m "feat(web): single-writer DOM/React theme module + useTheme (Phase 1.1)"
```

---

### Task 3: FOUC injection + remove the competing force-writes

**Files:**

- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/app/login/page.tsx:110` (remove force-write)
- Modify: `apps/web/src/app/home/page.tsx:233` (remove the localStorage write only)

**Interfaces:**

- Consumes: `buildInitBody` from `@/lib/theme-core` (pure, server-safe) + `STORAGE_KEYS` from `@/constants/storage-keys` (plain module, server-safe). **Not** `theme.ts` — `layout.tsx` is a Server Component and `theme.ts` is `"use client"`.

- [ ] **Step 1: Add `suppressHydrationWarning` + the pre-paint script to the layout**

In `apps/web/src/app/layout.tsx` (a Server Component): build the script string locally from the pure `theme-core` (importing the client module would yield a proxy, not the string), and render it as the **first child of `<body>`** (a synchronous inline script there runs before body content paints; simplest reliable placement under static export). Add `suppressHydrationWarning` to `<html>` (the script mutates `html.className`).

```tsx
import { buildInitBody } from "@/lib/theme-core";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const THEME_INIT_SCRIPT = `(function(){${buildInitBody(STORAGE_KEYS.THEME)}})();`;
// ...
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Remove the login force-write**

In `apps/web/src/app/login/page.tsx`, delete the `useEffect` at line ~110:

```tsx
useEffect(() => {
  localStorage.setItem("ams_theme", "dark");
}, []);
```

(If `useEffect` becomes an unused import, remove it from the import statement.)

- [ ] **Step 3: Remove home's localStorage theme write (leave its internal state)**

In `apps/web/src/app/home/page.tsx` around line 231-233, delete ONLY the localStorage line, keeping `setTheme("dark")`:

```tsx
useEffect(() => {
  setTheme("dark");
  // (removed) localStorage.setItem(STORAGE_KEYS.THEME, "dark");
}, []);
```

If `STORAGE_KEYS` becomes unused in the file, remove that import; otherwise leave it.

- [ ] **Step 4: Build (expect PASS) and verify the script is in the static HTML**

Run: `pnpm --filter @ams/web build`
Expected: PASS. Then confirm the script is present in an exported page:
Run: `grep -l 'prefers-color-scheme' apps/web/out/index.html`
Expected: `apps/web/out/index.html` (the inline script is in the static HTML).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/app/login/page.tsx apps/web/src/app/home/page.tsx
git commit -m "feat(web): pre-paint theme FOUC script + drop competing force-writes (Phase 1.1)"
```

---

### Task 4: `<ThemeToggle>` component + wire into welcome & login

**Files:**

- Create: `apps/web/src/components/ThemeToggle.tsx`
- Modify: `apps/web/src/app/WelcomeScreen.tsx` (render the toggle)
- Modify: `apps/web/src/app/login/page.tsx` (render the toggle)

**Interfaces:**

- Consumes: `useTheme` from `@/lib/theme`.

- [ ] **Step 1: Create the mounted-gated toggle**

Create `apps/web/src/components/ThemeToggle.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Until mounted, render a theme-neutral icon so the first client render matches
  // the static HTML (no hydration mismatch, no wrong-icon flicker). The page itself
  // never flashes — the FOUC script set the class pre-paint.
  const isLight = mounted && theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={mounted ? `Switch to ${isLight ? "dark" : "light"} theme` : "Toggle theme"}
      aria-pressed={mounted ? isLight : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--theme-border)",
        background: "transparent",
        color: "var(--text-dim)",
        cursor: "pointer",
        transition: "color var(--transition-fast), border-color var(--transition-fast)",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {isLight ? (
          <circle cx="12" cy="12" r="5" />
        ) : (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Render the toggle on welcome**

In `apps/web/src/app/WelcomeScreen.tsx`, import and place it in the top-right corner badge area (near `welcome-corner-tr`):

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
// inside the top-right corner JSX, alongside the mono-tag:
<ThemeToggle />;
```

- [ ] **Step 3: Render the toggle on login**

In `apps/web/src/app/login/page.tsx`, import and place it in the form pane header area (top-right of the right pane):

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";
// in the right-pane top area:
<ThemeToggle />;
```

- [ ] **Step 4: Build (expect PASS)**

Run: `pnpm --filter @ams/web build`
Expected: PASS.

- [ ] **Step 5: Manual no-flash proof (record result)**

Run the app (`pnpm --filter @ams/web dev`), on welcome and login:

1. With OS in dark and no stored pref → loads dark, no flash.
2. With OS in light and no stored pref → loads light, no flash, toggle icon correct.
3. Toggle → flips instantly, no reload.
4. Reload → persisted choice survives.
5. DevTools console → no hydration warning.
   Record outcomes for the /code-review.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ThemeToggle.tsx apps/web/src/app/WelcomeScreen.tsx apps/web/src/app/login/page.tsx
git commit -m "feat(web): reusable ThemeToggle wired into welcome + login (Phase 1.1)"
```

---

## After the plan: /code-review the MECHANISM

Per the spec's review gates (weightier than a styling slice): single-source-of-truth (only `theme.ts` writes class/storage; competing writers removed) · parity test passes · no-flash both modes cold load · persistence survives reload · system-default with no stored pref · no hydration warning under static export · CSP allows the inline script · no entry-screen render branches on `.theme`. Then 1.2 route-gating before release.
