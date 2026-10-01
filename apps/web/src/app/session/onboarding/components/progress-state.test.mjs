import test from "node:test";
import assert from "node:assert/strict";
import { setupProgress, setupPhase } from "./progress-state.ts";

const passed = count => Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, "pass"]));

test("completed progress advances with each real step and leaves secure entry pending", () => {
  for (let step = 1; step <= 13; step++) {
    assert.deepEqual(setupProgress(step, passed(step - 1), 13), { step, completed: step - 1 });
  }
});
test("a retry ignores stored results for the current and future steps", () => {
  assert.deepEqual(setupProgress(4, passed(12), 13), { step: 4, completed: 3 });
  assert.equal(setupPhase({ start: 4, end: 6 }, 4, passed(12)).label, "In progress");
  assert.equal(setupPhase({ start: 7, end: 7 }, 4, passed(12)).label, "Upcoming");
});
test("returning from entry to review does not count a previous review as completed", () => {
  assert.equal(setupProgress(12, passed(12), 13).completed, 11);
});
test("warnings count as completed steps and remain visible in the active phase", () => {
  const results = { 1: "warn", 2: "pass" };
  assert.equal(setupProgress(3, results, 13).completed, 2);
  assert.deepEqual(setupPhase({ start: 1, end: 3 }, 3, results), {
    active: true, label: "In progress · warning recorded", variant: "warning",
  });
  assert.equal(setupPhase({ start: 1, end: 3 }, 4, { ...results, 3: "pass" }).label, "Complete with warnings");
});
test("failed or missing checks are not invented completion", () => {
  assert.equal(setupProgress(4, { 1: "fail", 2: "pending", 3: "checking" }, 13).completed, 0);
  assert.equal(setupPhase({ start: 1, end: 3 }, 4, { 1: "fail", 2: "pass", 3: "pass" }).label, "Needs action");
  assert.equal(setupPhase({ start: 1, end: 3 }, 4, { 1: "pass" }).label, "Not fully checked");
});
test("a policy block is shown on the current phase even when earlier checks passed", () => {
  assert.deepEqual(setupPhase({ start: 11, end: 13 }, 12, passed(12), true), {
    active: true, label: "Needs action", variant: "error",
  });
  assert.equal(setupPhase({ start: 1, end: 3 }, 12, passed(12), true).label, "Complete");
});
test("stale future failures and warnings do not mark upcoming phases", () => {
  assert.equal(setupPhase({ start: 8, end: 9 }, 4, { 8: "fail", 9: "warn" }).label, "Upcoming");
});
test("presentation derivation never mutates stored check results", () => {
  const results = Object.freeze({ ...passed(12), 5: "warn" });
  setupProgress(4, results, 13);
  setupPhase({ start: 4, end: 6 }, 4, results);
  assert.equal(results[5], "warn");
  assert.equal(Object.keys(results).length, 12);
});
