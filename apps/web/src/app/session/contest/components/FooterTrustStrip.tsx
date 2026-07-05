import { type ReactElement } from "react";
import { ShieldCheck, Shield, Wifi, WifiOff, Save } from "lucide-react";
import { footerSaveView, type SaveIndicator } from "../save-indicator";
import { type Question } from "./questions";

export interface FooterTrustStripProps {
  proctoringOk: boolean;
  footerStatusDot: (color: string) => ReactElement;
  faceStatus: "ok" | "away" | "unknown";
  online: boolean;
  saveIndicator: SaveIndicator;
  activeQ: number;
  questions: Question[];
  attemptedQuestionCount: number;
  acceptedQuestionCount: number;
  remainingQuestionCount: number;
}

export function FooterTrustStrip({
  proctoringOk,
  footerStatusDot,
  faceStatus,
  online,
  saveIndicator,
  activeQ,
  questions,
  attemptedQuestionCount,
  acceptedQuestionCount,
  remainingQuestionCount,
}: FooterTrustStripProps) {
  return (
    <footer
      style={{
        display: "flex",
        alignItems: "center",
        gap: "18px",
        padding: "0 18px",
        height: "40px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: "#0F0F0F",
        flexShrink: 0,
      }}
    >
      {/* Status icons spread across the sidebar column: 202px = 220px rail − 18px
          footer padding, so the group's right edge aligns with the rail boundary */}
      <div
        style={{
          width: "202px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        {/* Secure session — icon only; status announced via content-based live region */}
        <div
          role="status"
          aria-live="polite"
          title={proctoringOk ? "Secure session" : "Action needed"}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            color: proctoringOk ? "#71717a" : "#ef4444",
          }}
        >
          {proctoringOk ? (
            <ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Shield size={15} strokeWidth={2} aria-hidden="true" />
          )}
          {footerStatusDot(proctoringOk ? "var(--verdict-ac)" : "#ef4444")}
          <span className="sr-only">{proctoringOk ? "Secure" : "Action needed"}</span>
        </div>

        {/* Face detection — icon only; the re-center nudge is conveyed in THREE modalities:
          a content-based live region (actionable guidance), a non-color shape cue (the alert
          dot appears only when the face drifts), and colour. faceStatus logic is untouched. */}
        <div
          role="status"
          aria-live="polite"
          title={
            faceStatus === "ok"
              ? "Face detected"
              : faceStatus === "away"
                ? "Face not centered — center your face in the camera"
                : "Camera starting"
          }
          style={{ position: "relative", display: "flex", alignItems: "center" }}
        >
          <svg width="15" height="15" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle
              cx="6"
              cy="4.5"
              r="2"
              stroke={
                faceStatus === "ok" ? "#71717a" : faceStatus === "away" ? "#f59e0b" : "#71717a"
              }
              strokeWidth="1.1"
            />
            <path
              d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
              stroke={
                faceStatus === "ok" ? "#71717a" : faceStatus === "away" ? "#f59e0b" : "#71717a"
              }
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            {/* Non-color cue (WCAG 1.4.1): a shape present ONLY on away — kept as the face's
              non-colour channel; the corner LED below is ADDITIVE colour reinforcement, not a
              replacement. Placed top-LEFT so it never sits under that LED (top-right). */}
            {faceStatus === "away" && <circle cx="2" cy="2" r="1.6" fill="#f59e0b" />}
          </svg>
          {footerStatusDot(
            faceStatus === "ok"
              ? "var(--verdict-ac)"
              : faceStatus === "away"
                ? "#ef4444"
                : "#e2e8f0"
          )}
          <span className="sr-only">
            {faceStatus === "ok"
              ? "Face detected"
              : faceStatus === "away"
                ? "Face not centered — center your face in the camera"
                : "Camera starting"}
          </span>
        </div>

        {/* Connection — icon only; status announced via content-based live region */}
        <div
          role="status"
          aria-live="polite"
          title={online ? "Connected" : "Reconnecting…"}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            color: online ? "#71717a" : "#f59e0b",
          }}
        >
          {online ? (
            <Wifi size={15} strokeWidth={2} aria-hidden="true" />
          ) : (
            <WifiOff size={15} strokeWidth={2} aria-hidden="true" />
          )}
          {footerStatusDot(online ? "var(--verdict-ac)" : "#ef4444")}
          <span className="sr-only">{online ? "Connected" : "Reconnecting…"}</span>
        </div>

        {/* Saved — icon only; mirrors the editor save indicator; content-based live region.
          State classification is driven off saveIndicator.icon (the same safety-tested
          deriveSaveIndicator discriminant the main indicator uses above), so this footer
          can never drift into showing "Saved" when the main indicator wouldn't. */}
        <div
          role="status"
          aria-live="polite"
          title={footerSaveView(saveIndicator.icon).label}
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            color: footerSaveView(saveIndicator.icon).color,
          }}
        >
          <Save size={15} strokeWidth={2} aria-hidden="true" />
          {footerStatusDot(footerSaveView(saveIndicator.icon).dotColor)}
          <span className="sr-only">{footerSaveView(saveIndicator.icon).label}</span>
        </div>

        {/* Keyboard intercept — icon only; static state exposed via role=img label */}
        <span
          title="Keyboard locked"
          style={{ position: "relative", display: "flex", alignItems: "center" }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 12 12"
            fill="none"
            role="img"
            aria-label="Keyboard locked"
          >
            <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="#71717a" strokeWidth="1.1" />
            <path
              d="M3 5.5h1M5 5.5h1M7 5.5h1M3 7.5h6"
              stroke="#71717a"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </svg>
          {footerStatusDot("var(--verdict-ac)")}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {/* Contest + question info */}
      <span
        style={{
          fontSize: "11px",
          color: "var(--text-dim)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        Q{activeQ + 1}/{questions.length} · {attemptedQuestionCount} attempted ·{" "}
        {acceptedQuestionCount} accepted · {remainingQuestionCount} remaining · Evaluation
      </span>

      <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

      {/* Access wordmark */}
      <span style={{ fontSize: "11px", color: "var(--text-dim)", letterSpacing: "0.08em" }}>
        Access
      </span>
    </footer>
  );
}
