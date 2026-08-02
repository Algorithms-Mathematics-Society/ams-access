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

// Long enough for a slow network at an exam centre; short enough that a dead
// connection surfaces rather than hanging the UI.
const DEFAULT_TIMEOUT_MS = 20_000;

export class ProctorApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "",
  ) {
    super(message);
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

let token: string | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export function hasToken(): boolean {
  return token !== null;
}

// ── transport ────────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {};
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
      aborted ? "TIMEOUT" : "UNREACHABLE",
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
    const detail =
      (data as { detail?: string; error?: string } | null)?.detail ??
      (data as { error?: string } | null)?.error ??
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

export type LoginResult = {
  token: string;
  user: Participant;
  server_time: string;
};

export type SessionStatus = "pending" | "active" | "submitted" | "terminated" | "abandoned";

export type ProctorSession = {
  uid: string;
  contest_uid: string;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
  violation_count: number;
  server_time: string;
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
  const result = await request<LoginResult>("POST", "/students/login", {
    // Normalised here so a candidate typing lowercase, or with the spaces
    // they see on the printed slip, is not told their credentials are wrong.
    login_id: loginId.trim().toUpperCase().replace(/\s+/g, ""),
    password: password.trim(),
  });
  setToken(result.token);
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
  return request<ProctorSession>("POST", "/sessions", {
    contest_uid: input.contestUid,
    device_fingerprint: input.deviceFingerprint ?? "",
    os_name: input.osName ?? "",
    app_version: input.appVersion ?? "",
  });
}

export async function getSession(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>("GET", `/sessions/${encodeURIComponent(sessionUid)}`);
}

/** Liveness, and a clock resync. Also how the app learns it was terminated. */
export async function heartbeat(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>(
    "POST",
    `/sessions/${encodeURIComponent(sessionUid)}/heartbeat`,
    {},
    // Shorter than the default: a heartbeat that hangs is itself the signal.
    8_000,
  );
}

/** Report violations. Batched because a minute offline must not need sixty
 * round trips to catch up. */
export async function reportEvents(
  sessionUid: string,
  events: ViolationEvent[],
): Promise<{ recorded: number; total: number }> {
  if (events.length === 0) return { recorded: 0, total: 0 };
  return request("POST", `/sessions/${encodeURIComponent(sessionUid)}/events`, { events });
}

/** End the exam. Idempotent — a retry after a dropped response is safe. */
export async function finishSession(sessionUid: string): Promise<ProctorSession> {
  return request<ProctorSession>("POST", `/sessions/${encodeURIComponent(sessionUid)}/submit`, {});
}
