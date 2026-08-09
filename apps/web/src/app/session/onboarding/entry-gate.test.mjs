// Who may start onboarding.
//
// The bug this replaces was a hard block on the recovery path. `isAfterStart`
// was true for the whole contest, and the render gate hid every stage behind
// it, so anyone arriving after the start — including **every approved
// resume**, which routes back through onboarding — hit "Join window is closed
// once contest starts" with no way forward and no way out but Ctrl+Shift+Q.
//
// It also contradicted the server, which permits late entry outright.

import test from "node:test";
import assert from "node:assert/strict";

import {
  blockedMessage,
  decideEntry,
  shouldRunChecks,
  verificationOpensAtMs,
} from "./entry-gate.ts";

const START = Date.parse("2026-05-01T10:00:00Z");
const window = (phase, minutes = 30) => ({
  phase,
  starts_at: "2026-05-01T10:00:00Z",
  verification_window_minutes: minutes,
});

test("a running contest lets a late arrival in", () => {
  // The regression. The server allows this; the client used to refuse it.
  const decision = decideEntry(window("running"), START + 5 * 60_000);
  assert.equal(decision.kind, "live");
  assert.equal(shouldRunChecks(decision), true);
  assert.equal(blockedMessage(decision), null);
});

test("a resume mid-contest is let in", () => {
  // Same path, and the one that matters most: an approved resume re-enters
  // through onboarding an hour after the start.
  const decision = decideEntry(window("running"), START + 60 * 60_000);
  assert.equal(shouldRunChecks(decision), true);
});

test("the verification window runs the checks", () => {
  const decision = decideEntry(window("verification"), START - 10 * 60_000);
  assert.equal(decision.kind, "open");
  assert.equal(shouldRunChecks(decision), true);
});

test("before check-in opens, the candidate waits and is told how long", () => {
  const decision = decideEntry(window("before_window"), START - 45 * 60_000);
  assert.equal(decision.kind, "too_early");
  // Check-in opens 30 minutes before the start, so 15 minutes from now.
  assert.equal(decision.opensInMs, 15 * 60_000);
  assert.equal(shouldRunChecks(decision), false);
  assert.match(blockedMessage(decision), /automatically/);
});

test("an ended contest is the only other refusal", () => {
  const decision = decideEntry(window("ended"), START + 3 * 3_600_000);
  assert.equal(decision.kind, "ended");
  assert.equal(shouldRunChecks(decision), false);
  assert.equal(blockedMessage(decision), "This contest has ended.");
});

test("the countdown never goes negative", () => {
  // A clock skewed forwards must not render as a negative wait.
  const decision = decideEntry(window("before_window"), START + 60_000);
  assert.equal(decision.opensInMs, 0);
});

test("no verification window means there is nothing to be early for", () => {
  assert.equal(verificationOpensAtMs(window("before_window", 0)), null);
  const decision = decideEntry(window("before_window", 0), START - 3_600_000);
  assert.equal(decision.kind, "too_early");
  assert.equal(decision.opensInMs, 0);
});

test("check-in opens the configured number of minutes before the start", () => {
  assert.equal(verificationOpensAtMs(window("verification", 30)), START - 30 * 60_000);
  assert.equal(verificationOpensAtMs(window("verification", 5)), START - 5 * 60_000);
});

test("an unparseable start time does not throw", () => {
  const broken = {
    phase: "before_window",
    starts_at: "not a date",
    verification_window_minutes: 30,
  };
  assert.equal(verificationOpensAtMs(broken), null);
  assert.equal(decideEntry(broken, START).kind, "too_early");
});

test("an unknown phase is treated as not-yet-open, never as live", () => {
  // Fail closed: a phase this client does not recognise must not admit
  // someone to a contest that has not started.
  const decision = decideEntry(window("something_new"), START);
  assert.equal(shouldRunChecks(decision), false);
});
