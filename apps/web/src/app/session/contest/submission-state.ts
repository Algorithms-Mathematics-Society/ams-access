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

export function normalizeSubmissionVerdict(attempt: SubmissionAttemptRecord): RunVerdict {
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
    case "IE":
      return verdict;
    default:
      return attempt.status === "FAILED" ? "IE" : "IE";
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
    compile_output: status === "CE" || status === "IE" ? compileOutput : null,
    stderr,
  };
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
