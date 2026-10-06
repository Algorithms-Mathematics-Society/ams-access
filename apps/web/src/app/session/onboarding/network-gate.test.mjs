// What a missing egress firewall is worth: a record, never a wall.
//
// Two bugs sit behind this. The first blocked every candidate on the ordinary
// unelevated Windows release, with a message ("we couldn't secure your
// network") describing a failure that never happened because nothing was
// attempted. The fix split "never asked to elevate" from "asked and was
// refused" -- correct, but it kept a gate on the second.
//
// A gate cannot stand on a privilege the candidate can decline. It fails open
// for anyone willing to say no to the prompt, and falls shut on an honest
// machine that is merely ordinary. So the firewall is best-effort everywhere
// and the record is the control. The distinction that survives is whether a
// firewall was EXPECTED, because that decides whether the open egress is worth
// an invigilator's attention.
//
// The test that matters most is the last one: nothing may return a blocking
// decision, whatever the platform.

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

test("Linux without the privileged helper enters, and is recorded", () => {
  const out = decideNetworkLockdown({ ...base, platform: "linux" });
  assert.equal(out.decision, "advisory");
  assert.equal(out.violation, true);
  assert.equal(out.eventKind, "network_lockdown_failed");
});

test("an unknown platform is recorded rather than assumed safe", () => {
  const out = decideNetworkLockdown({ ...base, platform: null });
  assert.equal(out.decision, "advisory");
  assert.equal(out.violation, true);
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

test("windows_no_admin — a firewall build refused elevation — is recorded", () => {
  // The whole point of the three-way split in the native layer. This build was
  // MEANT to have a firewall and does not: someone declined a prompt that was
  // meant to be accepted. It no longer stops them, but it must stay a
  // violation, or the one shape worth an invigilator's attention goes silent.
  const out = decideNetworkLockdown({ ...base, platform: "windows_no_admin" });
  assert.equal(out.violation, true);
  assert.equal(out.eventKind, "network_lockdown_failed");
});

test("an elevated Windows build that fails to lock down is recorded", () => {
  const out = decideNetworkLockdown({ ...base, platform: "windows" });
  assert.equal(out.violation, true);
  assert.equal(out.eventKind, "network_lockdown_failed");
});

test("platform matching is case-insensitive", () => {
  assert.equal(
    decideNetworkLockdown({ ...base, platform: "Windows_No_Firewall" }).decision,
    "advisory"
  );
});

test("no platform, engaged state or error can produce a blocking decision", () => {
  // The guarantee this module now makes. Egress lockdown is best-effort
  // because it rests on privilege the exam shell does not hold, so no input
  // may put a wall in front of a candidate.
  const platforms = [
    "windows",
    "windows_no_admin",
    "windows_no_firewall",
    "windows_msix",
    "linux",
    "macos",
    "something_new",
    null,
  ];
  for (const platform of platforms) {
    for (const engaged of [true, false]) {
      for (const relaxed of [true, false]) {
        for (const error of [null, "helper unresponsive"]) {
          const out = decideNetworkLockdown({ platform, engaged, error, relaxed });
          assert.ok(
            out.decision === "engaged" || out.decision === "advisory",
            `${platform}/${engaged}/${relaxed} produced ${out.decision}`
          );
          assert.equal(out.message, undefined, `${platform} still carries a block message`);
        }
      }
    }
  }
});

test("every non-engaged outcome still carries a usable reason", () => {
  // The record is the control now, so a blank detail would be the whole
  // failure: an invigilator reading the feed must be able to tell a declined
  // admin prompt from a build that never asked.
  for (const platform of ["windows", "windows_no_admin", "windows_no_firewall", "linux", null]) {
    const out = decideNetworkLockdown({ ...base, platform });
    assert.ok(out.detail && out.detail.length > 0, String(platform));
    assert.ok(out.eventKind.startsWith("network_lockdown_"), String(platform));
  }
});
