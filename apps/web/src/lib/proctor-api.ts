/**
 * The proctor's client for ams-api.
 *
 * Two things this module exists to enforce.
 *
 * **The server owns the clock.** Every session response carries `server_time`.
 * A proctored exam whose remaining time is computed from `Date.now()` can be
 * extended by changing the system clock — which a candidate can do. We record
 * the offset between server and local time on every response and expose
 * `serverNow()`, and the countdown must be driven from that.
 *
 * **The token is not the internal secret.** This app runs on a machine the
 * candidate controls, so it holds only a participant bearer token: signed by
 * the server, scoped to one user, and useless for staff endpoints.
 */

import { resolveApiBase } from "./api-base";

const API = resolveApiBase();

/** Sent on every call. The server refuses builds older than its minimum with
 * a 426 naming the download, so a candidate on a stale installer gets a
 * sentence telling them what to do rather than a login that fails silently. */
const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "2.0.0";

// Long enough for a slow network at an exam centre; short enough that a dead
// connection surfaces rather than hanging the UI.
const DEFAULT_TIMEOUT_MS = 20_000;

export class ProctorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "",
    readonly detail: Record<string, unknown> | null = null
  ) {
    super(message);
  }

  /** The installed build is older than the server accepts. */
  get needsUpgrade(): boolean {
    return this.status === 426;
  }

  /** Seconds to wait before retrying, when the server said. */
  get retryAfterSeconds(): number {
    const value = this.detail?.retry_after;
    return typeof value === "number" ? value : 0;
  }

  /** Retrying will not help: the server rejected the request itself. */
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

// ── clock ────────────────────────────────────────────────────────────────

let serverOffsetMs = 0;
let haveServerTime = false;

function noteServerTime(iso: string | undefined): void {
  if (!iso) return;
  const server = Date.parse(iso);
  if (Number.isNaN(server)) return;
  serverOffsetMs = server - Date.now();
  haveServerTime = true;
}

/** Best estimate of the server's current time, in epoch ms. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

/** False until the first successful call — the UI should not start a timed
 * exam while the only clock available is the candidate's own. */
export function clockIsSynchronised(): boolean {
  return haveServerTime;
}

export function clockSkewMs(): number {
  return serverOffsetMs;
}

// ── token ────────────────────────────────────────────────────────────────

// Persisted, not just held in memory. The app restarting mid-exam is a
// normal event — that is the whole reason the resume flow exists — and an
// in-memory-only token turned every restart into a re-login *and* an
// invigilator-approved resume, when the session itself was still perfectly
// valid.
const TOKEN_KEY = "ams_participant_token";
const TOKEN_EXPIRY_KEY = "ams_participant_token_expires_at";

let token: string | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private mode, or a locked-down profile. In-memory still works.
    return null;
  }
}

export function setToken(value: string | null, expiresInSeconds?: number): void {
  token = value;
  const store = storage();
  if (!store) return;
  try {
    if (value === null) {
      store.removeItem(TOKEN_KEY);
      store.removeItem(TOKEN_EXPIRY_KEY);
      return;
    }
    store.setItem(TOKEN_KEY, value);
    if (expiresInSeconds) {
      store.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSeconds * 1000));
    }
  } catch {
    // A full or unavailable store must not stop the exam.
  }
}

/** Reload a token left by a previous run. Returns whether one was restored. */
export function restoreToken(): boolean {
  const store = storage();
  if (!store) return false;
  const saved = store.getItem(TOKEN_KEY);
  if (!saved) return false;

  const expiresAt = Number(store.getItem(TOKEN_EXPIRY_KEY) ?? "0");
  // Treat an unknown expiry as usable: the server is the authority and will
  // answer 401 if it is not. Discarding it here would force a re-login for a
  // token that still works.
  if (expiresAt && expiresAt <= Date.now()) {
    setToken(null);
    return false;
  }

  token = saved;
  return true;
}

export function hasToken(): boolean {
  return token !== null;
}

