"use client";

import { useMemo, useState } from "react";
import { getNetworkProbeHost, getThemeColors } from "./utils";
import { useFocusTrap } from "./hooks";
import type { TelemetryQueryState } from "./types";

interface ResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkKey: string | null;
  theme: "dark" | "light";
  telemetry?: TelemetryQueryState;
  onOpenSettings?: () => void;
  onRetry?: (checkKey: string) => Promise<void> | void;
}

type ResolveFlow = {
  title: string;
  problem: string;
  steps: string[];
  primaryLabel: string;
  primaryAction: "settings" | "retry";
  details: Array<{ label: string; value: string }>;
};

function formatValue(value: unknown, fallback = "Not available") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function buildFlow(checkKey: string, telemetry?: TelemetryQueryState): ResolveFlow {
  const processes = telemetry?.processes;
  const network = telemetry?.network;
  const platform = telemetry?.platform;
  const virt = telemetry?.virt;
  const env = telemetry?.env;
  const lastScanned = telemetry?.lastScannedAt
    ? new Date(telemetry.lastScannedAt).toLocaleTimeString([], { hour12: false })
    : "Not scanned yet";

  switch (checkKey) {
    case "restrictedApps":
      return {
        title: "Close restricted apps",
        problem: "One or more apps on this device can interfere with contest monitoring.",
        steps: [
          "Close screen sharing, recording, remote access, chat, and development helper apps.",
          "Check the flagged process list below and close each app completely.",
          "Run the app check again after closing them.",
        ],
        primaryLabel: "Run scan again",
        primaryAction: "retry",
        details: [
          {
            label: "Flagged apps",
            value: processes?.found?.length ? processes.found.join(", ") : "No process details available",
          },
          { label: "Latest scan", value: lastScanned },
          { label: "Status", value: processes ? (processes.clean ? "No restricted apps found" : "Needs action") : "Unknown" },
        ],
      };
    case "camera":
      return {
        title: "Camera needs attention",
        problem: "AMS Access cannot confirm a working camera for this session.",
        steps: [
          "Allow camera permission in your browser or system privacy settings.",
          "Close Zoom, Meet, OBS, or any other app that may be using the camera.",
          "Open Settings and run the camera test again.",
        ],
        primaryLabel: "Open Settings",
        primaryAction: "settings",
        details: [
          { label: "Device check", value: "Camera failed readiness" },
          { label: "Latest scan", value: lastScanned },
          { label: "Suggested fix", value: "Permission or camera busy" },
        ],
      };
    case "mic":
      return {
        title: "Microphone needs attention",
        problem: "AMS Access cannot confirm a working microphone for this session.",
        steps: [
          "Allow microphone permission in your browser or system privacy settings.",
          "Check that the microphone is connected and not muted.",
          "Open Settings and run the microphone test again.",
        ],
        primaryLabel: "Open Settings",
        primaryAction: "settings",
        details: [
          { label: "Device check", value: "Microphone failed readiness" },
          { label: "Latest scan", value: lastScanned },
          { label: "Suggested fix", value: "Permission, mute, or missing input device" },
        ],
      };
    case "network":
      return {
        title: "Network needs attention",
        problem: "The app could not confirm a stable connection to the contest service.",
        steps: [
          "Switch to a stable Wi-Fi network or wired connection if possible.",
          "Disable VPN or proxy tools unless your organizer requires them.",
          "Run the network check again.",
        ],
        primaryLabel: "Run network check again",
        primaryAction: "retry",
        details: [
          { label: "Probe host", value: getNetworkProbeHost() },
          { label: "Reachable", value: formatValue(network?.reachable, "Unknown") },
          { label: "Latency", value: network?.latency_ms != null ? `${network.latency_ms}ms` : "Not available" },
          { label: "Jitter", value: network?.jitter_ms != null ? `${network.jitter_ms}ms` : "Not available" },
          { label: "Quality", value: formatValue(network?.quality, "Unknown") },
        ],
      };
    case "keyboard":
      return {
        title: "Keyboard lockdown unavailable",
        problem: "This device has not confirmed the keyboard controls required for the contest.",
        steps: [
          "Disable custom keyboard remappers or window-manager shortcuts temporarily.",
          "Close tools like AutoHotkey or global hotkey managers.",
          "Run the device check again.",
        ],
        primaryLabel: "Run checks again",
        primaryAction: "retry",
        details: [
          { label: "Platform", value: platform ? `${platform.os} ${platform.arch}` : "Unknown" },
          { label: "Display session", value: formatValue(env?.display_server, "Unknown") },
          { label: "Latest scan", value: lastScanned },
        ],
      };
    case "platform":
      return {
        title: "Platform not supported",
        problem: "This operating system or desktop session may not support secure contest entry.",
        steps: [
          "Use a supported Windows or Linux desktop environment.",
          "Avoid running the app inside a browser-only or unsupported shell.",
          "Run the platform check again after changing devices or sessions.",
        ],
        primaryLabel: "Run checks again",
        primaryAction: "retry",
        details: [
          { label: "Operating system", value: platform ? `${platform.os} ${platform.arch}` : "Unknown" },
          { label: "Platform family", value: formatValue(platform?.family, "Unknown") },
          { label: "Display session", value: formatValue(env?.display_server, "Unknown") },
        ],
      };
    case "vm":
    default:
      return {
        title: "Virtual machine check failed",
        problem: "AMS Access detected a virtualized or unsupported device environment.",
        steps: [
          "Close VirtualBox, VMware, Parallels, or similar virtualization tools.",
          "Restart into your normal physical desktop environment.",
          "Run the device check again.",
        ],
        primaryLabel: "Run checks again",
        primaryAction: "retry",
        details: [
          { label: "VM detected", value: formatValue(virt?.detected, "Unknown") },
          { label: "Detected platform", value: formatValue(virt?.platform, "None reported") },
          { label: "Confidence", value: formatValue(virt?.confidence, "Unknown") },
        ],
      };
  }
}

