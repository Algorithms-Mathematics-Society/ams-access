import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCandidateToken,
  setCandidateToken,
  clearCandidateToken,
  authHeaders,
} from "./candidate-auth.ts";

// Minimal localStorage stub
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  globalThis.window = {};
  globalThis.localStorage = makeLocalStorage();
  // Stub crypto.randomUUID for device-id generation in Node test environment
  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = { randomUUID: () => "test-device-uuid-1234" };
  }
});

test("setCandidateToken / getCandidateToken round-trip", () => {
  setCandidateToken("tok-abc123");
  assert.equal(getCandidateToken(), "tok-abc123");
});

test("clearCandidateToken removes the stored token", () => {
  setCandidateToken("tok-xyz");
  clearCandidateToken();
  assert.equal(getCandidateToken(), null);
});

test("authHeaders includes Bearer token when token is set", () => {
  setCandidateToken("my-jwt");
  const h = authHeaders();
  assert.equal(h["Authorization"], "Bearer my-jwt");
});

test("authHeaders omits Authorization when no token is stored", () => {
  clearCandidateToken();
  const h = authHeaders();
  assert.equal(Object.prototype.hasOwnProperty.call(h, "Authorization"), false);
});

test("authHeaders merges extra headers", () => {
  setCandidateToken("tok-merge");
  const h = authHeaders({ "X-Custom": "val" });
  assert.equal(h["Authorization"], "Bearer tok-merge");
  assert.equal(h["X-Custom"], "val");
});

test("authHeaders with extra and no token returns only extra", () => {
  clearCandidateToken();
  const h = authHeaders({ "X-Request-ID": "r1" });
  assert.equal(Object.prototype.hasOwnProperty.call(h, "Authorization"), false);
  assert.equal(h["X-Request-ID"], "r1");
});

test("authHeaders includes X-Device-Id when on the client", () => {
  // Ensure a device id is generated and present in the header map.
  const h = authHeaders();
  assert.ok(
    Object.prototype.hasOwnProperty.call(h, "X-Device-Id"),
    "X-Device-Id header must be present"
  );
  assert.ok(h["X-Device-Id"].length > 0, "X-Device-Id must be non-empty");
});

test("authHeaders X-Device-Id is stable across calls (same device)", () => {
  const h1 = authHeaders();
  const h2 = authHeaders();
  assert.equal(h1["X-Device-Id"], h2["X-Device-Id"]);
});

test("getCandidateToken returns null on SSR (no window)", () => {
  delete globalThis.window;
  assert.equal(getCandidateToken(), null);
});

test("setCandidateToken no-ops on SSR (no window)", () => {
  delete globalThis.window;
  // Should not throw
  setCandidateToken("should-not-store");
  // Restore window to verify nothing was stored
  globalThis.window = {};
  globalThis.localStorage = makeLocalStorage();
  assert.equal(getCandidateToken(), null);
});
