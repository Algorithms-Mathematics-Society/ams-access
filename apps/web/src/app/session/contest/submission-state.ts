export type RunVerdict =
  | "QUEUED"
  | "RUNNING"
  | "AC"
  | "WA"
  | "TLE"
  | "MLE"
  | "RE"
  | "CE"
  | "OLE"
  // The judge's name for "judging never completed". `IE` was this codebase's
  // own name for the same thing; kept so stored verdicts still render.
  | "SE"
  | "IE";

export type RunAttempt = {
  id: string;
  attempt_no: number;
  status: RunVerdict;
  runtime_ms?: number | null;
  memory_kb?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
};

export type SubmissionAttemptRecord = {
  id: string;
  problem_id: string;
  question_title?: string | null;
  attempt_no: number;
  language: string;
  status: string;
  final_verdict?: string | null;
  score: number;
  runtime_ms?: number | null;
  memory_kb?: number | null;
  error_message?: string | null;
  compile_output?: string | null;
  source_code?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export function isPendingSubmissionStatus(status: string | null | undefined): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

/**
 * Max age for a pending submission to lock the Submit button ("Judging…").
 * Older pendings (stuck judge / orphaned row) must NOT trap the candidate in a
 * disabled button — the server's ALREADY_PENDING guard remains the backstop if
 * the attempt is genuinely still being judged.
 */
export const JUDGING_LOCKOUT_MAX_MS = 3 * 60_000;

/** True when a submission should lock the Submit UI: pending AND recent. */
export function isUiBlockingPending(
  status: string | null | undefined,
  createdAt: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = JUDGING_LOCKOUT_MAX_MS
): boolean {
  if (!isPendingSubmissionStatus(status)) return false;
  const created = Date.parse(createdAt ?? "");
  if (Number.isNaN(created)) return false; // unknown age → never trap; server backstops
  return nowMs - created < maxAgeMs;
}

export function normalizeSubmissionVerdict(attempt: SubmissionAttemptRecord): RunVerdict {
  // Statuses arrive here already normalized by `attempt-adapter`, which is
  // the only thing that should be producing these records.
  if (attempt.status === "QUEUED" || attempt.status === "RUNNING") {
    return attempt.status as RunVerdict;
  }
  const verdict = String(attempt.final_verdict ?? "").toUpperCase();
  switch (verdict) {
    case "AC":
    case "WA":
    case "TLE":
    case "MLE":
    case "RE":
    case "CE":
    case "OLE":
    case "SE":
    case "IE":
      return verdict;
    default:
      // "judging never completed" — the server's own name for it. This was
      // `attempt.status === "FAILED" ? "IE" : "IE"`, a tautology that dressed
      // an unhandled case up as a considered one.
      return "SE";
  }
}

export function normalizeAttemptForRunResult(attempt: SubmissionAttemptRecord): RunAttempt {
  const status = normalizeSubmissionVerdict(attempt);
  const compileOutput = attempt.compile_output ?? attempt.error_message ?? null;
  const stderr = status !== "AC" ? (attempt.error_message ?? compileOutput) : null;
  return {
    id: attempt.id,
    attempt_no: attempt.attempt_no,
    status,
    runtime_ms: attempt.runtime_ms ?? null,
    memory_kb: attempt.memory_kb ?? null,
    // `SE` alongside `CE`/`IE`: judging that never completed is exactly when
    // whatever the worker did manage to say is worth showing.
    compile_output: status === "CE" || status === "IE" || status === "SE" ? compileOutput : null,
    stderr,
  };
}

/**
 * Refresh the Output panel's run result from a fetched RAW attempts list
 * (runs included). STRICTLY id-keyed: returns the normalized row matching
 * prev.id, else prev unchanged. NO fallback to any other attempt — the old
 * `?? filtered[0]` fallback displayed the newest SUBMISSION in the run panel
 * (repro-proven misattribution). See design 2026-07-04-runresult-crosswrite-fix.
 */
export function resolveRunResultRefresh(
  prev: RunAttempt | null,
  rawAttempts: SubmissionAttemptRecord[]
): RunAttempt | null {
  if (!prev) return prev;
  const match = rawAttempts.find((attempt) => attempt.id === prev.id);
  return match ? normalizeAttemptForRunResult(match) : prev;
}

export function isTerminalSubmission(attempt: SubmissionAttemptRecord): boolean {
  return !isPendingSubmissionStatus(attempt.status);
}

export function shouldAutoExpandAttempt(
  current: SubmissionAttemptRecord | null | undefined,
  previous: SubmissionAttemptRecord | null | undefined
): boolean {
  if (!current || !isTerminalSubmission(current)) return false;
  if (!previous) return true;
  return (
    previous.id !== current.id ||
    previous.status !== current.status ||
    previous.final_verdict !== current.final_verdict
  );
}
