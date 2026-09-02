// Whether a missing egress firewall stops a candidate.
//
// The bug this replaces stopped every one of them. The default Windows build
// runs unelevated by design, `netsh` needs elevation, so
// `enable_network_lockdown` returns false — and onboarding turned that into a
// hard block with a message ("we couldn't secure your network") describing a
// failure that never happened, because nothing was attempted.
//
// The test that matters most is the last one: relaxing this for the ordinary
// build must NOT relax it for `windows_no_admin`, which is a firewall build
// that asked for elevation and was refused. That one is a real failure, and a
// regression here would disarm the gate silently — exactly the shape of the
// bug it is replacing.

import test from "node:test";
import assert from "node:assert/strict";

import { decideNetworkLockdown } from "./network-gate.ts";

const base = { platform: "windows", engaged: false, error: null, relaxed: false };

test("an engaged lockdown is engaged, whatever the platform", () => {
  for (const platform of ["windows", "windows_no_firewall", "linux", "macos", null]) {
    const out = decideNetworkLockdown({ ...base, platform, engaged: true });
    assert.equal(out.decision, "engaged", String(platform));
    assert.equal(out.violation, false);
  }
});

test("the ordinary Windows release enters with egress open, and is not blocked", () => {
  const out = decideNetworkLockdown({ ...base, platform: "windows_no_firewall" });
  assert.equal(out.decision, "advisory");
  assert.equal(out.eventKind, "network_lockdown_not_applicable");
});

test("a Store build is treated the same — it can never elevate", () => {
  const out = decideNetworkLockdown({ ...base, platform: "windows_msix" });
  assert.equal(out.decision, "advisory");
  assert.equal(out.eventKind, "network_lockdown_not_applicable");
});

test("neither files a violation — nobody did anything wrong", () => {
  // Every ordinary contestant runs one of these two builds. Filing a
  // violation for each would put the whole cohort in the invigilator's feed
  // on contest day and cost the feed its meaning.
  for (const platform of ["windows_no_firewall", "windows_msix"]) {
    assert.equal(decideNetworkLockdown({ ...base, platform }).violation, false, platform);
  }
});

test("the advisory says egress is open by design, not that something failed", () => {
  const out = decideNetworkLockdown({ ...base, platform: "windows_no_firewall" });
  assert.match(out.detail, /by design/);
  assert.doesNotMatch(out.detail, /couldn't|failed/i);
});

test("a relaxed dev build proceeds, but still records a violation", () => {
  const out = decideNetworkLockdown({ ...base, platform: "linux", relaxed: true });
  assert.equal(out.decision, "advisory");
  assert.equal(out.eventKind, "network_lockdown_failed");
  // The record is the only reason a build-time escape hatch is tolerable.
  assert.equal(out.violation, true);
});

test("an unelevated build that never wanted a firewall is not 'relaxed'", () => {
  // Both are advisory, so the decision alone cannot tell them apart — the
  // reason has to. A dev machine running the ordinary release must report
  // "nothing was attempted", not "a check was waived".
  const out = decideNetworkLockdown({ ...base, platform: "windows_msix", relaxed: true });
  assert.equal(out.eventKind, "network_lockdown_not_applicable");
  assert.equal(out.violation, false);
});

test("Linux without the privileged helper still blocks", () => {
  const out = decideNetworkLockdown({ ...base, platform: "linux" });
  assert.equal(out.decision, "blocked");
  assert.equal(out.violation, true);
  assert.match(out.message, /couldn't secure your network/);
});

test("an unknown platform blocks rather than assuming it is safe", () => {
  assert.equal(decideNetworkLockdown({ ...base, platform: null }).decision, "blocked");
});

test("the error from a rejected or timed-out call is carried into the record", () => {
  const out = decideNetworkLockdown({
    ...base,
    platform: "linux",
    error: "network lockdown timed out after 8s (helper unresponsive?)",
  });
  assert.equal(out.detail, "network lockdown timed out after 8s (helper unresponsive?)");
});

test("a silent false still gets a detail, so the record is never blank", () => {
  const out = decideNetworkLockdown({ ...base, platform: "linux" });
  assert.equal(out.detail, "enable_network_lockdown returned false");
});

test("windows_no_admin — a firewall build refused elevation — still blocks", () => {
  // The whole point of the three-way split in the native layer. This build
  // was MEANT to have a firewall and does not, so the candidate is stopped
  // and the original message is the honest one. If this ever starts passing
  // as advisory, the gate is disarmed for the machines it exists to catch.
  const out = decideNetworkLockdown({ ...base, platform: "windows_no_admin" });
  assert.equal(out.decision, "blocked");
  assert.equal(out.violation, true);
  assert.match(out.message, /couldn't secure your network/);
});

test("an elevated Windows build that fails to lock down still blocks", () => {
  assert.equal(decideNetworkLockdown({ ...base, platform: "windows" }).decision, "blocked");
});

test("platform matching is case-insensitive", () => {
  assert.equal(
    decideNetworkLockdown({ ...base, platform: "Windows_No_Firewall" }).decision,
    "advisory"
  );
});
