import test from "node:test";
import assert from "node:assert/strict";

import {
  attemptsForProblem,
  isPendingSubmissionStatus,
  isUiBlockingPending,
  JUDGING_LOCKOUT_MAX_MS,
  normalizeAttemptForRunResult,
  normalizeSubmissionVerdict,
  resolveRunResultRefresh,
  shouldAutoExpandAttempt,
} from "./submission-state.ts";

function makeAttempt(overrides = {}) {
  return {
    id: "attempt-1",
    problem_id: "problem-1",
    attempt_no: 1,
    language: "cpp17",
    status: "DONE",
    score: 0,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

test("submission state helpers normalize backend attempts", () => {
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ status: "QUEUED" })), "QUEUED");
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ status: "RUNNING" })), "RUNNING");
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ final_verdict: "AC" })), "AC");
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ final_verdict: "CE" })), "CE");
  // "judging never completed" is `SE`, the judge's own name for it. This
  // asserted `IE` against a `status === "FAILED" ? "IE" : "IE"` tautology,
  // which could not have failed whatever the input.
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ status: "FAILED" })), "SE");
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ final_verdict: "SE" })), "SE");
  // Kept as an alias so stored verdicts from before the rename still render.
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ final_verdict: "IE" })), "IE");

  const normalized = normalizeAttemptForRunResult(
    makeAttempt({
      final_verdict: "CE",
      error_message: "generic worker failure",
      compile_output: "main.cpp:1: error: expected ';'",
    })
  );

  assert.equal(normalized.status, "CE");
  assert.equal(normalized.compile_output, "main.cpp:1: error: expected ';'");
  assert.equal(normalized.stderr, "generic worker failure");
  assert.equal(isPendingSubmissionStatus("QUEUED"), true);
  assert.equal(isPendingSubmissionStatus("RUNNING"), true);
  assert.equal(isPendingSubmissionStatus("DONE"), false);
  assert.equal(
    shouldAutoExpandAttempt(
      makeAttempt({ id: "attempt-1", status: "DONE", final_verdict: "WA" }),
      makeAttempt({ id: "attempt-1", status: "RUNNING" })
    ),
    true
  );
});

test("isUiBlockingPending age-bounds the Judging… lockout", () => {
  const NOW = Date.parse("2026-07-04T10:00:00Z");

  // Fresh pending (age 0) blocks.
  assert.equal(isUiBlockingPending("QUEUED", new Date(NOW).toISOString(), NOW), true);
  assert.equal(isUiBlockingPending("RUNNING", new Date(NOW).toISOString(), NOW), true);

  // Pending at exactly maxAge does NOT block (strict <).
  const atMaxAge = new Date(NOW - JUDGING_LOCKOUT_MAX_MS).toISOString();
  assert.equal(isUiBlockingPending("QUEUED", atMaxAge, NOW), false);

  // Pending older than maxAge does NOT block.
  const olderThanMax = new Date(NOW - JUDGING_LOCKOUT_MAX_MS - 1).toISOString();
  assert.equal(isUiBlockingPending("QUEUED", olderThanMax, NOW), false);

  // Just under maxAge still blocks.
  const justUnderMax = new Date(NOW - JUDGING_LOCKOUT_MAX_MS + 1).toISOString();
  assert.equal(isUiBlockingPending("QUEUED", justUnderMax, NOW), true);

  // Terminal statuses never block regardless of age, even if "created" is fresh.
  for (const status of ["DONE", "AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE", "FAILED"]) {
    assert.equal(isUiBlockingPending(status, new Date(NOW).toISOString(), NOW), false);
  }

  // Missing/garbage created_at does NOT block (unknown age -> never trap; server backstops).
  assert.equal(isUiBlockingPending("QUEUED", null, NOW), false);
  assert.equal(isUiBlockingPending("QUEUED", undefined, NOW), false);
  assert.equal(isUiBlockingPending("QUEUED", "", NOW), false);
  assert.equal(isUiBlockingPending("QUEUED", "not-a-date", NOW), false);
});

