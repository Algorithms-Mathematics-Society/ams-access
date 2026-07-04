"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";

const API_URL = resolveApiBase();
import { STORAGE_KEYS } from "@/constants/storage-keys";
import { verdictColor, verdictLabel, type VerdictCode } from "@/lib/verdict";
import { VerdictBadge } from "@/lib/VerdictBadge";
import type { ResultsData, MySubmission } from "./components/types";
import { formatPenalty, formatCountdown } from "./components/utils";
import { ResultsLoading } from "./components/ResultsLoading";

// ── Page ─────────────────────────────────────────────────────────────────────

function ResultsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";
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
        return;
      }
      const data = (await res.json()) as ResultsData;
      setResults(data);
      setLocked(false);
      setLockedUntil(null);
    } catch {
      setError("Could not connect. Check your network and retry.");
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
      <div
        style={{
          minHeight: "100vh",
          background: "var(--surface-0)",
          color: "var(--theme-text)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          fontFamily: "system-ui, sans-serif",
          padding: "40px 20px",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "var(--theme-text-muted)",
            textTransform: "uppercase",
          }}
        >
          You&rsquo;re done
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: "var(--theme-text)" }}>
          {lockedUntil ? `Results unlock in ${countdown}` : "Results unlock soon"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", maxWidth: 360, textAlign: "center" }}>
          {email
            ? `Your work is safely submitted. We'll email you at ${email} when results are ready.`
            : "Your work is safely submitted. We'll email you when results are ready."}
        </div>
        <button
          onClick={() => router.push("/home")}
          className="results-btn results-btn-ghost"
          style={{ marginTop: 12 }}
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--surface-0)",
          color: "var(--theme-text)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            animation: "slideDown var(--transition-slow) both",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
              stroke="currentColor"
              style={{ color: "var(--theme-error-text)" }}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span style={{ fontSize: 15, color: "var(--theme-error-text)" }}>{error}</span>
        </div>
        <button onClick={() => void fetchResults()} className="results-btn results-btn-primary">
          Retry
        </button>
        <button onClick={() => router.push("/home")} className="results-btn results-btn-ghost">
          Back to Home
        </button>
      </div>
    );
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
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: "var(--theme-text-muted)",
                textTransform: "uppercase",
              }}
            >
              My Submissions
            </div>
            {!mySubmissions && (
              <button
                onClick={() => void loadMySubmissions()}
                disabled={loadingMySubmissions}
                className="results-load-btn"
                style={{
                  padding: "5px 14px",
                  background: "rgb(var(--accent-rgb) / 0.1)",
                  border: "1px solid rgb(var(--accent-rgb) / 0.2)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--theme-accent-text)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {loadingMySubmissions ? "Loading…" : "Load Breakdown"}
              </button>
            )}
          </div>
          {myProblems && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {myProblems.map(({ question, submissions }) => {
                const expanded = expandedProblemId === question.id;
                const bestVerdict = submissions.find((s) => s.final_verdict === "AC")
                  ? "AC"
                  : submissions.length > 0
                    ? (submissions[submissions.length - 1].final_verdict ?? "-")
                    : "-";
                return (
                  <div
                    key={question.id}
                    style={{
                      background: "var(--theme-row-bg)",
                      border: "1px solid var(--theme-border)",
                      borderRadius: 8,
                    }}
                  >
                    <button
                      onClick={() => setExpandedProblemId(expanded ? null : question.id)}
                      className="results-problem-row"
                      style={{
                        width: "100%",
                        padding: "14px 18px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "var(--theme-text)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span
                          role="img"
                          aria-label={verdictLabel(bestVerdict)}
                          title={verdictLabel(bestVerdict)}
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "var(--radius-pill)",
                            background: verdictColor(bestVerdict),
                            flexShrink: 0,
                            display: "inline-block",
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{question.title}</span>
                        <span style={{ fontSize: 11, color: "var(--theme-text-muted)" }}>
                          {submissions.length} attempt{submissions.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--theme-text-muted)" }}>
                        {expanded ? "Hide" : "Show"}
                      </span>
                    </button>
                    {expanded && (
                      <div
                        style={{
                          padding: "0 18px 14px",
                          borderTop: "1px solid var(--theme-border)",
                        }}
                      >
                        <table
                          style={{
                            width: "100%",
                            fontSize: 12,
                            borderCollapse: "collapse",
                            marginTop: 12,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          <thead>
                            <tr style={{ color: "var(--text-dim)" }}>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                #
                              </th>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                Verdict
                              </th>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                Score
                              </th>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                Time
                              </th>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                Memory
                              </th>
                              <th style={{ textAlign: "left", paddingBottom: 8, fontWeight: 600 }}>
                                Language
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {submissions.map((s) => (
                              <tr key={s.id} style={{ borderTop: "1px solid var(--theme-border)" }}>
                                <td style={{ padding: "7px 0", color: "var(--theme-text-muted)" }}>
                                  {s.attempt_no}
                                </td>
                                <td
                                  style={{
                                    padding: "7px 0",
                                  }}
                                >
                                  <VerdictBadge
                                    variant="full"
                                    code={(s.final_verdict ?? s.status) as VerdictCode}
                                  />
                                </td>
                                <td
                                  style={{
                                    padding: "7px 0",
                                    color: "var(--theme-text-muted-strong)",
                                  }}
                                >
                                  {s.score}
                                </td>
                                <td
                                  style={{
                                    padding: "7px 0",
                                    color: "var(--theme-text-muted-strong)",
                                  }}
                                >
                                  {s.runtime_ms != null ? `${s.runtime_ms}ms` : "-"}
                                </td>
                                <td
                                  style={{
                                    padding: "7px 0",
                                    color: "var(--theme-text-muted-strong)",
                                  }}
                                >
                                  {s.memory_kb != null
                                    ? `${Math.round(s.memory_kb / 1024)}MB`
                                    : "-"}
                                </td>
                                <td style={{ padding: "7px 0", color: "var(--theme-text-muted)" }}>
                                  {s.language}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Full leaderboard */}
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--theme-text-muted)",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Full Rankings — {results.entries.length} participants
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                fontSize: 12,
                borderCollapse: "collapse",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <thead>
                <tr
                  style={{
                    color: "var(--text-dim)",
                    borderBottom: "1px solid var(--theme-border)",
                  }}
                >
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Rank</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>
                    Contestant
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>
                    Score
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>
                    Solved
                  </th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>
                    Penalty
                  </th>
                  {results.questions.map((q) => (
                    <th
                      key={q.id}
                      style={{
                        textAlign: "center",
                        padding: "8px 8px",
                        fontWeight: 600,
                        maxWidth: 60,
                      }}
                      title={q.title}
                    >
                      {q.order_index + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.entries.map((entry) => {
                  const isMe = entry.session_id === results.my_session_id;
                  return (
                    <tr
                      key={entry.session_id}
                      className="lb-row"
                      style={{
                        borderBottom: "1px solid var(--theme-border)",
                        ...(isMe ? { background: "rgb(var(--accent-rgb) / 0.08)" } : {}),
                      }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          fontWeight: isMe ? 700 : 400,
                          color: isMe ? "var(--theme-accent-text)" : "var(--theme-text-muted)",
                        }}
                      >
                        {entry.rank}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: isMe ? "var(--theme-text)" : "var(--theme-text-muted-strong)",
                          fontWeight: isMe ? 600 : 400,
                        }}
                      >
                        {entry.candidate_name}
                        {isMe && <span className="results-you-chip">You</span>}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: isMe ? "var(--theme-text)" : "var(--theme-text-muted-strong)",
                        }}
                      >
                        {entry.total_score}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          color: "var(--theme-text-muted)",
                        }}
                      >
                        {entry.solved_count}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          color: "var(--theme-text-muted)",
                        }}
                      >
                        {formatPenalty(entry.penalty_seconds)}
                      </td>
                      {results.questions.map((q) => {
                        const p = entry.problems.find((pr) => pr.question_id === q.id);
                        const v = p?.verdict ?? "UNATTEMPTED";
                        return (
                          <td key={q.id} style={{ padding: "10px 8px", textAlign: "center" }}>
                            <span
                              role="img"
                              aria-label={`${q.title}: ${verdictLabel(v)}`}
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "var(--radius-pill)",
                                background:
                                  v === "UNATTEMPTED" ? "var(--verdict-none)" : verdictColor(v),
                              }}
                              title={`${q.title}: ${verdictLabel(v)}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
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
