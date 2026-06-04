"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/api-client";
import {
  getThemeColors,
  toPreflightPolicyItem,
  calculateReadinessScore,
  getEstimatedTimeToReady,
  API_URL,
} from "./utils";
import { useFocusTrap } from "./hooks";
import { parseLogLine } from "./SecurityOperationsLog";
import type { ReadinessState, ReadinessStatus } from "./types";
import type { ReadinessReport } from "@ams/api-client";

function PreflightCheckItem({
  label,
  status,
  successLabel,
  failLabel,
  theme,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  successLabel: string;
  failLabel: string;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  const dotColor = status === "ok" ? c.dot : status === "fail" ? "#f59e0b" : c.accent;
  const valueColor = status === "ok" ? c.dot : status === "fail" ? "#f59e0b" : c.accent;
  const valueLabel =
    status === "ok"
      ? successLabel.toUpperCase()
      : status === "fail"
        ? failLabel.toUpperCase()
        : "PROBING...";

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
          color: c.textMutedStrong,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            boxShadow: status !== "checking" ? `0 0 6px ${dotColor}` : "none",
            animation: status === "checking" ? "pulse-dot 1.5s ease-in-out infinite" : "none",
          }}
        />
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: valueColor,
          }}
        >
          {valueLabel}
        </span>
      </div>
    </div>
  );
}

