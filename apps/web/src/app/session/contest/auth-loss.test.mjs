import test from "node:test";
import assert from "node:assert/strict";

import { AUTH_RECHECK_MS, onUnauthorized } from "./auth-loss.ts";

test("the first 401 is provisional", () => {
  assert.deepEqual(onUnauthorized(null, 1000), { firstAt: 1000, signedOut: false });
});

test("a second 401 too soon after the first does not sign out", () => {
  const step = onUnauthorized(1000, 1000 + AUTH_RECHECK_MS - 1);
  assert.deepEqual(step, { firstAt: 1000, signedOut: false });
});

test("a second 401 after the recheck pause confirms the sign-out", () => {
  assert.equal(onUnauthorized(1000, 1000 + AUTH_RECHECK_MS).signedOut, true);
});