export function ResolveModal({
  isOpen,
  onClose,
  checkKey,
  theme,
  telemetry,
  onOpenSettings,
  onRetry,
}: ResolveModalProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const c = getThemeColors(theme);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const flow = useMemo(() => (checkKey ? buildFlow(checkKey, telemetry) : null), [checkKey, telemetry]);

  if (!isOpen || !checkKey || !flow) return null;

  const activeCheckKey = checkKey;
  const activeFlow = flow;

  async function handlePrimaryAction() {
    if (activeFlow.primaryAction === "settings") {
      onOpenSettings?.();
      return;
    }
    setBusy(true);
    try {
      await onRetry?.(activeCheckKey);
    } finally {
      setBusy(false);
    }
  }

  async function copySupportDetails() {
    const payload = {
      issue: activeCheckKey,
      title: activeFlow.title,
      problem: activeFlow.problem,
      details: Object.fromEntries(activeFlow.details.map((item) => [item.label, item.value])),
      copied_at: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(3,8,22,0.6)",
        backdropFilter: "blur(16px)",
        animation: "fadeIn 280ms var(--ease-cinematic) forwards",
        padding: "24px",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          maxWidth: "560px",
          width: "100%",
          borderRadius: "10px",
          padding: "26px",
          background: theme === "light" ? "#ffffff" : "rgba(15, 23, 42, 0.96)",
          border: `1px solid ${c.border}`,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}>
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "8px",
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              color: "#f59e0b",
              fontWeight: 800,
            }}
          >
            !
          </div>
          <div>
            <h3 id="resolve-modal-title" style={{ color: c.text, margin: "0 0 7px", fontSize: "18px", fontWeight: 750 }}>
              {activeFlow.title}
            </h3>
            <p style={{ color: c.textMutedStrong, lineHeight: 1.55, margin: 0, fontSize: "13px" }}>
              {activeFlow.problem}
            </p>
          </div>
        </div>

        <section style={{ marginBottom: "18px" }}>
          <h4 style={{ color: c.text, fontSize: "12px", fontWeight: 700, margin: "0 0 10px" }}>
            What to do
          </h4>
          <ol style={{ margin: 0, paddingLeft: "20px", color: c.textMutedStrong, fontSize: "13px", lineHeight: 1.65 }}>
            {activeFlow.steps.map((step) => (
              <li key={step} style={{ marginBottom: "5px" }}>{step}</li>
            ))}
          </ol>
        </section>

        <section
          style={{
            border: `1px solid ${c.border}`,
            borderRadius: "8px",
            background: theme === "light" ? "#f8fafc" : "rgba(255,255,255,0.025)",
            padding: "13px 14px",
            marginBottom: "20px",
          }}
        >
          <h4 style={{ color: c.text, fontSize: "12px", fontWeight: 700, margin: "0 0 10px" }}>
            Diagnostic details
          </h4>
          <div style={{ display: "grid", gap: "8px" }}>
            {activeFlow.details.map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", gap: "14px" }}>
                <span style={{ color: c.textMuted, fontSize: "12px" }}>{item.label}</span>
                <span style={{ color: c.textMutedStrong, fontSize: "12px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={copySupportDetails}
            style={{
              height: "40px",
              padding: "0 14px",
              background: "transparent",
              color: c.textMutedStrong,
              border: `1px solid ${c.border}`,
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            {copied ? "Copied" : "Copy support details"}
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: "40px",
              padding: "0 14px",
              background: "transparent",
              color: c.textMuted,
              border: `1px solid ${c.border}`,
              borderRadius: "6px",
              fontWeight: 500,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={busy}
            style={{
              height: "40px",
              padding: "0 16px",
              background: activeFlow.primaryAction === "settings" ? "#a855f7" : "rgba(245, 158, 11, 0.14)",
              color: activeFlow.primaryAction === "settings" ? "#ffffff" : "#f59e0b",
              border: `1px solid ${activeFlow.primaryAction === "settings" ? "#a855f7" : "rgba(245, 158, 11, 0.36)"}`,
              borderRadius: "6px",
              fontWeight: 700,
              fontSize: "13px",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.72 : 1,
            }}
          >
            {busy ? "Checking..." : activeFlow.primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
