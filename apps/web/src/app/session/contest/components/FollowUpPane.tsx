import { authHeaders } from "@/lib/candidate-auth";
import { parseDescription } from "./markdown";
import { parseFollowUpParts, type Question, type FollowUpPartState } from "./questions";

export function FollowUpPane({
  question,
  sessionId,
  apiUrl,
  questionLetter,
  partStates,
  onPartUpdate,
}: {
  question: Question;
  sessionId: string;
  apiUrl: string;
  questionLetter: string;
  partStates: Record<number, FollowUpPartState>;
  onPartUpdate: (partIndex: number, patch: Partial<FollowUpPartState>) => void;
}) {
  const parts = parseFollowUpParts(question.description ?? "");

  async function handleSubmit(partIndex: number) {
    const state = partStates[partIndex];
    const answer = state?.inputText ?? "";
    if (!answer.trim()) return;
    onPartUpdate(partIndex, { loading: true });
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/followup-answer`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ question_id: question.id, part_index: partIndex, answer }),
      });
      const data = await res.json();
      onPartUpdate(partIndex, { loading: false, submitted: true, correct: data.correct === true });
    } catch {
      onPartUpdate(partIndex, { loading: false });
    }
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        background: "#0F0F0F",
        padding: "24px 32px",
        gap: "0",
      }}
    >
      <div
        style={{
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid #1F1F1F",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            color: "#64748b",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
          }}
        >
          Follow-up question
        </span>
        <h2
          style={{
            margin: "8px 0 0",
            fontSize: "20px",
            fontWeight: 600,
            color: "#e2e8f0",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {question.title}
        </h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {parts.map((part, idx) => {
          const label = `${questionLetter}${idx + 1}`;
          const state = partStates[idx] ?? {
            inputText: "",
            loading: false,
            submitted: false,
            correct: false,
          };
          const prevAccepted = idx === 0 || partStates[idx - 1]?.correct === true;
          const locked = !prevAccepted;
          const accepted = state.correct && state.submitted;

          return (
            <div
              key={idx}
              style={{
                borderRadius: "10px",
                border: accepted
                  ? "1px solid rgba(34,197,94,0.3)"
                  : locked
                    ? "1px solid #1F1F1F"
                    : "1px solid rgb(var(--accent-rgb) / 0.2)",
                background: accepted
                  ? "rgba(34,197,94,0.04)"
                  : locked
                    ? "#111111"
                    : "rgb(var(--accent-rgb) / 0.03)",
                overflow: "hidden",
                opacity: locked ? 0.55 : 1,
                transition: "all 250ms",
              }}
            >
              {/* Part header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 16px",
                  borderBottom: locked ? "none" : "1px solid rgba(255,255,255,0.05)",
                  background: accepted
                    ? "rgba(34,197,94,0.06)"
                    : locked
                      ? "transparent"
                      : "rgb(var(--accent-rgb) / 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      fontSize: "13px",
                      color: accepted ? "#22c55e" : locked ? "#475569" : "var(--color-accent-base)",
                    }}
                  >
                    {label}
                  </span>
                  {locked && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#475569",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Locked · complete {questionLetter}
                      {idx} first
                    </span>
                  )}
                  {accepted && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#22c55e",
                        fontWeight: 600,
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Accepted
                    </span>
                  )}
                  {state.submitted && !state.correct && !locked && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#ef4444",
                        fontFamily: "Inter, system-ui, sans-serif",
                      }}
                    >
                      Incorrect · try again
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: accepted ? "#22c55e" : "#64748b",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {part.points} pts
                </span>
              </div>

              {!locked && (
                <div style={{ padding: "16px" }}>
                  {/* Statement */}
                  <div
                    className="pb-body"
                    style={{
                      color: "#cbd5e1",
                      fontSize: "14px",
                      lineHeight: 1.65,
                      marginBottom: "14px",
                    }}
                    dangerouslySetInnerHTML={{ __html: parseDescription(part.statement || "") }}
                  />

                  {/* Answer input */}
                  {!accepted && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="text"
                        value={state.inputText}
                        onChange={(e) => onPartUpdate(idx, { inputText: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !state.loading) handleSubmit(idx);
                        }}
                        placeholder="Your answer…"
                        disabled={state.loading}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          background: "#1A1A1A",
                          border:
                            state.submitted && !state.correct
                              ? "1px solid rgba(239,68,68,0.4)"
                              : "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "6px",
                          color: "#e2e8f0",
                          fontSize: "13px",
                          fontFamily: "system-ui, sans-serif",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSubmit(idx)}
                        disabled={state.loading || !state.inputText.trim()}
                        style={{
                          padding: "8px 16px",
                          background: state.loading
                            ? "rgb(var(--accent-rgb) / 0.2)"
                            : "rgb(var(--accent-rgb) / 0.15)",
                          border: "1px solid rgb(var(--accent-rgb) / 0.35)",
                          borderRadius: "6px",
                          color: "var(--color-accent-light)",
                          fontSize: "12px",
                          fontWeight: 600,
                          cursor:
                            state.loading || !state.inputText.trim() ? "not-allowed" : "pointer",
                          opacity: state.loading || !state.inputText.trim() ? 0.6 : 1,
                          transition: "all 150ms",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {state.loading ? "Checking…" : "Submit"}
                      </button>
                    </div>
                  )}
                  {accepted && (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "rgba(34,197,94,0.08)",
                        border: "1px solid rgba(34,197,94,0.2)",
                        borderRadius: "6px",
                        color: "#4ade80",
                        fontSize: "13px",
                      }}
                    >
                      {state.inputText}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
