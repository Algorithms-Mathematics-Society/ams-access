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
import { AUTH_RECHECK_MS, onUnauthorized } from "../app/session/contest/auth-loss.ts";
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

test("every header map names the client version, signed in or not", () => {
  assert.equal(
    authHeaders()["X-AMS-Client-Version"],
    process.env.NEXT_PUBLIC_APP_VERSION ?? "2.0.0"
  );
  setToken("versioned");
  assert.ok(authHeaders()["X-AMS-Client-Version"]);
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
    hasNativeBridge: () => false,
    withTelemetryTimeout: (promise) => promise,
    setResumeStatus() {},
    setActiveNav() {},
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

test("confirmed sign-out preserves device keys and clears query caches", async () => {
  setToken("device-owner");
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, "stable-device");
  localStorage.setItem(STORAGE_KEYS.THEME, "dark");
  let cacheCleared = false;
  await homeSignOutHandler({
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

test("home sign-out invokes shared logout before bulk cleanup and still navigates when removal fails", async () => {
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
  await handlerFn();
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

test("home sign-out swallows inaccessible storage and cannot restore an old token later", async () => {
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
    await assert.doesNotReject(() => handler());
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

test("home sign-out navigates when storage enumeration throws", async () => {
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
  await assert.doesNotReject(() => handler());
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

test("native sign-out awaits revocation before deleting recovery data or navigating", async () => {
  setToken("native-owner");
  localStorage.setItem("ams_active_session", "recoverable");
  const calls = [];
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const handler = homeSignOutHandler({
    localStorage,
    logout,
    hasNativeBridge: () => true,
    setSigningOut() {},
    invoke: (command, args) => {
      assert.equal(command, "configure_event_stream");
      assert.deepEqual(args, { apiUrl: "", sessionId: null, token: null });
      calls.push("revoke");
      return pending;
    },
    setTimeout: (callback) => callback(),
    router: { push: () => calls.push("navigate") },
  });
  const signedOut = handler();
  assert.equal(currentToken(), null);
  assert.equal(localStorage.getItem("ams_active_session"), "recoverable");
  assert.deepEqual(calls, ["revoke"]);
  resolve();
  await signedOut;
  assert.equal(localStorage.getItem("ams_active_session"), null);
  assert.deepEqual(calls, ["revoke", "navigate"]);
});

test("native sign-out failure retains recovery data and reports a retry instead of success", async () => {
  setToken("native-owner");
  localStorage.setItem("ams_active_session", "recoverable");
  const calls = [];
  await homeSignOutHandler({
    localStorage,
    logout,
    hasNativeBridge: () => true,
    setSigningOut: (value) => calls.push(value),
    invoke: async () => {
      throw Error("native unavailable");
    },
    setResumeStatus: (message) => calls.push(message),
    setTimeout: () => assert.fail("must not schedule navigation"),
    router: { push: () => assert.fail("must not navigate") },
  })();
  assert.equal(currentToken(), null);
  assert.equal(localStorage.getItem("ams_active_session"), "recoverable");
  assert.deepEqual(calls.slice(0, 2), [true, false]);
  assert.match(calls[2], /Native uploads may still be active/);
});

function contestExitHandlers(context) {
  const source = readFileSync(
    new URL("../app/session/contest/client.tsx", import.meta.url),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "client.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const handlers = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ["withTimeout", "runExitTeardown", "redirectAfterRelease"].includes(node.name?.text)
    )
      handlers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(handlers.length, 3);
  const js = ts.transpileModule(handlers.map((handler) => handler.getText(ast)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    ...Object.keys(context),
    `${js}; return {runExitTeardown, redirectAfterRelease};`
  )(...Object.values(context));
}

function contestExitFixture(fail = "", browser = false, hang = "") {
  const calls = [];
  let error = null;
  const context = {
    localStorage,
    logout,
    clearQueryCache() {},
    setTimeout: (callback, delay) => setTimeout(callback, hang ? 1 : delay),
    clearTimeout,
    ACTIVE_SESSION_KEY: "ams_active_session",
    STORAGE_KEYS,
    redirectInFlightRef: { current: false },
    exitInFlightRef: { current: false },
    redirectSaveRef: {
      current: () => {
        calls.push("save");
        if (fail === "storage") throw Error("blocked");
      },
    },
    // The exit identity frame. Pushed to `calls` so the ordering assertion
    // below can prove it is taken before the camera is released -- after
    // that there is no stream left to photograph.
    exitPhotoRef: {
      current: async () => {
        calls.push("identity-photo");
      },
    },
    cameraClosedRef: { current: false },
    cameraStreamRef: { current: {} },
    cameraSession: { release: () => calls.push("camera") },
    setCameraStream() {},
    setPendingRedirect() {},
    setLoadError: (message) => {
      error = message;
    },
    setRestoreStatus() {},
    router: { replace: (path) => calls.push(`redirect:${path}`) },
    window: browser
      ? {}
      : {
          __TAURI__: {
            window: {
              getCurrentWindow: () =>
                Object.fromEntries(
                  ["setFullscreen", "setAlwaysOnTop", "setDecorations"].map((method) => [
                    method,
                    async () => {
                      calls.push(method);
                      if (hang === method) return new Promise(() => {});
                      if (fail === method) throw Error("window failed");
                    },
                  ])
                ),
            },
            core: {
              invoke: async (command, args) => {
                calls.push(command);
                if (hang === command) return new Promise(() => {});
                if (command === fail) throw Error("native failed");
                if (command === "configure_event_stream")
                  assert.deepEqual(args, {
                    apiUrl: "",
                    sessionId: null,
                    token: null,
                    preserveBinding: true,
                  });
                if (command === "get_lockdown_restore_status")
                  return { pending: fail === "pending", items: [] };
              },
            },
          },
        },
  };
  return { ...contestExitHandlers(context), calls, context, error: () => error };
}

test("auth redirect releases all native controls before navigation and retains recovery", async () => {
  setToken("expired-but-cached");
  localStorage.setItem("ams_active_session", "recoverable");
  localStorage.setItem(bufferKey("session", "question"), "draft");
  const fixture = contestExitFixture();
  await fixture.redirectAfterRelease("/login");
  assert.deepEqual(fixture.calls, [
    "save",
    "configure_event_stream",
    // Before "camera": the exit frame has to be taken while there is still
    // a stream to take it from.
    "identity-photo",
    "camera",
    "setFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "disable_network_lockdown",
    "get_lockdown_restore_status",
    "redirect:/login",
  ]);
  assert.equal(localStorage.getItem("ams_active_session"), "recoverable");
  assert.equal(localStorage.getItem(bufferKey("session", "question")), "draft");
  assert.equal(localStorage.getItem(STORAGE_KEYS.LAST_SESSION), null);
  assert.equal(fixture.context.cameraClosedRef.current, true);
  assert.equal(currentToken(), null);
});

test("every cleanup failure still tries native unlock and exposes retry without redirect", async () => {
  for (const failure of [
    "configure_event_stream",
    "setFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "get_lockdown_restore_status",
    "pending",
  ]) {
    const fixture = contestExitFixture(failure);
    await fixture.redirectAfterRelease("/login");
    assert.ok(fixture.calls.includes("unlock_desktop"), failure);
    assert.ok(!fixture.calls.includes("redirect:/login"), failure);
    assert.match(fixture.error(), /cleanup could not be confirmed/);
    assert.equal(fixture.context.redirectInFlightRef.current, false);
  }
});

test("browser redirects and blocked draft storage still release before navigating", async () => {
  for (const fixture of [contestExitFixture("", true), contestExitFixture("storage")]) {
    await fixture.redirectAfterRelease("/home");
    assert.ok(fixture.calls.includes("camera"));
    assert.equal(fixture.calls.at(-1), "redirect:/home");
  }
});

test("concurrent auth redirects run teardown once", async () => {
  const fixture = contestExitFixture();
  await Promise.all([
    fixture.redirectAfterRelease("/login"),
    fixture.redirectAfterRelease("/login"),
  ]);
  assert.equal(fixture.calls.filter((call) => call === "unlock_desktop").length, 1);
  assert.equal(fixture.calls.filter((call) => call === "redirect:/login").length, 1);
});

test("stalled native cleanup times out, attempts unlock and offers retry", async () => {
  for (const hang of [
    "configure_event_stream",
    "setFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "get_lockdown_restore_status",
  ]) {
    const fixture = contestExitFixture("", false, hang);
    await fixture.redirectAfterRelease("/login");
    assert.ok(fixture.calls.includes("unlock_desktop"), hang);
    assert.ok(!fixture.calls.includes("redirect:/login"), hang);
    assert.match(fixture.error(), /cleanup could not be confirmed/);
  }
});

test("heartbeat 401 uses the actual release handler before redirect", async () => {
  const source = readFileSync(
    new URL("../app/session/contest/client.tsx", import.meta.url),
    "utf8"
  );
  const ast = ts.createSourceFile(
    "client.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("await heartbeat(sessionId)")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect);
  const js = ts.transpileModule(`const effect = ${effect.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const fixture = contestExitFixture();
  class ProctorApiError extends Error {
    status = 401;
  }
  let released;
  const bindings = {
    sessionId: "active",
    browserOnline: true,
    ProctorApiError,
    heartbeat: async () => {
      throw new ProctorApiError();
    },
    redirectAfterRelease: (destination) => {
      released = fixture.redirectAfterRelease(destination);
      return released;
    },
    setInterval: () => 1,
    clearInterval() {},
    // The effect publishes its beat function here so the offline dialog can
    // ask for one immediately. Bound as a plain box: this test is about the
    // 401 path, not about who else can trigger a heartbeat.
    retryBeatRef: { current: () => {} },
    // A first 401 already seen long ago, so this one confirms the sign-out
    // (see auth-loss.ts); the provisional first one is covered there.
    unauthorizedAtRef: { current: 0 },
    onUnauthorized,
    AUTH_RECHECK_MS,
  };
  const cleanup = new Function(...Object.keys(bindings), `${js}; return effect();`)(
    ...Object.values(bindings)
  );
  await Promise.resolve();
  await released;
  cleanup();
  assert.equal(fixture.calls.at(-1), "redirect:/login");
  assert.ok(fixture.calls.indexOf("unlock_desktop") < fixture.calls.indexOf("redirect:/login"));
});
