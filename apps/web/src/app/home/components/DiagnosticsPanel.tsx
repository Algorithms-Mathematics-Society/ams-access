"use client";

import { useEffect, memo, useMemo, useState, useCallback } from "react";
import { getThemeColors } from "./utils";
import type { ReadinessState, TelemetryQueryState } from "./types";

function TelemetryStat({
  label,
  val,
  sub,
  status,
  theme,
}: {
  label: string;
  val: string;
  sub: string;
  status: "ok" | "fail" | "unknown";
  theme: "dark" | "light";
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  const dotColor =
    status === "ok"
      ? theme === "light"
        ? "#10b981"
        : "#22c55e"
      : status === "fail"
        ? "#ef4444"
        : theme === "light"
          ? "#a8a29e"
          : "rgba(255,255,255,0.32)";
  return (
    <div
      style={{
        padding: "var(--density-standard)",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      <p className="text-micro-label" style={{ color: c.textMuted, marginBottom: "4px" }}>
        {label}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        <span className="text-body-copy" style={{ fontWeight: 600, color: c.text }}>
          {val}
        </span>
      </div>
      <p className="text-mono-console" style={{ color: c.textMuted, margin: 0 }}>
        {sub}
      </p>
    </div>
  );
}

export const DiagnosticsPanel = memo(function DiagnosticsPanel({
  readiness,
  theme,
  telemetry,
  refreshTelemetry,
}: {
  readiness: ReadinessState;
  theme: "dark" | "light";
  telemetry: TelemetryQueryState;
  refreshTelemetry: (force?: boolean, source?: string) => Promise<void>;
}) {
  const c = useMemo(() => getThemeColors(theme), [theme]);
  const platformInfo = telemetry.platform;
  const securityEnv = telemetry.env;
  const network = telemetry.network;
  const checkingNetwork = telemetry.isLoading;
  const latency = network?.latency_ms ?? null;
  const jitter = network?.jitter_ms ?? null;
  const networkQuality = telemetry.error
    ? "unavailable"
    : network
      ? network.reachable
        ? network.quality
        : "unreachable"
      : "unchecked";
  const lastScannedLabel = useMemo(
    () =>
      telemetry.lastScannedAt
        ? new Date(telemetry.lastScannedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        : null,
    [telemetry.lastScannedAt]
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refreshTelemetry(false, "DIAGNOSTICS");
  }, [refreshTelemetry]);

  async function runNetworkScan() {
    await refreshTelemetry(true, "DIAGNOSTICS");
  }

  const copySupportSummary = useCallback(() => {
    const lines = [
      "AMS Access — Support Summary",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      `Platform: ${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}`,
      `Network quality: ${networkQuality}${latency !== null ? ` (${latency}ms latency` : ""}${jitter !== null ? `, ${jitter}ms jitter)` : latency !== null ? ")" : ""}`,
      `Camera: ${readiness.camera === "ok" ? "Ready" : readiness.camera === "fail" ? "Not ready" : "Checking"}`,
      `Microphone: ${readiness.mic === "ok" ? "Ready" : readiness.mic === "fail" ? "Not ready" : "Checking"}`,
      `Keyboard lock: ${readiness.keyboard === "ok" ? "Ready" : readiness.keyboard === "fail" ? "Not ready" : "Checking"}`,
      `Platform support: ${readiness.platform === "ok" ? "Ready" : readiness.platform === "fail" ? "Not supported" : "Checking"}`,
      `VM detection: ${readiness.vm === "ok" ? "Ready" : readiness.vm === "fail" ? "Needs attention" : "Checking"}`,
      "",
      "Client version: 0.1.0",
      "Build channel: release-production",
      lastScannedLabel ? `Last checked: ${lastScannedLabel}` : "Last checked: not scanned",
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  }, [platformInfo, networkQuality, latency, jitter, readiness, lastScannedLabel]);

  function exportReport() {
    const data = {
      timestamp: new Date().toISOString(),
      client_version: "0.1.0",
      os: platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown",
      display_server: securityEnv?.display_server ?? "unknown",
      proctoring_telemetry: {
        camera_available: readiness.camera === "ok",
        mic_available: readiness.mic === "ok",
        network_latency_ms: latency,
        network_jitter_ms: jitter,
        network_quality: networkQuality,
      },
      security_lock_matrix: {
        platform_supported: readiness.platform === "ok",
        vm_shield_active: readiness.vm === "ok",
        ld_preload_clean: securityEnv ? !securityEnv.ld_preload_injection : null,
        keyboard_lock_available: readiness.keyboard === "ok",
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ams_diagnostic_report_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      <div
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: "var(--radius-md)",
          padding: "var(--density-relaxed)",
        }}
      >
        <h4
          className="text-subsection-title"
          style={{ color: c.text, marginBottom: "var(--density-compact)" }}
        >
          Platform Connection Diagnostics
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <TelemetryStat
            label="API Gateway Connectivity"
            val={
              checkingNetwork
                ? "Checking"
                : networkQuality === "unchecked"
                  ? "Not checked"
                  : networkQuality === "unavailable" || networkQuality === "unreachable"
                    ? "Unavailable"
                    : networkQuality
            }
            sub={`Connectivity checks disabled / last ${lastScannedLabel}`}
            status={
              checkingNetwork || networkQuality === "unchecked"
                ? "unknown"
                : networkQuality === "unavailable" || networkQuality === "unreachable"
                  ? "fail"
                  : "ok"
            }
            theme={theme}
          />
          <TelemetryStat
            label="Native Platform"
            val={platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "Unavailable"}
            sub={
              platformInfo ? `Family: ${platformInfo.family}` : "get_platform did not return data"
            }
            status={platformInfo ? "ok" : "unknown"}
            theme={theme}
          />
          <TelemetryStat
            label="Security checks"
            val={securityEnv ? securityEnv.display_server : "Unavailable"}
            sub={
              securityEnv
                ? `Startup injection check ${securityEnv.ld_preload_injection ? "needs attention" : "clean"}`
                : "Security check did not return data"
            }
            status={securityEnv ? (securityEnv.ld_preload_injection ? "fail" : "ok") : "unknown"}
            theme={theme}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "center",
            borderTop: `1px solid ${c.border}`,
            paddingTop: "16px",
          }}
        >
          <button
            onClick={runNetworkScan}
            disabled={checkingNetwork}
            style={{
              padding: "9px 16px",
              background: c.accentLight,
              border: `1px solid ${c.accentBorder}`,
              borderRadius: "var(--radius-sm)",
              color: c.accentText,
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: checkingNetwork ? "not-allowed" : "pointer",
              opacity: checkingNetwork ? 0.72 : 1,
              transition:
                "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              if (checkingNetwork) return;
              e.currentTarget.style.background = "rgb(var(--accent-rgb) / 0.14)";
              e.currentTarget.style.borderColor = c.accentText;
            }}
            onMouseLeave={(e) => {
              if (checkingNetwork) return;
              e.currentTarget.style.background = c.accentLight;
              e.currentTarget.style.borderColor = c.accentBorder;
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseDown={(e) => {
              if (!checkingNetwork) e.currentTarget.style.transform = "scale(0.98)";
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            {checkingNetwork ? "Checking network..." : "Run network check"}
          </button>
          <div style={{ display: "flex", gap: "20px" }}>
            <span style={{ fontSize: "13px", color: c.textMutedStrong }}>
              Latency:{" "}
              <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>
                {latency ?? "?"}ms
              </strong>
            </span>
            <span style={{ fontSize: "13px", color: c.textMutedStrong }}>
              Jitter:{" "}
              <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>
                {jitter ?? "?"}ms
              </strong>
            </span>
            <span style={{ fontSize: "13px", color: c.textMutedStrong }}>
              Signal Grade:{" "}
              <strong
                style={{
                  color:
                    networkQuality === "unreachable" || networkQuality === "unavailable"
                      ? "#ef4444"
                      : theme === "light"
                        ? "#10b981"
                        : "#22c55e",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {networkQuality.toUpperCase()}
              </strong>
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: "var(--radius-md)",
          padding: "20px 24px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: "8px",
          }}
        >
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text }}>Diagnostic Report</h4>
          <span
            style={{
              fontSize: "11px",
              color: c.textMuted,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            v0.1.0 · release-production
          </span>
        </div>
        <p style={{ fontSize: "13px", color: c.textMuted, marginBottom: "16px", lineHeight: 1.5 }}>
          Share this report with your contest organizer to help troubleshoot setup issues.
        </p>
        <pre
          style={{
            background: c.innerBg,
            border: `1px solid ${c.border}`,
            borderRadius: "var(--radius-sm)",
            padding: "16px",
            fontSize: "11px",
            color: c.consoleText,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.6,
            overflowX: "auto",
            marginBottom: "16px",
          }}
        >
          {`{
  "client_version": "0.1.0",
  "build_channel": "release-production",
  "os_environment": "${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}",
  "display_server": "${securityEnv?.display_server ?? "unknown"}",
  "network_quality": "${networkQuality}",
  "last_checked": "${lastScannedLabel ?? "not scanned"}",
  "security_lockdown": {
    "platform_supported": ${readiness.platform === "ok"},
    "keyboard_lock_available": ${readiness.keyboard === "ok"},
    "sandboxed_webview": true
  }
}`}
        </pre>
        <p
          style={{
            fontSize: "12px",
            color: c.textMuted,
            marginBottom: "16px",
            lineHeight: 1.5,
            padding: "10px 12px",
            background: "rgba(255,255,255,0.02)",
            border: `1px solid ${c.border}`,
            borderRadius: "var(--radius-sm)",
          }}
        >
          This includes device, network, and readiness details. It does not include your password or
          session code.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={copySupportSummary}
            style={{
              padding: "9px 16px",
              background: copied ? "rgba(34,197,94,0.1)" : c.accentLight,
              border: `1px solid ${copied ? "rgba(34,197,94,0.25)" : c.accentBorder}`,
              borderRadius: "var(--radius-sm)",
              color: copied ? "#4ade80" : c.accentText,
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition:
                "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
            }}
          >
            {copied ? "Copied!" : "Copy support summary"}
          </button>
          <button
            onClick={exportReport}
            style={{
              padding: "9px 16px",
              background: theme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)",
              border: `1px solid ${c.border}`,
              borderRadius: "var(--radius-sm)",
              color: c.textMutedStrong,
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition:
                "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background =
                theme === "light" ? "rgba(0,0,0,0.055)" : "rgba(255,255,255,0.075)";
              e.currentTarget.style.borderColor = c.borderStrong;
              e.currentTarget.style.color = c.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background =
                theme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)";
              e.currentTarget.style.borderColor = c.border;
              e.currentTarget.style.color = c.textMutedStrong;
            }}
          >
            Export diagnostic report
          </button>
        </div>
      </div>
    </div>
  );
});
