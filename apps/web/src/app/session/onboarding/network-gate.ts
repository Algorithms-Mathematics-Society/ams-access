/**
 * Whether a failure to raise the egress firewall should stop a candidate.
 *
 * This exists because two correct decisions collided. Flipping the default
 * Windows build to `asInvoker` was deliberate — contestants install at home
 * and the firewall was never wanted there. But Windows egress lockdown is
 * `netsh advfirewall firewall add rule`, which needs elevation, so
 * `enable_network_lockdown` short-circuits and returns `false` on such a
 * build. Its comment in lib.rs explains why that is safe:
 *
 *   > `false` is the existing "not applied" answer — the caller already
 *   > treats it as advisory, because this has always been best-effort on
 *   > machines where it could not engage.
 *
 * The caller did not. It turned any falsy result into a `setPolicyBlock` and
 * an early return, and the only escape was a build-time flag that must never
 * ship. So on a release build *every* Windows candidate was stopped at the
 * final stage, and told "we couldn't secure your network for the exam" —
 * which was not even true, because that build never tried.
 *
 * Three layers already agreed this check is advisory: the Rust comment above,
 * the readiness policy in `packages/api-client` ("egress lockdown is applied
 * best-effort during the contest and is NOT a hard entry gate"), and core-rs.
 * This module is the fourth, and it is the one the candidate meets.
 *
 * The distinction that makes it safe to relax is one the native layer already
 * reports, and it turns on intent rather than outcome: a build that never
 * asked to elevate is not failing when it has no firewall, while a build that
 * asked and was refused is. Only the second is a block.
 */

/**
 * Builds that cannot raise a firewall and never tried to. Both are unelevated,
 * and neither is a fault: `windows_no_firewall` is the ordinary release, and
 * `windows_msix` is a Store build that can never elevate by construction.
 *
 * `windows_no_admin` is deliberately absent. It is the shape that means a
 * firewall build asked for elevation and did not get it — the one case where
 * the old message was honest, and the one that must keep blocking.
 */
const FIREWALL_NOT_EXPECTED = ["windows_no_firewall", "windows_msix"];

export type NetworkLockdownDecision =
  /** Egress is restricted to the allowlist. Nothing to tell the candidate. */
  | { decision: "engaged"; eventKind: string; detail: string; violation: false }
  /**
   * The candidate goes in with open egress. Recorded so an invigilator can
   * see the session is under-protected — but not called a failure, and not a
   * wall.
   */
  | { decision: "advisory"; eventKind: string; detail: string; violation: boolean }
  /** A firewall was expected here and did not engage. Stop. */
  | {
      decision: "blocked";
      eventKind: string;
      detail: string;
      violation: true;
      message: string;
    };

export type NetworkLockdownInput = {
  /**
   * `deviceState.platform` — the native label, not `get_platform`'s coarse
   * `os`. On Windows that is one of `windows`, `windows_no_admin`,
   * `windows_no_firewall`, `windows_msix`; elsewhere it is `linux`/`macos`.
   */
  platform: string | null;
  /** What `enable_network_lockdown` returned. */
  engaged: boolean;
  /** Its rejection or timeout message, if it threw rather than returned. */
  error: string | null;
  /** `isGatingRelaxed()` — dev builds only, never set in a shipping build. */
  relaxed: boolean;
};

const BLOCK_MESSAGE =
  "We couldn't secure your network for the exam — the proctoring network component may not be installed or still needs your permission. Re-run device setup, then try again. Starting now would leave your internet open, which a secured contest does not allow.";

export function decideNetworkLockdown(input: NetworkLockdownInput): NetworkLockdownDecision {
  if (input.engaged) {
    return {
      decision: "engaged",
      eventKind: "network_lockdown_engaged",
      detail: "Outbound traffic restricted to the exam allowlist.",
      violation: false,
    };
  }

  const platform = (input.platform ?? "").toLowerCase();
  const detail = input.error ?? "enable_network_lockdown returned false";

  // Checked before `relaxed` so the honest reason wins on a dev machine that
  // happens to be running an unelevated Windows build: nothing was attempted,
  // which is not the same as something being waived.
  if (FIREWALL_NOT_EXPECTED.includes(platform)) {
    return {
      decision: "advisory",
      eventKind: "network_lockdown_not_applicable",
      detail: `This build does not raise a firewall (${platform}); egress is open by design.`,
      // Not a violation. Nobody did anything wrong, and filing one here would
      // put every ordinary contestant in the violation feed on contest day,
      // which would cost the feed its meaning within one contest.
      violation: false,
    };
  }

  if (input.relaxed) {
    return {
      decision: "advisory",
      eventKind: "network_lockdown_failed",
      detail,
      // A relaxed build *did* expect a firewall, so this stays a violation —
      // the record is the whole reason the escape hatch is tolerable.
      violation: true,
    };
  }

  return {
    decision: "blocked",
    eventKind: "network_lockdown_failed",
    detail,
    violation: true,
    message: BLOCK_MESSAGE,
  };
}
