import { useState, useMemo } from "react";
import MarkovEditor, { type MarkovChain, normalizeChain } from "@/components/MarkovEditor";
import { authHeaders } from "@/lib/candidate-auth";
import { parseDescription } from "./markdown";
import type { Question } from "./questions";

// ─── Markov Pane ────────────────────────────────────────────────
export function MarkovPane({
  question,
  sessionId,
  apiUrl,
  questionLetter,
}: {
  question: Question;
  sessionId: string;
  apiUrl: string;
  questionLetter: string;
}) {
  const [chain, setChain] = useState<MarkovChain>({ states: [], transitions: [] });
  const [verdict, setVerdict] = useState<{
    correct: boolean;
    feedback: string;
    points: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (chain.states.length === 0) {
      setError("Build a Markov chain before submitting.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/sessions/${sessionId}/markov-answer`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          question_id: question.id,
          submitted_json: JSON.stringify(normalizeChain(chain)),
        }),
      });
      if (!res.ok) throw new Error("Server error");
      const data = (await res.json()) as { correct: boolean; feedback: string; points: number };
      setVerdict(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  }

  const descHtml = useMemo(
    () => parseDescription(question.description ?? ""),
    [question.description]
  );

  return (
    <div style={{ flex: 1, display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: problem statement */}
      <div
        style={{
          width: "38%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          background: "#0F0F0F",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            padding: "0 16px",
            height: 38,
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid #1F1F1F",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#64748b",
              letterSpacing: "0.06em",
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 700,
            }}
          >
            Problem {questionLetter} · Markov chain
          </span>
        </div>
        <div
          style={{ padding: "20px 24px", fontSize: 14, color: "#cbd5e1", lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: descHtml }}
        />
      </div>

      {/* Right: editor + submit */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#080d1a",
          overflowY: "auto",
          padding: 20,
        }}
      >
        <div
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "#64748b",
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: "0.06em",
            }}
          >
            Build your Markov chain
          </span>
          {verdict && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 12px",
                borderRadius: 20,
                background: verdict.correct ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${verdict.correct ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                color: verdict.correct ? "#4ade80" : "#f87171",
              }}
            >
              {verdict.correct ? `✓ AC  +${verdict.points}pts` : `✗ ${verdict.feedback}`}
            </span>
          )}
        </div>

        <MarkovEditor value={chain} onChange={setChain} readOnly={verdict?.correct === true} />

        {error && <p style={{ fontSize: 12, color: "#f87171", marginTop: 8 }}>{error}</p>}

        {!verdict?.correct && (
          <button
            type="button"
            disabled={loading || chain.states.length === 0}
            onClick={handleSubmit}
            style={{
              marginTop: 14,
              alignSelf: "flex-start",
              padding: "8px 24px",
              borderRadius: 8,
              background: "rgb(var(--accent-rgb) / 0.15)",
              border: "1px solid rgb(var(--accent-rgb) / 0.45)",
              color: "var(--color-accent-light)",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              opacity: loading || chain.states.length === 0 ? 0.5 : 1,
            }}
          >
            {loading ? "Checking…" : "Submit Answer"}
          </button>
        )}

        {verdict?.correct && (
          <p style={{ marginTop: 12, fontSize: 12, color: "#4ade80" }}>
            ✓ Correct! Your Markov chain matches the expected answer.
          </p>
        )}
      </div>
    </div>
  );
}
