import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictLabel, verdictShort, verdictColor } from "./verdict.ts";

test("verdictLabel returns standard CP names", () => {
  assert.equal(verdictLabel("AC"), "Accepted");
  assert.equal(verdictLabel("WA"), "Wrong Answer");
  assert.equal(verdictLabel("TLE"), "Time Limit Exceeded");
  assert.equal(verdictLabel("MLE"), "Memory Limit Exceeded");
  assert.equal(verdictLabel("RE"), "Runtime Error");
  assert.equal(verdictLabel("CE"), "Compilation Error");
  assert.equal(verdictLabel("OLE"), "Output Limit Exceeded");
  assert.equal(verdictLabel("IE"), "Internal Error");
});
test("verdictLabel handles pending + unknown + nullish", () => {
  assert.equal(verdictLabel("RUNNING"), "Running");
  assert.equal(verdictLabel("QUEUED"), "Queued");
  assert.equal(verdictLabel("UNATTEMPTED"), "Not attempted");
  assert.equal(verdictLabel(null), "—");
  assert.equal(verdictLabel(undefined), "—");
  assert.equal(verdictLabel("ZZ"), "ZZ");
});
test("verdictShort returns the bare code", () => {
  assert.equal(verdictShort("WA"), "WA");
  assert.equal(verdictShort("AC"), "AC");
  assert.equal(verdictShort(null), "—");
});
test("verdictColor maps to --verdict-* tokens", () => {
  assert.ok(verdictColor("AC").includes("--verdict-ac"));
  assert.ok(verdictColor("WA").includes("--verdict-wa"));
  assert.ok(verdictColor("ZZ").includes("--verdict-none"));
});
