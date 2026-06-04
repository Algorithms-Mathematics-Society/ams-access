"use client";

import { memo, useMemo } from "react";
import { getThemeColors } from "./utils";
import type { ReadinessState } from "./types";

export const ReadinessWidget = memo(function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
  onResolve,
}: {
  readiness: ReadinessState;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
  onResolve?: (key: string) => void;
}) {
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);
  const failedChecks = [
    { key: "camera", label: "Camera unavailable", status: readiness.camera },
    { key: "mic", label: "Microphone unavailable", status: readiness.mic },
    { key: "network", label: "Network unstable or unreachable", status: readiness.network },
    { key: "restrictedApps", label: "Restricted app detected", status: readiness.restrictedApps },
    { key: "keyboard", label: "Keyboard lockdown unavailable", status: readiness.keyboard },
    { key: "platform", label: "Platform support check failed", status: readiness.platform },
    { key: "vm", label: "VM or security check failed", status: readiness.vm },
  ].filter((item) => item.status === "fail");

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "6px",
        padding: "24px",
        boxShadow: "none",
        transition: "all 150ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: themeColors.accent,
            outline: `1px solid ${themeColors.accent}`,
            outlineOffset: "1.5px",
          }}
        />
        <h3
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: themeColors.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          System Integrity HUD
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: "24px" }}>
        <ReadinessItem
          label="Network Connection"
          status={readiness.network}
          theme={theme}
          onResolve={onResolve ? () => onResolve("network") : undefined}
        />
        <ReadinessItem
          label="Video Capture"
          status={readiness.camera}
          theme={theme}
          onResolve={onResolve ? () => onResolve("camera") : undefined}
        />
        <ReadinessItem
          label="Audio Input"
          status={readiness.mic}
          theme={theme}
          onResolve={onResolve ? () => onResolve("mic") : undefined}
        />
        <ReadinessItem
          label="Secure VM Shield"
          status={readiness.vm}
          theme={theme}
          onResolve={onResolve ? () => onResolve("vm") : undefined}
        />
        <ReadinessItem
          label="Keyboard Lockdown"
          status={readiness.keyboard}
          theme={theme}
          onResolve={onResolve ? () => onResolve("keyboard") : undefined}
        />
        <ReadinessItem
          label="Platform Support"
          status={readiness.platform}
          theme={theme}
          onResolve={onResolve ? () => onResolve("platform") : undefined}
        />
        <ReadinessItem
          label="Restricted Processes"
          status={readiness.restrictedApps}
          theme={theme}
          onResolve={onResolve ? () => onResolve("restrictedApps") : undefined}
        />
      </div>

      <div
        style={{
          marginBottom: "18px",
          border:
            failedChecks.length > 0
              ? "1px solid rgba(239, 68, 68, 0.22)"
              : "1px solid rgba(255, 255, 255, 0.05)",
          background: failedChecks.length > 0 ? "rgba(239, 68, 68, 0.06)" : "transparent",
          borderRadius: "6px",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <p
          style={{
            color: failedChecks.length > 0 ? "#fca5a5" : "rgba(255, 255, 255, 0.35)",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono), monospace",
            marginBottom: failedChecks.length > 0 ? "8px" : "0",
          }}
        >
          {failedChecks.length > 0 ? "Active Warnings" : "All checks passed"}
        </p>
        {failedChecks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            {failedChecks.map((item) => (
              <span
                key={item.key}
                style={{
                  color: "#f87171",
                  fontSize: "12px",
                  lineHeight: 1.35,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onSettingsRedirect}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "11px 16px",
          borderRadius: "6px",
          border: "1px solid #a855f7",
          background: "#a855f7",
          color: "#ffffff",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 150ms ease",
          letterSpacing: "0",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#9333ea";
          e.currentTarget.style.borderColor = "#c084fc";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#a855f7";
          e.currentTarget.style.borderColor = "#a855f7";
        }}
      >
        Open Settings
      </button>
    </div>
  );
});

export const ReadinessItem = memo(function ReadinessItem({
  label,
  status,
  theme,
  onResolve,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  theme: "dark" | "light";
  onResolve?: () => void;
}) {
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "13px 0",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontWeight: 500,
          fontFamily: "var(--font-mono), monospace",
          color: themeColors.textMutedStrong,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ width: "80px", textAlign: "right", marginRight: "16px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontFamily: "var(--font-mono), monospace",
              color:
                status === "ok"
                  ? "#22c55e"
                  : status === "fail"
                    ? "#ef4444"
                    : themeColors.accentText,
            }}
          >
            {status === "ok" ? "SECURE" : status === "fail" ? "CRITICAL" : "SCANNING"}
          </span>
        </div>

        <div
          style={{
            width: "24px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background:
                status === "ok" ? "#22c55e" : status === "fail" ? "#ef4444" : themeColors.accent,
              outline: `1px solid ${status === "ok" ? "#22c55e" : status === "fail" ? "#ef4444" : themeColors.accent}`,
              outlineOffset: "2px",
              animation: status === "checking" ? "pulse-dot 1s ease-in-out infinite" : "none",
            }}
          />
        </div>

        <div
          style={{
            width: "80px",
            display: "flex",
            justifyContent: "flex-end",
            marginLeft: "16px",
          }}
        >
          {status === "fail" && onResolve ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "4px",
                padding: "5px 11px",
                fontSize: "11px",
                color: "#fca5a5",
                fontWeight: 600,
                letterSpacing: "0.05em",
                cursor: "pointer",
                fontFamily: "var(--font-mono), monospace",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
              }}
            >
              Resolve
            </button>
          ) : (
            <div style={{ width: "80px" }} />
          )}
        </div>
      </div>
    </div>
  );
});
