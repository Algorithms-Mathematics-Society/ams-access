"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";

const API_URL = resolveApiBase();
import { STORAGE_KEYS } from "@/constants/storage-keys";

// ── Types ────────────────────────────────────────────────────────────────────

type ProblemState = {
  question_id: string;
  attempts: number;
  best_score: number;
  verdict: string;
  last_submission_at: string | null;
};

type LeaderboardEntry = {
  rank: number;
  session_id: string;
  candidate_name: string;
  candidate_email: string;
  total_score: number;
  solved_count: number;
  penalty_seconds: number;
  problems: ProblemState[];
};

type Question = { id: string; title: string; points: number; order_index: number };

type ResultsData = {
  contest_id: string;
  status: string;
  scoring_type: string;
  results_visible_at: string;
  questions: Question[];
  entries: LeaderboardEntry[];
  my_session_id: string;
};

type MySubmission = {
  id: string;
  problem_id: string;
  problem_title: string;
  attempt_no: number;
  language: string;
  status: string;
  final_verdict: string | null;
  score: number;
  runtime_ms: number | null;
  memory_kb: number | null;
  created_at: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function verdictColor(v: string | null): string {
  switch (v) {
    case "AC":
      return "#22c55e";
    case "WA":
      return "#ef4444";
    case "TLE":
      return "#f59e0b";
    case "MLE":
      return "#fb923c";
    case "RE":
      return "#f97316";
    case "CE":
      return "#a78bfa";
    case "IE":
      return "#94a3b8";
    case "RUNNING":
      return "#60a5fa";
    default:
      return "rgba(255,255,255,0.25)";
  }
}

// Plain-language verdict labels for candidates (the org views keep the raw codes).
function verdictLabel(v: string | null): string {
  switch (v) {
    case "AC":
      return "Accepted";
    case "WA":
      return "Wrong answer";
    case "TLE":
      return "Too slow";
    case "MLE":
      return "Out of memory";
    case "RE":
      return "Runtime error";
    case "CE":
      return "Didn’t compile";
    case "OLE":
      return "Too much output";
    case "IE":
      return "Judge error";
    case "RUNNING":
      return "Running…";
    case "UNATTEMPTED":
      return "Not attempted";
    default:
      return v ?? "—";
  }
}

function formatPenalty(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatCountdown(targetIso: string): string {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
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
          background: "#070a10",
          color: "#e2e8f0",
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
            color: "#64748b",
            textTransform: "uppercase",
          }}
        >
          You&rsquo;re done
        </div>
        <div style={{ fontSize: 28, fontWeight: 600, color: "#e2e8f0" }}>
          {lockedUntil ? `Results unlock in ${countdown}` : "Results unlock soon"}
        </div>
        <div style={{ fontSize: 13, color: "#475569", maxWidth: 360, textAlign: "center" }}>
          {email
            ? `Your work is safely submitted. We'll email you at ${email} when results are ready.`
            : "Your work is safely submitted. We'll email you when results are ready."}
        </div>
        <button
          onClick={() => router.push("/home")}
          style={{
            marginTop: 12,
            padding: "9px 22px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "#94a3b8",
            fontSize: 13,
            cursor: "pointer",
          }}
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
          background: "#070a10",
          color: "#e2e8f0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 15, color: "#fca5a5" }}>{error}</div>
        <button
          onClick={() => void fetchResults()}
          style={{
            padding: "8px 20px",
            background: "#7c3aed",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
        <button
          onClick={() => router.push("/home")}
          style={{
            padding: "8px 20px",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "#94a3b8",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Back to Home
        </button>
      </div>
    );
  }

  if (!results) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#070a10",
          color: "#64748b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        Loading results…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070a10",
        color: "#e2e8f0",
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
                color: "#64748b",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Contest Results
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0" }}>Leaderboard</div>
          </div>
          <button
            onClick={() => router.push("/home")}
            style={{
              padding: "8px 18px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "#94a3b8",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Back to Home
          </button>
        </div>

        {/* My result banner */}
        {myEntry && (
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(124,58,237,0.12) 0%, rgba(168,85,247,0.06) 100%)",
              border: "1px solid rgba(168,85,247,0.25)",
              borderRadius: 10,
              padding: "20px 24px",
              display: "flex",
              gap: 32,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#7c3aed",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Your Rank
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#c084fc" }}>#{myEntry.rank}</div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Score
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#e2e8f0" }}>
                {myEntry.total_score}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Solved
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#e2e8f0" }}>
                {myEntry.solved_count} / {results.questions.length}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Penalty
              </div>
              <div style={{ fontSize: 24, fontWeight: 600, color: "#e2e8f0" }}>
                {formatPenalty(myEntry.penalty_seconds)}
              </div>
            </div>
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
                color: "#64748b",
                textTransform: "uppercase",
              }}
            >
              My Submissions
            </div>
            {!mySubmissions && (
              <button
                onClick={() => void loadMySubmissions()}
                disabled={loadingMySubmissions}
                style={{
                  padding: "5px 14px",
                  background: "rgba(168,85,247,0.1)",
                  border: "1px solid rgba(168,85,247,0.2)",
                  borderRadius: 5,
                  color: "#c084fc",
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
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 8,
                    }}
                  >
                    <button
                      onClick={() => setExpandedProblemId(expanded ? null : question.id)}
                      style={{
                        width: "100%",
                        padding: "14px 18px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "#e2e8f0",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: verdictColor(bestVerdict),
                            flexShrink: 0,
                            display: "inline-block",
                          }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{question.title}</span>
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          {submissions.length} attempt{submissions.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "#475569" }}>
                        {expanded ? "Hide" : "Show"}
                      </span>
                    </button>
                    {expanded && (
                      <div
                        style={{
                          padding: "0 18px 14px",
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <table
                          style={{
                            width: "100%",
                            fontSize: 12,
                            borderCollapse: "collapse",
                            marginTop: 12,
                          }}
                        >
                          <thead>
                            <tr style={{ color: "#475569" }}>
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
                              <tr
                                key={s.id}
                                style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                              >
                                <td style={{ padding: "7px 0", color: "#64748b" }}>
                                  {s.attempt_no}
                                </td>
                                <td
                                  style={{
                                    padding: "7px 0",
                                    color: verdictColor(s.final_verdict),
                                    fontWeight: 600,
                                  }}
                                >
                                  {s.final_verdict ? verdictLabel(s.final_verdict) : s.status}
                                </td>
                                <td style={{ padding: "7px 0", color: "#94a3b8" }}>{s.score}</td>
                                <td style={{ padding: "7px 0", color: "#94a3b8" }}>
                                  {s.runtime_ms != null ? `${s.runtime_ms}ms` : "-"}
                                </td>
                                <td style={{ padding: "7px 0", color: "#94a3b8" }}>
                                  {s.memory_kb != null
                                    ? `${Math.round(s.memory_kb / 1024)}MB`
                                    : "-"}
                                </td>
                                <td style={{ padding: "7px 0", color: "#64748b" }}>{s.language}</td>
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
              color: "#64748b",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Full Rankings — {results.entries.length} participants
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
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
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        background: isMe ? "rgba(124,58,237,0.08)" : "transparent",
                      }}
                    >
                      <td
                        style={{
                          padding: "10px 12px",
                          fontWeight: isMe ? 700 : 400,
                          color: isMe ? "#c084fc" : "#64748b",
                        }}
                      >
                        {entry.rank}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: isMe ? "#e2e8f0" : "#94a3b8",
                          fontWeight: isMe ? 600 : 400,
                        }}
                      >
                        {entry.candidate_name}
                        {isMe && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              color: "#7c3aed",
                              fontWeight: 700,
                            }}
                          >
                            YOU
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: isMe ? "#e2e8f0" : "#94a3b8",
                        }}
                      >
                        {entry.total_score}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#64748b" }}>
                        {entry.solved_count}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#64748b" }}>
                        {formatPenalty(entry.penalty_seconds)}
                      </td>
                      {results.questions.map((q) => {
                        const p = entry.problems.find((pr) => pr.question_id === q.id);
                        const v = p?.verdict ?? "UNATTEMPTED";
                        return (
                          <td key={q.id} style={{ padding: "10px 8px", textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                background:
                                  v === "UNATTEMPTED" ? "rgba(255,255,255,0.1)" : verdictColor(v),
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