// ── transport ────────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const headers: Record<string, string> = { "X-AMS-Client-Version": CLIENT_VERSION };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    // A timeout and an unreachable host are different problems for a
    // candidate mid-exam: one is "wait", the other is "get an invigilator".
    const aborted = controller.signal.aborted;
    throw new ProctorApiError(
      aborted ? "The server did not respond in time." : "Cannot reach the exam server.",
      0,
      aborted ? "TIMEOUT" : "UNREACHABLE"
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    // `detail` is a string for most errors and an object for the ones the
    // client has to act on — 426 (too old, here is the download) and 429
    // (cooling down, here is how long).
    const raw = (data as { detail?: unknown; error?: unknown } | null)?.detail ?? null;
    if (raw && typeof raw === "object") {
      const structured = raw as { error?: string; code?: string; retry_after?: number };
      throw new ProctorApiError(
        structured.error ?? `Request failed (${res.status}).`,
        res.status,
        structured.code ?? "",
        structured
      );
    }
    const detail =
      (raw as string | null) ??
      ((data as { error?: string } | null)?.error as string | undefined) ??
      `Request failed (${res.status}).`;
    throw new ProctorApiError(String(detail), res.status);
  }

  noteServerTime((data as { server_time?: string } | null)?.server_time);
  return data as T;
}

// ── types ────────────────────────────────────────────────────────────────

export type Participant = {
  uid: string;
  display_name: string;
  username: string;
};

export type LoginContest = {
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  freeze_minutes_before_end: number;
};

export type LoginResult = {
  token: string;
  expires_in: number;
  user: Participant;
  server_time: string;
  /** Credentials are contest-scoped, so the server already knows which
   * contest this is. This is what removes the "now type the session code"
   * step — one more thing to mistype under exam pressure, for no security. */
  contest: LoginContest | null;
};

export type SessionStatus = "pending" | "active" | "submitted" | "terminated" | "abandoned";

export type SessionPhase = "before_window" | "verification" | "running" | "ended";

export type ProctorSession = {
  uid: string;
  contest_uid: string;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
  violation_count: number;
  resume_count: number;
  server_time: string;
  /** Drive the countdown from these. Never from `Date.now()` — the candidate
   * controls that clock, and the whole point of `serverNow()` is to close
   * that as a way of extending your own exam. */
  remaining_ms: number;
  ends_at: string | null;
  phase: SessionPhase;
};

export type SymbolicRule = {
  kind: "must_include" | "must_not_include";
  pattern: string;
  message: string;
};

export type ProblemFamilies = {
  io: { graded: boolean; weight: number; count: number };
  behavior: { graded: boolean; weight: number; count: number; present: boolean };
  /** Not graded, and a gate: one violation zeroes this problem's partial
   * credit however well the code runs. The rules are shown to the candidate
   * because being marked against an unstated instruction is indefensible. */
  symbolic: { graded: false; gate: true; rules: SymbolicRule[]; count: number };
};

export type ProblemProjection = {
  label: string;
  title: string;
  score: number;
  schema_version: number;
  language: string;
  standard: string;
  limits: { cpu_time_ms: number; wall_time_ms: number; memory_mb: number };
  statement: { markdown: string; sha256: string; size_bytes: number };
  starter?: { filename: string; source: string; sha256: string; size_bytes: number };
  samples: { label?: string; input: string; output: string }[];
  families: ProblemFamilies;
  /** True when the projection was reconstructed from the old columns rather
   * than extracted from the pack — the families are unknown, not empty. */
  backfilled?: boolean;
};

/** A contest as it appears in this participant's list. Mirrors the API's
 * `ContestOut`, minus the invite code — a proctored candidate has no use for
 * one, and it would let them admit somebody else. */
export type ContestSummary = {
  uid: string;
  title: string;
  description: string;
  status: string;
  starts_at: string;
  ends_at: string;
  is_practice: boolean;
  frozen: boolean;
  organization_name: string;
  verification_window_minutes: number;
  problems: { uid: string; label: string; title: string; score: number }[];
};

