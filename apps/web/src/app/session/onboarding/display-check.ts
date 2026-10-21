import type { ReadinessObservation } from "./readiness-action";

/** Measurement only. `null` is a failed/unavailable probe. Tauri's established
 * Windows contract can return an empty successful enumeration for the primary
 * display, so `[]` retains the prior single-display result. Policy is evaluated
 * by readinessAction; callers must not turn a thrown/timed-out probe into `[]`. */
export function displayObservation(monitors: readonly unknown[] | null): ReadinessObservation {
  if (monitors === null) return "probe_unavailable";
  return monitors.length <= 1 ? "pass" : "failure";
}
