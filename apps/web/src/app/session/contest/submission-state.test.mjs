import test from "node:test";
import assert from "node:assert/strict";

import {
  isPendingSubmissionStatus,
  normalizeAttemptForRunResult,
  normalizeSubmissionVerdict,
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
  assert.equal(normalizeSubmissionVerdict(makeAttempt({ status: "FAILED" })), "IE");

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
