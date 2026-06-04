"use client";

import { useEffect, memo, useMemo } from "react";
import { getThemeColors, getNetworkProbeHost } from "./utils";
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
        borderRadius: "6px",
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
        ? new Date(telemetry.lastScannedAt).toLocaleTimeString([], { hour12: false })
        : "not scanned",
    [telemetry.lastScannedAt]
  );

  useEffect(() => {
    void refreshTelemetry(false, "DIAGNOSTICS");
  }, [refreshTelemetry]);

  async function runNetworkScan() {
    await refreshTelemetry(true, "DIAGNOSTICS");
  }

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
          borderRadius: "8px",
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
            sub={`Probe host: ${getNetworkProbeHost()} / last ${lastScannedLabel}`}
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
            label="Security Environment"
            val={securityEnv ? securityEnv.display_server : "Unavailable"}
            sub={
              securityEnv
                ? `LD_PRELOAD ${securityEnv.ld_preload_injection ? "present" : "clean"}`
                : "get_security_environment did not return data"
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
              borderRadius: "6px",
              color: c.accentText,
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: checkingNetwork ? "not-allowed" : "pointer",
              opacity: checkingNetwork ? 0.72 : 1,
              transition:
                "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (checkingNetwork) return;
              e.currentTarget.style.background = "rgba(168,85,247,0.14)";
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
            {checkingNetwork ? "Measuring Telemetry..." : "Scan Latency Network"}
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
          borderRadius: "8px",
          padding: "20px 24px",
        }}
      >
        <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text, marginBottom: "8px" }}>
          Diagnostics Export
        </h4>
        <p style={{ fontSize: "13px", color: c.textMuted, marginBottom: "16px", lineHeight: 1.5 }}>
          Export local secure client parameters to help technical administrators troubleshoot
          workstation setups.
        </p>
        <pre
          style={{
            background: c.innerBg,
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            padding: "16px",
            fontSize: "11px",
            color: c.consoleText,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.6,
            overflowX: "auto",
            marginBottom: "20px",
          }}
        >
          {`{
  "client_version": "0.1.0",
  "build_channel": "release-production",
  "os_environment": "${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}",
  "display_server": "${securityEnv?.display_server ?? "unknown"}",
  "network_quality": "${networkQuality}",
  "security_lockdown": {
    "platform_supported": ${readiness.platform === "ok"},
    "keyboard_lock_available": ${readiness.keyboard === "ok"},
    "sandboxed_webview": true
  }
}`}
        </pre>
        <button
          onClick={exportReport}
          style={{
            padding: "9px 16px",
            background: theme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)",
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            color: c.textMutedStrong,
            fontSize: "13px",
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
            transition:
              "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
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
            e.currentTarget.style.transform = "scale(1)";
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.98)";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          Export Diagnostic JSON Log
        </button>
      </div>
    </div>
  );
});
