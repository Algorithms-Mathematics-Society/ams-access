// Pure countdown-phase logic for the contest top-bar timer (§6.1).
// Kept free of React/DOM so it can be unit-tested in isolation.

export type CountdownPhase = "nominal" | "warning" | "critical" | "expired";

/** ≤ this remaining → warning (amber). */
export const COUNTDOWN_WARNING_MS = 6 * 60_000;
/** ≤ this remaining → critical (red + shape pulse). */
export const COUNTDOWN_CRITICAL_MS = 60_000;

/**
 * Map remaining milliseconds to an explicit urgency phase.
 * Thresholds are inclusive of their upper bound so a value exactly on the
 * boundary (e.g. 60_000) reads as the more urgent phase.
 */
export function countdownPhase(diffMs: number): CountdownPhase {
  if (diffMs <= 0) return "expired";
  if (diffMs <= COUNTDOWN_CRITICAL_MS) return "critical";
  if (diffMs <= COUNTDOWN_WARNING_MS) return "warning";
  return "nominal";
}
