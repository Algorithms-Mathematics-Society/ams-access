import test from "node:test";
import assert from "node:assert/strict";

import { COUNTDOWN_CRITICAL_MS, COUNTDOWN_WARNING_MS, countdownPhase } from "./countdown.ts";

test("countdownPhase maps remaining ms to urgency phases", () => {
  assert.equal(countdownPhase(2 * 60 * 60_000), "nominal"); // 2h
  assert.equal(countdownPhase(COUNTDOWN_WARNING_MS + 1), "nominal"); // just above 6m
  assert.equal(countdownPhase(COUNTDOWN_WARNING_MS), "warning"); // exactly 6m
  assert.equal(countdownPhase(2 * 60_000), "warning"); // 2m
  assert.equal(countdownPhase(COUNTDOWN_CRITICAL_MS + 1), "warning"); // just above 1m
  assert.equal(countdownPhase(COUNTDOWN_CRITICAL_MS), "critical"); // exactly 1m
  assert.equal(countdownPhase(5_000), "critical"); // 5s
  assert.equal(countdownPhase(1), "critical"); // sub-second
  assert.equal(countdownPhase(0), "expired");
  assert.equal(countdownPhase(-5_000), "expired"); // clock drift past end
});
