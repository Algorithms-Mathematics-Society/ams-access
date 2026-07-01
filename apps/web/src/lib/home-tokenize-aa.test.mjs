import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// WCAG relative luminance + contrast (sRGB).
const lum = (r, g, b) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hex = (h) => {
  const n = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};
const contrast = (fg, bg) => {
  const L1 = lum(...fg),
    L2 = lum(...bg);
  const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (a + 0.05) / (b + 0.05);
};

// Read a token's light value from the html.light:not(.theme-dark-locked) block.
const lightVal = (token) => {
  const block = css.slice(css.indexOf("html.light:not(.theme-dark-locked)"));
  const m = block.match(new RegExp(token + ":\\s*(#[0-9a-fA-F]{6})"));
  if (!m) throw new Error(`light value for ${token} not found`);
  return m[1];
};

// Home-light surfaces (all light; darkest is the worst case). #f0eadd = --theme-inner-bg light.
const SURFACES = {
  "cream-inner #f0eadd (darkest)": "#f0eadd",
  "page #f6f2ea": "#f6f2ea",
  "white #ffffff": "#ffffff",
};

test("--home-status-ok text is AA (>=4.5:1) on EVERY home-light surface (re-computed, not ledger-trusted)", () => {
  const fg = hex(lightVal("--home-status-ok"));
  for (const [name, s] of Object.entries(SURFACES)) {
    const ratio = contrast(fg, hex(s));
    assert.ok(ratio >= 4.5, `--home-status-ok on ${name} = ${ratio.toFixed(2)}:1 < 4.5`);
  }
});

test("PROVEN-SENSITIVE: the old authored #10b981 FAILS on the darkest surface", () => {
  const ratio = contrast(hex("#10b981"), hex("#f0eadd"));
  assert.ok(
    ratio < 4.5,
    `expected #10b981 to FAIL AA, got ${ratio.toFixed(2)}:1 — guard is not sensitive`
  );
});

test("reused --theme-dot light passes the 3:1 graphical-dot rule on the darkest surface", () => {
  const block = css.slice(css.indexOf("html.light:not(.theme-dark-locked)"));
  const dot = block.match(/--theme-dot:\s*(#[0-9a-fA-F]{6})/)[1];
  assert.ok(contrast(hex(dot), hex("#f0eadd")) >= 3, "--theme-dot below 3:1 on cream-inner");
});