export type ContestIndex = {
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  server_time: string;
  remaining_ms: number;
  phase: SessionPhase;
  verification_window_minutes: number;
  problems: {
    label: string;
    title: string;
    score: number;
    time_limit_ms: number;
    memory_limit_mb: number;
  }[];
};

export type Draft = {
  problem_label: string;
  source: string;
  language: string;
  client_revision: number;
  updated_at: string;
};

export type TestcaseResult = {
  kind: string;
  testcase_no: number;
  label: string;
  verdict: string;
  runtime_ms: number;
  memory_kb: number;
  checker_message: string;
};

export type SubmissionResult = {
  uid: string;
  problem_label: string;
  language: string;
  status: string;
  created_at: string;
  verdict: string | null;
  score: number;
  passed_count: number;
  total_count: number;
  max_runtime_ms: number;
  max_memory_kb: number;
  compile_output: string;
  testcases: TestcaseResult[];
};

export type ResumeRequest = {
  uid: string;
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  reason: string;
  review_note: string;
  expires_at: string | null;
  consumed_at: string | null;
  created_at: string;
};

export type ViolationKind =
  | "vm_detected"
  | "screen_share_detected"
  | "process_detected"
  | "focus_lost"
  | "fullscreen_exited"
  | "keyboard_intercept_failed"
  | "capture_protection_failed"
  | "network_lost"
  | "clock_skew"
  | "face_absent"
  | "multiple_faces"
  | "device_changed";

export type ViolationEvent = {
  kind: ViolationKind | string;
  severity?: "info" | "warning" | "critical";
  detail?: string;
  evidence?: Record<string, unknown>;
  occurred_at?: string;
};

// ── calls ────────────────────────────────────────────────────────────────

/** Exchange the printed login id and password for a session token. */
export async function studentLogin(loginId: string, password: string): Promise<LoginResult> {
  const result = await request<LoginResult>("POST", "/participant/login", {
    // Normalised here so a candidate typing lowercase, or with the spaces
    // they see on the printed slip, is not told their credentials are wrong.
    login_id: loginId.trim().toUpperCase().replace(/\s+/g, ""),
    password: password.trim(),
  });
  setToken(result.token, result.expires_in);
  noteServerTime(result.server_time);
  return result;
}

export function logout(): void {
  setToken(null);
}

/** Start or resume this participant's session. Resuming is the normal path
 * after a crash, so callers must not treat an existing session as an error. */
export async function startSession(input: {
  contestUid: string;
  deviceFingerprint?: string;
  osName?: string;
  appVersion?: string;
}): Promise<ProctorSession> {
  return request<ProctorSession>("POST", "/participant/sessions", {
    contest_uid: input.contestUid,
    device_fingerprint: input.deviceFingerprint ?? "",
    os_name: input.osName ?? "",
    app_version: input.appVersion ?? "",
  });
}

export async function getSession(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>("GET", `/participant/sessions/${encodeURIComponent(sessionUid)}`);
}

/** Liveness, and a clock resync. Also how the app learns it was terminated. */
export async function heartbeat(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/heartbeat`,
    {},
    // Shorter than the default: a heartbeat that hangs is itself the signal.
    8_000
  );
}

/** Report violations. Batched because a minute offline must not need sixty
 * round trips to catch up. */
export async function reportEvents(
  sessionUid: string,
  events: ViolationEvent[]
): Promise<{ recorded: number; total: number }> {
  if (events.length === 0) return { recorded: 0, total: 0 };
  return request("POST", `/participant/sessions/${encodeURIComponent(sessionUid)}/events`, {
    events,
  });
}

/** End the exam. Idempotent — a retry after a dropped response is safe. */
export async function finishSession(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/finish`,
    {}
  );
}

// ── the paper ─────────────────────────────────────────────────────────────

/** Every contest this participant is registered for.
 *
 * Usually one: credentials are contest-scoped, so a candidate normally holds
 * a slip for the round they are about to sit. The list exists because one
 * student can sit several rounds over a term. */
export async function listContests(): Promise<ContestSummary[]> {
  return request<ContestSummary[]>("GET", "/participant/contests");
}

