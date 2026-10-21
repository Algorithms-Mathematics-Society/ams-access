import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  EntryCancelledError,
  EntryTimeoutError,
  createEntryAttemptController,
  entryMediaFacts,
} from "./entry-attempt.ts";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let callbackNode;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "finalizeSecureStart") {
    callbackNode = node.initializer?.arguments?.[0];
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(callbackNode, "test must execute the real finalizeSecureStart callback");
const callbackCode = ts
  .transpileModule(`(${callbackNode.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  .outputText.trim()
  .replace(/;$/, "");

function fakeClock() {
  let next = 0;
  const timers = new Map();
  return {
    clock: {
      setTimeout(callback, ms) {
        const id = ++next;
        timers.set(id, { callback, ms });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    fire(ms) {
      const found = [...timers].find(([, timer]) => timer.ms === ms);
      assert.ok(found, `expected ${ms}ms deadline; had ${[...timers.values()].map((t) => t.ms)}`);
      timers.delete(found[0]);
      found[1].callback();
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function flushUntil(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), "expected async flow to reach checkpoint");
}

function fixture({ enumerateDevices, collectDeviceState }) {
  const time = fakeClock();
  const attempts = createEntryAttemptController(time.clock);
  attempts.activate();
  const state = { blocks: [], retries: [], navigation: [], sessions: 0 };
  const context = {
    entryAttemptsRef: { current: attempts },
    contestWindow: null,
    setPolicyBlock: (value) => state.blocks.push(value),
    setFaceReviewSaveFailed() {},
    setEntryRetryAvailable: (value) => state.retries.push(value),
    setTransitioning() {},
    dryRun: false,
    evaluateEntryGateFromServer: async () => ({ ok: true, index: null }),
    isTestAccount: false,
    contestIndex: null,
    navigator: { mediaDevices: { enumerateDevices } },
    hasNativeBridge: () => true,
    cameraStreamRef: { current: null },
    cameraAttemptedRef: { current: true },
    entryMediaFacts,
    browserDeviceState() {
      throw new Error("browser path must not run");
    },
    platform: "linux",
    collectDeviceState,
    isGatingRelaxed: () => false,
    getNetworkProbeHost: () => "probe.invalid",
    API_URL: "https://api.invalid",
    EntryCancelledError,
    EntryTimeoutError,
    SessionBindingError: class extends Error {},
    readinessErrorText: (error) =>
      error instanceof Error ? error.message : String(error ?? "unknown"),
    readinessBlockMessage: () => null,
    REVIEW_STAGE: 12,
    setCurrentStage() {},
    setReadyForStart() {},
    router: { push: (path) => state.navigation.push(path) },
    setTimeout,
    serverNow: () => 0,
    fetchJson: async () => {
      state.sessions += 1;
      return {};
    },
  };
  const finalize = new Function(...Object.keys(context), `return ${callbackCode}`)(
    ...Object.values(context)
  );
  return { finalize, time, state };
}

test("real final entry handles a pending media enumeration deadline without creating a session", async () => {
  const pending = deferred();
  const f = fixture({
    enumerateDevices: () => pending.promise,
    collectDeviceState: async () => ({}),
  });
  const run = f.finalize();
  await flush();
  f.time.fire(4_000);
  await run;
  assert.equal(f.state.sessions, 0);
  assert.deepEqual(f.state.navigation, []);
  assert.equal(f.state.retries.at(-1), true);
  assert.match(String(f.state.blocks.at(-1)), /media device listing timed out/i);
  pending.resolve([]);
  await flush();
  assert.deepEqual(f.state.navigation, [], "late enumeration must not resume entry");
});

test("real final entry prevents overlapping native scans and allows a fresh scan after settlement", async () => {
  const native = deferred();
  let scans = 0;
  const f = fixture({
    enumerateDevices: async () => [],
    collectDeviceState: () => {
      scans += 1;
      return scans === 1 ? native.promise : Promise.reject(new Error("fresh native failure"));
    },
  });
  const first = f.finalize();
  await flushUntil(() => scans === 1);
  f.time.fire(45_000);
  await first;
  assert.equal(scans, 1);
  assert.equal(f.state.sessions, 0);

  await f.finalize();
  assert.equal(scans, 1, "retry must not overlap the still-pending native operation");
  assert.match(String(f.state.blocks.at(-1)), /previous native device scan is still finishing/i);

  native.resolve({ platform: "linux" });
  await flush();
  await f.finalize();
  assert.equal(scans, 2, "a settled late scan releases the key for a fresh attempt");
  assert.match(String(f.state.blocks.at(-1)), /fresh native failure/i);
  assert.equal(f.state.sessions, 0);
  assert.deepEqual(f.state.navigation, []);
});
