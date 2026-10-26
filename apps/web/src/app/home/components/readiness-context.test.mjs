import test from "node:test";
import assert from "node:assert/strict";
import { deriveContestantReadiness } from "./readiness-context.ts";

const readiness = {
  camera: "ok",
  mic: "ok",
  network: "ok",
  networkLockdown: "ok",
  keyboard: "ok",
  restrictedApps: "ok",
  vm: "ok",
  platform: "ok",
};
const check = (kind, outcome, blocking = false) => ({ kind, outcome, blocking, required: true });

function derive(decision, required, optional = []) {
  return deriveContestantReadiness({
    readiness,
    report: {
      decision,
      required_checks: required,
      optional_checks: optional,
      checks: [...required, ...optional],
    },
    entryWindowStatus: "allowed",
  });
}

test("a required probe that could not conclude without blocking is advisory, not a fix", () => {
  const context = derive("allowed_with_warnings", [check("clock_integrity", "unknown")]);
  assert.equal(context.status, "advisory_warning");
  assert.equal(context.failedRequired, 0);
  assert.equal(context.failedOptional, 1);
});

test("a blocked report still asks the candidate to act", () => {
  const context = derive("blocked", [check("virtualization", "fail", true)]);
  assert.equal(context.status, "needs_action");
  assert.equal(context.failedRequired, 1);
});

test("a clean report is ready", () => {
  assert.equal(derive("allowed", [check("camera", "pass")]).status, "ready");
});

test("advisory warnings carry their kinds so Home can name them", () => {
  const context = derive(
    "allowed_with_warnings",
    [check("camera", "pass")],
    [check("external_display", "warn"), check("remote_server", "unknown")]
  );
  assert.equal(context.failedOptional, 2);
  assert.deepEqual(context.advisoryKinds, ["external_display", "remote_server"]);
});
