import assert from "node:assert/strict";
import test from "node:test";

import { isPracticeContest, practiceEntryState, PRACTICE_TICK_MS } from "./practice-card.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-08-15T12:00:00Z");

/**
 * A practice contest as one actually arrives: `is_practice` true, and a window
 * the organiser typed weeks ago. Both facts matter — the stale window is what
 * used to make the card unreachable.
 */
function practice(overrides = {}) {
  return {
    id: "p1",
    title: "Practice",
    start_at: new Date(NOW - 30 * DAY).toISOString(),
    end_at: new Date(NOW - 30 * DAY + 2 * HOUR).toISOString(),
    status: "SCHEDULED",
    is_practice: true,
    ...overrides,
  };
}

test("a practice contest is recognised whatever its dates say", () => {
  // `getContestEntryState` consults this before any time-based branch, so
  // these are the inputs that used to render ENDED with a disabled button on
  // a contest the server opens without complaint.
  for (const [label, dates] of [
    ["thirty days stale", {}],
    ["far past", { start_at: new Date(NOW - 365 * DAY).toISOString() }],
    ["far future", { start_at: new Date(NOW + 365 * DAY).toISOString() }],
    ["unusable dates", { start_at: "", end_at: "" }],
  ]) {
    assert.equal(isPracticeContest(practice(dates)), true, label);
  }
});

test("a graded contest is never mistaken for a practice one", () => {
  // The leak this special case could cause. `is_practice` must be the only
  // thing that diverts a card out of the ordinary time-based path.
  assert.equal(isPracticeContest({ is_practice: false }), false);
});

test("a contest with no is_practice field falls through unchanged", () => {
  // The field is optional, and every contest stored before it existed omits
  // it. Those must keep their existing time-based behaviour exactly.
  assert.equal(isPracticeContest({}), false);
  assert.equal(isPracticeContest({ is_practice: undefined }), false);
});

test("a truthy non-boolean does not count as practice", () => {
  // Guards against a wire value like "false" or 1 quietly unlocking a graded
  // contest's card.
  assert.equal(isPracticeContest({ is_practice: "false" }), false);
  assert.equal(isPracticeContest({ is_practice: 1 }), false);
});

test("the practice card can always be entered", () => {
  const state = practiceEntryState();
  assert.equal(state.canEnter, true);
  assert.equal(state.phase, "live");
  assert.equal(state.sessionType, "new");
});

test("the practice card shows no countdown and no clock times", () => {
  const state = practiceEntryState();

  assert.equal(state.timingLabel, "no time limit");
  assert.equal(state.contestEndsAt, "—");
  assert.equal(state.contestStartsAt, "—");
  assert.equal(state.verificationOpensAt, "—");
});

test("no field of the practice card contains a formatted date", () => {
  // Any real timestamp here would be read off the meaningless window.
  for (const [key, value] of Object.entries(practiceEntryState())) {
    if (typeof value !== "string") continue;
    assert.ok(!/\d{1,2}:\d{2}/.test(value), `${key} looks like a time: ${value}`);
    assert.ok(!/\d{4}/.test(value), `${key} looks like a year: ${value}`);
  }
});

test("the practice wording never says 'practice run'", () => {
  // "Practice run" is the device rehearsal at ?mode=dry-run, which opens no
  // contest at all. Two different things; a candidate told the same words for
  // both cannot know which they are about to start.
  const state = practiceEntryState();
  const wording = `${state.ctaLabel} ${state.statusLabel} ${state.actionHelper} ${state.contestDateLabel}`;
  assert.ok(!/practice run/i.test(wording), wording);
});

test("the practice card says plainly that nothing is scored", () => {
  // Otherwise a candidate cannot tell the rehearsal from the graded round,
  // and the two cards are identical apart from a title.
  assert.match(practiceEntryState().actionHelper, /nothing.*scored/i);
});

test("a practice card does not re-render on contest boundaries", () => {
  // It has no boundary to cross and no countdown to advance.
  assert.equal(PRACTICE_TICK_MS, 60000);
});