test("resolveRunResultRefresh is strictly id-keyed — never adopts another attempt (the cross-write regression pin)", () => {
  const prevRun = {
    id: "run-1",
    attempt_no: 1,
    status: "AC",
    runtime_ms: 12,
    memory_kb: 2048,
    compile_output: null,
    stderr: null,
  };
  // THE REPRO SHAPE: raw list contains only newer SUBMIT attempts. The old
  // `?? filtered[0]` fallback returned the newest submission (WA/340ms) here.
  const submitsOnly = [
    makeAttempt({
      id: "sub-2",
      attempt_no: 2,
      status: "DONE",
      final_verdict: "WA",
      runtime_ms: 340,
      memory_kb: 9001,
    }),
    makeAttempt({ id: "sub-3", attempt_no: 3, status: "QUEUED" }),
  ];
  const out = resolveRunResultRefresh(prevRun, submitsOnly);
  assert.equal(out, prevRun); // unchanged, same reference
  assert.equal(out.id, "run-1");
  assert.notEqual(out.status, "WA"); // the old bug asserted impossible
  assert.notEqual(out.runtime_ms, 340);

  // Sensitivity: the id-match arm DOES refresh — same id, later verdict.
  const withRunRow = [
    ...submitsOnly,
    makeAttempt({
      id: "run-1",
      attempt_no: 1,
      status: "DONE",
      final_verdict: "TLE",
      runtime_ms: 2000,
      memory_kb: 4096,
    }),
  ];
  const refreshed = resolveRunResultRefresh(prevRun, withRunRow);
  assert.equal(refreshed.id, "run-1");
  assert.equal(refreshed.status, "TLE");
  assert.equal(refreshed.runtime_ms, 2000);
});

test("resolveRunResultRefresh null/empty edges", () => {
  assert.equal(resolveRunResultRefresh(null, [makeAttempt({})]), null);
  const prevRun = {
    id: "run-9",
    attempt_no: 1,
    status: "QUEUED",
    runtime_ms: null,
    memory_kb: null,
    compile_output: null,
    stderr: null,
  };
  assert.equal(resolveRunResultRefresh(prevRun, []), prevRun);
});

// ── the Attempts panel shows one problem's history, not the contest's ──────
//
// The room used to store this list, written from whatever problem was active
// when the fetch was issued. A fetch outlives that problem, so a reply could
// land under the wrong tab and stay there.

test("attemptsForProblem keeps only the asked-for problem", () => {
  const all = [
    makeAttempt({ id: "a1", problem_id: "A", attempt_no: 1 }),
    makeAttempt({ id: "b1", problem_id: "B", attempt_no: 1 }),
    makeAttempt({ id: "a2", problem_id: "A", attempt_no: 2 }),
  ];
  assert.deepEqual(
    attemptsForProblem(all, "A").map((a) => a.id),
    ["a2", "a1"],
    "B's attempt must not appear under A, and A's must be newest-first"
  );
  assert.deepEqual(
    attemptsForProblem(all, "B").map((a) => a.id),
    ["b1"]
  );
});

test("attemptsForProblem shows nothing for a problem with no attempts", () => {
  const all = [makeAttempt({ id: "a1", problem_id: "A" })];
  assert.deepEqual(attemptsForProblem(all, "C"), []);
});

test("attemptsForProblem never falls back to the whole contest", () => {
  // The failure being guarded: an empty or unknown label showing every
  // attempt in the contest, which is what a `?? all` fallback would do.
  const all = [
    makeAttempt({ id: "a1", problem_id: "A" }),
    makeAttempt({ id: "b1", problem_id: "B" }),
  ];
  assert.deepEqual(attemptsForProblem(all, ""), [], "no label means no rows, not all rows");
});

test("attemptsForProblem hides a submission the server could not attribute", () => {
  // `_to_out` sends problem_label: "" when a submission has no
  // contest_problem_id. Such a row belongs under no problem rather than all.
  const all = [
    makeAttempt({ id: "orphan", problem_id: "" }),
    makeAttempt({ id: "a1", problem_id: "A" }),
  ];
  assert.deepEqual(
    attemptsForProblem(all, "A").map((a) => a.id),
    ["a1"]
  );
});

test("attemptsForProblem does not mutate what it is given", () => {
  // It sorts, and sorting the caller's array in place would reorder the
  // all-problems list the question rail badges are built from.
  const all = [
    makeAttempt({ id: "a1", problem_id: "A", attempt_no: 1 }),
    makeAttempt({ id: "a2", problem_id: "A", attempt_no: 2 }),
  ];
  const order = all.map((a) => a.id);
  attemptsForProblem(all, "A");
  assert.deepEqual(
    all.map((a) => a.id),
    order
  );
});
