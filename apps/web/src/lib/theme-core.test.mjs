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
