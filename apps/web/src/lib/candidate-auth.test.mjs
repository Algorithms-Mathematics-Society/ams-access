// Authenticated request headers.
//
// The previous version of this file passed while testing a storage key
// nothing wrote. `candidate-auth` kept its own token under
// `ams_candidate_token`; the slip login writes `ams_participant_token`. So
// every `authHeaders()` call went out with no `Authorization`, every
// authenticated route answered 401, and the suite was green throughout.
//
// These tests therefore assert against the key the login actually writes, and
// go through `proctor-api` — the token's single owner — rather than a private
// copy.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { authHeaders, participantToken } from "./candidate-auth.ts";
import { setToken } from "./proctor-api.ts";

const TOKEN_KEY = "ams_participant_token";

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
  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = { randomUUID: () => "test-device-uuid-1234" };
  }
  // Clear the module-scope token between tests; it outlives localStorage.
  setToken(null);
});

test("a token set by the login is visible to authHeaders", () => {
  setToken("slip-token");
  assert.equal(participantToken(), "slip-token");
  assert.equal(authHeaders()["Authorization"], "Bearer slip-token");
});

test("the token is read from the key the login actually writes", () => {
  // The regression this file exists for. A token present in storage under
  // the participant key must be picked up even with cold module state — a
  // hard reload of a deep route is exactly the crash case resume covers.
  localStorage.setItem(TOKEN_KEY, "restored-from-storage");
  assert.equal(participantToken(), "restored-from-storage");
  assert.equal(authHeaders()["Authorization"], "Bearer restored-from-storage");
});

test("no Authorization when nobody is signed in", () => {
  const headers = authHeaders();
  assert.equal(Object.prototype.hasOwnProperty.call(headers, "Authorization"), false);
});

test("signing out drops the Authorization header", () => {
  setToken("temporary");
  setToken(null);
  assert.equal(Object.prototype.hasOwnProperty.call(authHeaders(), "Authorization"), false);
});

test("an expired stored token is not used", () => {
  localStorage.setItem(TOKEN_KEY, "stale");
  localStorage.setItem("ams_participant_token_expires_at", String(Date.now() - 1000));
  assert.equal(participantToken(), null);
});

test("a stored token with no recorded expiry is still used", () => {
  // The server is the authority and answers 401 if it disagrees. Discarding
  // it here would force a re-login for a token that still works.
  localStorage.setItem(TOKEN_KEY, "no-expiry-recorded");
  assert.equal(participantToken(), "no-expiry-recorded");
});

test("X-Device-Id is always present and stable", () => {
  const first = authHeaders();
  const second = authHeaders();
  assert.ok(first["X-Device-Id"].length > 0);
  assert.equal(first["X-Device-Id"], second["X-Device-Id"]);
});

test("extra headers merge, and win", () => {
  setToken("tok");
  const headers = authHeaders({ "X-Custom": "val", "X-Device-Id": "override" });
  assert.equal(headers["Authorization"], "Bearer tok");
  assert.equal(headers["X-Custom"], "val");
  assert.equal(headers["X-Device-Id"], "override");
});

test("nothing is emitted, and nothing throws, during SSR", () => {
  delete globalThis.window;
  assert.equal(participantToken(), null);
  const headers = authHeaders();
  assert.equal(Object.prototype.hasOwnProperty.call(headers, "Authorization"), false);
  assert.equal(headers["X-Device-Id"], undefined);
});
