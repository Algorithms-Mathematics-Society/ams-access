// The TypeScript and Rust readiness-policy builders are hand-maintained
// mirrors, and `merge_requirements` overlays one on the other. Nothing stopped
// them drifting — a requirement changed on one side only produces a client
// that enforces something the readiness report does not describe, silently.
//
// Both sides are pinned to `packages/policy-fixtures.json`. Whichever drifts
// fails. The fixture is generated from Rust:
//
//     UPDATE_POLICY_FIXTURE=1 cargo test -p core-rs
//
// so if this test fails, the question to answer is "did I mean to change the
// policy, and did I change it in both places?".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sessionPolicy } from "./index.ts";

const FIXTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../policy-fixtures.json", import.meta.url)), "utf8")
);

const PROFILES = ["practice", "internal_pilot", "strict_contest"];
const PLATFORMS = [undefined, "windows", "windows_no_admin", "macos", "linux"];

/** Keyed by check kind, so the sides are compared on content not build order. */
function snapshot(profile, platform) {
  const out = {};
  for (const check of sessionPolicy(profile, platform).checks) {
    out[check.kind] = {
      required: check.required,
      severity: check.severity,
      organizer_override_allowed: check.organizer_override_allowed,
      // Absent means warn, which is what the Rust default resolves to. Making
      // it explicit here is what lets the two be compared at all.
      unsupported_severity: check.unsupported_severity ?? "warning",
    };
  }
  return out;
}

test("the fixture covers every profile and platform combination", () => {
  assert.equal(Object.keys(FIXTURE).length, PROFILES.length * PLATFORMS.length);
});

for (const profile of PROFILES) {
  for (const platform of PLATFORMS) {
    const key = `${profile}/${platform ?? "none"}`;
    test(`the TypeScript policy matches Rust for ${key}`, () => {
      assert.deepEqual(snapshot(profile, platform), FIXTURE[key]);
    });
  }
}

test("an unprobeable check blocks only under a strict Windows session", () => {
  // The rule the tri-state turns on, asserted directly rather than only via
  // the fixture — so the intent survives a regeneration.
  const strictWindows = sessionPolicy("strict_contest", "windows");
  const strictLinux = sessionPolicy("strict_contest", "linux");
  const practiceWindows = sessionPolicy("practice", "windows");

  const severity = (policy, kind) =>
    policy.checks.find((check) => check.kind === kind).unsupported_severity;

  assert.equal(severity(strictWindows, "external_display"), "block");
  assert.equal(severity(strictLinux, "external_display"), "warning");
  assert.equal(severity(practiceWindows, "external_display"), "warning");
});
