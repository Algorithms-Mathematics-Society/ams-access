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
