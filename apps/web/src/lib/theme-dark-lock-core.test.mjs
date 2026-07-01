import test from "node:test";
import assert from "node:assert/strict";
import {
  DARK_LOCKED_ROUTES,
  normalizePath,
  isRouteDarkLocked,
  buildDarkLockBody,
} from "./theme-dark-lock-core.ts";

test("normalizePath: strips index.html then trailing slash; keeps root", () => {
  assert.equal(normalizePath("/home/"), "/home");
  assert.equal(normalizePath("/home"), "/home");
  assert.equal(normalizePath("/home/index.html"), "/home");
  assert.equal(normalizePath("/session/contest/"), "/session/contest");
  assert.equal(normalizePath("/"), "/");
  assert.equal(normalizePath(""), "/");
});

const LOCKED = ["/home/", "/home", "/home/index.html", "/session/contest/", "/session/onboarding/"];
const UNLOCKED = ["/", "/login/", "/results/", "/home-x/", "/session/"];

test("isRouteDarkLocked: verified matrix", () => {
  for (const p of LOCKED) assert.equal(isRouteDarkLocked(p), true, `locked: ${p}`);
  for (const p of UNLOCKED) assert.equal(isRouteDarkLocked(p), false, `unlocked: ${p}`);
});

// PARITY: the inline pre-paint body must decide identically to isRouteDarkLocked.
test("buildDarkLockBody ↔ isRouteDarkLocked parity across the matrix", () => {
  const body = buildDarkLockBody(DARK_LOCKED_ROUTES);
  for (const p of [...LOCKED, ...UNLOCKED]) {
    const added = [];
    const document = { documentElement: { classList: { add: (c) => added.push(c) } } };
    const location = { pathname: p };
    new Function("document", "location", body)(document, location);
    assert.equal(
      added.includes("theme-dark-locked"),
      isRouteDarkLocked(p),
      `parity mismatch at ${p}`
    );
  }
});

test("buildDarkLockBody fails closed (locks) on error", () => {
  const body = buildDarkLockBody(DARK_LOCKED_ROUTES);
  const added = [];
  const document = { documentElement: { classList: { add: (c) => added.push(c) } } };
  // location getter throws → catch must add the lock
  new Function("document", "location", body)(document, undefined);
  assert.ok(added.includes("theme-dark-locked"));
});
