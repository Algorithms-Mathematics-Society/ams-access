import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { STORAGE_KEYS } from "../../constants/storage-keys.ts";

const loginSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const loginStart = loginSource.indexOf("  async function handleSubmit(");
const loginEnd = loginSource.indexOf("\n  // Frame budget", loginStart);
const homeSource = readFileSync(new URL("../home/page.tsx", import.meta.url), "utf8");
const homeStart = homeSource.lastIndexOf(
  "  useEffect(() => {",
  homeSource.indexOf("    // The token outlives the page:")
);
const homeEnd = homeSource.indexOf("\n  }, []);", homeStart) + "\n  }, []);".length;
assert.ok(loginStart >= 0 && loginEnd > loginStart && homeStart >= 0 && homeEnd > homeStart);
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
const loginCode = compile(loginSource.slice(loginStart, loginEnd));
const homeCode = compile(homeSource.slice(homeStart, homeEnd));
const TOKEN = "ams_participant_token",
  EXPIRY = "ams_participant_token_expires_at";
let moduleId = 0;

async function setup(t, { expiry = Date.now() + 3600000, failedKey = "all" } = {}) {
  const saved = new Map([
    [TOKEN, "candidate-A"],
    [EXPIRY, String(expiry)],
    [STORAGE_KEYS.DISPLAY_NAME, "Candidate A"],
  ]);
  const store = {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      if (failedKey === "all" || key === failedKey)
        throw new DOMException("Storage full", "QuotaExceededError");
      saved.set(key, String(value));
    },
    removeItem: (key) => saved.delete(key),
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: store });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, headers: init.headers });
    return new Response(
      JSON.stringify(
        String(url).endsWith("/participant/login")
          ? {
              token: "candidate-B",
              expires_in: 3600,
              server_time: new Date().toISOString(),
              user: { display_name: "Candidate B" },
              contest: { uid: "contest-B", title: "B" },
            }
          : []
      ),
      { status: 200 }
    );
  });
  // Use the real token owner, login transport and authenticated GET, not auth stubs.
  const api = await import(`../../lib/proctor-api.ts?loginIdentity=${++moduleId}`);
  const routes = [],
    errors = [];
  const context = {
    ...api,
    STORAGE_KEYS,
    localStorage: store,
    loginId: "candidate-B",
    password: "password",
    loading: false,
    loginInFlightRef: { current: false },
    performance,
    cooldownUntil: { current: 0 },
    setCooldownSeconds() {},
    setError: (value) => errors.push(value),
    setDiagnostic() {},
    setServiceFailure() {},
    setInvalidField() {},
    setLoading() {},
    router: { push: (path) => routes.push(path) },
    useEffect: (effect) => effect(),
    setDisplayName() {},
    setIdentityHydrated() {},
    setActiveSession() {},
    setResumeVerification() {},
    setResumeStatus() {},
    ACTIVE_SESSION_KEY: STORAGE_KEYS.ACTIVE_SESSION,
    scanGenerationRef: { current: 0 },
  };
  vm.runInNewContext(loginCode, context);
  return {
    api,
    saved,
    store,
    requests,
    routes,
    errors,
    signIn: () => context.handleSubmit({ preventDefault() {}, currentTarget: {} }),
    hydrateHome: () => vm.runInNewContext(homeCode, context),
  };
}

for (const expiry of [Date.now() + 3600000, Date.now() - 3600000]) {
  test(`Home retains real login identity when all writes fail and stored expiry is ${expiry > Date.now() ? "future" : "past"}`, async (t) => {
    const h = await setup(t, { expiry });
    await h.signIn();
    assert.deepEqual(h.routes, ["/home"]);
    assert.equal(h.errors.at(-1), null);
    // The failed persistence may leave either an older valid token or no token
    // (the expired token is removed by the login request's lazy restore).
    assert.equal(h.api.currentToken(), "candidate-B");
    h.hydrateHome();
    h.hydrateHome();
    assert.equal(h.api.currentToken(), "candidate-B");
    await h.api.listContests();
    assert.equal(h.requests.at(-1).headers.Authorization, "Bearer candidate-B");
  });
}

test("failed expiry write cannot invalidate the fresh token using an old expiry", async (t) => {
  const h = await setup(t, { failedKey: EXPIRY });
  await h.signIn();
  h.saved.set(EXPIRY, String(Date.now() - 1000));
  h.hydrateHome();
  assert.equal(h.api.currentToken(), "candidate-B");
  await h.api.listContests();
  assert.equal(h.requests.at(-1).headers.Authorization, "Bearer candidate-B");
});

test("cold Home restores persisted identity when no live token exists", async (t) => {
  const h = await setup(t);
  h.hydrateHome();
  assert.equal(h.api.currentToken(), "candidate-A");
  await h.api.listContests();
  assert.equal(h.requests.at(-1).headers.Authorization, "Bearer candidate-A");
});

test("logout still prevents stale stored credentials from being restored", async (t) => {
  const h = await setup(t);
  await h.signIn();
  h.store.removeItem = () => {
    throw new Error("Removal blocked");
  };
  h.api.logout();
  h.hydrateHome();
  assert.equal(h.api.restoreToken(), false);
  assert.equal(h.api.currentToken(), null);
  await h.api.listContests();
  assert.equal(h.requests.at(-1).headers.Authorization, undefined);
});
