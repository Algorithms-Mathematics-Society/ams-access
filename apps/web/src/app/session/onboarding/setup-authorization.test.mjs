import assert from "node:assert/strict";
import test from "node:test";
import {
  SETUP_ATTEMPT_KEY,
  setupAttemptId,
  clearSetupAttempt,
  createSetupAuthorization,
} from "./setup-authorization.ts";

const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("refresh and setup retry reuse the contest-bound nonce; exit and another contest replace it", () => {
  const saved = storage();
  assert.equal(
    setupAttemptId(saved, "c", () => first),
    first
  );
  assert.equal(
    setupAttemptId(saved, "c", () => assert.fail("must reuse")),
    first
  );
  assert.equal(
    setupAttemptId(saved, "other", () => second),
    second
  );
  clearSetupAttempt(saved);
  assert.equal(
    setupAttemptId(saved, "other", () => first),
    first
  );
});

test("malformed nonces are replaced and persistence failure prevents sending an unrepeatable attempt", () => {
  const saved = storage();
  for (const value of ["bad", "{}", JSON.stringify({ contestId: "c", id: "tampered" })]) {
    saved.setItem(SETUP_ATTEMPT_KEY, value);
    assert.equal(
      setupAttemptId(saved, "c", () => first),
      first
    );
  }
  saved.removeItem(SETUP_ATTEMPT_KEY);
  saved.setItem = () => {
    throw Error("storage unavailable");
  };
  assert.throws(() => setupAttemptId(saved, "c", () => first), /storage unavailable/);
});

test("duplicate authorization calls have one owner and failures permit only an explicit retry", async () => {
  const gate = createSetupAuthorization();
  let finish;
  let calls = 0;
  const start = () => {
    calls++;
    return new Promise((_, reject) => {
      finish = reject;
    });
  };
  const a = gate.run(start);
  const b = gate.run(start);
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(Error("unavailable"));
  await assert.rejects(a, /unavailable/);
  assert.equal(calls, 1);
  assert.equal(
    await gate.run(async () => {
      calls++;
      return "authorized";
    }),
    "authorized"
  );
  assert.equal(calls, 2);
});