interface SessionReadinessModalProps {
  contestId: string;
  sessionType: "new" | "resume";
  theme: "dark" | "light";
  onClose: () => void;
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
  readiness,
  readinessReport,
  onSettingsRedirect,
  onRescan,
}: SessionReadinessModalProps) {
  const router = useRouter();
  const c = getThemeColors(theme);
  const isLight = theme === "light";
  const [isRescanning, setIsRescanning] = useState(false);
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
  const estimatedTime = getEstimatedTimeToReady(readiness);
  const requiredPolicyChecks = activeReport?.required_checks ?? [];
  const requiredChecksPassed =
    !!activeReport &&
    requiredPolicyChecks.every((check) => check.outcome === "pass" && !check.blocking);
  const policyAllowsProceed =
    !!activeReport && activeReport.decision !== "blocked" && requiredChecksPassed;
  const entryWindowAllowed = entryWindow.status === "allowed";
  const canProceed = scanStatus === "done" && entryWindowAllowed && policyAllowsProceed;
  const shouldShowFixIssues = scanStatus === "done" && !canProceed;
  const requiredPreflightItems = activeReport
    ? activeReport.required_checks.map((check) => toPreflightPolicyItem(check, "required"))
    : [
        {
          key: "required-policy-pending",
          label: "Required Policy Checks",
          status: "checking" as ReadinessStatus,
          successLabel: "Policy ready",
          failLabel: "Policy pending",
        },
      ];
  const optionalPreflightItems = activeReport
    ? activeReport.optional_checks.map((check) => toPreflightPolicyItem(check, "optional"))
    : [];

  const consoleLogs = useMemo(() => {
    if (scanStatus === "scanning") {
      return [
        entryWindowChecking
          ? "[SYS] Validating synced contest entry window..."
          : "[SYS] Waiting for readiness report...",
        "[SCAN] Running active telemetry probe from local device checks.",
      ];
    }

    if (entryWindow.status === "blocked") {
      return [
        `[SYS] Entry window blocked: ${entryWindow.reason ?? "unavailable"}`,
        "[SYS] Policy decision: BLOCKED",
      ];
    }

    if (!activeReport) {
      return ["[SYS] Readiness report unavailable.", "[SYS] Policy decision: BLOCKED"];
    }

    const checkLog = (kind: string, prefix: string, label: string) => {
      const check = activeReport.checks.find((item) => item.kind === kind);
      if (!check) return `[${prefix}] ${label}: unavailable`;
      const outcome = check.outcome === "pass" ? "PASS" : "FAIL";
      const detail = check.detail ? ` - ${check.detail}` : "";
      return `[${prefix}] ${label}: ${outcome}${detail}`;
    };

    return [
      `[SYS] Readiness report received at ${new Date(activeReport.generated_at_ms).toLocaleTimeString()}`,
      checkLog("network", "NET", "Network connectivity"),
      checkLog("microphone", "AUD", "Audio telemetry"),
      checkLog("camera", "CAM", "Optical stream"),
      checkLog("virtualization", "SEC", "Virtualization shield"),
      checkLog("keyboard_lockdown", "SEC", "Keyboard lockdown"),
      checkLog("restricted_apps", "SEC", "Restricted process scan"),
      `[SYS] Policy decision: ${activeReport.decision.toUpperCase()}`,
    ];
  }, [activeReport, entryWindow.reason, entryWindow.status, entryWindowChecking, scanStatus]);

  async function handleRescan() {
    setIsRescanning(true);
    setEntryWindowRefreshIndex((value) => value + 1);
    await onRescan();
    setIsRescanning(false);
  }

  const proceedHref =
    sessionType === "new"
      ? `/session/onboarding?contestId=${contestId}`
      : `/session/contest?contestId=${contestId}`;

  useEffect(() => {
    router.prefetch(proceedHref);
  }, [proceedHref, router]);

  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const currentProgress = scanStatus === "scanning" ? 0 : score;
  const strokeDashoffset = circumference - (currentProgress / 100) * circumference;

  const accentColor = score === 100 ? "#10b981" : "#f59e0b";
  const glowColor = score === 100 ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)";
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-readiness-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: "920px",
          minHeight: "540px",
          background: isLight ? "#ffffff" : c.cardBg,
          border: `1px solid ${c.borderStrong}`,
          borderRadius: "2px",
          padding: "36px",
          boxShadow: isLight
            ? "0 24px 60px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)"
            : "0 24px 64px rgba(168, 85, 247, 0.08)",
          position: "relative",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
          gap: "36px",
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
            background: `radial-gradient(circle, ${score === 100 ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)"} 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* Left column: telemetry readout */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderRight: isLight
              ? "1px solid rgba(0, 0, 0, 0.12)"
              : "1px solid rgba(255, 255, 255, 0.12)",
            paddingRight: "36px",
            gap: "6px",
          }}
        >
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: c.textMuted,
              marginBottom: "16px",
              whiteSpace: "nowrap",
            }}
          >
            SESSION READINESS SCAN
          </p>

          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              lineHeight: 2,
              color: c.textMutedStrong,
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>SYS_INTEGRITY: </span>
              <span
                style={{
                  color: score === 100 ? c.dot : "#f59e0b",
                  letterSpacing: "-0.12em",
                  display: "inline-block",
                }}
              >
                {"█".repeat(Math.round(currentProgress / 10)) +
                  "░".repeat(10 - Math.round(currentProgress / 10))}
              </span>
              <span style={{ color: score === 100 ? c.dot : "#f59e0b", marginLeft: "6px" }}>
                {Math.round(currentProgress)}%
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>STATUS: </span>
              <span
                style={{ color: scanStatus === "scanning" ? "#f59e0b" : c.dot, fontWeight: 700 }}
              >
                {scanStatus === "scanning" ? "PROBING" : "ARMED"}
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>ETA_READY: </span>
              <span style={{ color: estimatedTime === 0 ? c.dot : "#f59e0b" }}>
                {estimatedTime === 0 ? "0s" : `${estimatedTime}s`}
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>SCAN_PROGRESS: </span>
              <span style={{ color: c.textMutedStrong }}>{Math.round(currentProgress)}/100</span>
            </div>
          </div>
        </div>

        {/* Right column: checklist + console */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div>
            <h3
              id="session-readiness-title"
              style={{
                fontSize: "16px",
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.04em",
                color: c.text,
                marginBottom: "6px",
              }}
            >
              Secure Enclave Port
            </h3>
            <p
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#999999",
                lineHeight: 1.6,
              }}
            >
              Pre-flight validation of biometric feeds, restricted process hooks, and network
              topology.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <p
              style={{
                fontSize: "9px",
                fontFamily: "'JetBrains Mono', monospace",
                color: c.textMuted,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              Required Policy Checks
            </p>
            {requiredPreflightItems.map((item) => (
              <PreflightCheckItem
                key={item.key}
                label={item.label}
                status={item.status}
                successLabel={item.successLabel}
                failLabel={item.failLabel}
                theme={theme}
              />
            ))}
            {optionalPreflightItems.length > 0 && (
              <p
                style={{
                  fontSize: "9px",
                  fontFamily: "'JetBrains Mono', monospace",
                  color: c.textMuted,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  margin: "6px 0 0",
                }}
              >
                Optional Signals
              </p>
            )}
            {optionalPreflightItems.map((item) => (
              <PreflightCheckItem
                key={item.key}
                label={item.label}
                status={item.status}
                successLabel={item.successLabel}
                failLabel={item.failLabel}
                theme={theme}
              />
            ))}
          </div>

          {/* Live console */}
          <div
            style={{
              background: isLight ? "#f8fafc" : c.innerBg,
              border: `1px solid ${c.border}`,
              borderRadius: "2px",
              padding: "14px",
              height: "135px",
              overflowY: "auto",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              color: "#A8A8A8",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {consoleLogs.map((log, index) => (
              <div
                key={index}
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {parseLogLine(log, c.dot)}
              </div>
            ))}
            {scanStatus === "scanning" && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>[SCAN] Running active telemetry probe</span>
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

          {/* Actions */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px",
              marginTop: "8px",
            }}
          >
            {canProceed ? (
              <Link
                href={proceedHref}
                prefetch
                onClick={onClose}
                style={{
                  flex: "1 1 180px",
                  minWidth: "180px",
                  height: "42px",
                  borderRadius: "2px",
                  border: `1px solid ${c.dot}`,
                  background: c.innerBg,
                  color: c.dot,
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
              >
                PROCEED TO SESSION
              </Link>
            ) : (
              <button
                disabled
                style={{
                  flex: "1 1 180px",
                  minWidth: "180px",
                  height: "42px",
                  borderRadius: "2px",
                  border: `1px solid ${c.border}`,
                  background: c.innerBg,
                  color: c.textMuted,
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "not-allowed",
                  transition: "all 150ms ease",
                }}
              >
                {scanStatus === "scanning" ? "PROBING..." : "PROCEED TO SESSION"}
              </button>
            )}
            {shouldShowFixIssues && (
              <button
                onClick={onSettingsRedirect}
                style={{
                  height: "42px",
                  borderRadius: "2px",
                  border: "1px solid #f59e0b",
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#f59e0b",
                  padding: "0 14px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                }}
              >
                FIX ISSUES
              </button>
            )}
            <button
              onClick={handleRescan}
              disabled={scanStatus === "scanning" || isRescanning}
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: scanStatus === "scanning" || isRescanning ? "not-allowed" : "pointer",
                transition: "all 200ms ease",
              }}
              title="Rescan systems"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  animation:
                    scanStatus === "scanning" || isRescanning ? "spin 1s linear infinite" : "none",
                }}
              >
                <path
                  d="M1 8a7 7 0 1 1 7 7M1 8h4V4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              onClick={onSettingsRedirect}
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 200ms ease",
              }}
              title="Go to settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M8 1v2M8 13v2M1 8h2M13 8h2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                padding: "0 16px",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.08em",
                cursor: "pointer",
                transition: "all 200ms ease",
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
