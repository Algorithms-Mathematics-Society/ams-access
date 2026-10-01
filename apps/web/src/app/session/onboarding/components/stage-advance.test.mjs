import test from "node:test";
import assert from "node:assert/strict";
import { createStageAdvanceController } from "./stage-advance.ts";

function harness() {
  const calls = [], timers = new Map(), cancelled = [];
  let id = 0;
  const controller = createStageAdvanceController({
    finalStage: 13,
    onBegin: (stage, status) => calls.push(["begin", stage, status]),
    onAdvance: next => calls.push(["advance", next]),
    onFinalize: () => calls.push(["finalize"]),
    clock: {
      setTimeout: (callback, delay) => { assert.equal(delay, 300); timers.set(++id, callback); return id; },
      clearTimeout: timer => { cancelled.push(timer); timers.delete(timer); },
    },
  });
  return { controller, calls, timers, cancelled, flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); } };
}

test("synchronous duplicate pass/warn callbacks record and advance only once", () => {
  const h = harness(), run = { stage: 4 };
  h.controller.activate(run);
  assert.equal(h.controller.advance(run, "warn"), true);
  assert.equal(h.controller.advance(run, "pass"), false);
  assert.deepEqual(h.calls, [["begin", 4, "warn"]]);
  h.flush();
  assert.deepEqual(h.calls, [["begin", 4, "warn"], ["advance", 5]]);
});

test("a completed visit cannot advance again while React has not committed the next step", () => {
  const h = harness(), run = { stage: 2 };
  h.controller.activate(run); h.controller.advance(run); h.flush();
  assert.equal(h.controller.advance(run), false);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, [["begin", 2, "pass"], ["advance", 3]]);
});

test("late callbacks from an earlier stage cannot overwrite results or skip the active stage", () => {
  const h = harness(), earlier = { stage: 2 }, current = { stage: 7 };
  h.controller.activate(earlier); h.controller.deactivate(earlier); h.controller.activate(current);
  assert.equal(h.controller.advance(earlier, "warn"), false);
  assert.equal(h.controller.advance(current), true); h.flush();
  assert.deepEqual(h.calls, [["begin", 7, "pass"], ["advance", 8]]);
});

test("a retry of the same numbered stage rejects callbacks from its previous visit", () => {
  const h = harness(), original = { stage: 4 }, review = { stage: 12 }, retry = { stage: 4 };
  h.controller.activate(original); h.controller.activate(review); h.controller.activate(retry);
  assert.equal(h.controller.advance(original), false);
  assert.equal(h.controller.advance(retry, "warn"), true); h.flush();
  assert.deepEqual(h.calls, [["begin", 4, "warn"], ["advance", 5]]);
});

test("unmount cancels the transition timer and ignores already queued callbacks", () => {
  const h = harness(), run = { stage: 12 };
  h.controller.activate(run); h.controller.advance(run);
  const queued = [...h.timers.values()][0];
  h.controller.deactivate(run); queued();
  assert.equal(h.cancelled.length, 1);
  assert.equal(h.controller.advance(run), false);
  assert.deepEqual(h.calls, [["begin", 12, "pass"]]);
});

test("a superseded transition cannot advance a newly activated retry", () => {
  const h = harness(), old = { stage: 4 }, next = { stage: 4 };
  h.controller.activate(old); h.controller.advance(old);
  const queued = [...h.timers.values()][0];
  h.controller.activate(next); queued();
  assert.equal(h.controller.advance(next), true); h.flush();
  assert.deepEqual(h.calls, [["begin", 4, "pass"], ["begin", 4, "pass"], ["advance", 5]]);
});

test("entering the final stage invokes finalization exactly once after advancing", () => {
  const h = harness(), run = { stage: 12 };
  h.controller.activate(run); h.controller.advance(run); h.flush();
  h.controller.advance(run); h.flush();
  assert.deepEqual(h.calls, [["begin", 12, "pass"], ["advance", 13], ["finalize"]]);
});

test("cleanup of an older visit cannot cancel the current visit", () => {
  const h = harness(), old = { stage: 4 }, current = { stage: 5 };
  h.controller.activate(old); h.controller.activate(current); h.controller.advance(current);
  h.controller.deactivate(old); h.flush();
  assert.deepEqual(h.calls, [["begin", 5, "pass"], ["advance", 6]]);
});

test("a queued old timer cannot discard the timer handle of a new visit", () => {
  const h = harness(), old = { stage: 4 }, current = { stage: 5 };
  h.controller.activate(old); h.controller.advance(old);
  const queued = [...h.timers.values()][0];
  h.controller.activate(current); h.controller.advance(current);
  queued(); h.controller.deactivate(current);
  assert.equal(h.cancelled.length, 2);
  assert.equal(h.timers.size, 0);
  h.flush();
  assert.deepEqual(h.calls, [["begin", 4, "pass"], ["begin", 5, "pass"]]);
});

test("default browser clock preserves the global receiver for schedule and cancellation", () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let scheduled = false, cleared = false;
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
      finalStage: 13, onBegin() {}, onAdvance() {}, onFinalize() {},
    });
    const run = { stage: 4 };
    controller.activate(run); controller.advance(run); controller.deactivate(run);
    assert.equal(scheduled, true);
    assert.equal(cleared, true);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});
