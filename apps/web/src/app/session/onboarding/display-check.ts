/**
 * What the display scan means for a candidate.
 *
 * Extracted because the distinction it encodes is the one that broke. The
 * scan used to fold "we could not enumerate the monitors" and "there are no
 * monitors" into the same empty array, so when `availableMonitors` was called
 * incorrectly — as a method on the window object rather than the module-level
 * function it actually is — the resulting TypeError became an empty list,
 * and on Windows an empty list is fail-closed. Every Windows candidate was
 * held at the display check by a call that had never worked.
 *
 * `null` and `[]` therefore stay distinct all the way through.
 */

export type DisplayDecision =
  /** One screen, verified. Proceed. */
  | { kind: "single" }
  /** More than one screen, and this platform blocks on that. */
  | { kind: "multi_blocked" }
  /** More than one screen, advisory only. */
  | { kind: "multi_warned" }
  /** We could not tell. Windows holds; everywhere else this never occurs. */
  | { kind: "indeterminate" };

export type DisplayInput = {
  /** `null` when the enumeration could not be performed at all. */
  monitors: { name: string | null }[] | null;
  isWindows: boolean;
  /** An organizer has waived `external_display` for this device. */
  override: boolean;
};

export function decideDisplayCheck(input: DisplayInput): DisplayDecision {
  const { monitors, isWindows, override } = input;

  // A waiver covers both the multi-display case and the one where we cannot
  // tell — an invigilator who has looked at the machine outranks the probe.
  if (override) {
    return monitors && monitors.length > 1 ? { kind: "multi_warned" } : { kind: "single" };
  }

  if (monitors === null) {
    // Off-Windows the check is advisory, so an unverifiable scan falls back to
    // the synthetic single display rather than trapping the candidate.
    return isWindows ? { kind: "indeterminate" } : { kind: "single" };
  }

  if (monitors.length > 1) {
    return isWindows ? { kind: "multi_blocked" } : { kind: "multi_warned" };
  }

  // Zero monitors from a scan that *worked* is not a failure to measure. It is
  // a headless or virtualised display stack, and the VM check owns that.
  return { kind: "single" };
}

/** Whether the candidate may move on from this stage. */
export function displayCheckPasses(decision: DisplayDecision): boolean {
  return decision.kind === "single" || decision.kind === "multi_warned";
}
