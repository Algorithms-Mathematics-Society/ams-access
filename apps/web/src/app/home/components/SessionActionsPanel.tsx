"use client";

import { getThemeColors } from "./utils";
import type { ActiveSession, ResumeVerificationState } from "./types";

export function SessionActionsPanel({
  activeSession,
  inviteCode,
  inviteCodeBusy,
  inviteCodeStatus,
  inviteSuccessMsg,
  onInviteCodeChange,
  onInviteCodeSubmit,
  onRefresh,
  onResume,
  resumeBusy,
  resumeStatus,
  resumeVerification,
  sessionsError,
  sessionsRefreshing,
  theme,
}: {
  activeSession: ActiveSession | null;
  inviteCode: string;
  inviteCodeBusy: boolean;
  inviteCodeStatus: string | null;
  inviteSuccessMsg: string | null;
  onInviteCodeChange: (value: string) => void;
  onInviteCodeSubmit: () => void;
  onRefresh: () => void;
  onResume: () => void;
  resumeBusy: boolean;
  resumeStatus: string | null;
  resumeVerification: ResumeVerificationState;
  sessionsError: string | null;
  sessionsRefreshing: boolean;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  const inputBg = "rgba(255,255,255,0.02)";
  const subtleButtonBg = theme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)";
  const subtleButtonHoverBg = theme === "light" ? "rgba(0,0,0,0.055)" : "rgba(255,255,255,0.075)";
  const resumeVerified = resumeVerification === "verified";
  const resumeChecking = resumeVerification === "checking" || resumeVerification === "unverified";
  const resumeAvailable = Boolean(activeSession && resumeVerified);
  const resumeButtonDisabled = resumeBusy || !resumeAvailable;
  const resumeButtonLabel =
    resumeBusy || resumeChecking ? "Validating..." : "Resume Active Session";
  const disabledButtonBg = theme === "light" ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.055)";
  const disabledButtonBorder = theme === "light" ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.1)";
  const disabledButtonText = theme === "light" ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.38)";

  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "6px",
        padding: "20px",
        display: "grid",
        gridTemplateColumns: "1.25fr 0.75fr",
        gap: "18px",
        alignItems: "stretch",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <label
            htmlFor="session-code"
            style={{
              display: "block",
              fontSize: "11px",
              color: c.textMuted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "6px",
              fontWeight: 600,
            }}
          >
            Session Code
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inviteCodeBusy) onInviteCodeSubmit();
            }}
            style={{ display: "flex", gap: "10px" }}
          >
            <input
              id="session-code"
              value={inviteCode}
              onChange={(e) => onInviteCodeChange(e.target.value)}
              disabled={inviteCodeBusy}
              placeholder="Enter invite code"
              style={{
                flex: 1,
                minWidth: 0,
                height: "38px",
                borderRadius: "6px",
                border: `1px solid ${c.border}`,
                background: inputBg,
                color: c.text,
                padding: "0 16px",
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "13px",
                fontWeight: 600,
                outline: "2px solid transparent",
                cursor: inviteCodeBusy ? "not-allowed" : "text",
                opacity: inviteCodeBusy ? 0.75 : 1,
              }}
            />
            <button
              type="submit"
              disabled={inviteCodeBusy}
              style={{
                minWidth: "96px",
                height: "38px",
                borderRadius: "6px",
                border: `1px solid ${inviteCodeBusy ? disabledButtonBorder : c.accentBorder}`,
                background: inviteCodeBusy ? disabledButtonBg : "rgba(168,85,247,0.06)",
                color: inviteCodeBusy ? disabledButtonText : c.accentText,
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: inviteCodeBusy ? "not-allowed" : "pointer",
                transition:
                  "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
              }}
              onMouseEnter={(e) => {
                if (inviteCodeBusy) return;
                e.currentTarget.style.background = "rgba(168,85,247,0.12)";
                e.currentTarget.style.borderColor = c.accentText;
              }}
              onMouseLeave={(e) => {
                if (inviteCodeBusy) return;
                e.currentTarget.style.background = "rgba(168,85,247,0.06)";
                e.currentTarget.style.borderColor = c.accentBorder;
              }}
            >
              {inviteCodeBusy ? "Checking..." : "Validate"}
            </button>
          </form>
          {inviteSuccessMsg && (
            <p
              style={{
                marginTop: "8px",
                color: "#22c55e",
                fontSize: "13px",
                lineHeight: 1.45,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 7l3 3 5-5"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {inviteSuccessMsg}
            </p>
          )}
          {inviteCodeStatus && (
            <p
              style={{
                marginTop: "8px",
                color: "#ef4444",
                fontSize: "13px",
                lineHeight: 1.45,
                fontWeight: 500,
              }}
            >
              {inviteCodeStatus}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={onRefresh}
            disabled={sessionsRefreshing}
            style={{
              height: "38px",
              borderRadius: "6px",
              border: `1px solid ${c.border}`,
              background: subtleButtonBg,
              color: c.textMutedStrong,
              padding: "0 16px",
              fontSize: "13px",
              cursor: sessionsRefreshing ? "not-allowed" : "pointer",
              opacity: sessionsRefreshing ? 0.72 : 1,
              fontWeight: 500,
              fontFamily: "inherit",
              transition:
                "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (sessionsRefreshing) return;
              e.currentTarget.style.background = subtleButtonHoverBg;
              e.currentTarget.style.borderColor = c.borderStrong;
              e.currentTarget.style.color = c.text;
            }}
            onMouseLeave={(e) => {
              if (sessionsRefreshing) return;
              e.currentTarget.style.background = subtleButtonBg;
              e.currentTarget.style.borderColor = c.border;
              e.currentTarget.style.color = c.textMutedStrong;
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={(e) => {
              if (!sessionsRefreshing) e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {sessionsRefreshing ? "Refreshing..." : "Refresh Sessions"}
          </button>
          {sessionsError && (
            <span style={{ alignSelf: "center", color: "#ef4444", fontSize: "12px" }}>
              {sessionsError}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          borderLeft: `1px solid ${c.border}`,
          paddingLeft: "18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "11px",
              color: c.textMuted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "6px",
              fontWeight: 600,
            }}
          >
            Resume
          </p>
          <p style={{ color: c.textMutedStrong, fontSize: "13px", lineHeight: 1.45 }}>
            {activeSession ? (
              <span
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontWeight: 600,
                  color: c.text,
                }}
              >
                {activeSession.contest_title ?? `CONTEST_${activeSession.contest_id.toUpperCase()}`}
              </span>
            ) : (
              "No active session stored on this device."
            )}
          </p>
        </div>
        <button
          onClick={onResume}
          disabled={resumeButtonDisabled}
          style={{
            height: "38px",
            borderRadius: "6px",
            border: resumeAvailable ? "1px solid " + c.accent : `1px solid ${disabledButtonBorder}`,
            background: resumeAvailable ? "#a855f7" : disabledButtonBg,
            color: resumeAvailable ? "#ffffff" : disabledButtonText,
            fontSize: "13px",
            fontWeight: 600,
            cursor: resumeButtonDisabled ? "not-allowed" : "pointer",
            transition:
              "background 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 120ms ease",
          }}
          onMouseEnter={(e) => {
            if (resumeButtonDisabled) return;
            e.currentTarget.style.background = "#9333ea";
            e.currentTarget.style.borderColor = "#c084fc";
            e.currentTarget.style.boxShadow = "0 10px 24px rgba(168,85,247,0.22)";
          }}
          onMouseLeave={(e) => {
            if (resumeButtonDisabled) return;
            e.currentTarget.style.background = "#a855f7";
            e.currentTarget.style.borderColor = c.accentBorder;
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "scale(1)";
          }}
          onMouseDown={(e) => {
            if (!resumeButtonDisabled) e.currentTarget.style.transform = "scale(0.98)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          {resumeButtonLabel}
        </button>
        {resumeStatus && (
          <p style={{ color: "#ef4444", fontSize: "13px", lineHeight: 1.4, fontWeight: 500 }}>
            {resumeStatus}
          </p>
        )}
      </div>
    </div>
  );
}
