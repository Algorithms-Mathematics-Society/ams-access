/**
 * What to record when the egress firewall does not come up.
 *
 * It never stops a candidate. Egress lockdown needs privilege the exam shell
 * deliberately does not hold -- Windows releases ship `asInvoker` because
 * contestants install at home, Linux runs unelevated so GTK, WebKit, the
 * camera and the microphone work at all, and macOS needs a LaunchDaemon the
 * candidate installs by consenting to an admin prompt. A control that depends
 * on privilege the candidate can simply decline is not a control, and building
 * a gate on one means the gate fails open for anyone willing to say no, while
 * falling shut on honest candidates whose machine is merely ordinary.
 *
 * So the firewall is best-effort, and the thing of actual value is the record:
 * an invigilator can see which sessions ran with open egress and weigh that
 * against the rest of the proctoring signal. That is also the honest framing --
 * three other layers already called this advisory (the Rust comment on
 * `enable_network_lockdown`, the readiness policy in `packages/api-client`,
 * and core-rs, which gives it `BlockingSeverity::Warning`). This module used to
 * be the one that disagreed, and it was the one the candidate met.
 *
 * The distinction that survives is not block-vs-enter. It is whether a
 * firewall was *expected* here, because that decides whether the open egress
 * is worth an invigilator's attention:
 *
 * * A build that never asked to elevate has nothing to report. Every ordinary
 *   contestant runs one, and filing a violation for each would put the whole
 *   cohort in the feed on contest day and cost the feed its meaning.
 * * A build that asked and was refused, or a helper that should be installed
 *   and is not, is recorded -- that is a candidate who declined, or a machine
 *   that changed under them, and it is exactly what the feed is for.
 */

/**
 * Builds that cannot raise a firewall and never tried to. Both are unelevated,
 * and neither is a fault: `windows_no_firewall` is the ordinary release, and
 * `windows_msix` is a Store build that can never elevate by construction.
 *
 * `windows_no_admin` is deliberately absent. It is the shape that means a
 * firewall build asked for elevation and did not get it, so its open egress is
 * worth recording -- someone declined a prompt that was meant to be accepted.
 */
const FIREWALL_NOT_EXPECTED = ["windows_no_firewall", "windows_msix"];

export type NetworkLockdownDecision =
  /** Egress is restricted to the allowlist. Nothing to tell the candidate. */
  | { decision: "engaged"; eventKind: string; detail: string; violation: false }
  /**
   * The candidate goes in with open egress. Never a wall; `violation` says
   * whether an invigilator should be told.
   */
  | { decision: "advisory"; eventKind: string; detail: string; violation: boolean };

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

  // A firewall was expected here and did not come up: an elevated Windows
  // build, `windows_no_admin` (asked to elevate and was refused), a macOS or
  // Linux session whose privileged helper is absent, or a platform we cannot
  // identify. The candidate still enters -- none of these is something they
  // can necessarily fix at the desk, and none of them is worth voiding a sitting
  // over by itself -- but every one is recorded for the invigilator.
  return {
    decision: "advisory",
    eventKind: "network_lockdown_failed",
    detail,
    violation: true,
  };
}
