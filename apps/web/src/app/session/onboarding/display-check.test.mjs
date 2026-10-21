import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOrganizerOverrides,
  sessionPolicy,
} from "../../../../../../packages/api-client/src/index.ts";
import { displayObservation } from "./display-check.ts";
import { readinessAction } from "./readiness-action.ts";

const one = [{ name: "Primary" }];
const two = [{ name: "Primary" }, { name: "HDMI-1" }];

test("display measurement preserves pass, observed failure, and unavailable facts", () => {
  assert.equal(displayObservation(one), "pass");
  assert.equal(displayObservation(two), "failure");
  assert.equal(displayObservation(null), "probe_unavailable");
  assert.equal(displayObservation([]), "pass");
});

test("strict Linux keeps observed and unavailable display results advisory", () => {
  const linux = sessionPolicy("strict_contest", "linux");
  assert.equal(
    readinessAction(linux, "external_display", displayObservation(two)).decision,
    "warn"
  );
  assert.equal(
    readinessAction(linux, "external_display", displayObservation(null)).decision,
    "warn"
  );
  assert.equal(readinessAction(linux, "external_display", displayObservation([])).decision, "pass");
});

test("strict Windows blocks observed and unavailable display results", () => {
  const windows = sessionPolicy("strict_contest", "windows");
  assert.equal(
    readinessAction(windows, "external_display", displayObservation(one)).decision,
    "pass"
  );
  assert.equal(
    readinessAction(windows, "external_display", displayObservation(two)).decision,
    "block"
  );
  assert.equal(
    readinessAction(windows, "external_display", displayObservation(null)).decision,
    "block"
  );
  assert.equal(
    readinessAction(windows, "external_display", displayObservation([])).decision,
    "pass"
  );
});

test("Windows distinguishes an empty successful enumeration from a failed probe", () => {
  const windows = sessionPolicy("strict_contest", "windows");
  assert.equal(
    readinessAction(windows, "external_display", displayObservation([])).decision,
    "pass"
  );
  assert.equal(
    readinessAction(windows, "external_display", displayObservation(null)).decision,
    "block"
  );
});

test("an organizer override relaxes the Windows action without changing the measured fact", () => {
  const observed = displayObservation(two);
  assert.equal(observed, "failure");
  const overridden = applyOrganizerOverrides(sessionPolicy("strict_contest", "windows"), [
    { check_kind: "external_display", expires_at_ms: Date.now() + 60_000 },
  ]);
  assert.equal(readinessAction(overridden, "external_display", observed).decision, "warn");
});
