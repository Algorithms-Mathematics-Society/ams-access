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

// Alpha-composite a semi-transparent fg over an opaque bg (per channel: out = a*fg + (1-a)*bg).
const composite = (fg, alpha, bg) => fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));

// Read a token's raw light value (hex or rgba) from the html.light:not(.theme-dark-locked) block.
const lightValRaw = (token) => {
  const block = css.slice(css.indexOf("html.light:not(.theme-dark-locked)"));
  const m = block.match(new RegExp(token + ":\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]+\\))"));
  if (!m) throw new Error(`light value for ${token} not found`);
  return m[1];
};

// Read a token's raw dark value (hex or rgba) from the .dark, html.theme-dark-locked block.
const darkValRaw = (token) => {
  const block = css.slice(css.indexOf(".dark,\nhtml.theme-dark-locked"));
  const m = block.match(new RegExp(token + ":\\s*(#[0-9a-fA-F]{6}|rgba?\\([^)]+\\))"));
  if (!m) throw new Error(`dark value for ${token} not found`);
  return m[1];
};

// Parse a raw hex or rgba(...) value to [r,g,b]; composite over bg if alpha < 1.
const parseColor = (raw, bg) => {
  if (raw.startsWith("#")) return hex(raw);
  const m = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) throw new Error(`cannot parse color: ${raw}`);
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  return a < 1 ? composite([r, g, b], a, bg) : [r, g, b];
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

// Darkest home cream (worst-case surface for readable text tokens).
const DARKEST = hex("#f0eadd");

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

// ── 3a readable tokens: all must clear AA (≥4.5:1) on the darkest home cream #f0eadd ──────────

test("--home-status-ok is AA (>=4.5:1) on darkest home cream #f0eadd", () => {
  const fg = parseColor(lightValRaw("--home-status-ok"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--home-status-ok on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--home-status-error is AA (>=4.5:1) on darkest home cream #f0eadd", () => {
  const fg = parseColor(lightValRaw("--home-status-error"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--home-status-error on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--theme-error-text is AA (>=4.5:1) on darkest home cream #f0eadd", () => {
  const fg = parseColor(lightValRaw("--theme-error-text"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--theme-error-text on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--home-status-warn is AA (>=4.5:1) on darkest home cream #f0eadd", () => {
  const fg = parseColor(lightValRaw("--home-status-warn"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--home-status-warn on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--theme-accent-text is AA (>=4.5:1) on darkest home cream #f0eadd", () => {
  const fg = parseColor(lightValRaw("--theme-accent-text"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--theme-accent-text on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--text-dim composited over #f0eadd is AA (>=4.5:1) — alpha-composite ink over darkest cream", () => {
  const fg = parseColor(lightValRaw("--text-dim"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--text-dim composited on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--theme-text-muted composited over #f0eadd is AA (>=4.5:1)", () => {
  const fg = parseColor(lightValRaw("--theme-text-muted"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(ratio >= 4.5, `--theme-text-muted composited on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`);
});

test("--theme-text-muted-strong composited over #f0eadd is AA (>=4.5:1)", () => {
  const fg = parseColor(lightValRaw("--theme-text-muted-strong"), DARKEST);
  const ratio = contrast(fg, DARKEST);
  assert.ok(
    ratio >= 4.5,
    `--theme-text-muted-strong composited on #f0eadd = ${ratio.toFixed(2)}:1 < 4.5`
  );
});

// ── PROVEN-SENSITIVE: pre-fold shades that must FAIL AA on #f0eadd ───────────────────────────

test("PROVEN-SENSITIVE: old warn shade #b45309 FAILS AA on #f0eadd (~4.20)", () => {
  const ratio = contrast(hex("#b45309"), DARKEST);
  assert.ok(
    ratio < 4.5,
    `expected #b45309 to FAIL AA on #f0eadd, got ${ratio.toFixed(2)}:1 — contrast math or compositing is wrong`
  );
});

test("PROVEN-SENSITIVE: old success shade #4ade80 FAILS AA on #f0eadd", () => {
  const ratio = contrast(hex("#4ade80"), DARKEST);
  assert.ok(
    ratio < 4.5,
    `expected #4ade80 to FAIL AA on #f0eadd, got ${ratio.toFixed(2)}:1 — contrast math or compositing is wrong`
  );
});

// ── 3a-neutral: new neutral/surface tokens — dark EXACT, light black-alpha (direction) ──
const NEUTRAL_TOKENS = {
  "--home-overlay-faintest": { dark: "rgba(255,255,255,0.02)", lightMaxChannel: 0 },
  "--home-overlay-rail": { dark: "rgba(255,255,255,0.24)", lightMaxChannel: 0 },
  "--home-border-control": { dark: "#3f3f46", lightMaxChannel: 90 },
  "--home-border-hover": { dark: "#52525b", lightMaxChannel: 90 },
};
function normHex(s) {
  return s.replace(/\s+/g, "").toLowerCase();
}
function maxChannel(rgbaStr) {
  const m = rgbaStr.match(/rgba?\(([^)]+)\)/i);
  if (!m) {
    const h = normHex(rgbaStr).replace("#", "");
    return Math.max(
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    );
  }
  const [r, g, b] = m[1].split(",").map((x) => parseInt(x, 10));
  return Math.max(r, g, b);
}
for (const [tok, exp] of Object.entries(NEUTRAL_TOKENS)) {
  test(`3a-neutral: ${tok} dark == ledger literal (EXACT)`, () => {
    assert.equal(normHex(darkValRaw(tok)).replace(/,/g, ""), normHex(exp.dark).replace(/,/g, ""));
  });
  test(`3a-neutral: ${tok} light facet is BLACK-alpha / dark-on-cream (never white-alpha)`, () => {
    const mc = maxChannel(lightValRaw(tok));
    assert.ok(
      mc <= exp.lightMaxChannel + 1,
      `${tok} light max channel ${mc} — must be dark ink, not white-alpha`
    );
  });
}
test("3a-neutral PROVEN-SENSITIVE: a white-alpha light facet FAILS the direction check", () => {
  assert.ok(
    maxChannel("rgba(255,255,255,0.24)") > 90,
    "direction check is insensitive — would pass white-alpha"
  );
});
