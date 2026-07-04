import { verdictColor, verdictLabel } from "@/lib/verdict";
import { formatPenalty } from "./utils";
import type { ResultsData } from "./types";

export interface LeaderboardSectionProps {
  results: ResultsData;
}

export function LeaderboardSection({ results }: LeaderboardSectionProps) {
  return (
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
              <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Score</th>
              <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Solved</th>
              <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Penalty</th>
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
  );
}
