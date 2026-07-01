// Regression guard for the .theme-dark-locked lock's TOKEN-COVERAGE completeness.
//
// The bug this guards (surfaced by home unification, step 1, as the lock's first all-element
// consumer): `.theme-dark-locked` re-pins the theme tokens via a co-selector on the `.dark` block —
// but that block only covers the `--theme-*` subset. The other light-overridden tokens
// (--accent-rgb / --accent-light-rgb / --surface-* / --text-* / --verdict-*) live in :root + .light,
// so under `<html class="light theme-dark-locked">` they leaked LIGHT (accents, input surfaces, text
// tiers). A `--theme-bg`-only runtime check passed and missed it; only an ALL-token check catches it.
//
// The fix scopes the whole `.light` block to `html.light:not(.theme-dark-locked)` — so on a locked
// route NO light token matches and every token falls back to :root + .dark = an exact dark render.
// This test enforces that exclusion by construction: any `.light`-scoped rule that declares custom
// properties MUST exclude `.theme-dark-locked`, or a token can leak onto a locked route again.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Strip CSS comments first (so a selector's preceding comment can't satisfy the assertion for it).
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

// Top-level rule blocks: "selector { declarations }". Declaration bodies have no nested braces
// (rgb(a / b) uses parens), so this simple split is sufficient for the .light token block.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, " "),
  body: m[2],
}));

// A "light token rule" = selector scoped to the `.light` class AND declaring >=1 custom property.
const lightTokenRules = rules.filter((r) => /\.light\b/.test(r.sel) && /--[\w-]+\s*:/.test(r.body));

test("guard is not vacuous: at least one .light rule declares custom properties", () => {
  assert.ok(
    lightTokenRules.length >= 1,
    "expected globals.css to have a .light block declaring theme tokens"
  );
});

test("no light token can apply on a dark-locked route (coverage-complete by construction)", () => {
  for (const r of lightTokenRules) {
    assert.match(
      r.sel,
      /:not\(\s*\.theme-dark-locked\s*\)/,
      `A .light-scoped rule that declares custom properties must exclude locked routes ` +
        `(":not(.theme-dark-locked)") — otherwise its light tokens leak onto /home, ` +
        `/session/onboarding, /session/contest for a system-light user. Offending selector: "${r.sel}"`
    );
  }
});

test("the previously-leaking tokens are inside the excluded .light block", () => {
  const lightBody = lightTokenRules.map((r) => r.body).join("\n");
  for (const tok of [
    "--accent-rgb",
    "--accent-light-rgb",
    "--surface-2",
    "--text-dim",
    "--verdict-ac",
  ]) {
    assert.match(
      lightBody,
      new RegExp(tok + "\\s*:"),
      `expected ${tok} to be declared in the .light block, so :not(.theme-dark-locked) neutralizes it when locked`
    );
  }
});
