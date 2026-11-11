/** Small allowlisted submission projection; never keep history or judge payloads. */
export type TeamIntegrationSummary = { revision: number; status: string; verdict: string | null };
export type TeamVote = {
  revision: number;
  votes: number;
  needed: number;
  mine: boolean;
  deadline: string;
  submitted_revision: number | null;
  submitted_by: "vote" | "deadline" | null;
  integration: TeamIntegrationSummary | null;
  last_result: TeamIntegrationSummary | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function summary(v: unknown): TeamIntegrationSummary | null {
  if (
    !object(v) ||
    !integer(v.revision) ||
    typeof v.status !== "string" ||
    v.status.length > 64 ||
    !(v.verdict === null || (typeof v.verdict === "string" && v.verdict.length <= 64))
  )
    return null;
  return { revision: v.revision, status: v.status, verdict: v.verdict as string | null };
}
export function parseTeamVote(v: unknown): TeamVote | null {
  if (
    !object(v) ||
    !object(v.vote) ||
    !integer(v.revision) ||
    !integer(v.vote.votes) ||
    !integer(v.vote.needed) ||
    v.vote.needed < 1 ||
    v.vote.needed > 5 ||
    v.vote.votes > v.vote.needed ||
    typeof v.vote.mine !== "boolean" ||
    typeof v.vote.deadline !== "string" ||
    !Number.isFinite(Date.parse(v.vote.deadline)) ||
    !(
      v.submitted_revision === null ||
      (integer(v.submitted_revision) && v.submitted_revision <= v.revision)
    ) ||
    ![null, "vote", "deadline"].includes(v.submitted_by as string | null)
  )
    return null;
  return {
    revision: v.revision,
    votes: v.vote.votes,
    needed: v.vote.needed,
    mine: v.vote.mine,
    deadline: v.vote.deadline,
    submitted_revision: v.submitted_revision as number | null,
    submitted_by: v.submitted_by as TeamVote["submitted_by"],
    integration: summary(v.integration),
    last_result: summary(v.last_result),
  };
}
export function voteRemainingMs(
  vote: TeamVote,
  serverTime: string,
  sampledAt: number,
  now: number
): number {
  return Math.max(
    0,
    Date.parse(vote.deadline) - Date.parse(serverTime) - Math.max(0, now - sampledAt)
  );
}
export function integrationStatus(summary: TeamIntegrationSummary): string {
  if (summary.status === "queued" || summary.status === "pending") return "Queued";
  if (summary.status === "running" || summary.status === "judging") return "Running";
  if (summary.status === "completed") return "Completed";
  if (summary.status === "failed") return "Could not complete";
  return "Awaiting result";
}
