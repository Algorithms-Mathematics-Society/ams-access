import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { entryProgressLabel } from "./entry-progress.ts";

import {
  EntryCancelledError,
  EntryTimeoutError,
  createEntryAttemptController,
  entryMediaFacts,
  refreshEntryValue,
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

function fixture({ enumerateDevices, collectDeviceState, overrides = {} }) {
  const time = fakeClock();
  const attempts = createEntryAttemptController(time.clock);
  attempts.activate();
  const state = { blocks: [], retries: [], navigation: [], sessions: 0, progress: [] };
  const context = {
    entryAttemptsRef: { current: attempts },
    setupLeavingRef: { current: false },
    contestWindow: null,
    setPolicyBlock: (value) => state.blocks.push(value),
    setFaceReviewSaveFailed() {},
    setEntryRetryAvailable: (value) => state.retries.push(value),
    setTransitioning() {},
    setEntryProgress: (value) => state.progress.push(value),
    entryProgressLabel,
    dryRun: false,
    evaluateEntryGateFromServer: async () => ({ ok: true, index: null }),
    isTestAccount: false,
    contestIndex: null,
    navigator: { mediaDevices: { enumerateDevices } },
    hasNativeBridge: () => true,
    cameraStreamRef: { current: null },
    cameraAttemptedRef: { current: true },
    entryMediaFacts,
    refreshEntryValue,
    browserDeviceState() {
      throw new Error("browser path must not run");
    },
    platform: "linux",
    collectDeviceState,
    invokeStrict: async () => {},
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
  Object.assign(context, overrides);
  const finalize = new Function(...Object.keys(context), `return ${callbackCode}`)(
    ...Object.values(context)
  );
  return { finalize, time, state, attempts };
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

function desktopFixture({ start, verify, cleanup } = {}) {
  const desktop = { active: false, scans: 0, starts: 0, unlocks: 0 };
  const invoke = async (name) => {
    if (name === "is_lockdown_engaged") return verify ? verify() : desktop.active;
    if (name === "unlock_desktop") {
      desktop.unlocks++;
      if (cleanup) await cleanup();
      desktop.active = false;
    }
    return true;
  };
  const f = fixture({
    enumerateDevices: async () => [],
    collectDeviceState: async () => {
      desktop.scans++;
      if (desktop.active) throw new Error("A secure session owns desktop controls");
      return { platform: "linux" };
    },
    overrides: {
      contestId: "contest",
      preparedSessionIdRef: { current: "session" },
      faceReviewRef: { current: { isRequested: () => false } },
      warningRecordsRef: { current: new Map() },
      invokeStrict: invoke,
      invoke,
      window: { __TAURI__: { core: { invoke } } },
      participantToken: () => "token",
      getNetworkLockdownAllowlistHost: () => "api.invalid",
      decideNetworkLockdown: () => ({ violation: false, eventKind: "network", detail: "" }),
      getOrCreateDeviceId: () => "device",
      refreshEntryValue,
      overrides: [],
      fetchOrganizerOverrides: async () => [],
      setOverrides() {},
      applyOrganizerOverrides: (p) => p,
      applyLockdownConfig: (p) => p,
      strictContestPolicy: () => ({}),
      startSecureSession: async () => {
        desktop.starts++;
        if (start) await start();
        desktop.active = true;
      },
    },
  });
  return { ...f, desktop };
}

test("failed post-start verification releases desktop before a successful retry", async () => {
  let fail = true;
  const f = desktopFixture({
    verify: async () => {
      if (fail) throw new Error("verification IPC failed");
      return true;
    },
  });
  await f.finalize();
  await flushUntil(() => !f.desktop.active);
  assert.equal(f.desktop.unlocks, 1);
  fail = false;
  await flush();
  await f.finalize();
  assert.deepEqual(f.state.navigation, ["/session/contest?contestId=contest"]);
  assert.equal(f.desktop.active, true);
  f.attempts.cancel();
  await flush();
  assert.equal(f.desktop.unlocks, 1, "successful navigation transfers desktop ownership");
});

test("verification timeout holds retries until desktop cleanup settles", async () => {
  const verification = deferred();
  const cleanup = deferred();
  const f = desktopFixture({ verify: () => verification.promise, cleanup: () => cleanup.promise });
  const run = f.finalize();
  await flushUntil(() => f.desktop.active);
  await flush();
  f.time.fire(5000);
  await run;
  await f.finalize();
  assert.equal(f.desktop.scans, 1);
  assert.match(f.state.blocks.at(-1), /restoring controls/);
  cleanup.resolve();
  verification.resolve(true);
  await flush();
  assert.equal(f.desktop.active, false);
});

for (const reason of ["timeout", "cancel"]) {
  test(`late secure startup is released after ${reason} without overlapping retry`, async () => {
    const start = deferred();
    const f = desktopFixture({ start: () => start.promise });
    const run = f.finalize();
    await flushUntil(() => f.desktop.starts === 1);
    if (reason === "timeout") f.time.fire(45000);
    else f.attempts.cancel();
    await run;
    await flush();
    assert.equal(f.desktop.unlocks, 1, "abandonment requests immediate restoration");
    if (reason === "timeout") {
      await f.finalize();
      assert.equal(f.desktop.scans, 1, "retry must not probe while startup is pending");
    }
    start.resolve();
    await flushUntil(() => f.desktop.unlocks === 2);
    await flush();
    assert.equal(f.desktop.active, false, "late engagement is rolled back");
    assert.deepEqual(f.state.navigation, []);
  });
}

test("failed desktop cleanup blocks probes until an explicit retry restores it", async () => {
  let restorationFails = true;
  let verificationFails = true;
  const f = desktopFixture({
    verify: async () => {
      if (verificationFails) throw new Error("verification failed");
      return true;
    },
    cleanup: async () => {
      if (restorationFails) throw new Error("restore failed");
    },
  });
  await f.finalize();
  await flush();
  await f.finalize();
  await flush();
  assert.equal(f.desktop.scans, 1);
  assert.equal(f.desktop.active, true);
  assert.match(f.state.blocks.at(-1), /restore failed/);
  restorationFails = false;
  verificationFails = false;
  await f.finalize();
  assert.equal(f.desktop.scans, 2);
  assert.deepEqual(f.state.navigation, ["/session/contest?contestId=contest"]);
});

test("real final entry awaits recorder binding before network lockdown can emit events", () => {
  const recorder = callbackCode.indexOf(
    'await attempts.runAdvisory(attempt, "event recorder setup"'
  );
  const lockdown = callbackCode.indexOf('"enable_network_lockdown"', recorder);
  assert.ok(recorder >= 0, "event recorder setup must be awaited");
  assert.ok(lockdown > recorder, "network lockdown must start after the bounded recorder binding");
});

test("session binding failures remain visible instead of navigating in the same catch", () => {
  const start = callbackCode.indexOf("error instanceof SessionBindingError");
  const end = callbackCode.indexOf("const rawMsg", start);
  assert.ok(start >= 0 && end > start);
  const branch = callbackCode.slice(start, end);
  assert.match(branch, /setPolicyBlock/);
  assert.doesNotMatch(branch, /router\.(?:push|replace)/);
});

test("leaving setup prevents final entry from starting again", async () => {
  const f = fixture({
    enumerateDevices: async () => [],
    collectDeviceState: async () => ({}),
    overrides: { setupLeavingRef: { current: true } },
  });
  await f.finalize();
  assert.equal(f.state.sessions, 0);
  assert.deepEqual(f.state.navigation, []);
});
