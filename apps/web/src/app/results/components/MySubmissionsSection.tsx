import { type Dispatch, type SetStateAction } from "react";
import { verdictColor, verdictLabel, type VerdictCode } from "@/lib/verdict";
import { VerdictBadge } from "@/lib/VerdictBadge";
import type { Question, MySubmission } from "./types";

export interface MySubmissionsSectionProps {
  mySubmissions: MySubmission[] | null;
  loadingMySubmissions: boolean;
  loadMySubmissions: () => Promise<void>;
  expandedProblemId: string | null;
  setExpandedProblemId: Dispatch<SetStateAction<string | null>>;
  myProblems: { question: Question; submissions: MySubmission[] }[] | null | undefined;
}

export function MySubmissionsSection({
  mySubmissions,
  loadingMySubmissions,
  loadMySubmissions,
  expandedProblemId,
  setExpandedProblemId,
  myProblems,
}: MySubmissionsSectionProps) {
  return (
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
                              {s.memory_kb != null ? `${Math.round(s.memory_kb / 1024)}MB` : "-"}
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
  );
}
