// The exam clock.
//
// The rule under test is the one a candidate has the most incentive to break:
// remaining time comes from the server, and the server's `phase` outranks any
// deadline arithmetic. The room previously computed this from `Date.now()`,
// so winding the system clock back extended your own exam.
//
// The second rule is the one that bit hardest in practice: when the deadline
// is unknown, say so. The old code invented "one hour from page load" and
// rendered it exactly like a real deadline.

import test from "node:test";
import assert from "node:assert/strict";

import { formatRemaining, isBell, paperIsOpen, remainingMs } from "./session-clock.ts";

const AT = 1_700_000_000_000; // arbitrary fixed "now"
const running = (endsAtMs) => ({ endsAtMs, phase: "running" });

test("remaining counts down to the deadline", () => {
  assert.equal(remainingMs(running(AT + 90_000), AT), 90_000);
});

test("remaining floors at zero rather than going negative", () => {
  // A negative would render as a growing countdown, which is worse than
  // stopped.
  assert.equal(remainingMs(running(AT - 5_000), AT), 0);
});

test("an unknown deadline reports no time, not zero time", () => {
  assert.equal(remainingMs(running(null), AT), null);
});

test("the bell rings when the deadline passes", () => {
  assert.equal(isBell(running(AT + 1), AT), false);
  assert.equal(isBell(running(AT), AT), true);
  assert.equal(isBell(running(AT - 1), AT), true);
});

test("the server saying ended outranks a deadline that has not passed", () => {
  // The case this closes: a client whose clock is behind would otherwise keep
  // accepting work after the contest closed. `phase` comes from the server.
  const snapshot = { endsAtMs: AT + 600_000, phase: "ended" };
  assert.equal(isBell(snapshot, AT), true);
});

test("an unknown deadline never rings the bell", () => {
  // Not knowing when the exam ends must not end it.
  assert.equal(isBell({ endsAtMs: null, phase: "running" }, AT), false);
});

test("time formats as HH:MM:SS", () => {
  assert.equal(formatRemaining(0), "00:00:00");
  assert.equal(formatRemaining(59_000), "00:00:59");
  assert.equal(formatRemaining(60_000), "00:01:00");
  assert.equal(formatRemaining(3_661_000), "01:01:01");
  assert.equal(formatRemaining(2 * 3_600_000), "02:00:00");
});

test("an unknown deadline renders as dashes, not zeros", () => {
  // Zeros read as "your time is up". Dashes read as "we do not know yet",
  // which is the truth.
  assert.equal(formatRemaining(null), "—:—:—");
  assert.notEqual(formatRemaining(null), "00:00:00");
});

test("negative input still formats as zero", () => {
  assert.equal(formatRemaining(-1), "00:00:00");
});

test("the paper is open only while the contest is running", () => {
  // During verification a session exists and the proctor is arming, but the
  // statements are withheld — the server 409s. This is what lets the room say
  // "opens in…" rather than showing a load error.
  assert.equal(paperIsOpen({ endsAtMs: AT, phase: "running" }), true);
  assert.equal(paperIsOpen({ endsAtMs: AT, phase: "verification" }), false);
  assert.equal(paperIsOpen({ endsAtMs: AT, phase: "before_window" }), false);
  assert.equal(paperIsOpen({ endsAtMs: AT, phase: "ended" }), false);
});
