/**
 * Whether a candidate may start onboarding, and why not.
 *
 * This replaces a cluster of local time comparisons — `isTooEarly`,
 * `isAfterStart`, `isEnded`, `localGate` — that between them had two bugs
 * with the same root: they were derived from the *client's* clock against a
 * window fetched from a staff route that 403s for participants.
 *
 * The worse of the two: `isAfterStart` was true for the entire contest
 * duration, and the render gate read
 * `!isTooEarly && (!isAfterStart || showWaitLock) && !isEnded`. `showWaitLock`
 * only becomes true at the *last* stage, which you cannot reach if every
 * stage is hidden. So anyone opening onboarding after the start — including
 * **every approved resume**, which routes back through here — saw
 * "Join window is closed once contest starts" with no way forward. That
 * contradicted the server, which explicitly permits late entry, and it broke
 * the crash-recovery path the whole resume flow exists for.
 *
 * The decision now comes from the server's own `phase`, which
 * `GET /participant/contests/{uid}` already computes and returns.
 */

import type { SessionPhase } from "@/lib/proctor-api";

export type EntryDecision =
  /** Check-in has not opened. The candidate waits; we show them how long. */
  | { kind: "too_early"; opensInMs: number }
  /** Inside the verification window: run the checks, but the paper is shut. */
  | { kind: "open" }
  /** The contest is running. Run the checks — late entry is allowed. */
  | { kind: "live" }
  /** Over. Nothing to enter. */
  | { kind: "ended" };

export type ContestWindow = {
  phase: SessionPhase;
  starts_at: string;
  verification_window_minutes: number;
};

/** Epoch ms at which check-in opens, or null if the contest declares no
 * verification window (in which case there is nothing to be early for). */
export function verificationOpensAtMs(window: ContestWindow): number | null {
  const minutes = window.verification_window_minutes;
  if (!minutes || minutes <= 0) return null;
  const startsAt = Date.parse(window.starts_at);
  if (Number.isNaN(startsAt)) return null;
  return startsAt - minutes * 60_000;
}

/**
 * `nowMs` should come from `serverNow()`. It is only used to say *how long*
 * until check-in opens — never to decide whether it has, which is the
 * server's `phase`. A candidate who moves their clock changes the countdown
 * they see and nothing else.
 */
export function decideEntry(window: ContestWindow, nowMs: number): EntryDecision {
  switch (window.phase) {
    case "ended":
      return { kind: "ended" };
    case "running":
      // Deliberately not blocked. The server allows late entry, and a resume
      // is by definition a re-entry after the start.
      return { kind: "live" };
    case "verification":
      return { kind: "open" };
    case "before_window":
    default: {
      const opensAt = verificationOpensAtMs(window);
      return { kind: "too_early", opensInMs: opensAt === null ? 0 : Math.max(0, opensAt - nowMs) };
    }
  }
}

/** Whether the readiness stages should run at all. */
export function shouldRunChecks(decision: EntryDecision): boolean {
  return decision.kind === "open" || decision.kind === "live";
}

/** What to tell a candidate who cannot proceed, or null when they can. */
export function blockedMessage(decision: EntryDecision): string | null {
  switch (decision.kind) {
    case "ended":
      return "This contest has ended.";
    case "too_early":
      return "Check-in has not opened yet. This screen will let you in automatically.";
    default:
      return null;
  }
}
