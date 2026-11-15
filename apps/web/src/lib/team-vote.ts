/** Small allowlisted submission projection; never keep history or judge payloads. */
export type TeamIntegrationDetails = {
  integration_verdict: string | null;
  passed_count: number | null;
  total_count: number | null;
  project_failure: boolean;
  failing_parts: string[];
  parts: {
    label: string;
    verdict: string | null;
    passed_count: number | null;
    total_count: number | null;
    substituted: boolean;
  }[];
  substitutions: { label: string; reason: string; reference: boolean }[];
};
export type TeamIntegrationSummary = {
  revision: number;
  status: string;
  verdict: string | null;
  details: TeamIntegrationDetails | null;
};
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
const bounded = (v: unknown, max = 64): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const count = (v: unknown): number | null => (integer(v) ? v : null);
/** Python truthiness, to match the server's bool() checks in team_board.substituted. */
const truthy = (v: unknown) =>
  Array.isArray(v) ? v.length > 0 : object(v) ? Object.keys(v).length > 0 : !!v;
/** Fail closed on incomplete substitution metadata, never reinterpret a reference as a pass. */
function details(v: Record<string, unknown>): TeamIntegrationDetails | null {
  if (
    !object(v.parts) ||
    Object.keys(v.parts).length > 5 ||
    !Array.isArray(v.substitutions) ||
    v.substitutions.length > 5 ||
    !Array.isArray(v.failing_parts) ||
    v.failing_parts.length > 5 ||
    !v.failing_parts.every((label) => bounded(label)) ||
    typeof v.project_failure !== "boolean" ||
    !(v.fallbacks === undefined || v.fallbacks === null || object(v.fallbacks)) ||
    Object.keys(v.fallbacks ?? {}).length > 5
  )
    return null;
  // Labels sent with no source; the server links a stand-in and denies credit.
  const fallbacks = (v.fallbacks ?? {}) as Record<string, unknown>;
  const substitutions: TeamIntegrationDetails["substitutions"] = [];
  for (const sub of v.substitutions) {
    if (!object(sub) || !bounded(sub.label) || !bounded(sub.reason, 400)) return null;
    substitutions.push({
      label: sub.label,
      reason: sub.reason,
      reference: sub.origin === "reference",
    });
  }
  for (const [label, kind] of Object.entries(fallbacks)) {
    if (!bounded(label)) return null;
    if (!substitutions.some((sub) => sub.label === label))
      substitutions.push({
        label,
        reason: "no source was submitted for this part",
        reference: kind === "reference",
      });
  }
  const parts: TeamIntegrationDetails["parts"] = [];
  for (const [label, part] of Object.entries(v.parts)) {
    if (!bounded(label) || !object(part)) return null;
    const substituted =
      substitutions.some((sub) => sub.label === label) ||
      truthy(part.substituted) ||
      (truthy(part.origin) && part.origin !== "submission");
    if (substituted && !substitutions.some((sub) => sub.label === label))
      substitutions.push({
        label,
        reason: "not supplied by your team",
        reference: part.origin === "reference" || part.substituted === "reference",
      });
    parts.push({
      label,
      substituted,
      verdict: bounded(part.verdict) ? part.verdict : null,
      passed_count: count(part.passed_count),
      total_count: count(part.total_count),
    });
  }
  return {
    parts,
    substitutions,
    failing_parts: v.failing_parts as string[],
    project_failure: v.project_failure,
    integration_verdict: bounded(v.integration_verdict) ? v.integration_verdict : null,
    passed_count: count(v.passed_count),
    total_count: count(v.total_count),
  };
}
function summary(v: unknown): TeamIntegrationSummary | null {
  if (
    !object(v) ||
    !integer(v.revision) ||
    typeof v.status !== "string" ||
    v.status.length > 64 ||
    !(v.verdict === null || (typeof v.verdict === "string" && v.verdict.length <= 64))
  )
    return null;
  return {
    revision: v.revision,
    status: v.status,
    verdict: v.verdict as string | null,
    details: details(v),
  };
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
/** Time since the server sample. performance.now() stops while a Mac sleeps,
 * so wall-clock elapsed also counts; taking the larger means a clock set
 * backwards still cannot add time. */
function elapsedSinceSample(
  sampledAt: number,
  now: number,
  sampledWallAt?: number,
  wallNow = Date.now()
): number {
  return Math.max(0, now - sampledAt, sampledWallAt === undefined ? 0 : wallNow - sampledWallAt);
}
export function voteRemainingMs(
  vote: TeamVote,
  serverTime: string,
  sampledAt: number,
  now: number,
  sampledWallAt?: number,
  wallNow?: number
): number {
  return Math.max(
    0,
    Date.parse(vote.deadline) -
      Date.parse(serverTime) -
      elapsedSinceSample(sampledAt, now, sampledWallAt, wallNow)
  );
}
/** The result the vote panel names and the results dialog shows: latest finished, else in flight. */
export function shownIntegration(vote: TeamVote | null | undefined): TeamIntegrationSummary | null {
  return vote?.last_result ?? vote?.integration ?? null;
}
export function integrationStatus(summary: TeamIntegrationSummary): string {
  if (summary.status === "queued" || summary.status === "pending") return "Queued";
  if (summary.status === "running" || summary.status === "judging") return "Running";
  if (summary.status === "completed") return "Completed";
  if (summary.status === "failed") return "Could not complete";
  return "Awaiting result";
}

export function integrationPartStatus(
  result: TeamIntegrationSummary | null | undefined,
  label: string
): string {
  if (!result) return "No result yet";
  if (!result.details) return "Result details unavailable";
  if (result.details.substitutions.some((sub) => sub.label === label))
    return "Substituted · no score";
  const part = result.details.parts.find((part) => part.label === label);
  if (!part) return "Result details unavailable";
  return part.substituted ? "Substituted · no score" : (part.verdict ?? "Verdict pending");
}
