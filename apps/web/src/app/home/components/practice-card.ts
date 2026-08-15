// How a practice contest presents on the home screen.
//
// Its own module, with no imports, for one practical reason: `utils.ts`
// resolves through the `@/` tsconfig alias, and Node's `--experimental-strip-types`
// runner cannot follow that — so nothing in `utils.ts` can be tested at all.
// The rule that decides whether a candidate can start their rehearsal is worth
// more than that.
//
// Two different things are called "practice" in this app and they must never
// be worded the same way:
//
//   - a **practice run** is the device rehearsal at `?mode=dry-run`. It walks
//     the readiness checks, creates no session and opens no contest.
//   - a **practice contest** — this one — is a real contest with real problems,
//     the real editor and the real judge, unscored and with no clock.
//
// A candidate told the same words for both cannot know which they are about
// to start, so the wording here never says "practice run".

/** The fields of a contest card this decision reads. */
export type PracticeCardInput = {
  is_practice?: boolean;
};

export type PracticeEntry = {
  phase: "live";
  canEnter: true;
  sessionType: "new";
  ctaLabel: string;
  statusLabel: string;
  timingLabel: string;
  actionHelper: string;
  verificationOpensAt: string;
  contestStartsAt: string;
  contestEndsAt: string;
  contestDateLabel: string;
};

export function isPracticeContest(contest: PracticeCardInput): boolean {
  return contest.is_practice === true;
}

/**
 * A practice contest is always open, and its dates mean nothing.
 *
 * This is decided before any time-based branch — including the one that
 * reports unusable metadata — because an organiser creating a practice
 * contest still has to type *something* into the date fields, and whatever
 * they type is usually in the past by the time anyone practises. Read
 * literally, the card said ENDED with a disabled button, on a contest the
 * server opens without complaint: a candidate looking at a rehearsal they are
 * registered for and cannot start.
 */
export function practiceEntryState(): PracticeEntry {
  return {
    phase: "live",
    canEnter: true,
    sessionType: "new",
    ctaLabel: "Start practice",
    statusLabel: "PRACTICE",
    // No countdown anywhere. The server sends a null clock for a practice
    // contest, and the card must not invent one either — a timer that means
    // nothing teaches the candidate to distrust the one that does.
    timingLabel: "no time limit",
    actionHelper: "Practice on the real problems. Nothing here is scored.",
    verificationOpensAt: "—",
    contestStartsAt: "—",
    contestEndsAt: "—",
    contestDateLabel: "Open whenever you are",
  };
}

/**
 * How long before the card should re-render.
 *
 * A practice card has no boundary to cross and no countdown to advance, so it
 * does not need a per-minute re-render for the rest of the session.
 */
export const PRACTICE_TICK_MS = 60000;
