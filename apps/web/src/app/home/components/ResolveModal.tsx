"use client";

import { useMemo, useState } from "react";
import { invoke } from "@ams/api-client";
import { getThemeColors } from "./utils";
import { useFocusTrap } from "./hooks";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import type { TelemetryQueryState } from "./types";

interface ResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkKey: string | null;
  theme: "dark" | "light";
  telemetry?: TelemetryQueryState;
  onOpenSettings?: () => void;
  onRetry?: (checkKey: string) => Promise<void> | void;
  onCloseApps?: (apps: string[]) => Promise<void>;
  closingApps?: boolean;
}

type ResolveFlow = {
  title: string;
  problem: string;
  steps: string[];
  primaryLabel: string;
  primaryAction: "settings" | "retry" | "elevate" | "privacy-camera" | "privacy-microphone";
  details: Array<{ label: string; value: string }>;
  closeAllApps?: string[];
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
            value: processes?.found?.length
              ? processes.found.join(", ")
              : "No process details available",
          },
          { label: "Latest scan", value: lastScanned },
          {
            label: "Status",
            value: processes
              ? processes.clean
                ? "No restricted apps found"
                : "Needs action"
              : "Unknown",
          },
        ],
        closeAllApps: processes?.found?.length ? processes.found : undefined,
      };
    case "camera": {
      // On Windows the usual cause is the OS privacy toggle — deep-link
      // straight to it so fixing it is one click, not a Settings scavenger hunt.
      const winCamera = platform?.os?.toLowerCase().startsWith("windows") ?? false;
      return {
        title: "Camera needs attention",
        problem: "AMS Access cannot confirm a working camera for this session.",
        steps: winCamera
          ? [
              "Click the button below to open Windows camera privacy settings.",
              "Turn on “Camera access” and “Let desktop apps access your camera”.",
              "Close Zoom, Meet, OBS, or any other app that may be using the camera, then run the camera test again.",
            ]
          : [
              "Allow camera permission in your browser or system privacy settings.",
              "Close Zoom, Meet, OBS, or any other app that may be using the camera.",
              "Open Settings and run the camera test again.",
            ],
        primaryLabel: winCamera ? "Open Windows camera settings" : "Open Settings",
        primaryAction: winCamera ? "privacy-camera" : "settings",
        details: [
          { label: "Device check", value: "Camera failed readiness" },
          { label: "Latest scan", value: lastScanned },
          { label: "Suggested fix", value: "Permission or camera busy" },
        ],
      };
    }
    case "mic": {
      const winMic = platform?.os?.toLowerCase().startsWith("windows") ?? false;
      return {
        title: "Microphone needs attention",
        problem: "AMS Access cannot confirm a working microphone for this session.",
        steps: winMic
          ? [
              "Click the button below to open Windows microphone privacy settings.",
              "Turn on “Microphone access” and “Let desktop apps access your microphone”.",
              "Check that the microphone is connected and not muted, then run the test again.",
            ]
          : [
              "Allow microphone permission in your browser or system privacy settings.",
              "Check that the microphone is connected and not muted.",
              "Open Settings and run the microphone test again.",
            ],
        primaryLabel: winMic ? "Open Windows microphone settings" : "Open Settings",
        primaryAction: winMic ? "privacy-microphone" : "settings",
        details: [
          { label: "Device check", value: "Microphone failed readiness" },
          { label: "Latest scan", value: lastScanned },
          { label: "Suggested fix", value: "Permission, mute, or missing input device" },
        ],
      };
    }
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
          { label: "Connectivity", value: "Disabled for now" },
          { label: "Reachable", value: formatValue(network?.reachable, "Unknown") },
          {
            label: "Latency",
            value: network?.latency_ms != null ? `${network.latency_ms}ms` : "Not available",
          },
          {
            label: "Jitter",
            value: network?.jitter_ms != null ? `${network.jitter_ms}ms` : "Not available",
          },
          { label: "Quality", value: formatValue(network?.quality, "Unknown") },
        ],
      };
    case "keyboard": {
      const isMac = platform?.os === "macos";
      return {
        title: "Keyboard lockdown unavailable",
        problem: "This device has not confirmed the keyboard controls required for the contest.",
        steps: isMac
          ? [
              "Open System Settings → Privacy & Security → Accessibility.",
              "Enable AMS Access in the Accessibility list.",
              "Run the device check again.",
            ]
          : [
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
    }
    case "platform": {
      // Windows without elevation is recoverable in one click: the relaunch
      // command raises the standard UAC consent prompt — no manual
      // right-click "Run as administrator" needed.
      if (platform?.os?.toLowerCase().startsWith("windows") && platform?.elevated === false) {
        return {
          title: "Administrator approval needed",
          problem:
            "AMS Access needs Administrator privileges on Windows to enable full exam lockdown (firewall and keyboard protection).",
          steps: [
            "Click “Relaunch as Administrator” below.",
            "Choose “Yes” on the Windows confirmation prompt that appears.",
            "The app restarts with the required privileges — then sign in again.",
          ],
          primaryLabel: "Relaunch as Administrator",
          primaryAction: "elevate",
          details: [
            {
              label: "Operating system",
              value: `${platform.os} ${platform.arch}`,
            },
            { label: "Administrator", value: "No — approval required" },
          ],
        };
      }
      return {
        title: "Platform not supported",
        problem: "This operating system or desktop session may not support secure contest entry.",
        steps: [
          "Use a supported Windows, macOS, or Linux desktop environment.",
          "Avoid running the app inside a browser-only or unsupported shell.",
          "Run the platform check again after changing devices or sessions.",
        ],
        primaryLabel: "Run checks again",
        primaryAction: "retry",
        details: [
          {
            label: "Operating system",
            value: platform ? `${platform.os} ${platform.arch}` : "Unknown",
          },
          { label: "Platform family", value: formatValue(platform?.family, "Unknown") },
          { label: "Display session", value: formatValue(env?.display_server, "Unknown") },
        ],
      };
    }
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
  onCloseApps,
  closingApps,
}: ResolveModalProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const c = getThemeColors(theme);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
  const flow = useMemo(
    () => (checkKey ? buildFlow(checkKey, telemetry) : null),
    [checkKey, telemetry]
  );

  if (!isOpen || !checkKey || !flow) return null;

  const activeCheckKey = checkKey;
  const activeFlow = flow;

  async function handlePrimaryAction() {
    setActionNotice(null);
    if (activeFlow.primaryAction === "settings") {
      onOpenSettings?.();
      return;
    }
    if (activeFlow.primaryAction === "elevate") {
      setBusy(true);
      try {
        // Raises the one-click UAC prompt; on approval the elevated instance
        // starts and this one exits, so we never reach the catch block.
        await invoke("relaunch_as_admin");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setActionNotice(
          msg.includes("uac_declined")
            ? "Administrator approval was declined. Click the button and choose “Yes” on the Windows prompt to continue."
            : "Could not relaunch with Administrator privileges. Please try again."
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (
      activeFlow.primaryAction === "privacy-camera" ||
      activeFlow.primaryAction === "privacy-microphone"
    ) {
      const section = activeFlow.primaryAction === "privacy-camera" ? "camera" : "microphone";
      try {
        await invoke("open_privacy_settings", { section });
      } catch {
        setActionNotice("Could not open Windows Settings. Please try again.");
      }
      return;
    }
    setBusy(true);
    try {
      await onRetry?.(activeCheckKey);
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseAll() {
    if (!confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    setConfirmingClose(false);
    if (activeFlow.closeAllApps && onCloseApps) {
      await onCloseApps(activeFlow.closeAllApps);
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
        background: "rgba(0,0,0,0.6)",
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
          borderRadius: "var(--radius-lg)",
          padding: "26px",
          background: "var(--home-modal-surface)",
          border: `1px solid ${c.border}`,
          boxShadow: "var(--elevation-3)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "18px" }}
        >
          <div
            style={{
              width: "38px",
              height: "38px",
              borderRadius: "var(--radius-md)",
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
            <h3
              id="resolve-modal-title"
              style={{ color: c.text, margin: "0 0 7px", fontSize: "18px", fontWeight: 750 }}
            >
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
          <ol
            style={{
              margin: 0,
              paddingLeft: "20px",
              color: c.textMutedStrong,
              fontSize: "13px",
              lineHeight: 1.65,
            }}
          >
            {activeFlow.steps.map((step) => (
              <li key={step} style={{ marginBottom: "5px" }}>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section
          style={{
            border: `1px solid ${c.border}`,
            borderRadius: "var(--radius-md)",
            background: "var(--home-modal-inner)",
            padding: "13px 14px",
            marginBottom: "20px",
          }}
        >
          <h4 style={{ color: c.text, fontSize: "12px", fontWeight: 700, margin: "0 0 10px" }}>
            Diagnostic details
          </h4>
          <div style={{ display: "grid", gap: "8px" }}>
            {activeFlow.details.map((item) => (
              <div
                key={item.label}
                style={{ display: "flex", justifyContent: "space-between", gap: "14px" }}
              >
                <span style={{ color: c.textMuted, fontSize: "12px" }}>{item.label}</span>
                <span
                  style={{
                    color: c.textMutedStrong,
                    fontSize: "12px",
                    textAlign: "right",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {actionNotice && (
          <p
            role="alert"
            style={{
              margin: "0 0 14px",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "rgba(245, 158, 11, 0.10)",
              border: "1px solid rgba(245, 158, 11, 0.32)",
              color: "#f59e0b",
              fontSize: "12.5px",
              lineHeight: 1.55,
            }}
          >
            {actionNotice}
          </p>
        )}

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
              borderRadius: "var(--radius-md)",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            {copied ? "Copied" : "Copy support details"}
          </button>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            style={{
              height: "40px",
              padding: "0 14px",
              background: "transparent",
              color: c.textMutedStrong,
              border: `1px solid ${c.border}`,
              borderRadius: "var(--radius-md)",
              fontWeight: 600,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Get help
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
              borderRadius: "var(--radius-md)",
              fontWeight: 500,
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
          {activeFlow.closeAllApps &&
            (confirmingClose ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                  disabled={closingApps}
                  style={{
                    height: "40px",
                    padding: "0 14px",
                    background: "transparent",
                    color: c.textMuted,
                    border: `1px solid ${c.border}`,
                    borderRadius: "var(--radius-md)",
                    fontWeight: 500,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCloseAll}
                  disabled={closingApps}
                  aria-label={`Confirm close: ${activeFlow.closeAllApps.join(", ")}`}
                  style={{
                    height: "40px",
                    padding: "0 16px",
                    background: "rgba(239, 68, 68, 0.12)",
                    color: "#ef4444",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    borderRadius: "var(--radius-md)",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: closingApps ? "not-allowed" : "pointer",
                    opacity: closingApps ? 0.72 : 1,
                  }}
                >
                  {closingApps
                    ? "Closing…"
                    : `Confirm — close ${activeFlow.closeAllApps.join(", ")}?`}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleCloseAll}
                disabled={busy || closingApps}
                aria-label="Close all restricted apps automatically"
                style={{
                  height: "40px",
                  padding: "0 16px",
                  background: "rgba(239, 68, 68, 0.10)",
                  color: "#ef4444",
                  border: "1px solid rgba(239, 68, 68, 0.30)",
                  borderRadius: "var(--radius-md)",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: busy || closingApps ? "not-allowed" : "pointer",
                  opacity: busy || closingApps ? 0.72 : 1,
                }}
              >
                Close all ▸
              </button>
            ))}
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={busy}
            style={{
              height: "40px",
              padding: "0 16px",
              background:
                activeFlow.primaryAction === "retry"
                  ? "rgba(245, 158, 11, 0.14)"
                  : "var(--color-accent-base)",
              color: activeFlow.primaryAction === "retry" ? "#f59e0b" : "#ffffff",
              border: `1px solid ${activeFlow.primaryAction === "retry" ? "rgba(245, 158, 11, 0.36)" : "var(--color-accent-base)"}`,
              borderRadius: "var(--radius-md)",
              fontWeight: 700,
              fontSize: "13px",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.72 : 1,
            }}
          >
            {busy
              ? activeFlow.primaryAction === "elevate"
                ? "Waiting for approval..."
                : "Checking..."
              : activeFlow.primaryLabel}
          </button>
        </div>
      </div>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="READINESS"
        summary={`I can't resolve the “${activeFlow.title}” device check.`}
        details={{
          source: "resolve_modal",
          issue: activeCheckKey,
          problem: activeFlow.problem,
          diagnostics: Object.fromEntries(
            activeFlow.details.map((item) => [item.label, item.value])
          ),
        }}
      />
    </div>
  );
}
