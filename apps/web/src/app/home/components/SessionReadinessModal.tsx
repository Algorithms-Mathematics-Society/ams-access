"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/api-client";
import { invoke } from "@ams/api-client";
import { getThemeColors, toPreflightPolicyItem, calculateReadinessScore, API_URL } from "./utils";
import { deriveContestantReadiness } from "./readiness-context";
import { useFocusTrap } from "./hooks";
import { parseLogLine } from "./SecurityOperationsLog";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import type { ReadinessState, ReadinessStatus } from "./types";
import type { ReadinessReport } from "@ams/api-client";

// §1 — Telemetry-dot check row: label left, single 6px dot flush right. No status text.
function PreflightCheckItem({
  label,
  status,
  theme,
  variant = "required",
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  successLabel: string;
  failLabel: string;
  theme: "dark" | "light";
  variant?: "required" | "optional";
}) {
  const c = getThemeColors(theme);
  const failColor =
    variant === "optional" ? "var(--home-status-warn-dot)" : "var(--home-status-error-dot)";
  const dotColor =
    status === "ok" ? "var(--home-status-ok-dot)" : status === "fail" ? failColor : c.accent;
  const dotAriaLabel =
    status === "ok"
      ? "pass"
      : status === "fail"
        ? variant === "optional"
          ? "warning"
          : "fail"
        : "checking";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: "var(--text-dim)",
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      {/* Single 6px dot flush right — dot column stays perfectly aligned */}
      <div
        role="img"
        aria-label={dotAriaLabel}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          boxShadow: status !== "checking" ? `0 0 6px ${dotColor}` : "none",
          animation: status === "checking" ? "pulse-dot 1.5s ease-in-out infinite" : "none",
        }}
      />
    </div>
  );
}

interface SessionReadinessModalProps {
  contestId: string;
  sessionType: "new" | "resume";
  theme: "dark" | "light";
  onClose: () => void;
  onProceed?: () => Promise<void> | void;
  readiness: ReadinessState;
  readinessReport: ReadinessReport | null;
  onSettingsRedirect: () => void;
  onRescan: () => Promise<void>;
}

