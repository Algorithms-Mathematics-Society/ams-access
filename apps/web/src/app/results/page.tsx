"use client";

/**
 * What the candidate did, after the bell.
 *
 * This page used to be a leaderboard behind a 48-hour embargo, fetched from
 * `/contests/:id/results?email=…` — an endpoint that no longer exists, keyed
 * on an identity the platform no longer has. Both are gone:
 *
 * - **No leaderboard.** Candidates see their own results and nobody else's.
 *   The API has no participant-facing standings endpoint at all, deliberately.
 * - **No embargo.** Everything here was already visible in the contest room
 *   as they submitted. Locking it afterwards would be hiding something from
 *   them that they had already been shown.
 *
 * The per-problem breakdown, including the symbolic gate, renders through the
 * same modules the contest room uses, so a verdict reads identically in both
 * places.
 */

import { useCallback, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { getContest, listMySubmissions, ProctorApiError } from "@/lib/proctor-api";
import { toAttemptRecords, type AttemptRecord } from "@/app/session/contest/attempt-adapter";
import { partialCreditZeroed } from "@/app/session/contest/family-summary";
import { verdictColor, verdictLabel } from "@/lib/verdict";
import { ResultsLoading } from "./components/ResultsLoading";
import { ErrorScreen } from "./components/ErrorScreen";

type ProblemRow = {
  label: string;
  title: string;
  attempts: AttemptRecord[];
};

/** The session whose results to show: the one just finished, or the one still
 * open if the candidate navigated here without exiting. */
function resolveSessionId(contestId: string): string | null {
  for (const key of [STORAGE_KEYS.LAST_SESSION, STORAGE_KEYS.ACTIVE_SESSION]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { id?: string; contest_id?: string };
      if (parsed?.id && (!contestId || parsed.contest_id === contestId)) return parsed.id;
    } catch {
      // Corrupt entry — try the next one rather than failing the page.
    }
  }
  return null;
}

function ResultsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";

  const [rows, setRows] = useState<ProblemRow[] | null>(null);
  const [contestTitle, setContestTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    setError(null);
    const sessionId = resolveSessionId(contestId);
    if (!contestId || !sessionId) {
      setError("We couldn't tell which contest this was. Open it from your home screen.");
      return;
    }

    try {
      const [index, submissions] = await Promise.all([
        getContest(contestId),
        listMySubmissions(sessionId),
      ]);
      setContestTitle(index.title);

      const attempts = toAttemptRecords(submissions);
      setRows(
        index.problems.map((problem) => ({
          label: problem.label,
          title: problem.title,
          // Oldest first here: reading down the list is reading the story of
          // how they got there.
          attempts: attempts.filter((attempt) => attempt.problem_id === problem.label).reverse(),
        }))
      );
    } catch (caught) {
      if (caught instanceof ProctorApiError && caught.status === 401) {
        router.push("/login");
        return;
      }
      setError("Could not load your results. Check your connection and retry.");
    }
  }, [contestId, router]);

  useEffect(() => {
    void fetchResults();
  }, [fetchResults]);

  if (error) return <ErrorScreen error={error} fetchResults={fetchResults} router={router} />;
  if (!rows) return <ResultsLoading />;

  return (
    <div className="results-root">
      <div className="results-shell">
        <header className="results-header">
          <div>
            <div className="results-eyebrow">Your results</div>
            <h1 className="results-title">{contestTitle}</h1>
          </div>
          <button onClick={() => router.push("/home")} className="results-btn results-btn-ghost">
            Back to Home
          </button>
        </header>

        {rows.every((row) => row.attempts.length === 0) && (
          <p className="results-empty">You didn&rsquo;t submit anything for this contest.</p>
        )}

        {rows.map((row) => (
          <ProblemResult key={row.label} row={row} />
        ))}
      </div>
    </div>
  );
}

function ProblemResult({ row }: { row: ProblemRow }) {
  const latest = row.attempts[row.attempts.length - 1];
  const verdict = latest?.final_verdict ?? (latest ? latest.status : "UNATTEMPTED");
  const gated = latest ? partialCreditZeroed(latest.testcases) : false;

  return (
    <section className="results-problem">
      <div className="results-problem-head">
        <span
          className="results-verdict-dot"
          style={{ background: verdictColor(verdict) }}
          role="img"
          aria-label={verdictLabel(verdict)}
        />
        <span className="results-problem-label">{row.label}</span>
        <span className="results-problem-title">{row.title}</span>
        <span className="results-problem-count">
          {row.attempts.length} attempt{row.attempts.length === 1 ? "" : "s"}
        </span>
      </div>

      {gated && (
        // Said here as well as on the verdict in the room. Someone reading a
        // zero afterwards is exactly the person who most needs to know why,
        // and they may never have looked at the panel during the contest.
        <p className="results-gate">
          A restriction was broken, so this problem scored zero regardless of the tests.
        </p>
      )}

      {row.attempts.length > 0 && (
        <ol className="results-attempts">
          {row.attempts.map((attempt) => (
            <li key={attempt.id}>
              <span style={{ color: verdictColor(attempt.final_verdict ?? attempt.status) }}>
                {verdictLabel(attempt.final_verdict ?? attempt.status)}
              </span>
              <span className="results-attempt-meta">
                attempt {attempt.attempt_no} · {new Date(attempt.created_at).toLocaleTimeString()}
                {attempt.testcases.length > 0 && (
                  <>
                    {" "}
                    · {attempt.testcases.filter((t) => t.verdict === "AC").length}/
                    {attempt.testcases.length} cases
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<ResultsLoading />}>
      <ResultsView />
    </Suspense>
  );
}
