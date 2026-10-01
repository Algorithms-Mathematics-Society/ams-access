import type { ContestEntryPhase, InvitedContest } from "./types";

/** Orders the home view only; the existing entry policy remains authoritative. */
export function sortHomeContests(
  contests: readonly InvitedContest[],
  phaseFor: (contest: InvitedContest) => ContestEntryPhase
): InvitedContest[] {
  return contests
    .map((contest, index) => {
      const phase = phaseFor(contest);
      const priority = contest.is_practice
        ? 2
        : phase === "live"
          ? 0
          : phase === "verification_open" || phase === "too_early"
            ? 1
            : phase === "blocked" || phase === "metadata_unavailable"
              ? 3
              : phase === "ended"
                ? 4
                : 5;
      const start = Date.parse(contest.start_at);
      const end = Date.parse(contest.end_at);
      const chronological = priority === 0 ? end : priority === 1 ? start : 0;
      const time = Number.isFinite(chronological) ? chronological : Number.POSITIVE_INFINITY;
      return { contest, index, priority, time };
    })
    .sort((a, b) => a.priority - b.priority || a.time - b.time || a.index - b.index)
    .map(({ contest }) => contest);
}