export function SessionReadinessModal({
  contestId,
  sessionType,
  theme,
  onClose,
  onProceed,
  readiness,
  readinessReport,
  onSettingsRedirect,
  onRescan,
}: SessionReadinessModalProps) {
  const router = useRouter();
  const c = getThemeColors(theme);
  const [isRescanning, setIsRescanning] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [entryWindow, setEntryWindow] = useState<{
    status: "checking" | "allowed" | "blocked";
    reason: string | null;
  }>({ status: "checking", reason: null });
  const [entryWindowRefreshIndex, setEntryWindowRefreshIndex] = useState(0);
  const activeReport = readinessReport?.contest_id === contestId ? readinessReport : null;
  const hasPendingChecks = Object.values(readiness).some((status) => status === "checking");
  const entryWindowChecking = entryWindow.status === "checking";
  const scanStatus: "scanning" | "done" =
    isRescanning || entryWindowChecking || (activeReport === null && hasPendingChecks)
      ? "scanning"
      : "done";

  useEffect(() => {
    let cancelled = false;
    setEntryWindow({ status: "checking", reason: null });
    fetchJson<{
      eligibility_status?: string;
      blocked_reason?: string;
      session_window_state?: string;
    }>(
      `${API_URL}/contests/${contestId}/session-window`,
      {},
      { dedupeKey: `contest-window:${contestId}`, retries: 2 }
    )
      .then((body) => {
        if (cancelled) return;
        const status = String(body.eligibility_status ?? "blocked").toLowerCase();
        const state = String(body.session_window_state ?? "").toUpperCase();
        const allowed = status === "allowed" || (sessionType === "resume" && state === "LIVE");
        setEntryWindow({
          status: allowed ? "allowed" : "blocked",
          reason: allowed ? null : body.blocked_reason || "Contest entry window is not open.",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setEntryWindow({
            status: "blocked",
            reason: "Unable to validate contest entry window.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contestId, entryWindowRefreshIndex, sessionType]);

  const score = calculateReadinessScore(readiness);
  const requiredReportChecks = activeReport?.required_checks ?? [];
  const context = useMemo(
    () =>
      deriveContestantReadiness({
        readiness,
        report: activeReport,
        entryWindowStatus:
          entryWindow.status === "checking"
            ? "checking"
            : entryWindow.status === "allowed"
              ? "allowed"
              : "blocked",
        entryWindowReason: entryWindow.reason,
      }),
    [readiness, activeReport, entryWindow.status, entryWindow.reason]
  );

  const modalTitle =
    context.status === "checking"
      ? "Checking your device"
      : context.status === "ready"
        ? sessionType === "resume"
          ? "Ready to resume"
          : "Ready to enter"
        : context.status === "needs_action"
          ? `Fix ${context.failedRequired === 1 ? "1 required check" : `${context.failedRequired} required checks`}`
          : context.status === "advisory_warning"
            ? "Device ready — review advisory warnings"
            : "Contest window not open";

  const decisionTone =
    context.status === "ready" || context.status === "advisory_warning"
      ? { color: c.dot, bg: "var(--home-status-ok-bg)", border: "var(--home-status-ok-border-24)" }
      : context.status === "needs_action"
        ? {
            color: "var(--home-status-warn)",
            bg: "var(--home-status-warn-bg-09)",
            border: "var(--home-status-warn-border-28)",
          }
        : context.status === "blocked_by_policy"
          ? {
              color: "var(--theme-error-text)",
              bg: "var(--home-status-error-bg)",
              border: "var(--home-status-error-border-26)",
            }
          : { color: c.accentText, bg: c.accentLight, border: c.accentBorder };

  const requiredPolicyChecks = requiredReportChecks;
  const requiredChecksPassed =
    !!activeReport &&
    requiredPolicyChecks.every((check) => check.outcome === "pass" && !check.blocking);
  const policyAllowsProceed =
    !!activeReport && activeReport.decision !== "blocked" && requiredChecksPassed;
  const entryWindowAllowed = entryWindow.status === "allowed";
  const canProceed = scanStatus === "done" && entryWindowAllowed && policyAllowsProceed;
  const primaryActionLabel = canProceed
    ? sessionType === "resume"
      ? "Resume contest"
      : "Enter contest"
    : scanStatus === "scanning"
      ? "Checking..."
      : context.status === "needs_action" || context.status === "advisory_warning"
        ? "Open settings"
        : "Back to contests";
  const requiredPreflightItems = activeReport
    ? activeReport.required_checks.map((check) => toPreflightPolicyItem(check, "required"))
    : [
        {
          key: "required-policy-pending",
          label: "Required checks",
          status: "checking" as ReadinessStatus,
          successLabel: "Policy ready",
          failLabel: "Policy pending",
        },
      ];
  const optionalPreflightItems = activeReport
    ? activeReport.optional_checks.map((check) => toPreflightPolicyItem(check, "optional"))
    : [];
  const optionalWarningCount = activeReport
    ? activeReport.optional_checks.filter((check) => check.outcome !== "pass").length
    : 0;

  // macOS accessibility-denied gate: keyboard_lockdown is failing because the
  // user hasn't granted Accessibility permission. The detail string emitted by
  // core-rs contains "accessibility_denied" — that substring is macOS-specific
  // so no explicit platform check is required.
  const showAccessibilityRecovery = useMemo(() => {
    if (!activeReport) return false;
    const kbCheck = activeReport.required_checks.find(
      (check) => check.kind === "keyboard_lockdown"
    );
    return (
      !!kbCheck &&
      kbCheck.outcome !== "pass" &&
      typeof kbCheck.detail === "string" &&
      kbCheck.detail.includes("accessibility_denied")
    );
  }, [activeReport]);

  const consoleLogs = useMemo(() => {
    if (scanStatus === "scanning") {
      return [
        entryWindowChecking
          ? "Validating the contest entry window..."
          : "Waiting for the readiness report...",
        "Checking your device from local device checks.",
      ];
    }

    if (entryWindow.status === "blocked") {
      return [
        `Contest window not open: ${entryWindow.reason ?? "unavailable"}`,
        "Entry decision: blocked",
      ];
    }

    if (!activeReport) {
      return ["Readiness report unavailable.", "Entry decision: blocked"];
    }

    const checkLog = (kind: string, prefix: string, label: string) => {
      const check = activeReport.checks.find((item) => item.kind === kind);
      if (!check) return `[${prefix}] ${label}: unavailable`;
      const outcome = check.outcome === "pass" ? "PASS" : "FAIL";
      const detail = check.detail ? ` - ${check.detail}` : "";
      return `[${prefix}] ${label}: ${outcome}${detail}`;
    };

    return [
      `Readiness report received at ${new Date(activeReport.generated_at_ms).toLocaleTimeString()}`,
      checkLog("network", "NET", "Network connectivity"),
      checkLog("microphone", "AUD", "Microphone"),
      checkLog("camera", "CAM", "Camera"),
      checkLog("virtualization", "SEC", "Virtual machine check"),
      checkLog("keyboard_lockdown", "SEC", "Keyboard lockdown"),
      checkLog("restricted_apps", "SEC", "Restricted app check"),
      checkLog("platform", "SEC", "Platform compatibility"),
      `Entry decision: ${activeReport.decision.toUpperCase()}`,
    ].filter((log): log is string => Boolean(log));
  }, [activeReport, entryWindow.reason, entryWindow.status, entryWindowChecking, scanStatus]);

  async function handleRescan() {
    setIsRescanning(true);
    setEntryWindowRefreshIndex((value) => value + 1);
    await onRescan();
    setIsRescanning(false);
  }

  // SECURITY: every contest entry — new OR resume — must route through
  // onboarding, which is the only path that runs verification and engages the
  // desktop lockdown (lock_desktop via startSecureSession). Sending a resume
  // straight to /session/contest skips the lock and lets a candidate sit in a
  // live contest with the machine wide open. Onboarding reuses the existing
  // IN_PROGRESS session (backend CreateSession reuses it), so re-entering does
  // not create duplicate sessions.
  const proceedHref = `/session/onboarding?contestId=${contestId}`;

  useEffect(() => {
    router.prefetch(proceedHref);
  }, [proceedHref, router]);

  const currentProgress = scanStatus === "scanning" ? 0 : score;
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  // §4 — Technical details: smooth height+opacity reveal
  const techDetailsContentRef = useRef<HTMLDivElement>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-readiness-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        animation: "fadeIn var(--transition-standard) forwards",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: "680px",
          minHeight: "540px",
          maxHeight: "calc(100vh - 48px)",
          background: "var(--theme-card-bg)",
          border: `1px solid ${c.borderStrong}`,
          borderRadius: "var(--radius-lg)",
          padding: "36px",
          boxShadow: "var(--elevation-3)",
          position: "relative",
          overflowX: "hidden",
          overflowY: "auto",
          alignSelf: "center",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {/* Ambient spotlight */}
        <div
          style={{
            position: "absolute",
            top: "-40%",
            left: "-20%",
            width: "300px",
            height: "300px",
            background: `radial-gradient(circle, ${score === 100 ? "var(--home-status-ok-emerald-bg)" : "var(--home-status-warn-bg)"} 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* §2 — Header: flat, no border/bg box */}
        <section
          style={{
            position: "relative",
            padding: "20px 22px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "18px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                color: decisionTone.color,
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                margin: "0 0 8px",
              }}
            >
              Device readiness
            </p>
            <h3
              id="session-readiness-title"
              style={{
                color: c.text,
                fontSize: "24px",
                fontWeight: 750,
                letterSpacing: 0,
                lineHeight: 1.2,
                margin: "0 0 8px",
              }}
            >
              {modalTitle}
            </h3>
            <p style={{ color: c.textMutedStrong, fontSize: "13px", lineHeight: 1.55, margin: 0 }}>
              {context.message}
            </p>
          </div>
          {/* §2 — "100% complete": raw percentage, no border/bg box */}
          <div
            style={{
              flexShrink: 0,
              minWidth: "86px",
              textAlign: "right",
            }}
          >
            <div style={{ color: "var(--home-status-ok)", fontSize: "24px", fontWeight: 800 }}>
              {Math.round(currentProgress)}%
            </div>
            <div
              style={{ color: c.textMuted, fontSize: "11px", fontWeight: 600, marginTop: "2px" }}
            >
              complete
            </div>
          </div>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.74fr)",
            gap: "18px",
            alignItems: "start",
          }}
        >
          <section
            style={{
              border: `1px solid ${c.border}`,
              background: "var(--theme-inner-bg)",
              borderRadius: "var(--radius-md)",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "8px",
              }}
            >
              <h4 style={{ color: c.text, fontSize: "13px", fontWeight: 750, margin: 0 }}>
                Required checks
              </h4>
              {/* §2 — sub-header: plain muted text, no pill */}
              <span
                style={{
                  color: "var(--text-dim)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {context.failedRequired > 0 ? `${context.failedRequired} to fix` : "Passing"}
              </span>
            </div>
            <p
              style={{ color: c.textMuted, fontSize: "11px", lineHeight: 1.5, margin: "0 0 10px" }}
            >
              These checks must pass before this device can enter the contest.
            </p>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {requiredPreflightItems.map((item) => (
                <PreflightCheckItem
                  key={item.key}
                  label={item.label}
                  status={item.status}
                  successLabel={item.successLabel}
                  failLabel={item.failLabel}
                  theme={theme}
                  variant="required"
                />
              ))}
            </div>
          </section>

          <section
            style={{
              border: `1px solid ${optionalWarningCount > 0 ? "var(--home-status-warn-border-24)" : c.border}`,
              background:
                optionalWarningCount > 0
                  ? "var(--home-status-warn-bg-055)"
                  : "var(--theme-inner-bg)",
              borderRadius: "var(--radius-md)",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                marginBottom: "8px",
              }}
            >
              <h4 style={{ color: c.text, fontSize: "13px", fontWeight: 750, margin: 0 }}>
                Optional warnings
              </h4>
              {/* §2 — sub-header: plain muted text, no pill */}
              <span
                style={{
                  color: "var(--text-dim)",
                  fontSize: "11px",
                  fontWeight: 600,
                }}
              >
                {optionalWarningCount > 0 ? `${optionalWarningCount} advisory` : "Advisory only"}
              </span>
            </div>
            <p
              style={{ color: c.textMuted, fontSize: "11px", lineHeight: 1.5, margin: "0 0 10px" }}
            >
              These do not block entry, but they may help support diagnose issues.
            </p>
            {optionalPreflightItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {optionalPreflightItems.map((item) => (
                  <PreflightCheckItem
                    key={item.key}
                    label={item.label}
                    status={item.status}
                    successLabel={item.successLabel}
                    failLabel={item.failLabel}
                    theme={theme}
                    variant="optional"
                  />
                ))}
              </div>
            ) : (
              <p style={{ color: c.textMutedStrong, fontSize: "12px", margin: "6px 0 0" }}>
                No optional warnings reported.
              </p>
            )}
          </section>
        </div>

        {/* macOS accessibility-denied recovery panel — logic untouched */}
        {showAccessibilityRecovery && (
          <section
            style={{
              border: "1px solid var(--home-status-error-border-36)",
              background: "var(--home-status-error-bg-07)",
              borderRadius: "var(--radius-md)",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: "50%",
                  background: "var(--home-status-error-dot)",
                  flexShrink: 0,
                  boxShadow: "0 0 6px var(--home-status-error-dot)",
                }}
              />
              <h4
                style={{
                  color: "var(--theme-error-text)",
                  fontSize: "13px",
                  fontWeight: 750,
                  margin: 0,
                  letterSpacing: "0.01em",
                }}
              >
                Grant Accessibility permission
              </h4>
            </div>
            <p
              style={{
                color: c.textMutedStrong,
                fontSize: "12px",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              AMS Access needs macOS Accessibility permission to lock the keyboard — open Settings,
              enable AMS Access under Privacy &amp; Security → Accessibility, then re-run the
              checks.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "2px" }}>
              <button
                onClick={() => void invoke("open_accessibility_settings")}
                style={{
                  height: "36px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--home-status-error-border-50)",
                  background: "var(--home-status-error-bg-14)",
                  color: "var(--theme-error-text)",
                  padding: "0 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                Open Accessibility Settings
              </button>
              <button
                onClick={handleRescan}
                disabled={isRescanning}
                style={{
                  height: "36px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${c.border}`,
                  background: "transparent",
                  color: c.textMutedStrong,
                  padding: "0 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: isRescanning ? "not-allowed" : "pointer",
                  opacity: isRescanning ? 0.62 : 1,
                }}
              >
                Run checks again
              </button>
            </div>
          </section>
        )}

        {/* §4 — Technical details: smooth height+opacity CSS transition */}
        <div
          style={{
            border: `1px solid ${c.border}`,
            background: "var(--theme-inner-bg)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            aria-expanded={showTechnicalDetails}
            onClick={() => setShowTechnicalDetails((v) => !v)}
            style={{
              width: "100%",
              cursor: "pointer",
              padding: "12px 14px",
              color: c.textMutedStrong,
              fontSize: "12px",
              fontWeight: 600,
              background: "transparent",
              border: "none",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <span>Technical details</span>
            <span style={{ color: c.textMuted, fontSize: "11px" }}>
              {showTechnicalDetails ? "Hide" : "Show"}
            </span>
          </button>
          <div
            ref={techDetailsContentRef}
            style={{
              maxHeight: showTechnicalDetails ? "340px" : "0px",
              opacity: showTechnicalDetails ? 1 : 0,
              overflow: "hidden",
              transition: "max-height 0.28s ease, opacity 0.22s ease",
            }}
          >
            <div
              style={{
                borderTop: `1px solid ${c.border}`,
                padding: "12px 14px",
                maxHeight: "300px",
                overflowY: "auto",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "11px",
                color: "var(--text-dim)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {consoleLogs.map((log, index) => (
                <div key={index} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {parseLogLine(log, c.dot)}
                </div>
              ))}
              {scanStatus === "scanning" && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>Checking your device</span>
                  <span
                    className="terminal-caret"
                    style={{
                      display: "inline-block",
                      width: "6px",
                      height: "12px",
                      background: "currentColor",
                      animation: "pulse-dot 1s ease infinite",
                    }}
                  >
                    ▎
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* §3 — Button bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "10px",
            paddingTop: "4px",
          }}
        >
          {canProceed ? (
            onProceed ? (
              /* §3 — Primary: AMS purple, unified radius (matches Validate / app buttons) */
              <button
                onClick={() => void onProceed()}
                style={{
                  minWidth: "170px",
                  height: "42px",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: "var(--color-accent-base)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                }}
              >
                {primaryActionLabel}
              </button>
            ) : (
              <Link
                href={proceedHref}
                prefetch
                onClick={onClose}
                style={{
                  minWidth: "170px",
                  height: "42px",
                  borderRadius: "var(--radius-md)",
                  border: "none",
                  background: "var(--color-accent-base)",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all var(--transition-fast)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
              >
                {primaryActionLabel}
              </Link>
            )
          ) : scanStatus === "scanning" ? (
            <button
              disabled
              style={{
                minWidth: "170px",
                height: "42px",
                borderRadius: "0",
                border: "none",
                background: "var(--color-accent-base)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "not-allowed",
                opacity: 0.5,
              }}
            >
              {primaryActionLabel}
            </button>
          ) : context.status === "needs_action" || context.status === "advisory_warning" ? (
            <button
              onClick={onSettingsRedirect}
              style={{
                minWidth: "170px",
                height: "42px",
                borderRadius: "0",
                border: "none",
                background: "var(--color-accent-base)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {primaryActionLabel}
            </button>
          ) : (
            <button
              onClick={onClose}
              style={{
                minWidth: "170px",
                height: "42px",
                borderRadius: "0",
                border: "none",
                background: "var(--color-accent-base)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {primaryActionLabel}
            </button>
          )}
          {/* §3 — Secondary buttons: flat muted text, no border/bg */}
          {scanStatus !== "scanning" && (
            <button
              onClick={handleRescan}
              disabled={isRescanning}
              style={{
                height: "42px",
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                padding: "0 14px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: isRescanning ? "not-allowed" : "pointer",
                opacity: isRescanning ? 0.62 : 1,
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
              }}
            >
              Run checks again
            </button>
          )}
          {primaryActionLabel !== "Open settings" && (
            <button
              onClick={onSettingsRedirect}
              style={{
                height: "42px",
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                padding: "0 14px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
              }}
            >
              Open settings
            </button>
          )}
          {primaryActionLabel !== "Back to contests" && (
            <button
              onClick={onClose}
              style={{
                height: "42px",
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                padding: "0 16px",
                fontSize: "13px",
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
              }}
            >
              Back to contests
            </button>
          )}
          {!canProceed && scanStatus !== "scanning" && (
            <button
              onClick={() => setHelpOpen(true)}
              style={{
                height: "42px",
                background: "transparent",
                border: "none",
                color: "var(--text-dim)",
                padding: "0 16px",
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-dim)";
              }}
            >
              Get help
            </button>
          )}
        </div>
      </div>
      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind={entryWindow.status === "blocked" ? "POLICY_BLOCK" : "READINESS"}
        contestId={contestId}
        summary={
          entryWindow.status === "blocked"
            ? `Blocked from entering the contest: ${entryWindow.reason ?? "entry window not open"}.`
            : "I can't pass the device readiness checks to enter the contest."
        }
        details={{
          source: "readiness_modal",
          session_type: sessionType,
          entry_window: entryWindow.status,
          entry_window_reason: entryWindow.reason,
          decision: activeReport?.decision,
          diagnostics: consoleLogs,
        }}
      />
      <style>{`
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
