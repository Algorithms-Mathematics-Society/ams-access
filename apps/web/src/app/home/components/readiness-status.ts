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


/** Whether the native bridge exists at all. */
export function hasNativeBridge(globals: unknown = globalThis): boolean {
  return Boolean(
    (globals as { __TAURI__?: { core?: { invoke?: unknown } } } | undefined)?.__TAURI__?.core
      ?.invoke,
  );
}

/**
 * What to show for the native-only checks when the readiness scan could not
 * run at all.
 *
 * Two different situations reach here and they deserve different answers.
 *
 * **No native bridge** — the app is being run in a browser, which is how
 * development and manual testing happen. Keyboard lockdown, VM detection,
 * restricted apps and platform support are not *failing* there; they do not
 * exist there, exactly as keyboard lockdown does not exist on a tiling window
 * manager. Reporting them as failures told a developer to "fix 4 required
 * checks" that no amount of fixing could change, and buried the checks that
 * had really run.
 *
 * **Bridge present but the scan threw** — something genuinely went wrong in
 * the packaged app. That fails closed, unchanged: we cannot prove the machine
 * is clean, so we do not say it is.
 *
 * This never relaxes anything in a shipped build, because the Tauri shell
 * always has the bridge. A browser cannot sit a proctored contest in any
 * meaningful sense anyway — the contest room says as much where it opens the
 * lock gate ("Tauri unavailable (dev/browser) — no real lockdown exists here").
 */
export function nativeCheckFallback(nativeAvailable: boolean): ReadinessStatus {
  return nativeAvailable ? "fail" : "unavailable";
}
