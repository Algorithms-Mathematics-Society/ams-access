/**
 * The API's submission shape, in the one the contest room reads.
 *
 * The room was fed `listMySubmissions()` through an `as unknown as` cast. The
 * two types share almost no field names — `uid` vs `id`, `problem_label` vs
 * `problem_id`, `verdict` vs `final_verdict` — so every filter keyed on them
 * matched nothing and the Attempts panel was permanently empty, along with
 * the verdict chips, the question-rail badges, the judging lockout and the
 * late-verdict recovery. TypeScript could not object, because the cast told
 * it not to.
 *
 * Two things the cast was hiding beyond the renames:
 *
 * **Statuses are lowercase on the wire.** `SubmissionStatus` in ams-api is
 * `pending|queued|running|completed|failed`; every check in the room compares
 * against `"QUEUED"`/`"RUNNING"`. Fixing only the field names would have left
 * the judging lockout dead and rendered every un-judged row as an internal
 * error.
 *
 * **`attempt_no` does not exist.** Submissions are contest-scoped server-side
 * and carry no per-problem ordinal, so it is synthesised here — by problem,
 * oldest first.
 */

import type { SubmissionResult, TestcaseResult } from "@/lib/proctor-api";
import type { SubmissionAttemptRecord } from "./submission-state";

/** Wire status → the vocabulary the room speaks. */
export function normalizeStatus(raw: string): string {
  switch (raw.toLowerCase()) {
    case "pending":
    case "queued":
      return "QUEUED";
    case "running":
      return "RUNNING";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      // Unknown statuses are *not* mapped to a terminal state. Treating one
      // as finished would show a verdict for a submission still being judged.
      return raw.toUpperCase();
  }
}

/** A submission that has not been judged yet, whatever it is called today. */
export function isPendingStatus(raw: string): boolean {
  const status = normalizeStatus(raw);
  return status === "QUEUED" || status === "RUNNING";
}

export type AttemptRecord = SubmissionAttemptRecord & {
  /** Carried through so the verdict panel can build the per-family breakdown
   * without a second round trip. */
  testcases: TestcaseResult[];
};

/**
 * Adapt a submission list, newest first.
 *
 * `attempt_no` counts from 1 per problem in `created_at` order, so "attempt 3
 * of A" means what a candidate would expect regardless of what they were
 * working on in between.
 */
export function toAttemptRecords(submissions: SubmissionResult[]): AttemptRecord[] {
  const byProblem = new Map<string, SubmissionResult[]>();
  for (const submission of submissions) {
    const label = submission.problem_label ?? "";
    const bucket = byProblem.get(label);
    if (bucket) bucket.push(submission);
    else byProblem.set(label, [submission]);
  }

  const ordinals = new Map<string, number>();
  for (const [, bucket] of byProblem) {
    bucket
      .slice()
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      .forEach((submission, index) => ordinals.set(submission.uid, index + 1));
  }

  return submissions
    .map((submission) => ({
      id: submission.uid,
      problem_id: submission.problem_label,
      question_title: null,
      attempt_no: ordinals.get(submission.uid) ?? 1,
      language: submission.language,
      status: normalizeStatus(submission.status),
      final_verdict: submission.verdict,
      score: submission.score,
      runtime_ms: submission.max_runtime_ms,
      memory_kb: submission.max_memory_kb,
      error_message: null,
      compile_output: submission.compile_output || null,
      source_code: null,
      created_at: submission.created_at,
      started_at: null,
      finished_at: null,
      testcases: submission.testcases ?? [],
    }))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
