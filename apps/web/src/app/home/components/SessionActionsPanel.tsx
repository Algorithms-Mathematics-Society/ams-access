"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, Play, RefreshCw, X } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, Field, InlineAlert } from "./ui-primitives";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import type { ActiveSession, ResumeVerificationState } from "./types";

export function SessionActionsPanel({
  activeSession,
  inviteCode,
  inviteCodeBusy,
  inviteCodeStatus,
  inviteSuccessMsg,
  onDismissInviteSuccess,
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
  onDismissInviteSuccess?: () => void;
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
  const [helpOpen, setHelpOpen] = useState(false);
  const resumeFailed =
    !!resumeStatus && /rejected|expired|failed|not found|mismatch|could not/i.test(resumeStatus);
  const resumeVerified = resumeVerification === "verified";
  const resumeChecking = resumeVerification === "checking" || resumeVerification === "unverified";
  const resumeRequestPending =
    String(activeSession?.resume_request_status ?? "").toUpperCase() === "PENDING";
  const resumeAvailable = Boolean(activeSession && resumeVerified);
  const resumeButtonDisabled = resumeBusy || resumeRequestPending || !resumeAvailable;
  const resumeButtonLabel = resumeRequestPending
    ? "Awaiting Approval"
    : resumeBusy || resumeChecking
      ? "Validating..."
      : "Resume Active Session";

  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
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
            <Field
              id="session-code"
              theme={theme}
              value={inviteCode}
              onChange={(e) => onInviteCodeChange(e.target.value)}
              disabled={inviteCodeBusy}
              placeholder="Enter invite code"
              style={{
                flex: 1,
                minWidth: 0,
                cursor: inviteCodeBusy ? "not-allowed" : "text",
                opacity: inviteCodeBusy ? 0.75 : 1,
              }}
            />
            <Button
              type="submit"
              disabled={inviteCodeBusy}
              theme={theme}
              variant="secondary"
              style={{ minWidth: "96px" }}
              onMouseEnter={(e) => {
                if (inviteCodeBusy) return;
                e.currentTarget.style.background = "rgb(var(--accent-rgb) / 0.12)";
                e.currentTarget.style.borderColor = c.accentText;
              }}
              onMouseLeave={(e) => {
                if (inviteCodeBusy) return;
                e.currentTarget.style.background = "rgb(var(--accent-rgb) / 0.06)";
                e.currentTarget.style.borderColor = c.accentBorder;
              }}
            >
              {inviteCodeBusy && (
                <Loader2
                  size={14}
                  strokeWidth={2}
                  style={{ animation: "spin 1s linear infinite" }}
                />
              )}
              {inviteCodeBusy ? "Checking" : "Validate"}
            </Button>
          </form>
          {/* Compound invite result — when success + warning coexist, show as single amber message */}
          {inviteSuccessMsg && inviteCodeStatus ? (
            <p
              role="status"
              style={{
                marginTop: "8px",
                color: "#fcd34d",
                fontSize: "13px",
                lineHeight: 1.5,
                fontWeight: 500,
                display: "flex",
                alignItems: "flex-start",
                gap: "6px",
              }}
            >
              <AlertTriangle
                size={14}
                strokeWidth={2}
                style={{ flexShrink: 0, marginTop: "2px" }}
              />
              <span>
                {inviteSuccessMsg} {inviteCodeStatus}
              </span>
              {onDismissInviteSuccess && (
                <button
                  type="button"
                  onClick={onDismissInviteSuccess}
                  aria-label="Dismiss"
                  style={{
                    marginLeft: "auto",
                    background: "none",
                    border: "none",
                    color: "rgba(252,211,77,0.6)",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: 1,
                    padding: "0 2px",
                    fontFamily: "inherit",
                    flexShrink: 0,
                  }}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </p>
          ) : inviteSuccessMsg ? (
            <p
              role="status"
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
              <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
              {inviteSuccessMsg}
              {onDismissInviteSuccess && (
                <button
                  type="button"
                  onClick={onDismissInviteSuccess}
                  aria-label="Dismiss"
                  style={{
                    marginLeft: "4px",
                    background: "none",
                    border: "none",
                    color: "rgba(34,197,94,0.5)",
                    cursor: "pointer",
                    fontSize: "14px",
                    lineHeight: 1,
                    padding: "0 2px",
                    fontFamily: "inherit",
                  }}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </p>
          ) : inviteCodeStatus ? (
            <InlineAlert theme={theme} tone="danger" style={{ marginTop: "8px" }}>
              {inviteCodeStatus}
            </InlineAlert>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Button
            onClick={onRefresh}
            disabled={sessionsRefreshing}
            theme={theme}
            variant="secondary"
            onMouseDown={(e) => {
              if (!sessionsRefreshing) e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <RefreshCw
              size={14}
              strokeWidth={2}
              style={{ animation: sessionsRefreshing ? "spin 1s linear infinite" : "none" }}
            />
            {sessionsRefreshing ? "Refreshing" : "Refresh Sessions"}
          </Button>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <p
            style={{
              fontSize: "11px",
              color: c.textMuted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Resume
          </p>
          {activeSession ? (
            <>
              <p
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontWeight: 600,
                  fontSize: "13px",
                  color: c.text,
                  lineHeight: 1.3,
                }}
              >
                {activeSession.contest_title ?? `Session ${activeSession.contest_id.slice(0, 8)}`}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: "11px",
                    padding: "2px 7px",
                    borderRadius: "4px",
                    fontWeight: 600,
                    background: resumeRequestPending
                      ? "rgba(245,158,11,0.12)"
                      : resumeVerification === "verified"
                        ? "rgba(34,197,94,0.12)"
                        : resumeVerification === "checking" || resumeVerification === "unverified"
                          ? "rgb(var(--accent-rgb) / 0.1)"
                          : "rgba(239,68,68,0.1)",
                    color: resumeRequestPending
                      ? "#fbbf24"
                      : resumeVerification === "verified"
                        ? "#4ade80"
                        : resumeVerification === "checking" || resumeVerification === "unverified"
                          ? c.accentText
                          : "#fca5a5",
                  }}
                >
                  {resumeRequestPending
                    ? "Approval pending"
                    : resumeVerification === "verified"
                      ? "Verified"
                      : resumeVerification === "checking" || resumeVerification === "unverified"
                        ? "Checking..."
                        : "Unverified"}
                </span>
                {activeSession.updated_at && resumeVerification === "verified" && (
                  <span style={{ fontSize: "11px", color: c.textMuted }}>
                    {new Date(activeSession.updated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p style={{ color: c.textMuted, fontSize: "13px", lineHeight: 1.45 }}>
              No active session stored on this device.
            </p>
          )}
        </div>
        <Button
          onClick={onResume}
          disabled={resumeButtonDisabled}
          theme={theme}
          variant={resumeAvailable ? "primary" : "secondary"}
          title={
            !activeSession
              ? "No active session to resume"
              : resumeVerification === "invalid"
                ? "Session could not be verified"
                : undefined
          }
          onMouseEnter={(e) => {
            if (resumeButtonDisabled) return;
            e.currentTarget.style.background = "#9333ea";
            e.currentTarget.style.borderColor = "var(--color-accent-light)";
            e.currentTarget.style.boxShadow = "0 10px 24px rgb(var(--accent-rgb) / 0.22)";
          }}
          onMouseLeave={(e) => {
            if (resumeButtonDisabled) return;
            e.currentTarget.style.background = "var(--color-accent-base)";
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
          {resumeBusy || resumeChecking ? (
            <Loader2 size={14} strokeWidth={2} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Play size={14} strokeWidth={2} />
          )}
          {resumeButtonLabel}
        </Button>
        {resumeStatus && (
          <InlineAlert
            theme={theme}
            tone={
              /verified/i.test(resumeStatus) &&
              !/failed|not found|expired|mismatch|could not/i.test(resumeStatus)
                ? "success"
                : /validat/i.test(resumeStatus)
                  ? "accent"
                  : "danger"
            }
          >
            {resumeStatus}
          </InlineAlert>
        )}
        {resumeFailed && (
          <Button theme={theme} variant="secondary" onClick={() => setHelpOpen(true)}>
            Get help rejoining
          </Button>
        )}
      </div>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="DISCONNECT"
        sessionId={activeSession?.id ?? null}
        contestId={activeSession?.contest_id ?? null}
        summary="I was disconnected and can't rejoin my contest session."
        details={{ source: "resume_flow", resume_status: resumeStatus }}
      />
    </div>
  );
}