/** Title, window, server clock and the problem list, in one call.
 *
 * One call rather than the old pair: the client needs all of it before it can
 * render anything, and two calls meant two chances to disagree about what
 * time it was. */
export async function getContest(contestUid: string): Promise<ContestIndex> {
  return request<ContestIndex>("GET", `/participant/contests/${encodeURIComponent(contestUid)}`);
}

/** The statement, samples, limits and marking scheme for one problem.
 *
 * 409 until the contest is actually running — during the verification window
 * the proctor is arming itself but the paper is not open. */
export async function getProblem(contestUid: string, label: string): Promise<ProblemProjection> {
  const body = await request<{ problem: ProblemProjection }>(
    "GET",
    `/participant/contests/${encodeURIComponent(contestUid)}/problems/${encodeURIComponent(label)}`
  );
  return body.problem;
}

// ── drafts ────────────────────────────────────────────────────────────────

export async function getDrafts(sessionUid: string): Promise<Draft[]> {
  return request<Draft[]>("GET", `/participant/sessions/${encodeURIComponent(sessionUid)}/drafts`);
}

/** Autosave one problem's source.
 *
 * `clientRevision` must increase monotonically per problem. A retry on a
 * flaky connection can arrive after a newer save, and without it the older
 * write wins — which in an exam is indistinguishable from losing work. */
export async function putDraft(
  sessionUid: string,
  label: string,
  input: { source: string; language: string; clientRevision: number }
): Promise<Draft> {
  return request<Draft>(
    "PUT",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/drafts/${encodeURIComponent(label)}`,
    {
      source: input.source,
      language: input.language,
      client_revision: input.clientRevision,
    }
  );
}

// ── running and submitting ────────────────────────────────────────────────

/** Compile and run against the samples. Unscored, rate-limited.
 *
 * Throws `ProctorApiError` with status 429 and `retryAfterSeconds` when the
 * candidate is going too fast. */
export async function run(
  sessionUid: string,
  input: { problemLabel: string; language: string; source: string }
): Promise<SubmissionResult> {
  return request<SubmissionResult>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/runs`,
    { problem_label: input.problemLabel, language: input.language, source: input.source }
  );
}

export async function getRun(sessionUid: string, runUid: string): Promise<SubmissionResult> {
  return request<SubmissionResult>(
    "GET",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/runs/${encodeURIComponent(runUid)}`
  );
}

/** The scored attempt. */
export async function submit(
  sessionUid: string,
  input: { problemLabel: string; language: string; source: string }
): Promise<SubmissionResult> {
  return request<SubmissionResult>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/submissions`,
    { problem_label: input.problemLabel, language: input.language, source: input.source }
  );
}

/** This candidate's own attempts. There is no leaderboard endpoint, by
 * design — candidates see their own results and nobody else's. */
export async function listMySubmissions(
  sessionUid: string,
  problemLabel?: string
): Promise<SubmissionResult[]> {
  const query = problemLabel ? `?problem_label=${encodeURIComponent(problemLabel)}` : "";
  return request<SubmissionResult[]>(
    "GET",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/submissions${query}`
  );
}

// ── resume ────────────────────────────────────────────────────────────────

/** Ask an invigilator to reopen a finished session. Idempotent while one is
 * pending — a crash-looping app must not fill their queue. */
export async function requestResume(
  sessionUid: string,
  input: { deviceFingerprint?: string; reason?: string } = {}
): Promise<ResumeRequest> {
  return request<ResumeRequest>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/resume-request`,
    { device_fingerprint: input.deviceFingerprint ?? "", reason: input.reason ?? "" }
  );
}

export async function latestResumeRequest(sessionUid: string): Promise<ResumeRequest | null> {
  return request<ResumeRequest | null>(
    "GET",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/resume-request`
  );
}

/** Spend an approved grant and re-enter. Separate from the approval so the
 * candidate comes back deliberately, rather than being dropped into a live
 * exam by a background poll. */
export async function consumeResume(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>(
    "POST",
    `/participant/sessions/${encodeURIComponent(sessionUid)}/resume-consume`,
    {}
  );
}