import { readFileSync } from "node:fs";
import ts from "typescript";
import { authorizeSetupEntry, assertSetupAuthorization } from "./setup-authorization.ts";
import { readResumeSetup, RESUME_SETUP_KEY } from "./resume-setup.ts";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function evaluate(node, context) {
  const code = ts.transpileModule(`return (${node.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
function named(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found, `${name} must exist`);
  return found;
}
function effectIncluding(text) {
  let found;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes(text)
    )
      found = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(found);
  return found;
}
const ready = { uid: "session", contest_uid: "contest", status: "active", entry_attempt_id: first };
const approvalError = {
  status: 409,
  code: "REENTRY_APPROVAL_REQUIRED",
  detail: { session_uid: "session" },
};
function fixture({
  start = async () => ready,
  latest = async () => null,
  request,
  persistFails = false,
} = {}) {
  const calls = [];
  const saved = storage();
  const context = {
    contestId: "contest",
    dryRun: false,
    useCallback: (fn) => fn,
    setupLeavingRef: { current: false },
    authorizationEpochRef: { current: 0 },
    authorizationRef: { current: createSetupAuthorization() },
    authorizedContextRef: { current: null },
    setupAttemptRef: { current: null },
    setupGateRef: { current: { kind: "checking" } },
    approvalRequestPendingRef: { current: false },
    authState: { current: 0 },
    authGeneration: () => context.authState.current,
    setSetupGate(value) {
      context.setupGateRef.current = value;
      calls.push(value.kind);
    },
    setApprovalRequestBusy() {},
    setupAttemptId,
    authorizeSetupEntry,
    clearSetupAttempt,
    sessionStorage: saved,
    crypto: { randomUUID: () => first },
    getOrCreateDeviceId: () => "device",
    navigator: { platform: "Linux" },
    startSession: async (input) => {
      calls.push(["authorize", input]);
      return start(input);
    },
    latestResumeRequest: async (id) => {
      calls.push(["latest", id]);
      return latest(id);
    },
    requestResume: async (id, input) => {
      calls.push(["request", id, input]);
      return request?.();
    },
    localStorage: {
      setItem(key, value) {
        if (persistFails) throw Error("full");
        calls.push([key, JSON.parse(value)]);
      },
    },
    readinessErrorText: (error) => error?.message ?? "Unavailable",
  };
  return {
    context,
    calls,
    authorize: evaluate(named("authorizeSetup"), context),
    request: evaluate(named("requestSetupApproval"), context),
    gate: () => context.setupGateRef.current,
  };
}
function probes(gate) {
  const calls = [];
  const context = {
    dryRun: false,
    contestId: "contest",
    setupGate: gate,
    setupAccessReady: gate.kind === "ready",
    hasNativeBridge: () => true,
    resumeSetupRef: { current: null },
    readResumeSetup,
    RESUME_SETUP_KEY,
    getOrCreateDeviceId: () => "device",
    localStorage: {
      getItem: () =>
        JSON.stringify({
          sessionId: "session",
          contestId: "contest",
          deviceId: "device",
          cameraId: "camera",
          passedAt: Date.now(),
        }),
    },
    setCurrentStage: () => calls.push("stage1"),
    withTimeout: (promise) => promise,
    invokeStrict: async () => {
      calls.push("platform");
      return { os: "linux" };
    },
    setPlatform() {},
    setContextError() {},
  };
  evaluate(effectIncluding("readResumeSetup"), context)();
  evaluate(effectIncluding('"get_platform"'), context)();
  return calls;
}

for (const status of [null, "pending", "rejected", "expired", "consumed", "approved"]) {
  test(`${status ?? "missing"} approval GET never starts setup; explicit POST acknowledgement does`, async () => {
    const h = fixture({
      start: async () => {
        throw approvalError;
      },
      latest: async () => (status ? { uid: "request", status } : null),
    });
    await h.authorize();
    assert.equal(h.gate().kind, "approval");
    assert.deepEqual(probes(h.gate()), []);
    assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "authorize").length, 1);
    assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "latest").length, 1);
    assert.equal(
      h.calls.some((c) => Array.isArray(c) && c[0] === "request"),
      false
    );
  });
}

test("authorized first entry, approved entry and refresh retry mount checks only after matching POST echo", async () => {
  const h = fixture();
  await h.authorize();
  assert.equal(h.gate().kind, "ready");
  assert.deepEqual(probes(h.gate()), ["stage1", "platform"]);
  const initialId = h.context.setupAttemptRef.current;
  await h.authorize();
  assert.equal(h.context.setupAttemptRef.current, initialId);
  assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "latest").length, 0);
});

for (const invalid of [
  { ...ready, entry_attempt_id: undefined },
  { ...ready, entry_attempt_id: second },
  { ...ready, contest_uid: "other" },
  { ...ready, uid: "" },
  { ...ready, status: "submitted" },
]) {
  test(`old server or mismatched acknowledgement blocks checks: ${JSON.stringify(invalid)}`, async () => {
    const h = fixture({ start: async () => invalid });
    await h.authorize();
    assert.equal(h.gate().kind, "unavailable");
    assert.deepEqual(probes(h.gate()), []);
  });
}

test("a different final session cannot inherit the early authorization", () => {
  assert.throws(
    () => assertSetupAuthorization({ ...ready, uid: "other" }, "contest", first, "session"),
    /could not authorize/
  );
});

for (const error of [
  Error("offline"),
  { status: 503 },
  { status: 429 },
  { status: 409, code: "ENTRY_ATTEMPT_DEVICE_MISMATCH" },
]) {
  test(`unavailable or unrelated conflict does not request approval or mount checks: ${JSON.stringify(error)}`, async () => {
    const h = fixture({
      start: async () => {
        throw error;
      },
    });
    await h.authorize();
    assert.equal(h.gate().kind, "unavailable");
    assert.deepEqual(probes(h.gate()), []);
    assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "latest").length, 0);
  });
}

test("pending status read failure fails closed and dry-run rehearsal makes no authorization request", async () => {
  const h = fixture({
    start: async () => {
      throw approvalError;
    },
    latest: async () => {
      throw Error("offline");
    },
  });
  await h.authorize();
  assert.equal(h.gate().kind, "unavailable");
  assert.deepEqual(probes(h.gate()), []);
  h.context.dryRun = true;
  await evaluate(named("authorizeSetup"), h.context)();
  assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "authorize").length, 1);
});

for (const boundary of ["exit", "unmount", "auth"]) {
  test(`late authorization after ${boundary} cannot publish readiness or recovery`, async () => {
    let finish;
    const h = fixture({
      start: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = h.authorize();
    await Promise.resolve();
    if (boundary === "exit") h.context.setupLeavingRef.current = true;
    if (boundary === "unmount") h.context.authorizationEpochRef.current++;
    if (boundary === "auth") h.context.authState.current++;
    finish(ready);
    await pending;
    assert.equal(h.gate().kind, "checking");
    assert.equal(
      h.calls.some((c) => Array.isArray(c) && c[0] === "ams_active_session"),
      false
    );
  });
}

test("explicit approval requests are single-flight and accepted even when optional persistence fails", async () => {
  let finish;
  const h = fixture({
    persistFails: true,
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  h.context.setupGateRef.current = { kind: "approval", sessionId: "session", request: null };
  const a = h.request();
  await h.request();
  assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "request").length, 1);
  finish({ uid: "request", status: "pending" });
  await a;
  assert.equal(h.gate().kind, "approval");
  assert.equal(h.gate().request.status, "pending");
  assert.deepEqual(probes(h.gate()), []);
});

test("failed nonce removal cannot reuse an old authorized nonce on the next entry", () => {
  const saved = storage();
  setupAttemptId(saved, "contest", () => first);
  saved.removeItem = () => {
    throw Error("denied");
  };
  assert.throws(() => clearSetupAttempt(saved), /denied/);
  assert.equal(
    setupAttemptId(saved, "contest", () => second),
    second
  );
});

test("manual approval status checks never consume or start setup, even when approval arrives", async () => {
  let finish;
  const h = fixture({
    latest: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  h.context.setupGateRef.current = {
    kind: "approval",
    sessionId: "session",
    request: { status: "pending" },
  };
  const refresh = evaluate(named("refreshSetupApproval"), h.context);
  const pending = refresh();
  await refresh();
  assert.equal(h.calls.filter((c) => Array.isArray(c) && c[0] === "latest").length, 1);
  finish({ uid: "request", status: "approved" });
  await pending;
  assert.equal(h.gate().request.status, "approved");
  assert.deepEqual(probes(h.gate()), []);
  assert.equal(
    h.calls.some((c) => Array.isArray(c) && c[0] === "authorize"),
    false
  );
  await h.authorize();
  assert.equal(h.gate().kind, "ready");
  assert.deepEqual(probes(h.gate()), ["stage1", "platform"]);
});
