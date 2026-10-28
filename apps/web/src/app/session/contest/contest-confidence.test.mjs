import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionDraftAssurance,
  draftStatus,
  sameSource,
  submissionComparison,
  requestFinish,
} from "./contest-confidence.ts";
const current = { source: "answer", language: "cpp" };

test("connection reassurance confirms only a successful local save, without promising upload", () => {
  const message = connectionDraftAssurance(true);
  assert.match(message, /draft is saved on this device/i);
  assert.match(message, /trying to reconnect/i);
  assert.match(message, /submit your solution.*before the contest ends/i);
  assert.doesNotMatch(message, /automatically.*(sync|upload)|synced|saved.*server/i);
});

test("connection reassurance warns when any local draft write failed", () => {
  const message = connectionDraftAssurance(false);
  assert.match(message, /could not be saved on this device/i);
  assert.match(message, /keep this app open/i);
  assert.doesNotMatch(message, /draft is saved|will be synced|will be uploaded/i);
});
// Drafts no longer go to the server, so there is no in-flight or failed state
// to describe: the write is a synchronous localStorage put on every change.
// What the label must not do is imply a server copy exists.
test("the draft label describes the device, never a server copy", () => {
  const status = draftStatus();
  assert.equal(status.confirmed, true);
  assert.match(status.label, /device/i);
  assert.doesNotMatch(status.label, /server/i);
});
test("source comparison still distinguishes a language change", () => {
  assert.equal(sameSource({ ...current, language: "python" }, current), false);
  assert.equal(sameSource(current, current), true);
});
test("historical submissions with no source do not claim draft equivalence", () => {
  assert.equal(submissionComparison(current), "");
  assert.equal(submissionComparison(current, current), "Current code matches");
  assert.match(submissionComparison({ ...current, source: "edit" }, current), /changed/);
  assert.match(submissionComparison({ ...current, language: "python" }, current), /changed/);
});
test("finish acknowledgement never covers a failed draft save", async () => {
  assert.deepEqual(
    await requestFinish({
      save: async () => false,
      finish: async () => ({ ok: true, json: async () => ({}) }),
      wait: async () => {},
    }),
    { confirmed: true, draftSaved: false }
  );
});
test("already submitted acknowledgement is distinct from contest deadline", async () => {
  for (const code of ["SESSION_ALREADY_SUBMITTED", "CONTEST_ENDED"]) {
    const result = await requestFinish({
      save: async () => false,
      finish: async () => ({ ok: false, json: async () => ({ code }) }),
      wait: async () => {},
    });
    assert.equal(result.confirmed, code === "SESSION_ALREADY_SUBMITTED");
  }
});
test("network failures stop after four attempts; no background retry promise", async () => {
  let saves = 0,
    finishes = 0,
    waits = 0;
  const result = await requestFinish({
    save: async () => {
      saves++;
      throw Error("offline");
    },
    finish: async () => {
      finishes++;
      throw Error("offline");
    },
    wait: async () => {
      waits++;
    },
  });
  assert.deepEqual(result, { confirmed: false, draftSaved: false });
  assert.deepEqual([saves, finishes, waits], [4, 4, 3]);
});
test("retry can recover both draft and finish acknowledgement", async () => {
  let n = 0;
  assert.deepEqual(
    await requestFinish({
      save: async () => n > 0,
      finish: async () => ({ ok: ++n === 2, json: async () => ({}) }),
      wait: async () => {},
    }),
    { confirmed: true, draftSaved: true }
  );
});

test("a lost finish response cannot erase an already confirmed final draft save", async () => {
  let n = 0;
  const result = await requestFinish({
    save: async () => n === 0,
    finish: async () => {
      if (n++ === 0) throw Error("lost response");
      return { ok: false, json: async () => ({ code: "SESSION_ALREADY_SUBMITTED" }) };
    },
    wait: async () => {},
  });
  assert.deepEqual(result, { confirmed: true, draftSaved: true });
});

