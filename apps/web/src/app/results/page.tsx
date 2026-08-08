"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";

const API_URL = resolveApiBase();
import { STORAGE_KEYS } from "@/constants/storage-keys";
import type { ResultsData, MySubmission } from "./components/types";
import { formatPenalty, formatCountdown } from "./components/utils";
import { ResultsLoading } from "./components/ResultsLoading";
import { LockedScreen } from "./components/LockedScreen";
import { ErrorScreen } from "./components/ErrorScreen";
import { MySubmissionsSection } from "./components/MySubmissionsSection";
import { LeaderboardSection } from "./components/LeaderboardSection";

// ── Page ─────────────────────────────────────────────────────────────────────

function ResultsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";
  // TODO(proctor-v2): this page still calls the retired /contests/:id/results
  // and /my-submissions endpoints. It moves to
  // GET /participant/sessions/:uid/submissions — own-only, no leaderboard —
  // when the contest room does.
  const emailParam = searchParams?.get("email") ?? "";
  const email =
    emailParam ||
    (typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "") : "");

  const [results, setResults] = useState<ResultsData | null>(null);
  const [locked, setLocked] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mySubmissions, setMySubmissions] = useState<MySubmission[] | null>(null);
  const [expandedProblemId, setExpandedProblemId] = useState<string | null>(null);
  const [loadingMySubmissions, setLoadingMySubmissions] = useState(false);

  const fetchResults = useCallback(async () => {
    if (!contestId) return;
    try {
      // Clear any stale error when a new attempt begins — error was previously
      // write-only, so once set the error branch rendered forever and Retry
      // could never recover even when the re-fetch succeeded.
      setError(null);
      const res = await fetch(
        `${API_URL}/contests/${contestId}/results?email=${encodeURIComponent(email)}`
      );
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as {
          code?: string;
          results_visible_at?: string;
        };
        if (data.code === "RESULTS_LOCKED") {
          setLocked(true);
          // Backend guarantees a concrete timestamp, but guard against an empty
          // value so the locked screen always renders (never stuck on Loading).
          setLockedUntil(data.results_visible_at ? data.results_visible_at : null);
          return;
        }
      }
      if (!res.ok) {
        setError("Could not load results. The contest may not exist.");
        // Lock state is unknown on failure — clear it so the honest error
        // screen (with a working Retry) renders instead of a frozen locked
        // screen (locked renders before error, so stale locked hid errors).
        setLocked(false);
        setLockedUntil(null);
        return;
      }
      const data = (await res.json()) as ResultsData;
      setResults(data);
      setLocked(false);
      setLockedUntil(null);
    } catch {
      setError("Could not connect. Check your network and retry.");
      // Same as above: don't assert a lock state we don't know.
      setLocked(false);
      setLockedUntil(null);
    }
  }, [contestId, email]);

  useEffect(() => {
    void fetchResults();
  }, [fetchResults]);

  // Countdown tick when locked.
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => {
      const remaining = formatCountdown(lockedUntil);
      setCountdown(remaining);
      if (new Date(lockedUntil).getTime() <= Date.now()) {
        clearInterval(id);
        void fetchResults();
      }
    }, 1000);
    setCountdown(formatCountdown(lockedUntil));
    return () => clearInterval(id);
  }, [lockedUntil, fetchResults]);

  async function loadMySubmissions() {
    if (!contestId || !email) return;
    setLoadingMySubmissions(true);
    try {
      const res = await fetch(
        `${API_URL}/contests/${contestId}/my-submissions?email=${encodeURIComponent(email)}`
      );
      if (res.ok) {
        const data = (await res.json()) as { submissions: MySubmission[] };
        setMySubmissions(data.submissions);
      }
    } finally {
      setLoadingMySubmissions(false);
    }
  }

  const myEntry = results?.entries.find((e) => e.session_id === results.my_session_id);
  const myProblems = mySubmissions
    ? results?.questions.map((q) => ({
        question: q,
        submissions: mySubmissions.filter((s) => s.problem_id === q.id),
      }))
    : null;

  // ── Locked screen ──────────────────────────────────────────────────────────
  if (locked) {
    return (
      <LockedScreen lockedUntil={lockedUntil} countdown={countdown} email={email} router={router} />
    );
  }

  if (error) {
    return <ErrorScreen error={error} fetchResults={fetchResults} router={router} />;
  }

  if (!results) {
    return <ResultsLoading />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-0)",
        color: "var(--theme-text)",
        fontFamily: "system-ui, sans-serif",
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          maxWidth: 900,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: "var(--theme-text-muted)",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Contest Results
            </div>
            <div
              style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--theme-text)" }}
            >
              Leaderboard
            </div>
          </div>
          <button onClick={() => router.push("/home")} className="results-btn results-btn-ghost">
            Back to Home
          </button>
        </div>

        {/* My result banner */}
        {myEntry && (
          <div
            style={{
              background: "rgb(var(--accent-rgb) / 0.10)",
              border: "1px solid rgb(var(--accent-rgb) / 0.30)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--elevation-1)",
              padding: "20px 24px",
              display: "flex",
              gap: 32,
              flexWrap: "wrap",
              animation: "slideDown var(--transition-slow) both",
            }}
          >
            {[
              { label: "Your Rank", value: `#${myEntry.rank}` },
              { label: "Score", value: myEntry.total_score },
              { label: "Solved", value: `${myEntry.solved_count} / ${results.questions.length}` },
              { label: "Penalty", value: formatPenalty(myEntry.penalty_seconds) },
            ].map((cell) => (
              <div key={cell.label}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--theme-text-muted)",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  {cell.label}
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "var(--theme-text)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {cell.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* My detailed breakdown */}
        <MySubmissionsSection
          mySubmissions={mySubmissions}
          loadingMySubmissions={loadingMySubmissions}
          loadMySubmissions={loadMySubmissions}
          expandedProblemId={expandedProblemId}
          setExpandedProblemId={setExpandedProblemId}
          myProblems={myProblems}
        />

        {/* Full leaderboard */}
        <LeaderboardSection results={results} />
      </div>
    </div>
  );
}

// useSearchParams() requires a Suspense boundary under static export (output:
// "export"). Wrapping the view keeps the rendered UI unchanged — the fallback
// is the same loading screen the page already shows while fetching.
export default function ResultsPage() {
  return (
    <Suspense fallback={<ResultsLoading />}>
      <ResultsView />
    </Suspense>
  );
}
