/**
 * How many missed heartbeats mean "offline".
 *
 * Pure, because the judgement is a policy call rather than a network fact and
 * it needs testing without one. `navigator.onLine` is not that fact either —
 * it is true on a captive portal, and true when the wifi is associated but
 * the exam server is unreachable.
 *
 * The bar is deliberately not one failure. Exam-hall wifi drops packets, and
 * locking every candidate's editor the first time one is lost would be a
 * self-inflicted incident affecting the whole room at once. Three consecutive
 * misses at a 60s interval is roughly three minutes of genuine silence, which
 * matches the resilience bar: survive minutes offline, never lose typed code.
 */

export type HeartbeatState = {
  consecutiveFailures: number;
  lastOkAtMs: number | null;
};

/** Consecutive misses before the editor locks. */
export const LOCK_AFTER_FAILURES = 3;

/** One miss is worth showing in the status strip, without locking anything. */
const DEGRADED_AFTER_FAILURES = 1;

export type ConnectionLevel = "online" | "degraded" | "offline";

export function initialHeartbeatState(): HeartbeatState {
  return { consecutiveFailures: 0, lastOkAtMs: null };
}

/** A success clears the streak outright — the run of failures is what matters,
 * not their total. A candidate on flaky wifi that recovers every other minute
 * is working, not offline. */
export function onSuccess(_state: HeartbeatState, atMs: number): HeartbeatState {
  return { consecutiveFailures: 0, lastOkAtMs: atMs };
}

export function onFailure(state: HeartbeatState): HeartbeatState {
  return { ...state, consecutiveFailures: state.consecutiveFailures + 1 };
}

export function connectionLevel(state: HeartbeatState): ConnectionLevel {
  if (state.consecutiveFailures >= LOCK_AFTER_FAILURES) return "offline";
  if (state.consecutiveFailures >= DEGRADED_AFTER_FAILURES) return "degraded";
  return "online";
}

/** Whether to stop accepting work. Only at `offline` — `degraded` is a
 * warning, and taking the editor away on a warning is the failure mode this
 * whole module exists to avoid. */
export function shouldLockEditor(state: HeartbeatState): boolean {
  return connectionLevel(state) === "offline";
}

/**
 * How long since the server last answered, for the status strip.
 *
 * Null before the first success: "we have never reached the server" and "we
 * reached it a second ago" are different things and must not render the same.
 */
export function secondsSinceContact(state: HeartbeatState, nowMs: number): number | null {
  if (state.lastOkAtMs === null) return null;
  return Math.max(0, Math.round((nowMs - state.lastOkAtMs) / 1000));
}
