import { type Dispatch, type SetStateAction } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Question } from "./questions";

export interface QuestionStatus {
  label: string;
  shortLabel: string;
  color: string;
  bg: string;
  border: string;
}

export interface QuestionRailProps {
  questions: Question[];
  activeQ: number;
  switchQuestion: (idx: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  questionStatusMap: Record<string, QuestionStatus>;
  acceptedQuestionCount: number;
}

export function QuestionRail({
  questions,
  activeQ,
  switchQuestion,
  sidebarCollapsed,
  setSidebarCollapsed,
  questionStatusMap,
  acceptedQuestionCount,
}: QuestionRailProps) {
  return (
    <aside
      style={{
        width: sidebarCollapsed ? "52px" : "220px",
        flexShrink: 0,
        // Visible divider + subtle elevation so the collapsed strip reads as a container
        // (the badge no longer floats on the bare canvas now the camera left the rail).
        borderRight: "1px solid #1F1F1F",
        display: "flex",
        flexDirection: "column",
        background: sidebarCollapsed ? "#111111" : "#0F0F0F",
        boxShadow: "none",
        overflow: "hidden",
        transition: "width 250ms, background-color 250ms",
      }}
    >
      <div
        style={{
          padding: sidebarCollapsed ? "12px 0" : "12px 14px 10px",
          borderBottom: "1px solid #1F1F1F",
          display: "flex",
          alignItems: "center",
          justifyContent: sidebarCollapsed ? "center" : "space-between",
          gap: "8px",
        }}
      >
        {!sidebarCollapsed && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                fontSize: "10px",
                color: "#64748b",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 600,
                fontFamily: "Inter, system-ui, sans-serif",
                margin: 0,
              }}
            >
              Questions ({questions.length})
            </p>
            <p
              style={{
                margin: "3px 0 0",
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--color-accent-light)",
                fontFamily: "Inter, system-ui, sans-serif",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {acceptedQuestionCount} / {questions.length} Solved
            </p>
            {/* Segmented progress bar */}
            <div
              style={{
                display: "flex",
                gap: "2px",
                marginTop: "6px",
              }}
            >
              {questions.map((q) => {
                const qStatus = questionStatusMap[q.id];
                return (
                  <div
                    key={q.id}
                    style={{
                      flex: 1,
                      height: "3px",
                      borderRadius: "var(--radius-pill)",
                      // Binary: solved (accepted) = green, everything else = gray. The
                      // saved/attempted nuance stays on the row dots, not the summary bar.
                      background:
                        qStatus.label === "Accepted" ? "var(--verdict-ac)" : "var(--text-dim)",
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          style={{
            background: "transparent",
            border: "none",
            color: "#64748b",
            cursor: "pointer",
            padding: "2px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          title={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={14} strokeWidth={2} />
          ) : (
            <ChevronLeft size={14} strokeWidth={2} />
          )}
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          // Clear the docked camera tile at the rail bottom (expanded only; hidden collapsed).
          padding: sidebarCollapsed ? "8px" : "8px 8px 162px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {questions.length === 0 && !sidebarCollapsed && (
          <p
            style={{
              fontSize: "12px",
              color: "#475569",
              textAlign: "center",
              marginTop: "24px",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            No questions
          </p>
        )}
        {questions.map((q, i) => {
          const qStatus = questionStatusMap[q.id];
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => switchQuestion(i)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed ? "center" : "flex-start",
                width: "100%",
                padding: sidebarCollapsed ? "6px 0" : "10px 12px",
                borderRadius: "var(--radius-md)",
                // Collapsed: the badge itself is the single active pill — no outer box, so it
                // doesn't read as a pill-inside-a-pill. Expanded keeps the row highlight.
                border: `1px solid ${!sidebarCollapsed && activeQ === i ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                background:
                  !sidebarCollapsed && activeQ === i
                    ? "rgb(var(--accent-rgb) / 0.08)"
                    : "transparent",
                cursor: "pointer",
                fontFamily: "Inter, system-ui, sans-serif",
                textAlign: "left",
                color: activeQ === i ? "var(--color-accent-light)" : "var(--text-dim)",
                transition:
                  "background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
                position: "relative",
              }}
              title={`${q.title} · ${qStatus.label}`}
            >
              {sidebarCollapsed ? (
                <span
                  style={{
                    width: "34px",
                    height: "30px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "var(--radius-md)",
                    // Active = a single clean pill; others = plain status-coloured letter
                    // (solved green / unsolved gray), matching the collapsed mockup.
                    border: `1px solid ${activeQ === i ? "rgb(var(--accent-rgb) / 0.5)" : "transparent"}`,
                    background: activeQ === i ? "rgb(var(--accent-rgb) / 0.12)" : "transparent",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: activeQ === i ? "var(--color-accent-light)" : qStatus.color,
                  }}
                >
                  {String.fromCharCode(65 + i)}
                </span>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    width: "100%",
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: activeQ === i ? "var(--color-accent-light)" : "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  >
                    {String.fromCharCode(65 + i)}.
                  </span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 500,
                      color: activeQ === i ? "#ffffff" : "var(--text-soft)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {q.title}
                  </span>
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "var(--radius-pill)",
                      // Active-first: the viewed question reads purple even if solved;
                      // non-active falls back to its status colour (solved=green, etc.).
                      background: activeQ === i ? "var(--color-accent-base)" : qStatus.color,
                      flexShrink: 0,
                    }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
