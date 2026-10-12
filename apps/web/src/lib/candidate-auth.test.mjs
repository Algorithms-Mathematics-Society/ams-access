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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { authHeaders, participantToken } from "./candidate-auth.ts";
import { STORAGE_KEYS } from "../constants/storage-keys.ts";
import { bufferKey, isBufferKey } from "../app/session/contest/answer-buffer.ts";
import {
  currentToken,
  hasToken,
  listContests,
  logout,
  restoreToken,
  setToken,
} from "./proctor-api.ts";

const TOKEN_KEY = "ams_participant_token";
const EXPIRY_KEY = "ams_participant_token_expires_at";
const require = createRequire(import.meta.url);
const ts = require("typescript");

function makeLocalStorage() {
  const store = Object.create(null);
  Object.defineProperties(store, {
    getItem: {
      value(k) {
        return this[k] ?? null;
      },
      writable: true,
    },
    setItem: {
      value(k, v) {
        this[k] = String(v);
      },
    },
    removeItem: {
      value(k) {
        delete this[k];
      },
      writable: true,
    },
    clear: {
      value() {
        for (const key of Object.keys(this)) delete this[key];
      },
    },
  });
  return store;
}

beforeEach(() => {
  globalThis.window = {};
  globalThis.localStorage = makeLocalStorage();
  if (typeof globalThis.crypto === "undefined") {
    globalThis.crypto = { randomUUID: () => "test-device-uuid-1234" };
  }
  // A new sign-in clears a prior test's explicit logout guard.
  setToken("test-reset");
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

test("canonical logout drops the live token, expiry, headers and request bearer", async () => {
  setToken("temporary", 3600);
  assert.equal(hasToken(), true);
  assert.ok(localStorage.getItem(EXPIRY_KEY));
  logout();
  assert.equal(localStorage.getItem(TOKEN_KEY), null);
  assert.equal(localStorage.getItem(EXPIRY_KEY), null);
  assert.equal(currentToken(), null);
  assert.equal(hasToken(), false);
  assert.equal(participantToken(), null);
  assert.equal("Authorization" in authHeaders(), false);
  assert.equal(restoreToken(), false);

  const originalFetch = globalThis.fetch;
  let headers;
  globalThis.fetch = async (_url, options) => {
    headers = options.headers;
    return { ok: true, text: async () => "{}" };
  };
  try {
    await listContests();
    assert.equal("Authorization" in headers, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed token removal cannot resurrect a signed-out token", () => {
  setToken("stuck", 3600);
  localStorage.removeItem = () => {
    throw Error("blocked removal");
  };
  logout();
  assert.equal(localStorage.getItem(TOKEN_KEY), "stuck");
  assert.equal(currentToken(), null);
  assert.equal(restoreToken(), false);
  assert.equal(hasToken(), false);
  assert.equal("Authorization" in authHeaders(), false);
  setToken(null); // Clearing test state is not a new login.
  assert.equal(currentToken(), null);
  setToken("fresh");
  assert.equal(authHeaders().Authorization, "Bearer fresh");
});

test("storage read failures return no token without throwing", () => {
  localStorage.setItem(TOKEN_KEY, "unreadable");
  localStorage.getItem = () => {
    throw Error("blocked read");
  };
  assert.equal(restoreToken(), false);
  assert.equal(currentToken(), null);
  assert.equal(participantToken(), null);
  logout();
  assert.equal(currentToken(), null);
  localStorage.getItem = function (key) {
    return this[key] ?? null;
  };
  assert.equal(restoreToken(), false);
  assert.equal(currentToken(), null);
});

test("a fresh module restores a persisted token on cold load", async () => {
  localStorage.setItem(TOKEN_KEY, "cold-token");
  window.location = { protocol: "tauri:", hostname: "localhost", port: "" };
  const cold = await import(`./proctor-api.ts?cold=${Date.now()}`);
  assert.equal(cold.restoreToken(), true);
  assert.equal(cold.currentToken(), "cold-token");
});

function homeSignOutHandler(context, name = "signOut") {
  const source = readFileSync(new URL("../app/home/page.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const imported = ast.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === "@/lib/proctor-api" &&
      node.importClause?.namedBindings?.elements?.some((element) => element.name.text === "logout")
  );
  assert.ok(imported, "Home must import the canonical logout");
  const home = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "HomePage"
  );
  const handler = home?.body?.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  assert.ok(handler, "Home must wire the real sign-out handler");
  assert.ok(source.includes("onSignOut={handleSignOut}"));
  const js = ts.transpileModule(handler.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const bindings = {
    setConfirmDiscardOpen() {},
    clearQueryCache() {},
    DEVICE_SCOPED_KEYS: new Set([STORAGE_KEYS.DEVICE_ID, STORAGE_KEYS.THEME]),
    isBufferKey,
    ...context,
  };
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(
    ...Object.values(bindings)
  );
}

test("home sign-out preserves draft confirmation before credential teardown", () => {
  setToken("draft-owner");
  const key = bufferKey("session", "question");
  localStorage.setItem(key, "sole draft");
  let confirmed = false;
  let signedOut = false;
  const handler = homeSignOutHandler(
    {
      localStorage,
      setConfirmDiscardOpen: (value) => {
        confirmed = value;
      },
      signOut: () => {
        signedOut = true;
      },
    },
    "handleSignOut"
  );
  handler();
  assert.equal(confirmed, true);
  assert.equal(signedOut, false);
  assert.equal(currentToken(), "draft-owner");
  assert.equal(localStorage.getItem(key), "sole draft");
});

test("confirmed sign-out preserves device keys and clears query caches", () => {
  setToken("device-owner");
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, "stable-device");
  localStorage.setItem(STORAGE_KEYS.THEME, "dark");
  let cacheCleared = false;
  homeSignOutHandler({
    localStorage,
    logout,
    clearQueryCache: () => {
      cacheCleared = true;
    },
    setSigningOut() {},
    setTimeout: (callback) => callback(),
    router: { push() {} },
  })();
  assert.equal(cacheCleared, true);
  assert.equal(currentToken(), null);
  assert.equal(localStorage.getItem(STORAGE_KEYS.DEVICE_ID), "stable-device");
  assert.equal(localStorage.getItem(STORAGE_KEYS.THEME), "dark");
});

test("home sign-out invokes shared logout before bulk cleanup and still navigates when removal fails", () => {
  const calls = [];
  const router = { push: (path) => calls.push(`push:${path}`) };
  const setTimeout = (callback, delay) => {
    assert.equal(delay, 600);
    callback();
  };
  setToken("home-token", 3600);
  localStorage.setItem("ams_draft", "draft");
  localStorage.setItem("unrelated", "keep");
  const removeItem = localStorage.removeItem;
  localStorage.removeItem = function (key) {
    calls.push(`remove:${key}`);
    if (key === "ams_draft") throw Error("blocked draft removal");
    return removeItem.call(this, key);
  };
  const handlerFn = homeSignOutHandler({
    setSigningOut: (value) => calls.push(`signingOut:${value}`),
    logout: () => {
      calls.push("logout");
      logout();
    },
    localStorage,
    setTimeout,
    router,
  });
  handlerFn();
  assert.deepEqual(calls.slice(0, 2), ["signingOut:true", "logout"]);
  assert.ok(calls.indexOf("remove:ams_draft") > calls.indexOf("logout"));
  assert.equal(calls.at(-1), "push:/");
  assert.equal(currentToken(), null);
  assert.equal(hasToken(), false);
  assert.equal("Authorization" in authHeaders(), false);
  assert.equal(restoreToken(), false);
  assert.equal(localStorage.getItem(TOKEN_KEY), null);
  assert.equal(localStorage.getItem(EXPIRY_KEY), null);
  assert.equal(localStorage.getItem("ams_draft"), "draft");
  assert.equal(localStorage.getItem("unrelated"), "keep");
});

test("home sign-out swallows inaccessible storage and cannot restore an old token later", () => {
  const store = localStorage;
  setToken("still-persisted", 3600);
  const calls = [];
  const handler = homeSignOutHandler({
    setSigningOut: (value) => calls.push(`signingOut:${value}`),
    logout: () => {
      calls.push("logout");
      logout();
    },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 600);
      callback();
    },
    router: { push: (path) => calls.push(`push:${path}`) },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw Error("storage denied");
    },
  });
  try {
    assert.doesNotThrow(() => handler());
    assert.deepEqual(calls, ["signingOut:true", "logout", "push:/"]);
    assert.equal(currentToken(), null);
    assert.equal(hasToken(), false);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: store,
    });
  }
  assert.equal(store.getItem(TOKEN_KEY), "still-persisted");
  assert.equal(restoreToken(), false);
  assert.equal(currentToken(), null);
  assert.equal("Authorization" in authHeaders(), false);
});

test("home sign-out navigates when storage enumeration throws", () => {
  setToken("enumeration-token");
  const calls = [];
  const blocked = new Proxy(localStorage, {
    ownKeys() {
      throw Error("enumeration denied");
    },
  });
  const handler = homeSignOutHandler({
    setSigningOut: () => calls.push("signingOut"),
    logout: () => {
      calls.push("logout");
      logout();
    },
    localStorage: blocked,
    setTimeout: (callback) => callback(),
    router: { push: (path) => calls.push(`push:${path}`) },
  });
  assert.doesNotThrow(() => handler());
  assert.deepEqual(calls, ["signingOut", "logout", "push:/"]);
  assert.equal(currentToken(), null);
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
