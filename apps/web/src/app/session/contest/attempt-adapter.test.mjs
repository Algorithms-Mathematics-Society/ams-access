// Adapting the API's submissions into the shape the room reads.
//
// This existed as an `as unknown as` cast, which compiled and matched
// nothing: the Attempts panel, verdict chips, rail badges, judging lockout
// and late-verdict recovery were all fed an empty list, permanently, and no
// type error was possible.
//
// The two cases worth most here are the ones a rename alone would not have
// fixed — lowercase wire statuses, and a synthesised attempt number.

import test from "node:test";
import assert from "node:assert/strict";

import { isPendingStatus, normalizeStatus, toAttemptRecords } from "./attempt-adapter.ts";

function submission(overrides = {}) {
  return {
    uid: "s-1",
    problem_label: "A",
    language: "cpp23",
    status: "completed",
    created_at: "2026-05-01T10:00:00Z",
    verdict: "AC",
    score: 100,
    passed_count: 3,
    total_count: 3,
    max_runtime_ms: 12,
    max_memory_kb: 2048,
    compile_output: "",
    testcases: [],
    ...overrides,
  };
}

test("the field renames the cast was hiding", () => {
  const [record] = toAttemptRecords([submission()]);
  assert.equal(record.id, "s-1");
  assert.equal(record.problem_id, "A");
  assert.equal(record.final_verdict, "AC");
  assert.equal(record.runtime_ms, 12);
  assert.equal(record.memory_kb, 2048);
});

test("wire statuses are lowercase and are uppercased", () => {
  // The half the rename would have missed: every check in the room compares
  // against "QUEUED"/"RUNNING", so without this the judging lockout stays
  // dead and un-judged rows render as errors.
  assert.equal(normalizeStatus("queued"), "QUEUED");
  assert.equal(normalizeStatus("running"), "RUNNING");
  assert.equal(normalizeStatus("completed"), "COMPLETED");
  assert.equal(normalizeStatus("failed"), "FAILED");
  assert.equal(normalizeStatus("pending"), "QUEUED");
});

test("an unknown status is not treated as finished", () => {
  // Mapping it to a terminal state would show a verdict for a submission
  // still being judged.
  assert.equal(normalizeStatus("reticulating"), "RETICULATING");
  assert.equal(isPendingStatus("reticulating"), false);
  assert.equal(isPendingStatus("queued"), true);
  assert.equal(isPendingStatus("PENDING"), true);
});

test("attempt numbers count from one, per problem, oldest first", () => {
  const records = toAttemptRecords([
    submission({ uid: "a1", problem_label: "A", created_at: "2026-05-01T10:00:00Z" }),
    submission({ uid: "b1", problem_label: "B", created_at: "2026-05-01T10:05:00Z" }),
    submission({ uid: "a2", problem_label: "A", created_at: "2026-05-01T10:10:00Z" }),
    submission({ uid: "a3", problem_label: "A", created_at: "2026-05-01T10:15:00Z" }),
  ]);
  const numberOf = (uid) => records.find((r) => r.id === uid).attempt_no;

  // Interleaved work must not make "attempt 3 of A" mean something else.
  assert.equal(numberOf("a1"), 1);
  assert.equal(numberOf("a2"), 2);
  assert.equal(numberOf("a3"), 3);
  assert.equal(numberOf("b1"), 1);
});

test("attempt numbers are stable regardless of arrival order", () => {
  const chronological = toAttemptRecords([
    submission({ uid: "a1", created_at: "2026-05-01T10:00:00Z" }),
    submission({ uid: "a2", created_at: "2026-05-01T10:10:00Z" }),
  ]);
  const reversed = toAttemptRecords([
    submission({ uid: "a2", created_at: "2026-05-01T10:10:00Z" }),
    submission({ uid: "a1", created_at: "2026-05-01T10:00:00Z" }),
  ]);
  const numbers = (list) =>
    Object.fromEntries(list.map((record) => [record.id, record.attempt_no]));

  assert.deepEqual(numbers(chronological), { a1: 1, a2: 2 });
  assert.deepEqual(numbers(reversed), { a1: 1, a2: 2 });
});

test("the list comes back newest first", () => {
  const records = toAttemptRecords([
    submission({ uid: "old", created_at: "2026-05-01T10:00:00Z" }),
    submission({ uid: "new", created_at: "2026-05-01T11:00:00Z" }),
  ]);
  assert.deepEqual(
    records.map((r) => r.id),
    ["new", "old"]
  );
});

test("a queued submission carries no verdict", () => {
  const [record] = toAttemptRecords([submission({ status: "queued", verdict: null, score: 0 })]);
  assert.equal(record.status, "QUEUED");
  assert.equal(record.final_verdict, null);
});

test("testcases ride along for the family breakdown", () => {
  // So the verdict panel does not need a second round trip, and cannot
  // disagree with the row it is rendering under.
  const cases = [{ kind: "io", label: "1", verdict: "AC", testcase_no: 1 }];
  const [record] = toAttemptRecords([submission({ testcases: cases })]);
  assert.deepEqual(record.testcases, cases);
});

test("an empty compile output becomes null rather than an empty panel", () => {
  const [record] = toAttemptRecords([submission({ compile_output: "" })]);
  assert.equal(record.compile_output, null);
});

test("an empty list stays empty", () => {
  assert.deepEqual(toAttemptRecords([]), []);
});
