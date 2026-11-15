import test from "node:test";
import assert from "node:assert/strict";
import { createStageAdvanceController } from "./stage-advance.ts";

function harness() {
  const calls = [],
    timers = new Map(),
    cancelled = [];
  let id = 0;
  const controller = createStageAdvanceController({
    finalStage: 13,
    onBegin: (stage, status) => calls.push(["begin", stage, status]),
    onAdvance: (next) => calls.push(["advance", next]),
    onFinalize: () => calls.push(["finalize"]),
    clock: {
      setTimeout: (callback, delay) => {
        assert.equal(delay, 300);
        timers.set(++id, callback);
        return id;
      },
      clearTimeout: (timer) => {
        cancelled.push(timer);
        timers.delete(timer);
      },
    },
  });
  return {
    controller,
    calls,
    timers,
    cancelled,
    flush() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((callback) => callback());
    },
  };
}

test("synchronous duplicate pass/warn callbacks record and advance only once", () => {
  const h = harness(),
    run = { stage: 4 };
  h.controller.activate(run);
  assert.equal(h.controller.advance(run, "warn"), true);
  assert.equal(h.controller.advance(run, "pass"), false);
  assert.deepEqual(h.calls, [["begin", 4, "warn"]]);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 4, "warn"],
    ["advance", 5],
  ]);
});

test("a completed visit cannot advance again while React has not committed the next step", () => {
  const h = harness(),
    run = { stage: 2 };
  h.controller.activate(run);
  h.controller.advance(run);
  h.flush();
  assert.equal(h.controller.advance(run), false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, [
    ["begin", 2, "pass"],
    ["advance", 3],
  ]);
});

test("late callbacks from an earlier stage cannot overwrite results or skip the active stage", () => {
  const h = harness(),
    earlier = { stage: 2 },
    current = { stage: 7 };
  h.controller.activate(earlier);
  h.controller.deactivate(earlier);
  h.controller.activate(current);
  assert.equal(h.controller.advance(earlier, "warn"), false);
  assert.equal(h.controller.advance(current), true);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 7, "pass"],
    ["advance", 8],
  ]);
});

test("a retry of the same numbered stage rejects callbacks from its previous visit", () => {
  const h = harness(),
    original = { stage: 4 },
    review = { stage: 12 },
    retry = { stage: 4 };
  h.controller.activate(original);
  h.controller.activate(review);
  h.controller.activate(retry);
  assert.equal(h.controller.advance(original), false);
  assert.equal(h.controller.advance(retry, "warn"), true);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 4, "warn"],
    ["advance", 5],
  ]);
});

test("unmount cancels the transition timer and ignores already queued callbacks", () => {
  const h = harness(),
    run = { stage: 12 };
  h.controller.activate(run);
  h.controller.advance(run);
  const queued = [...h.timers.values()][0];
  h.controller.deactivate(run);
  queued();
  assert.equal(h.cancelled.length, 1);
  assert.equal(h.controller.advance(run), false);
  assert.deepEqual(h.calls, [["begin", 12, "pass"]]);
});

test("a superseded transition cannot advance a newly activated retry", () => {
  const h = harness(),
    old = { stage: 4 },
    next = { stage: 4 };
  h.controller.activate(old);
  h.controller.advance(old);
  const queued = [...h.timers.values()][0];
  h.controller.activate(next);
  queued();
  assert.equal(h.controller.advance(next), true);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 4, "pass"],
    ["begin", 4, "pass"],
    ["advance", 5],
  ]);
});

test("entering the final stage invokes finalization exactly once after advancing", () => {
  const h = harness(),
    run = { stage: 12 };
  h.controller.activate(run);
  h.controller.advance(run);
  h.flush();
  h.controller.advance(run);
  h.flush();
  assert.deepEqual(h.calls, [["begin", 12, "pass"], ["advance", 13], ["finalize"]]);
});

test("cleanup of an older visit cannot cancel the current visit", () => {
  const h = harness(),
    old = { stage: 4 },
    current = { stage: 5 };
  h.controller.activate(old);
  h.controller.activate(current);
  h.controller.advance(current);
  h.controller.deactivate(old);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 5, "pass"],
    ["advance", 6],
  ]);
});

