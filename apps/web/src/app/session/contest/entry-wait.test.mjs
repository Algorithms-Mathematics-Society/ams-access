// What the screen says while entry is queued.
//
// A thousand candidates pressing Enter at the same second queue behind each
// other; the slowest were measured around half a minute. The screen used to
// show one unchanging "Loading contest..." and then, at twenty seconds, an
// error blaming the connection -- for a server that was working and about to
// answer. Candidates retried, which lengthened the queue that was the problem.

import test from "node:test";
import assert from "node:assert/strict";

import { ENTRY_WAIT_PHASES, entryWaitPhase } from "./entry-wait.ts";

test("the first thing a candidate sees is that they are being let in", () => {
  assert.equal(entryWaitPhase(0).label, "Letting you in...");
  assert.equal(entryWaitPhase(1_500).label, "Letting you in...");
});

test("the explanation changes as the wait grows, and never goes backwards", () => {
  const seen = [0, 7_000, 20_000, 40_000, 120_000].map((ms) => entryWaitPhase(ms));
  const details = seen.map((phase) => phase.detail);
  assert.equal(new Set(details).size, 4, "each phase should say something new");
  // Monotonic: a candidate watching never sees an earlier message return.
  const thresholds = seen.map((phase) => phase.after);
  assert.deepEqual(
    thresholds,
    [...thresholds].sort((a, b) => a - b)
  );
});

test("a long wait still reassures rather than blaming the candidate", () => {
  const late = entryWaitPhase(60_000);
  assert.match(late.detail, /place is held|not lost|invigilator/i);
  // The thing that must never appear: telling someone their connection is at
  // fault while the server is simply busy.
  for (const phase of ENTRY_WAIT_PHASES) {
    assert.doesNotMatch(phase.detail, /check your connection/i);
    assert.doesNotMatch(phase.label, /error|failed|unable/i);
  }
});

test("no phase invents progress the client cannot know", () => {
  for (const phase of ENTRY_WAIT_PHASES) {
    assert.doesNotMatch(phase.detail, /\d+\s*%/, "no fake percentage");
    assert.doesNotMatch(
      phase.detail,
      /position|queue number|you are #/i,
      "no invented queue position"
    );
    assert.doesNotMatch(
      phase.detail,
      /\b\d+\s*(seconds|minutes)\s*(left|remaining)/i,
      "no invented ETA"
    );
  }
});
