/**
 * Loading the paper, from the participant API.
 *
 * Replaces `fetchSessionQuestions`, which called
 * `GET /sessions/:id/questions` — an endpoint that no longer exists — and ran
 * the result through a validator built for a contract with no field for
 * sample tests and no per-family metadata. Those are the two things a
 * candidate most needs, so the contract was revised rather than reimplemented
 * (see `services/projection.py` in ams-api).
 *
 * The output is the `CandidateQuestion` shape the contest room already reads,
 * so ~3,500 lines of working editor did not have to move. Same reasoning as
 * `toInvitedContest` on the home screen: the data source changed, the
 * interface did not.
 */

import {
  fetchProblemAsset,
  getContest,
  getProblem,
  type ContestIndex,
  type ProblemProjection,
} from "@/lib/proctor-api";
import type { CandidateQuestion } from "./candidate-question-projection";

/** One megabyte, for the limits the editor reports in bytes. */
const MB = 1024 * 1024;

export function toCandidateQuestion(
  projection: ProblemProjection,
  orderIndex: number,
  contestUid: string = "",
  /** Blob URLs for this problem's statement images, keyed by content hash.
   *  Absent entries simply leave a gap — see `loadStatementAssets`. */
  objectUrls: ReadonlyMap<string, string> = new Map()
): CandidateQuestion {
  return {
    // The contest-problem *label* is the identifier now. It is what the
    // submission and draft endpoints take, and unlike a uuid it is the thing
    // the candidate sees on screen and says out loud to an invigilator.
    id: projection.label,
    title: projection.title,
    description: projection.statement.markdown,
    starter_code: projection.starter?.source ?? null,
    starter_filename: projection.starter?.filename ?? null,
    order_index: orderIndex,
    question_type: "coding",
    points: projection.score,
    judge_engine: "cxxprobe",
    time_limit_ms: projection.limits.wall_time_ms || null,
    memory_limit_mb: projection.limits.memory_mb || null,
    samples: projection.samples,
    families: projection.families,
    // Carried so the marking block can say "unknown" rather than "none" for a
    // version uploaded before projections existed.
    backfilled: projection.backfilled ?? false,
    cxxprobe: {
      // No whole-document digest: v2 dropped it. It guarded a connection that
      // is already TLS- and certificate-pinned, and the per-artifact hashes
      // below are the ones that catch the failure this actually has, which is
      // truncation.
      bundle_sha256: "",
      projection_sha256: "",
      problem_name: projection.title,
      language: "cpp",
      standard: "c++23",
      limits: {
        memory_bytes: (projection.limits.memory_mb || 0) * MB,
        cpu_time_ms: projection.limits.cpu_time_ms,
        wall_time_ms: projection.limits.wall_time_ms,
        max_pids: 0,
      },
      statement: {
        // The path the markdown was authored at, inside the pack. It has to
        // be the real one: relative image references are resolved against
        // this directory, so `statement.md` at the problem root would make
        // `![](figure.png)` look for `A/figure.png` while the asset is at
        // `A/statement/figure.png`, and every image would silently miss.
        path: `${projection.label}/statement/problem.md`,
        sha256: projection.statement.sha256,
        size_bytes: projection.statement.size_bytes,
        content: projection.statement.markdown,
      },
      starter: projection.starter
        ? {
            path: `${projection.label}/${projection.starter.filename}`,
            filename: projection.starter.filename,
            language: "cpp",
            sha256: projection.starter.sha256,
            size_bytes: projection.starter.size_bytes,
            content: projection.starter.source,
          }
        : null,
      // `path` is prefixed with the label so it sits in the same namespace as
      // `statement.path` above, which is what the resolver walks.
      assets: (projection.assets ?? [])
        .map((asset) => ({
          id: asset.sha256,
          path: `${projection.label}/${asset.path}`,
          filename: asset.path.split("/").pop() ?? asset.path,
          media_type: asset.content_type,
          sha256: asset.sha256,
          size_bytes: asset.size_bytes,
          // The API URL is recorded for diagnostics only. Nothing renders from
          // it — an <img> cannot carry the bearer token, so the blob URL is
          // what actually reaches the DOM.
          url:
            `/participant/contests/${contestUid}/problems/` +
            `${projection.label}/assets/${asset.sha256}`,
          object_url: objectUrls.get(asset.sha256) ?? "",
        }))
        .filter((asset) => asset.object_url !== ""),
    },
  };
}

/** The whole paper: the contest index, and every problem in label order.
 *
 * The index is returned rather than discarded because it carries `ends_at`,
 * `remaining_ms`, `phase` and `server_time` — everything the room needs to
 * run a clock the candidate cannot move. It used to be thrown away here while
 * the room asked a *staff* route for the same thing, unauthenticated, which
 * 403'd, which is why every candidate got a fabricated one-hour timer.
 *
 * All statements are fetched concurrently and awaited together. A contest is
 * a handful of problems, so the round trips overlap into roughly one, and the
 * room needs the full list before it can render its problem tabs anyway —
 * arriving progressively would only let a candidate click a tab that has no
 * statement behind it yet.
 */
export async function loadContestPaper(
  contestUid: string
): Promise<{ index: ContestIndex; questions: CandidateQuestion[] }> {
  const index = await getContest(contestUid);
  const projections = await Promise.all(
    index.problems.map((problem) => getProblem(contestUid, problem.label))
  );
  const assetUrls = await Promise.all(
    projections.map((projection) => loadStatementAssets(contestUid, projection))
  );
  return {
    index,
    questions: projections.map((projection, i) =>
      toCandidateQuestion(projection, i, contestUid, assetUrls[i])
    ),
  };
}

/**
 * Fetch a problem's statement images and turn them into blob URLs.
 *
 * Blob URLs rather than direct `src` attributes to the API: the image element
 * cannot carry an Authorization header, and the alternative — a presigned or
 * unauthenticated URL — would make every diagram in a live contest readable
 * by anyone holding the link.
 *
 * Failures are dropped, not thrown. A missing diagram leaves a gap in a
 * statement the candidate can still read; failing the paper load over one
 * image would turn a cosmetic problem into an exam-stopping one. The
 * remaining images still load, because each is settled independently.
 *
 * Revoke these with `releaseCandidateQuestionAssets` when the room unmounts.
 */
export async function loadStatementAssets(
  contestUid: string,
  projection: ProblemProjection
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const assets = projection.assets ?? [];
  if (assets.length === 0) return urls;

  const blobs = await Promise.all(
    assets.map((asset) => fetchProblemAsset(contestUid, projection.label, asset.sha256))
  );
  assets.forEach((asset, i) => {
    const blob = blobs[i];
    if (blob) urls.set(asset.sha256, URL.createObjectURL(blob));
  });
  return urls;
}
