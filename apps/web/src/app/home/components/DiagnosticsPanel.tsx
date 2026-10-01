"use client";

import { useEffect, memo, useMemo, useState, useCallback } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useAppVersion } from "@/lib/use-app-version";
import type { ReadinessState, TelemetryQueryState } from "./types";

export const DiagnosticsPanel = memo(function DiagnosticsPanel({
  readiness,
  telemetry,
  refreshTelemetry,
  onOpenSettings,
}: {
  readiness: ReadinessState;
  telemetry: TelemetryQueryState;
  refreshTelemetry: (force?: boolean, source?: string) => Promise<void>;
  onOpenSettings?: () => void;
}) {
  const { version: appVersion, source: versionSource } = useAppVersion();
  const platformInfo = telemetry.platform;
  const securityEnv = telemetry.env;
  const network = telemetry.network;
  const checkingNetwork = telemetry.isLoading;
  const latency = network?.latency_ms ?? null;
  const jitter = network?.jitter_ms ?? null;
  const networkQuality = network
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
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    void refreshTelemetry(false, "DIAGNOSTICS");
  }, [refreshTelemetry]);

  async function runNetworkScan() {
    await refreshTelemetry(true, "DIAGNOSTICS");
  }

  const rows: { label: string; status: "ok" | "fail" | "checking" | "unknown"; detail: string }[] =
    [
      {
        label: "Camera access",
        status: readiness.camera,
        detail:
          readiness.camera === "ok"
            ? "Camera access was available at the last check."
            : "Test camera access and framing in Settings.",
      },
      {
        label: "Microphone access",
        status: readiness.mic,
        detail:
          readiness.mic === "ok"
            ? "Microphone access was available at the last check."
            : "Test your microphone in Settings.",
      },
      {
        label: "Keyboard support",
        status: platformInfo ? readiness.keyboard : "unknown",
        detail: "Current readiness result; contest entry checks lockdown separately.",
      },
      {
        label: "Platform support",
        status: platformInfo ? readiness.platform : "unknown",
        detail: platformInfo
          ? `${platformInfo.os} · ${platformInfo.arch}`
          : "No native platform result is available.",
      },
      {
        label: "Virtual machine check",
        status: telemetry.virt ? (telemetry.virt.detected ? "fail" : "ok") : "unknown",
        detail: telemetry.virt
          ? telemetry.virt.detected
            ? `${telemetry.virt.platform ?? "Virtual environment"} detected.`
            : "No virtualization detected in the latest scan."
          : "No virtualization result is available.",
      },
      {
        label: "Restricted apps",
        status: telemetry.processes ? (telemetry.processes.clean ? "ok" : "fail") : "unknown",
        detail: telemetry.processes
          ? telemetry.processes.clean
            ? "No restricted apps found in the latest scan."
            : `${telemetry.processes.found.length} app entries found. Close flagged apps and scan again.`
          : "No app scan result is available.",
      },
      {
        label: "Startup integrity",
        status: securityEnv ? (securityEnv.ld_preload_injection ? "fail" : "ok") : "unknown",
        detail: securityEnv
          ? securityEnv.ld_preload_injection
            ? "Startup injection detected. Ask your organizer for help before entering."
            : "No startup injection detected in the latest scan."
          : "No startup integrity result is available.",
      },
    ];

  const copySupportSummary = useCallback(() => {
    setCopyError(null);
    if (!navigator.clipboard?.writeText) {
      setCopyError("Clipboard access is unavailable. Export the diagnostic report instead.");
      return;
    }
    const lines = [
      "AMS Access — Support Summary",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      `Platform: ${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}`,
      `Network quality: ${networkQuality}${latency !== null ? ` (${latency}ms latency` : ""}${jitter !== null ? `, ${jitter}ms jitter)` : latency !== null ? ")" : ""}`,
      ...rows.map(
        (row) =>
          `${row.label}: ${row.status === "ok" ? "Ready" : row.status === "fail" ? "Needs attention" : row.status === "checking" ? "Checking" : "Not available"}. ${row.detail}`
      ),
      "",
      `Client version: ${appVersion ?? "Not available"}`,
      `Version source: ${versionSource === "desktop" ? "Desktop app" : "Unavailable in this environment"}`,
      ...(telemetry.error
        ? [
            "Scan status: " +
              (telemetry.lastScannedAt
                ? "Showing last available results; latest scan failed."
                : "Unavailable."),
          ]
        : []),
      lastScannedLabel ? `Last checked: ${lastScannedLabel}` : "Last checked: not scanned",
    ];
    void navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      })
      .catch(() => {
        setCopyError("Clipboard access was denied. Export the diagnostic report instead.");
      });
  }, [
    platformInfo,
    networkQuality,
    latency,
    jitter,
    rows,
    appVersion,
    versionSource,
    telemetry.error,
    telemetry.lastScannedAt,
    lastScannedLabel,
  ]);

  function exportReport() {
    const data = {
      timestamp: new Date().toISOString(),
      client_version: appVersion,
      client_version_source: versionSource,
      scan_status: telemetry.error
        ? telemetry.lastScannedAt
          ? "stale"
          : "unavailable"
        : telemetry.lastScannedAt
          ? "current"
          : "not_scanned",
      last_scanned_at: telemetry.lastScannedAt
        ? new Date(telemetry.lastScannedAt).toISOString()
        : null,
      setup_checks: rows.map(({ label, status, detail }) => ({ label, status, detail })),
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
        vm_shield_active: telemetry.virt ? !telemetry.virt.detected : null,
        restricted_apps_clean: telemetry.processes?.clean ?? null,
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

  const attentionCount =
    rows.filter((row) => row.status === "fail").length + (network && !network.reachable ? 1 : 0);
  const pendingCount = rows.filter(
    (row) => row.status === "unknown" || row.status === "checking"
  ).length;
  const snapshotTitle = checkingNetwork
    ? "Updating your device snapshot"
    : telemetry.error
      ? telemetry.lastScannedAt
        ? "Showing your last scan"
        : "Device scan unavailable"
      : attentionCount
        ? `${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} attention`
        : pendingCount
          ? "Some checks are not available yet"
          : "Latest checks look good";
  const technicalDetails = JSON.stringify(
    {
      last_scanned: telemetry.lastScannedAt
        ? new Date(telemetry.lastScannedAt).toISOString()
        : null,
      platform: platformInfo,
      environment: securityEnv,
      virtualization: telemetry.virt,
      restricted_apps: telemetry.processes,
      network,
      readiness,
    },
    null,
    2
  );
  const cardStyle = { border: 0, borderRadius: "var(--radius-container)", minWidth: 0 };

  return (
    <VStack gap={6} data-device-diagnostics style={{ minWidth: 0 }}>
      <Card padding={6} style={cardStyle} aria-labelledby="device-snapshot-heading">
        <VStack gap={4}>
          <HStack gap={4} justify="between" align="start" wrap="wrap">
            <VStack gap={2} style={{ flex: "1 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}>
              <Heading level={3} accessibilityLevel={2} id="device-snapshot-heading">
                {snapshotTitle}
              </Heading>
              <Text type="supporting">
                {lastScannedLabel
                  ? `Last device scan: ${lastScannedLabel}`
                  : "A device scan has not completed yet."}
              </Text>
            </VStack>
            <HStack gap={2} wrap="wrap">
              <Button
                label={checkingNetwork ? "Scanning…" : "Run device scan"}
                variant="secondary"
                onClick={runNetworkScan}
                isDisabled={checkingNetwork}
                isLoading={checkingNetwork}
              />
              {onOpenSettings && (
                <Button label="Open settings" variant="ghost" onClick={onOpenSettings} />
              )}
            </HStack>
          </HStack>
          <Text color="secondary">
            Review access and device checks below. Your contest runs its required checks again
            before entry.
          </Text>
          {telemetry.error && (
            <Banner
              status="warning"
              title="Device scan unavailable"
              description={
                telemetry.lastScannedAt
                  ? "Showing the last available results. Run a device scan to try again."
                  : "Open the desktop app and run a device scan to try again."
              }
            />
          )}
        </VStack>
      </Card>

      <HStack gap={6} align="start" wrap="wrap">
        <VStack
          as="section"
          gap={4}
          aria-labelledby="device-checks-heading"
          style={{ flex: "3 1 calc(var(--spacing-10) * 11)", minWidth: 0 }}
        >
          <Heading level={4} accessibilityLevel={2} id="device-checks-heading">
            Setup checks
          </Heading>
          <List hasDividers density="spacious" aria-label="Device setup checks">
            {rows.map((row) => (
              <ListItem
                key={row.label}
                style={{ paddingInline: 0 }}
                label={
                  <HStack as="span" gap={3} justify="between" align="center" wrap="wrap">
                    <Text weight="medium">{row.label}</Text>
                    <Token
                      size="sm"
                      label={
                        row.status === "ok"
                          ? "Ready"
                          : row.status === "fail"
                            ? "Needs attention"
                            : checkingNetwork || row.status === "checking"
                              ? "Checking"
                              : "Not available"
                      }
                      color={
                        row.status === "ok" ? "green" : row.status === "fail" ? "yellow" : "gray"
                      }
                    />
                  </HStack>
                }
                description={
                  <Text type="supporting" style={{ overflowWrap: "anywhere" }}>
                    {row.detail}
                  </Text>
                }
              />
            ))}
          </List>
        </VStack>
        <VStack gap={6} style={{ flex: "2 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}>
          <Card padding={6} style={cardStyle} aria-labelledby="device-environment-heading">
            <VStack gap={4}>
              <Heading level={4} accessibilityLevel={2} id="device-environment-heading">
                Device details
              </Heading>
              <MetadataList label={{ position: "top" }}>
                <MetadataListItem label="Operating system">
                  <Text style={{ overflowWrap: "anywhere" }}>
                    {platformInfo ? `${platformInfo.os} · ${platformInfo.arch}` : "Not available"}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="Display session">
                  <Text style={{ overflowWrap: "anywhere" }}>
                    {securityEnv?.display_server ?? "Not available"}
                  </Text>
                </MetadataListItem>
                <MetadataListItem label="System family">
                  {platformInfo?.family ?? "Not available"}
                </MetadataListItem>
              </MetadataList>
            </VStack>
          </Card>
          <Card padding={6} style={cardStyle} aria-labelledby="device-network-heading">
            <VStack gap={4}>
              <HStack gap={3} justify="between" align="center" wrap="wrap">
                <Heading level={4} accessibilityLevel={2} id="device-network-heading">
                  Network
                </Heading>
                <Token
                  size="sm"
                  label={network ? (network.reachable ? "Measured" : "Unreachable") : "Not checked"}
                  color={network ? (network.reachable ? "green" : "yellow") : "gray"}
                />
              </HStack>
              {network ? (
                <MetadataList orientation="horizontal">
                  <MetadataListItem label="Quality">{network.quality}</MetadataListItem>
                  <MetadataListItem label="Latency">
                    {latency === null ? "Not available" : `${latency} ms`}
                  </MetadataListItem>
                  <MetadataListItem label="Jitter">
                    {jitter === null ? "Not available" : `${jitter} ms`}
                  </MetadataListItem>
                </MetadataList>
              ) : (
                <Text type="supporting">
                  Network probing is currently disabled. Device scans do not measure connection
                  quality.
                </Text>
              )}
            </VStack>
          </Card>
        </VStack>
      </HStack>

      <Card padding={6} style={cardStyle} aria-labelledby="device-support-heading">
        <VStack gap={5}>
          <HStack gap={4} justify="between" align="start" wrap="wrap">
            <VStack gap={2} style={{ flex: "1 1 calc(var(--spacing-10) * 8)", minWidth: 0 }}>
              <Heading level={4} accessibilityLevel={2} id="device-support-heading">
                Troubleshooting support
              </Heading>
              <Text type="supporting">
                Share a summary or diagnostic report with your contest organizer.
              </Text>
            </VStack>
            <HStack gap={2} wrap="wrap">
              <Button
                label="Copy support summary"
                variant="secondary"
                onClick={copySupportSummary}
              />
              <Button label="Export diagnostic report" variant="ghost" onClick={exportReport} />
            </HStack>
          </HStack>
          <Text type="supporting">
            Reports include device, network and readiness details. They do not include your password
            or session code.
          </Text>
          {copied && (
            <Text type="supporting" role="status">
              Support summary copied.
            </Text>
          )}
          {copyError && <Banner status="error" title="Could not copy" description={copyError} />}
          <Collapsible trigger="Technical details" defaultIsOpen={false}>
            <VStack gap={3} style={{ minWidth: 0, paddingBlockStart: "var(--spacing-4)" }}>
              <Text type="supporting">
                The latest available device snapshot. Missing results are shown as null.
              </Text>
              <CodeBlock
                code={technicalDetails}
                language="json"
                hasCopyButton={false}
                isWrapped
                width="100%"
                maxHeight="calc(var(--spacing-10) * 10)"
                size="sm"
                container="section"
              />
            </VStack>
          </Collapsible>
        </VStack>
      </Card>
    </VStack>
  );
});
