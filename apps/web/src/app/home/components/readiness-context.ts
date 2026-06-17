/**
 * Single source of truth for contestant-visible readiness state.
 *
 * deriveContestantReadiness() is a pure function that collapses three
 * independent signals — the raw device ReadinessState, the policy
 * ReadinessReport (when available), and the contest entry-window check —
 * into one ContestantReadinessContext. Every surface that needs to show
 * readiness status should call this function rather than branch on its own
 * internal state.
 *
 * Five statuses map directly to the five things a contestant needs to know:
 *   checking         — scans still running, no decision yet
 *   ready            — device eligible, window open (or no window constraint)
 *   needs_action     — required check(s) failed; contestant can act
 *   advisory_warning — required checks pass, optional check(s) flagged
 *   blocked_by_policy — server says no entry (wrong window, ineligible account)
 */

import type {
  ReadinessState,
  ContestantReadinessContext,
  ContestantReadinessStatus,
  InvitedContest,
  ActiveSession,
} from "./types";
import type { ReadinessReport } from "@ams/api-client";

export type EntryWindowStatus = "checking" | "allowed" | "blocked" | null;

function pluralChecks(n: number) {
  return n === 1 ? "1 required check" : `${n} required checks`;
}

function formatTimeAgo(isoString: string, now: number): string {
  const diff = now - new Date(isoString).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "recently";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

function formatContestStartTime(isoString: string, timezone?: string): string {
  try {
    return new Date(isoString).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return new Date(isoString).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

function make(
  status: ContestantReadinessStatus,
  message: string,
  failedRequired = 0,
  failedOptional = 0
): ContestantReadinessContext {
  return { status, message, failedRequired, failedOptional };
}

export function deriveContestantReadiness({
  readiness,
  report,
  entryWindowStatus,
  entryWindowReason,
  contest,
  activeSession,
  now = Date.now(),
}: {
  readiness: ReadinessState;
  report: ReadinessReport | null;
  /** null means "no entry-window check was performed" (hub baseline). */
  entryWindowStatus: EntryWindowStatus;
  entryWindowReason?: string | null;
  contest?: InvitedContest | null;
  activeSession?: Pick<ActiveSession, "contest_id" | "updated_at"> | null;
  now?: number;
}): ContestantReadinessContext {
  const reportRequiredChecks =
    report?.required_checks.filter((check) => check.kind !== "network") ?? [];

  // ── 1. Still scanning ──────────────────────────────────────────
  const anyChecking = Object.values(readiness).some((s) => s === "checking");
  if (anyChecking || entryWindowStatus === "checking") {
    return make("checking", "Checking your device...");
  }

  // ── 2. Entry window blocked by server ─────────────────────────
  if (entryWindowStatus === "blocked") {
    return make("blocked_by_policy", entryWindowReason?.trim() || "Contest entry is not open.");
  }

  // ── 3. Derive from policy report when available ────────────────
  if (report) {
    // Count failures against required checks (any non-pass outcome).
    const failedRequired = reportRequiredChecks.filter((c) => c.outcome !== "pass").length;
    // Count advisory warnings from optional checks.
    const failedOptional = report.optional_checks.filter((c) => c.outcome !== "pass").length;

    if (failedRequired > 0) {
      return make(
        "needs_action",
        `Fix ${pluralChecks(failedRequired)} before entering.`,
        failedRequired,
        failedOptional
      );
    }

    if (failedOptional > 0) {
      const noun = failedOptional === 1 ? "advisory warning" : "advisory warnings";
      return make(
        "advisory_warning",
        `${failedOptional} ${noun}. Device is eligible to enter.`,
        0,
        failedOptional
      );
    }

    // All checks pass — build a "ready" message with the richest available context.
    if (activeSession?.updated_at) {
      const ago = formatTimeAgo(activeSession.updated_at, now);
      return make("ready", `Resume available. Last verified ${ago}.`);
    }

    if (entryWindowStatus === "allowed" && contest) {
      const startLabel = formatContestStartTime(contest.start_at, contest.timezone);
      return make("ready", `Ready to verify. Contest starts at ${startLabel}.`);
    }

    return make("ready", "Device check complete.");
  }

  // ── 4. No report — fall back to ReadinessState ─────────────────
  // The hub baseline scan runs without a contestId (internal_pilot policy)
  // and produces no report, so ReadinessState is the only signal here.
  const failedKeys = (Object.keys(readiness) as (keyof ReadinessState)[]).filter(
    (k) => readiness[k] === "fail"
  );

  if (failedKeys.length > 0) {
    const n = failedKeys.length;
    return make("needs_action", `Fix ${pluralChecks(n)} before entering.`, n, 0);
  }

  // All statuses ok, no report.
  if (activeSession) {
    const ago = activeSession.updated_at ? formatTimeAgo(activeSession.updated_at, now) : null;
    return make("ready", ago ? `Resume available. Last verified ${ago}.` : "Resume available.");
  }

  return make("ready", "Device check complete.");
}
