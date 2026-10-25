/**
 * What to say while entry is queued, by how long the candidate has waited.
 *
 * A thousand people pressing Enter at the same second queue behind each
 * other, and the slowest were measured at around half a minute. For that
 * whole time the screen used to show one unchanging "Loading contest..."
 * and then, at twenty seconds, an error telling them to check their
 * connection -- for a server that was working and about to answer. The
 * predictable response was to retry, which lengthened the queue that was
 * the problem.
 *
 * These lines say the true thing at each point: we are waiting, it is
 * normal, nothing is lost. No progress bar and no queue position, because
 * the client knows neither and inventing one would be a lie that a
 * candidate makes decisions on.
 */
export const ENTRY_WAIT_PHASES: ReadonlyArray<{ after: number; label: string; detail: string }> = [
  {
    after: 0,
    label: "Letting you in...",
    detail: "Setting up your contest workspace.",
  },
  {
    after: 6_000,
    label: "Letting you in...",
    detail: "A few moments more. Everyone is entering at the same time, so this can take longer than usual.",
  },
  {
    after: 18_000,
    label: "Still letting you in...",
    detail: "You have not lost your place and nothing has gone wrong. Please keep this window open rather than retrying.",
  },
  {
    after: 35_000,
    label: "Still letting you in...",
    detail: "This is taking longer than we would like. If it does not open shortly, tell an invigilator -- your place is held.",
  },
];

/** The phase for a given wait, in milliseconds. */
export function entryWaitPhase(elapsedMs: number) {
  let phase = ENTRY_WAIT_PHASES[0];
  for (const candidate of ENTRY_WAIT_PHASES) {
    if (elapsedMs >= candidate.after) phase = candidate;
  }
  return phase;
}
