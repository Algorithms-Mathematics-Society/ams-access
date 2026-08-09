import { type Dispatch, type SetStateAction, type MouseEvent as ReactMouseEvent } from "react";
import { type ProblemSectionKey } from "./markdown";
import { type Question } from "./questions";
import { MarkingScheme } from "./MarkingScheme";

export interface ProblemPaneProps {
  problemPaneWidth: number;
  availableProblemTabs: ProblemSectionKey[];
  activeProblemTab: ProblemSectionKey;
  setProblemTab: Dispatch<SetStateAction<ProblemSectionKey>>;
  questions: Question[];
  activeQ: number;
  problemBodyHtml: string;
  handleProblemBodyClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function ProblemPane({
  problemPaneWidth,
  availableProblemTabs,
  activeProblemTab,
  setProblemTab,
  questions,
  activeQ,
  problemBodyHtml,
  handleProblemBodyClick,
}: ProblemPaneProps) {
  return (
    <div
      style={{
        width: `${problemPaneWidth}%`,
        minWidth: "320px",
        maxWidth: "680px",
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid rgba(255, 255, 255, 0.05)",
        background: "#0F0F0F",
        boxShadow: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #1F1F1F",
          background: "#0F0F0F",
          padding: "0 18px",
          flexShrink: 0,
          height: "44px",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-dim)",
            letterSpacing: "0.06em",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
          }}
        >
          Problem
        </span>
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-dim)",
            fontFamily: "Inter, system-ui, sans-serif",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(problemPaneWidth)}%
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {availableProblemTabs.length > 1 && (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              height: "44px",
              padding: "0 18px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              background: "rgba(15,15,15,0.96)",
              backdropFilter: "blur(12px)",
            }}
          >
            {availableProblemTabs.map((tab) => {
              const active = activeProblemTab === tab;
              const label =
                tab === "statement" ? "Statement" : tab === "examples" ? "Examples" : "Constraints";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setProblemTab(tab)}
                  style={{
                    height: "100%",
                    padding: "0 14px",
                    borderRadius: 0,
                    border: "none",
                    borderBottom: `2px solid ${active ? "var(--color-accent-base)" : "transparent"}`,
                    background: "transparent",
                    color: active ? "var(--color-accent-light)" : "var(--text-dim)",
                    fontSize: "13px",
                    fontWeight: 600,
                    fontFamily: "Inter, system-ui, sans-serif",
                    cursor: "pointer",
                    transition: "color var(--transition-fast), border-color var(--transition-fast)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
        {/* Bottom padding reserves the fixed camera tile's footprint so statement
            text never scrolls under it (esp. with the rail collapsed). */}
        <article style={{ padding: "28px 28px 178px", maxWidth: "760px" }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "12px",
              color: "var(--color-accent-base)",
              fontWeight: 700,
              fontFamily: "Inter, system-ui, sans-serif",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Problem {String.fromCharCode(65 + (questions[activeQ]?.order_index ?? activeQ))}
          </p>
          <h1
            style={{
              margin: "0 0 22px",
              color: "#f8fafc",
              fontSize: "var(--text-xl)",
              lineHeight: 1.3,
              fontWeight: 700,
              fontFamily: "Inter, system-ui, sans-serif",
              letterSpacing: 0,
            }}
          >
            {questions[activeQ]?.title}
          </h1>
          <div
            className="pb-body pb-body-editorial"
            onClick={handleProblemBodyClick}
            dangerouslySetInnerHTML={{ __html: problemBodyHtml }}
          />
          {activeProblemTab === "statement" && questions[activeQ] && (
            <MarkingScheme question={questions[activeQ]} />
          )}
        </article>
      </div>
    </div>
  );
}
