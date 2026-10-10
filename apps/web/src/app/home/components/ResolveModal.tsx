"use client";

import { useMemo, useState } from "react";
import { invoke } from "@ams/api-client";
import { getThemeColors } from "./utils";
import { Button } from "./ui-primitives";
import { AccessDialog } from "@/components/AccessDialog";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { Banner } from "@astryxdesign/core/Banner";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
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
}

type ResolveFlow = {
  title: string;
  problem: string;
  steps: string[];
  primaryLabel: string;
  primaryAction: "settings" | "retry" | "elevate" | "privacy-camera" | "privacy-microphone";
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
}: ResolveModalProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const c = getThemeColors(theme);
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
    <>
      <AccessDialog
        open={isOpen}
        onClose={onClose}
        title={activeFlow.title}
        subtitle={activeFlow.problem}
        labelId="resolve-modal-title"
        width="calc(var(--spacing-10) * 14)"
      >
        <VStack gap={6}>
          <VStack as="section" gap={3}>
            <Heading level={4} accessibilityLevel={3}>
              What to do
            </Heading>
            <List listStyle="decimal" density="balanced">
              {activeFlow.steps.map((step) => (
                <ListItem key={step} label={<Text color="secondary">{step}</Text>} />
              ))}
            </List>
          </VStack>
          <VStack as="section" gap={3}>
            <Heading level={4} accessibilityLevel={3}>
              Diagnostic details
            </Heading>
            <MetadataList>
              {activeFlow.details.map((item) => (
                <MetadataListItem key={item.label} label={item.label}>
                  <Text style={{ overflowWrap: "anywhere" }}>{item.value}</Text>
                </MetadataListItem>
              ))}
            </MetadataList>
          </VStack>
          {actionNotice && <Banner status="warning" title={actionNotice} />}

          <HStack gap={3} wrap="wrap" justify="end">
            <Button theme={theme} variant="secondary" type="button" onClick={copySupportDetails}>
              {copied ? "Copied" : "Copy support details"}
            </Button>
            <Button
              theme={theme}
              variant="secondary"
              type="button"
              onClick={() => setHelpOpen(true)}
            >
              Get help
            </Button>
            <Button theme={theme} variant="secondary" type="button" onClick={onClose}>
              Close
            </Button>
            <Button
              theme={theme}
              variant="primary"
              type="button"
              onClick={handlePrimaryAction}
              disabled={busy}
            >
              {busy
                ? activeFlow.primaryAction === "elevate"
                  ? "Waiting for approval..."
                  : "Checking..."
                : activeFlow.primaryLabel}
            </Button>
          </HStack>
        </VStack>
      </AccessDialog>
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
    </>
  );
}
