import test from "node:test";
import assert from "node:assert/strict";

import { computeAutosaveDelayMs } from "./autosave-timing.ts";

test("first attempt uses the ~600ms debounce floor, NOT the 1500ms retry base", () => {
  // failures === 0 → base debounce 600ms (jitter 0 with rand=()=>0).
  assert.equal(
    computeAutosaveDelayMs(0, () => 0),
    600
  );
  // Decoupling guard: the base debounce must NOT be the retry base (1500).
  assert.notEqual(
    computeAutosaveDelayMs(0, () => 0),
    1500
  );
});

test("jitter adds 0..400ms on top of the base", () => {
  assert.equal(
    computeAutosaveDelayMs(0, () => 1),
    1000
  ); // 600 + 400
});

test("failures back off exponentially on the 1500ms retry base, capped at 30000ms", () => {
  assert.equal(
    computeAutosaveDelayMs(1, () => 0),
    3000
  ); // 1500 * 2^1
  assert.equal(
    computeAutosaveDelayMs(2, () => 0),
    6000
  ); // 1500 * 2^2
  assert.equal(
    computeAutosaveDelayMs(5, () => 0),
    30000
  ); // 1500*32=48000 → capped
});
