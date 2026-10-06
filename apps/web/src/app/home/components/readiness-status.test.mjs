import test from "node:test";
import assert from "node:assert/strict";

import { readinessStatusForOutcome } from "./readiness-status.ts";

// The report has four outcomes. The UI had three, and the collapse lost two
// distinctions that matter to a candidate staring at a readiness modal.
//
// github.com/.../issues/40: keyboard lockdown failed on a tiling WM, the log
// said so, and the modal showed "Checking..." for ever.

test("a passing check is ok", () => {
  assert.equal(readinessStatusForOutcome("pass"), "ok");
});

test("a blocking failure is fail", () => {
  assert.equal(readinessStatusForOutcome("fail"), "fail");
});

test("an advisory warning is not reported as a failure", () => {
  // It used to be. An advisory check reading "Needs action" tells a candidate
  // to fix something that was never going to stop them entering.
  assert.equal(readinessStatusForOutcome("warn"), "warn");
});

test("a probe this machine cannot run is not reported as still checking", () => {
  // The bug in #40. `unknown` means the answer will never arrive, so showing
  // "Checking..." is a promise the scan cannot keep.
  const status = readinessStatusForOutcome("unknown");
  assert.equal(status, "unavailable");
  assert.notEqual(status, "checking");
});
