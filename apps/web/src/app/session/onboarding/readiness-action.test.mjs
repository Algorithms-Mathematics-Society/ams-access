import assert from "node:assert/strict";
import test from "node:test";

import { readinessAction } from "./readiness-action.ts";

const requirement = (overrides = {}) => ({
  kind: "camera",
  required: true,
  severity: "block",
  organizer_override_allowed: true,
  unsupported_severity: "block",
  ...overrides,
});

const policy = (...checks) => ({ profile: "strict_contest", checks });

test("waits until the effective policy contains the requested check", () => {
  assert.deepEqual(readinessAction(null, "camera", "failure"), {
    decision: "pending",
    requirement: null,
  });
  assert.equal(readinessAction(policy(), "camera", "failure").decision, "pending");
});

test("a passing observation proceeds regardless of a blocking requirement", () => {
  assert.equal(readinessAction(policy(requirement()), "camera", "pass").decision, "pass");
});

test("required blocking failures and unavailable probes hold entry", () => {
  const strict = policy(requirement());
  assert.equal(readinessAction(strict, "camera", "failure").decision, "block");
  assert.equal(readinessAction(strict, "camera", "probe_unavailable").decision, "block");
});

test("advisory failures and unavailable probes preserve a warning path", () => {
  const advisory = policy(requirement({ required: false, severity: "warning" }));
  assert.equal(readinessAction(advisory, "camera", "failure").decision, "warn");
  assert.equal(readinessAction(advisory, "camera", "probe_unavailable").decision, "warn");
});

test("required checks with non-blocking severity still warn", () => {
  const configuredWarning = policy(requirement({ severity: "warning" }));
  assert.equal(readinessAction(configuredWarning, "camera", "failure").decision, "warn");
});

test("unsupported observations use unsupported severity independently", () => {
  const strict = policy(requirement({ severity: "warning", unsupported_severity: "block" }));
  assert.equal(readinessAction(strict, "camera", "failure").decision, "warn");
  assert.equal(readinessAction(strict, "camera", "unsupported").decision, "block");

  const defaultWarning = policy(requirement({ unsupported_severity: undefined }));
  assert.equal(readinessAction(defaultWarning, "camera", "unsupported").decision, "warn");
});

test("the last requirement wins, matching core policy merge and organizer overrides", () => {
  const base = requirement();
  const override = requirement({ required: false, severity: "warning" });
  const result = readinessAction(policy(base, override), "camera", "failure");
  assert.equal(result.decision, "warn");
  assert.equal(result.requirement, override);
});
