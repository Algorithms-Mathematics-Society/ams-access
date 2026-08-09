"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Loader2, Play, RefreshCw, X } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, Field, InlineAlert } from "./ui-primitives";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import type { ActiveSession, ResumeVerificationState } from "./types";

export function SessionActionsPanel({
  activeSession,
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
        border: "1px solid var(--theme-border)",
        borderRadius: "var(--radius-md)",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* No session-code entry. Credentials are contest-scoped: signing in
          with a printed slip already tells the server which contest this is,
          so asking for a code as well added a thing to mistype under exam
          pressure and no security whatsoever. */}

      {/* ── Refresh affordance ────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <Button
          onClick={onRefresh}
          disabled={sessionsRefreshing}
          theme={theme}
          variant="secondary"
          size="small"
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
          <span
            style={{ alignSelf: "center", color: "var(--home-status-error)", fontSize: "12px" }}
          >
            {sessionsError}
          </span>
        )}
      </div>

      {/* ── Resume section (secondary) ────────────────────────────── */}
      <div
        style={{
          borderTop: "1px solid var(--theme-border)",
          paddingTop: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            color: "var(--theme-text-muted)",
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
                  borderRadius: "var(--radius-sm)",
                  fontWeight: 600,
                  background: resumeRequestPending
                    ? "var(--home-status-warn-bg-12)"
                    : resumeVerification === "verified"
                      ? "var(--home-status-ok-bg-12)"
                      : resumeVerification === "checking" || resumeVerification === "unverified"
                        ? "rgb(var(--accent-rgb) / 0.1)"
                        : "var(--home-status-error-bg-10)",
                  color: resumeRequestPending
                    ? "var(--home-status-warn)"
                    : resumeVerification === "verified"
                      ? "var(--home-status-ok)"
                      : resumeVerification === "checking" || resumeVerification === "unverified"
                        ? c.accentText
                        : "var(--theme-error-text)",
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
            e.currentTarget.style.background = "var(--color-accent-base)";
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