test("a queued old timer cannot discard the timer handle of a new visit", () => {
  const h = harness(),
    old = { stage: 4 },
    current = { stage: 5 };
  h.controller.activate(old);
  h.controller.advance(old);
  const queued = [...h.timers.values()][0];
  h.controller.activate(current);
  h.controller.advance(current);
  queued();
  h.controller.deactivate(current);
  assert.equal(h.cancelled.length, 2);
  assert.equal(h.timers.size, 0);
  h.flush();
  assert.deepEqual(h.calls, [
    ["begin", 4, "pass"],
    ["begin", 5, "pass"],
  ]);
});

test("default browser clock preserves the global receiver for schedule and cancellation", () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  let scheduled = false,
    cleared = false;
  try {
    globalThis.setTimeout = function (callback, delay) {
      assert.equal(this, globalThis, "native timer must use its global receiver");
      assert.equal(delay, 300);
      scheduled = true;
      return 42;
    };
    globalThis.clearTimeout = function (handle) {
      assert.equal(this, globalThis, "native cancellation must use its global receiver");
      assert.equal(handle, 42);
      cleared = true;
    };
    const controller = createStageAdvanceController({
      finalStage: 13,
      onBegin() {},
      onAdvance() {},
      onFinalize() {},
    });
    const run = { stage: 4 };
    controller.activate(run);
    controller.advance(run);
    controller.deactivate(run);
    assert.equal(scheduled, true);
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

// Exercise the real restricted-app component's retry ownership with controlled native replies.
async function restrictedAppsHarness() {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const timers = new Map();
  const calls = [];
  const nativeReplies = [];
  let id = 0,
    scan,
    cleanup;
  const output = {};
  const source = readFileSync(
    new URL("./stages/Stage5_RestrictedApps.tsx", import.meta.url),
    "utf8"
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      jsxFactory: "element",
    },
  }).outputText;
  new Function("require", "exports", "element", "setTimeout", "clearTimeout", code)(
    (name) => {
      if (name === "react")
        return {
          useState: (value) => [value, () => {}],
          useRef: (value) => ({ current: value }),
          useCallback: (callback) => {
            if (callback.constructor.name === "AsyncFunction") scan = callback;
            return callback;
          },
          useEffect: (effect) => {
            cleanup = effect();
          },
        };
      if (name === "../../support")
        return {
          invoke: (command) => {
            calls.push(command);
            return new Promise((resolve) => nativeReplies.push(resolve));
          },
          withNullableTimeout: (promise, ms) => {
            assert.equal(ms, 3000);
            return promise;
          },
        };
      return new Proxy({}, { get: (_, key) => key });
    },
    output,
    (type, props, ...children) => ({ type, props, children }),
    (callback, delay) => {
      timers.set(++id, { callback, delay });
      return id;
    },
    (handle) => timers.delete(handle)
  );
  output.Stage5_RestrictedApps({
    onPass: () => calls.push("pass"),
    onWarn: () => calls.push("warn"),
  });
  const drain = async () => {
    for (let n = 0; n < 8; n++) await Promise.resolve();
  };
  return {
    calls,
    timers,
    nativeReplies,
    drain,
    scan: () => scan(),
    unmount: () => cleanup(),
    async fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `expected ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
      await drain();
    },
  };
}

test("restricted-app retry cancels an obsolete warning and advances only after its own result", async () => {
  const h = await restrictedAppsHarness();
  await h.fire(600);
  h.nativeReplies.shift()(null);
  await h.drain();
  const oldWarning = [...h.timers.values()].find((timer) => timer.delay === 1400).callback;
  const retry = h.scan();
  assert.ok(![...h.timers.values()].some((timer) => timer.delay === 1400));
  oldWarning();
  assert.deepEqual(h.calls, ["scan_processes"]);
  await h.fire(600);
  h.nativeReplies.shift()({ found: [], clean: true });
  await retry;
  await h.fire(800);
  assert.deepEqual(h.calls, ["scan_processes", "scan_processes", "pass"]);
});

test("restricted-app scan prevents duplicate starts and ignores a result after unmount", async () => {
  const h = await restrictedAppsHarness();
  await h.scan();
  assert.equal(h.timers.size, 1);
  await h.fire(600);
  await h.scan();
  assert.deepEqual(h.calls, ["scan_processes"]);
  h.unmount();
  h.nativeReplies.shift()({ found: [], clean: true });
  await h.drain();
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, ["scan_processes"]);
});

test("leaving restricted-app setup during presentation delay never starts a native scan", async () => {
  const h = await restrictedAppsHarness();
  h.unmount();
  await h.fire(600);
  assert.deepEqual(h.calls, []);
});
