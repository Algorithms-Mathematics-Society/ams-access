import {
  applyLockdownConfig,
  applyOrganizerOverrides,
  strictContestPolicy,
  type OrganizerOverride,
  type SessionPolicy,
} from "@ams/api-client";

type LockdownConfig = Parameters<typeof applyLockdownConfig>[1];

/** Resolve the policy used by policy-dependent readiness stages.
 * Practice has no contest record, so it uses the platform baseline directly. */
export function effectiveReadinessPolicy(input: {
  dryRun: boolean;
  nativeAvailable: boolean;
  platform: string | null;
  hasContest: boolean;
  lockdown: LockdownConfig;
  overrides: readonly OrganizerOverride[];
  nowMs?: number;
}): SessionPolicy | null {
  if (input.nativeAvailable && !input.platform) return null;
  const baseline = strictContestPolicy(input.platform ?? undefined);
  if (input.dryRun) return baseline;
  if (!input.hasContest) return null;
  return applyOrganizerOverrides(
    applyLockdownConfig(baseline, input.lockdown),
    input.overrides.filter((grant) => grant.expires_at_ms > (input.nowMs ?? Date.now()))
  );
}
