import type { ReadinessStatus } from "./types";

/** The outcomes a readiness check can have, as the report reports them. */
type Outcome = "pass" | "warn" | "fail" | "unknown";

/**
 * One readiness outcome, as the UI should show it.
 *
 * Its own module, with no imports beyond a type, so it can be tested directly —
 * `utils.ts` reaches through `@/lib` path aliases that a plain `node --test`
 * cannot resolve.
 *
 * The mapping used to be three-way, and collapsed two things it should not
 * have:
 *
 * * `warn` → "fail" told a candidate to fix an advisory check that was never
 *   going to stop them entering.
 * * `unknown` → "checking" left a probe this machine can never run sitting at
 *   "Checking..." for ever, with the real failure printed in the log below it.
 */
export function readinessStatusForOutcome(outcome: Outcome): ReadinessStatus {
  if (outcome === "pass") return "ok";
  if (outcome === "warn") return "warn";
  if (outcome === "unknown") return "unavailable";
  return "fail";
}
