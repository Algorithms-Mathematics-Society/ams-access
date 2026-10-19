import test from "node:test";
import assert from "node:assert/strict";
import { buildInitBody } from "./theme-core.ts";
import {
  DARK_LOCKED_ROUTES,
  buildDarkLockBody,
  isRouteDarkLocked,
} from "./theme-dark-lock-core.ts";
import {
  effectiveTheme,
  buildThemeBridgeBody,
  syncThemeAttributes,
  withoutThemeTransition,
} from "./theme-bridge-core.ts";

function dom(classes = []) {
  const values = new Set(classes);
  const attributes = new Map();
  return {
    values,
    attributes,
    documentElement: {
      classList: {
        add: (value) => values.add(value),
        remove: (value) => values.delete(value),
        contains: (value) => values.has(value),
      },
      setAttribute: (name, value) => attributes.set(name, value),
    },
  };
}

test("theme changes settle before restoring transitions, including rapid toggles and failures", () => {
  const previous = ["document", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]);
  const document = dom();
  const frames = new Map();
  let next = 0;
  Object.assign(globalThis, {
    document,
    requestAnimationFrame(callback) {
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  });
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  try {
    withoutThemeTransition(() => assert(document.values.has("theme-changing")));
    frame();
    assert(document.values.has("theme-changing"));
    withoutThemeTransition(() => {});
    frame();
    assert(document.values.has("theme-changing"), "An earlier toggle must not restore transitions");
    frame();
    assert(!document.values.has("theme-changing"));
    assert.throws(
      () =>
        withoutThemeTransition(() => {
          throw Error("update failed");
        }),
      /update failed/
    );
    frame();
    frame();
    assert(!document.values.has("theme-changing"), "Failed updates must restore hover transitions");
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

for (const preference of ["light", "dark"]) {
  for (const darkLocked of [true, false]) {
    test(`effective theme preserves ${preference} preference with lock=${darkLocked}`, () => {
      assert.equal(effectiveTheme(preference, darkLocked), darkLocked ? "dark" : preference);
    });
  }
}

test("pre-paint preference, route lock and Astryx bridge agree across route/storage/system matrix", () => {
  const routes = [
    "/",
    "/login/",
    "/results/",
    "/home",
    "/home/index.html",
    "/home-x/",
    "/session/contest/",
    "/session/onboarding/nested/",
  ];
  const body =
    buildInitBody("ams_theme") + buildDarkLockBody(DARK_LOCKED_ROUTES) + buildThemeBridgeBody();
  for (const stored of [null, "light", "dark", "invalid"]) {
    for (const systemLight of [true, false]) {
      for (const pathname of routes) {
        const document = dom();
        const preference = ["light", "dark"].includes(stored)
          ? stored
          : systemLight
            ? "light"
            : "dark";
        const localStorage = {
          getItem: () => stored,
          setItem: () => assert.fail("Initialization must never overwrite saved preference"),
        };
        new Function("document", "location", "localStorage", "matchMedia", body)(
          document,
          { pathname },
          localStorage,
          () => ({ matches: systemLight })
        );
        assert(
          document.values.has(preference),
          `preference lost: ${stored}/${systemLight}/${pathname}`
        );
        assert.equal(
          document.attributes.get("data-theme"),
          isRouteDarkLocked(pathname) ? "dark" : preference
        );
        assert.equal(document.attributes.get("data-astryx-theme"), "access");
      }
    }
  }
});

test("blocked storage and failed route lookup remain dark before first paint", () => {
  const document = dom();
  const body =
    buildInitBody("ams_theme") + buildDarkLockBody(DARK_LOCKED_ROUTES) + buildThemeBridgeBody();
  new Function("document", "location", "localStorage", "matchMedia", body)(
    document,
    undefined,
    {
      getItem() {
        throw Error("blocked");
      },
    },
    () => ({ matches: true })
  );
  assert(document.values.has("dark"));
  assert(document.values.has("theme-dark-locked"));
  assert.equal(document.attributes.get("data-theme"), "dark");
});

test("runtime attributes preserve preference through locked-route entry, changes and exit", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = dom(["light"]);
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  try {
    const verify = (expected) => {
      const classesBefore = [...document.values];
      syncThemeAttributes();
      assert.deepEqual(
        [...document.values],
        classesBefore,
        "Attribute bridge must not alter preference or route policy"
      );
      assert.equal(document.attributes.get("data-theme"), expected);
      assert.equal(document.attributes.get("data-astryx-theme"), "access");
    };
    verify("light");
    document.values.add("theme-dark-locked");
    verify("dark");
    document.values.delete("light");
    document.values.add("dark");
    verify("dark");
    document.values.delete("dark");
    document.values.add("light");
    verify("dark");
    document.values.delete("theme-dark-locked");
    verify("light");
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete globalThis.document;
  }
});
