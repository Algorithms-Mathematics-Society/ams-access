/**
 * Proctor-gating relaxation switch — single source of truth.
 *
 * Default is OFF (full gating). When ON, the onboarding network-validation stage
 * and the network device-state inputs are relaxed FOR TESTING ONLY: each relaxation
 * is logged loudly and the UI shows a visible "relaxed mode" badge. This replaces the
 * hardcoded mocks introduced by commit `aa8f474` ("Relax proctor gating for contest
 * testing") so that a shipping build can never silently bypass gating.
 *
 * SECURITY: the flag is read ONLY from the build-time env var
 * `NEXT_PUBLIC_AMS_RELAX_GATING` (inlined at build). It is intentionally NOT readable
 * from localStorage / query params / cookies, so a candidate cannot flip it at runtime
 * in their own browser. A real contest build simply leaves the env var unset.
 *
 * Relaxation is confined to NETWORK inputs only: it makes the readiness pipeline see a
 * healthy network + an installed helper. It does NOT weaken the readiness decision logic
 * itself — a non-network block (VM detected, restricted app, camera, etc.) still blocks.
 */
export function isGatingRelaxed(): boolean {
  const env = process.env.NEXT_PUBLIC_AMS_RELAX_GATING;
  return env === "1" || env === "true";
}

/** Loud, greppable console warning emitted whenever a relaxation actually applies. */
export function warnGatingRelaxed(what: string): void {
  // eslint-disable-next-line no-console
  console.warn(`[AMS][GATING-RELAXED] ${what} — TEST MODE; must not be used in a real contest.`);
}

/** Human-readable badge text for the relaxed-mode UI indicator. */
export const RELAXED_MODE_BADGE = "PROCTOR GATING RELAXED (TEST MODE)";