// Exercise the actual component handler, including its synchronous guards and
// recovery/teardown decision, with deterministic transport and storage.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");
const clientSource = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const clientAst = ts.createSourceFile(
  "client.tsx",
  clientSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let finishHandler;
function visitFinish(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "handleSubmitConfirmed")
    finishHandler = node;
  ts.forEachChild(node, visitFinish);
}
visitFinish(clientAst);
assert.ok(finishHandler);
const finishJs = ts.transpileModule(finishHandler.getText(clientAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function finishHarness({
  pending = false,
  finish = async () => ({ ok: true, json: async () => ({}) }),
  withTimeout = (promise) => promise,
} = {}) {
  const signals = [];
  const state = {
    active: "session-1",
    last: null,
    phase: "idle",
    error: null,
    calls: 0,
    releases: 0,
  };
  const exitInFlightRef = { current: false };
  const leavingWorkspaceRef = { current: false };
  const submitInFlightRef = { current: pending };
  const deps = {
    exitInFlightRef,
    leavingWorkspaceRef,
    submitInFlightRef,
    sessionId: "session-1",
    API_URL: "https://fixture.invalid",
    setSubmitConfirm() {},
    setShowSupportModal() {},
    setSubmitWarning() {},
    setFinalDraftSaved() {},
    setSubmitError(value) {
      state.error = value;
    },
    setTimeUpState(value) {
      state.phase = value;
    },
    unsavedOnDeviceRef: { current: [] },
    handleSave: async () => true,
    authHeaders: () => ({}),
    requestFinish,
    withTimeout,
    setTimeout: (callback) => callback(),
    postJsonKeepalive: async (_url, _body, init) => {
      state.calls++;
      signals.push(init.signal);
      return finish();
    },
    runExitTeardown: async (preserve) => {
      state.releases++;
      if (!preserve) {
        state.last = state.active;
        state.active = null;
      }
    },
  };
  return {
    state,
    signals,
    exitInFlightRef,
    leavingWorkspaceRef,
    submitInFlightRef,
    run: new Function(...Object.keys(deps), `${finishJs}; return handleSubmitConfirmed;`)(
      ...Object.values(deps)
    ),
  };
}
test("finish cannot close a session while the solution POST is unresolved", async () => {
  const h = finishHarness({ pending: true });
  await h.run();
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.releases, 0);
  assert.equal(h.exitInFlightRef.current, false);
  assert.match(h.state.error, /submission.*finish/i);
  h.submitInFlightRef.current = false; // Accepted; judging can still be pending.
  await h.run();
  assert.equal(h.state.phase, "submitted");
  assert.equal(h.state.calls, 1);
});
test("failed finish releases controls, preserves recovery, and allows a bounded explicit retry", async () => {
  let offline = true;
  const h = finishHarness({
    finish: async () => {
      if (offline) throw Error("offline");
      return { ok: true, json: async () => ({}) };
    },
  });
  await h.run();
  assert.deepEqual(h.state, {
    active: "session-1",
    last: null,
    phase: "error",
    error: null,
    calls: 4,
    releases: 1,
  });
  assert.equal(h.exitInFlightRef.current, false);
  offline = false;
  await h.run();
  assert.equal(h.state.calls, 5);
  assert.equal(h.state.releases, 2);
  assert.equal(h.state.phase, "submitted");
  assert.equal(h.state.active, null);
  assert.equal(h.state.last, "session-1");
  assert.equal(h.exitInFlightRef.current, true);
  await h.run();
  assert.equal(h.state.calls, 5);
});
test("concurrent finish clicks run only one request and one cleanup", async () => {
  let accept;
  const h = finishHarness({
    finish: () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  });
  const first = h.run();
  await Promise.resolve();
  await Promise.resolve();
  await h.run();
  assert.equal(h.state.calls, 1);
  accept({ ok: true, json: async () => ({}) });
  await first;
  assert.equal(h.state.releases, 1);
});
test("lost finish acknowledgement followed by already-finished response clears recovery", async () => {
  let first = true;
  const h = finishHarness({
    finish: async () => {
      if (first) {
        first = false;
        throw Error("response lost");
      }
      return { ok: false, json: async () => ({ code: "SESSION_ALREADY_SUBMITTED" }) };
    },
  });
  await h.run();
  assert.equal(h.state.phase, "submitted");
  assert.equal(h.state.active, null);
  assert.equal(h.state.calls, 2);
});

test("stalled Finish error body cannot hold native release", async () => {
  let expire;
  let attempts = 0;
  let h;
  h = finishHarness({
    finish: async () => {
      attempts++;
      if (attempts === 2) assert.equal(h.signals[0].aborted, true);
      return attempts === 1
        ? { ok: false, json: () => new Promise(() => {}) }
        : { ok: false, json: async () => ({ code: "SESSION_ALREADY_SUBMITTED" }) };
    },
    withTimeout: (promise) =>
      Promise.race([
        promise,
        new Promise((_resolve, reject) => {
          expire = () => reject(Error("Finish attempt timed out"));
        }),
      ]),
  });
  const finishing = h.run();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(typeof expire, "function");
  assert.equal(h.state.releases, 0);
  expire();
  await finishing;
  assert.equal(attempts, 2);
  assert.equal(h.signals.length, 2);
  assert.notEqual(h.signals[0], h.signals[1]);
  assert.equal(h.signals[1].aborted, true);
  assert.equal(h.state.releases, 1);
  assert.equal(h.state.phase, "submitted");
});

test("late finish acknowledgement after intentional leave cannot clear session recovery", async () => {
  let acknowledge;
  const h = finishHarness({
    finish: () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      }),
  });
  const pending = h.run();
  while (!acknowledge) await Promise.resolve();
  h.leavingWorkspaceRef.current = true;
  h.state.active = "newer-session";
  acknowledge({ ok: true, json: async () => ({}) });
  await pending;
  assert.equal(h.state.active, "newer-session");
  assert.equal(h.state.releases, 0);
  assert.equal(h.state.phase, "submitting");
});

test("leaving during a failed finish prevents further network attempts", async () => {
  let reject;
  const h = finishHarness({
    finish: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  });
  const pending = h.run();
  while (!reject) await Promise.resolve();
  h.leavingWorkspaceRef.current = true;
  reject(Error("offline"));
  await pending;
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.releases, 0);
  assert.equal(h.state.active, "session-1");
});
