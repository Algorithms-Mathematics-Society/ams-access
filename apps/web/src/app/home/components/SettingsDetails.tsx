"use client";

import { memo, useEffect, useRef, useState } from "react";
import { invoke, listen, type RestoreStatus } from "@ams/api-client";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Token } from "@astryxdesign/core/Token";
import { useAppVersion } from "@/lib/use-app-version";
import { manualRecoveryCommand } from "@/lib/recovery-message";
import {
  getLastReleaseResult,
  releaseDeviceControls,
  releaseRestoreStatus,
} from "@/lib/release-device-controls";
import { AccessDialog } from "@/components/AccessDialog";
import type { ReadinessState, SecurityLogLevel, TelemetryQueryState } from "./types";

const groupStyle = { border: 0, borderRadius: "var(--radius-container)", minWidth: 0 };
const wrapText = { overflowWrap: "anywhere" as const };

function PermissionLine({
  label,
  status,
  description,
}: {
  label: string;
  status: ReadinessState["camera"];
  description: string;
}) {
  return (
    <ListItem
      style={{ paddingInline: 0 }}
      label={
        <HStack as="span" gap={2} justify="between" align="center" wrap="wrap">
          <Text weight="medium">{label}</Text>
          <Token
            label={status === "ok" ? "Ready" : status === "fail" ? "Check access" : "Checking"}
            color={status === "ok" ? "green" : status === "fail" ? "yellow" : "gray"}
            size="sm"
          />
        </HStack>
      }
      description={
        <Text type="supporting" style={wrapText}>
          {description}
        </Text>
      }
    />
  );
}

const RestoreLockdownCard = memo(function RestoreLockdownCard({
  platform,
  onSecurityEvent,
}: {
  platform: string | null;
  onSecurityEvent: (event: string, level?: SecurityLogLevel) => void;
}) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  // A copyable escape for the one platform where relaunching cannot help.
  const [manualCommand, setManualCommand] = useState<string | null>(null);
  // macOS: the settings lockdown changed that are still not back, each with
  // the exact command that puts it back. The app keeps retrying on its own;
  // this is what the candidate can do meanwhile.
  const pendingRecoveryRef = useRef(
    typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("restore") === "pending"
  );
  const unknownRecovery: RestoreStatus = {
    pending: true,
    items: [
      {
        label:
          "Previous device restoration was not verified. Retry restoration to check all controls.",
        fix_command: "",
      },
    ],
  };
  const [unrestored, setUnrestored] = useState<RestoreStatus | null>(() => {
    const previous = getLastReleaseResult();
    return previous
      ? releaseRestoreStatus(previous)
      : pendingRecoveryRef.current
        ? unknownRecovery
        : null;
  });
  const restoringRef = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardResult, setDiscardResult] = useState<{
    status: "success" | "error";
    detail: string;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    const accept = (next: RestoreStatus | null) => {
      const previous = getLastReleaseResult();
      const unresolved = previous
        ? releaseRestoreStatus(previous)
        : pendingRecoveryRef.current
          ? unknownRecovery
          : null;
      if (!disposed) setUnrestored(unresolved ?? (next?.pending ? next : null));
    };
    invoke<RestoreStatus>("get_lockdown_restore_status")
      .then(accept)
      .catch(() => {});
    const unlisten = listen<RestoreStatus>("lockdown-restore-status", accept).catch(() => null);
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  async function retryRestore() {
    setRetrying(true);
    try {
      await restore();
    } finally {
      setRetrying(false);
    }
  }

  async function restore() {
    if (restoringRef.current) return;
    restoringRef.current = true;
    setStatus("working");
    setDetail(null);
    setManualCommand(null);
    try {
      const result = await releaseDeviceControls();
      setUnrestored(releaseRestoreStatus(result));
      if (result.outcome === "confirmed") {
        pendingRecoveryRef.current = false;
        setStatus("done");
        setDetail(
          "The app confirmed restoration of its window, desktop, keyboard and network controls."
        );
        onSecurityEvent("RECOVERY: device controls restored");
      } else {
        setStatus("error");
        if (result.steps.some((step) => step.id === "network" && step.state !== "confirmed"))
          setManualCommand(manualRecoveryCommand(platform));
        setDetail(
          result.outcome === "browser"
            ? "Recovery is only available inside the AMS Access desktop app."
            : "Some device controls could not be verified as restored. A timed-out native operation may still be running. Retry restoration or ask an invigilator for help."
        );
        onSecurityEvent("RECOVERY: device restoration unverified", "warn");
      }
    } catch {
      setStatus("error");
      setDetail(
        "Device restoration could not be verified. Retry or use the app's normal Quit control."
      );
    } finally {
      restoringRef.current = false;
    }
  }

  async function discardKeyboardRecovery() {
    setDiscarding(true);
    setDiscardResult(null);
    try {
      await invoke("discard_keyboard_recovery");
      const remaining = await invoke<RestoreStatus>("get_lockdown_restore_status").catch(
        () => null
      );
      const lastRelease = getLastReleaseResult();
      setUnrestored(
        (lastRelease
          ? releaseRestoreStatus(lastRelease)
          : pendingRecoveryRef.current
            ? unknownRecovery
            : null) ?? (remaining?.pending ? remaining : null)
      );
      setDiscardOpen(false);
      setDiscardResult({
        status: "success",
        detail: remaining?.pending
          ? "The saved keyboard recovery was archived and will no longer be used to restore prior settings. Your current keyboard settings were not changed. Other recovery work is still pending."
          : "The saved keyboard recovery was archived and will no longer be used to restore prior settings. Your current keyboard settings were not changed.",
      });
      onSecurityEvent("RECOVERY: saved Linux keyboard recovery discarded", "warn");
    } catch {
      setDiscardResult({
        status: "error",
        detail:
          "AMS Access could not discard the saved keyboard recovery record. Try restoring again or ask an invigilator for help.",
      });
      onSecurityEvent("RECOVERY: discard saved Linux keyboard recovery failed", "warn");
    } finally {
      setDiscarding(false);
    }
  }

  const working = status === "working";

  return (
    <Card padding={6} style={groupStyle} aria-labelledby="settings-recovery-heading">
      <VStack gap={4}>
        <VStack gap={2}>
          <Heading level={4} accessibilityLevel={2} id="settings-recovery-heading">
            Restore device after a contest
          </Heading>
          <Text type="supporting">
            If a session ended unexpectedly, restore keyboard shortcuts, screen sleep, and network
            access. On macOS, this also restores trackpad gestures.
          </Text>
        </VStack>
        <HStack>
          <Button
            label={working ? "Restoring..." : "Restore system settings"}
            variant="secondary"
            onClick={() => void restore()}
            isDisabled={working}
            isLoading={working}
          />
        </HStack>
        {detail && (
          <Banner
            status={status === "done" ? "success" : "error"}
            title={status === "done" ? "Device settings restored" : "Could not restore device"}
            description={detail}
          />
        )}
        {manualCommand && (
          <CodeBlock
            code={manualCommand}
            language="plaintext"
            title="Manual network recovery command"
            hasCopyButton={false}
            isWrapped
            size="sm"
            width="100%"
            style={{ userSelect: "text" }}
          />
        )}
        {unrestored && (
          <VStack gap={3}>
            <Banner
              status="warning"
              title="Some settings are still changed"
              description={
                platform === "windows"
                  ? "Some Windows settings could not be restored. Select Try again to retry. Changes made outside AMS Access will not be overwritten."
                  : "AMS Access keeps retrying in the background. To fix one yourself, paste its command into Terminal."
              }
            />
            <List hasDividers aria-label="Settings not yet restored">
              {unrestored.items.map((item) => (
                <ListItem
                  key={item.label + item.fix_command}
                  style={{ paddingInline: 0 }}
                  label={<Text weight="medium">{item.label}</Text>}
                  description={
                    <CodeBlock
                      code={item.fix_command}
                      language="plaintext"
                      hasCopyButton
                      isWrapped
                      size="sm"
                      width="100%"
                      style={{ userSelect: "text" }}
                    />
                  }
                />
              ))}
            </List>
            <HStack>
              <Button
                label={retrying ? "Retrying..." : "Try again"}
                variant="secondary"
                onClick={() => void retryRestore()}
                isDisabled={retrying}
                isLoading={retrying}
              />
              {platform === "linux" && (
                <Button
                  label="Discard saved keyboard recovery"
                  variant="ghost"
                  onClick={() => setDiscardOpen(true)}
                  isDisabled={retrying || discarding}
                />
              )}
            </HStack>
          </VStack>
        )}
        {discardResult && (
          <Banner
            status={discardResult.status}
            title={
              discardResult.status === "success"
                ? "Saved keyboard recovery discarded"
                : "Could not discard keyboard recovery"
            }
            description={discardResult.detail}
          />
        )}
      </VStack>
      <AccessDialog
        open={discardOpen}
        onClose={() => {
          if (!discarding) setDiscardOpen(false);
        }}
        labelId="discard-keyboard-recovery-title"
        title="Discard saved keyboard recovery?"
        width="calc(var(--spacing-10) * 12)"
      >
        <VStack gap={5}>
          <Text color="secondary">
            AMS Access will stop trying to restore the prior Linux keyboard settings. Your current
            keyboard settings will stay as they are, and the recovery evidence will be archived.
            This does not clear firewall recovery or change any contest session.
          </Text>
          <HStack gap={3} justify="end" wrap="wrap">
            <Button
              label="Keep recovery and try again"
              variant="ghost"
              onClick={() => setDiscardOpen(false)}
              isDisabled={discarding}
            />
            <Button
              label={discarding ? "Discarding..." : "Discard keyboard recovery"}
              variant="destructive"
              onClick={() => void discardKeyboardRecovery()}
              isDisabled={discarding}
              isLoading={discarding}
            />
          </HStack>
        </VStack>
      </AccessDialog>
    </Card>
  );
});

export function SettingsPermissions({
  readiness,
  platform,
  onSecurityEvent,
}: {
  readiness: ReadinessState;
  platform: string | null;
  onSecurityEvent: (event: string, level?: SecurityLogLevel) => void;
}) {
  return (
    <VStack gap={6} data-settings-section="permissions">
      <Card padding={6} style={groupStyle} aria-labelledby="settings-permissions-heading">
        <VStack gap={4}>
          <VStack gap={2}>
            <Heading level={4} accessibilityLevel={2} id="settings-permissions-heading">
              Device access
            </Heading>
            <Text type="supporting">
              Access reflects your latest device checks. Use Hardware to test your camera and
              microphone.
            </Text>
          </VStack>
          <List hasDividers density="spacious" aria-label="Device access checks">
            <PermissionLine
              label="Camera"
              status={readiness.camera}
              description="Used for identity and camera checks during a proctored contest."
            />
            <PermissionLine
              label="Microphone"
              status={readiness.mic}
              description="Used for audio monitoring when required by your contest."
            />
            <ListItem
              style={{ paddingInline: 0 }}
              label={<Text weight="medium">Desktop prompts</Text>}
              description={
                <Text type="supporting">
                  The app shows setup and lockdown messages as needed. System notification
                  permission is not checked here.
                </Text>
              }
            />
          </List>
        </VStack>
      </Card>
      <RestoreLockdownCard platform={platform} onSecurityEvent={onSecurityEvent} />
    </VStack>
  );
}

function SecurityInfoRow({
  label,
  value,
  secure,
  loading,
  unavailableLabel,
}: {
  label: string;
  value: string;
  secure: boolean | null;
  loading: boolean;
  unavailableLabel?: string;
}) {
  return (
    <ListItem
      style={{ paddingInline: 0 }}
      label={
        <Text weight="medium" style={wrapText}>
          {label}
        </Text>
      }
      description={
        <Text type="supporting" style={wrapText}>
          {value}
        </Text>
      }
      endContent={
        <Token
          size="sm"
          label={
            secure === null
              ? (unavailableLabel ?? (loading ? "Checking" : "Unavailable"))
              : secure
                ? "Passed"
                : "Review"
          }
          color={secure === null ? "gray" : secure ? "green" : "yellow"}
        />
      }
    />
  );
}

export function SettingsSecurity({
  telemetry,
  lastScannedLabel,
  onScan,
}: {
  telemetry: TelemetryQueryState;
  lastScannedLabel: string;
  onScan: () => void;
}) {
  const {
    platform: platformInfo,
    env: securityEnv,
    processes: processScan,
    network: networkCheck,
    isLoading: securityBusy,
  } = telemetry;
  const isWindows = !!platformInfo?.os?.toLowerCase().startsWith("windows");
  const isLinux = platformInfo?.os?.toLowerCase() === "linux";
  const networkNotChecked = !networkCheck && telemetry.lastScannedAt !== null;
  // One message for every item was only correct back when one probe failing
  // failed them all. The scan is partial now, so an item is missing for its
  // own reason -- and "retry" is the wrong advice for a probe this machine
  // cannot run, which is what made the old message worse than silence.
  const unavailable = securityBusy
    ? "Checking native device information"
    : telemetry.error
      ? "The scan could not complete. Run it again to retry."
      : telemetry.lastScannedAt !== null
        ? "This check did not run on this device."
        : "Run a scan to check this device.";

  return (
    <VStack gap={6} data-settings-section="security">
      <HStack gap={4} justify="between" align="center" wrap="wrap">
        <VStack gap={1}>
          <Heading level={4} accessibilityLevel={2}>
            Security checks
          </Heading>
          <Text type="supporting">
            {telemetry.lastScannedAt === null
              ? "Not scanned yet"
              : `Last scanned: ${lastScannedLabel}`}
          </Text>
        </VStack>
        <Button
          label={securityBusy ? "Scanning..." : "Run native scan"}
          variant="secondary"
          onClick={onScan}
          isDisabled={securityBusy}
          isLoading={securityBusy}
        />
      </HStack>
      {telemetry.error && (
        <Banner
          status="warning"
          title="Some checks are unavailable"
          description={
            telemetry.lastScannedAt !== null
              ? `Showing the last available results. Run another scan to refresh them. ${telemetry.error}`
              : telemetry.error
          }
        />
      )}
      {!telemetry.error && telemetry.scanErrors.length > 0 && (
        <Banner
          status="warning"
          title={
            telemetry.scanErrors.length === 1
              ? "One check could not run"
              : `${telemetry.scanErrors.length} checks could not run`
          }
          description={`Everything else scanned normally. ${telemetry.scanErrors.join("; ")}.`}
        />
      )}
      <HStack gap={6} align="start" wrap="wrap">
        <Card
          padding={6}
          style={{ ...groupStyle, flex: "3 1 calc(var(--spacing-10) * 9)" }}
          aria-labelledby="settings-environment-heading"
        >
          <VStack gap={4}>
            <Heading level={4} accessibilityLevel={3} id="settings-environment-heading">
              Device environment
            </Heading>
            <MetadataList label={{ position: "top" }}>
              <MetadataListItem label="Operating system">
                <Text style={wrapText}>
                  {platformInfo ? `${platformInfo.os} / ${platformInfo.arch}` : unavailable}
                </Text>
              </MetadataListItem>
              <MetadataListItem label="Display / webview session">
                <Text style={wrapText}>{securityEnv?.display_server ?? unavailable}</Text>
              </MetadataListItem>
            </MetadataList>
            <List hasDividers density="spacious" aria-label="Security environment results">
              <SecurityInfoRow
                label={isWindows ? "Debugger/injection profile" : "Startup injection check"}
                value={
                  securityEnv
                    ? securityEnv.ld_preload_injection
                      ? "Needs attention"
                      : "Clean"
                    : unavailable
                }
                secure={securityEnv ? !securityEnv.ld_preload_injection : null}
                loading={securityBusy}
              />
              {isLinux && (
                <SecurityInfoRow
                  label="Linux ptrace scope"
                  value={securityEnv ? `ptrace_scope ${securityEnv.ptrace_scope}` : unavailable}
                  secure={securityEnv ? securityEnv.ptrace_scope > 0 : null}
                  loading={securityBusy}
                />
              )}
              <SecurityInfoRow
                label="Network reachability"
                value={
                  networkCheck
                    ? networkCheck.reachable
                      ? `${networkCheck.quality} (${networkCheck.latency_ms ?? "?"}ms)`
                      : "Unreachable"
                    : networkNotChecked
                      ? "This scan does not include a network probe."
                      : unavailable
                }
                secure={networkCheck ? networkCheck.reachable : null}
                loading={securityBusy}
                unavailableLabel={networkNotChecked ? "Not checked" : undefined}
              />
            </List>
          </VStack>
        </Card>
        <Card
          padding={6}
          style={{ ...groupStyle, flex: "2 1 calc(var(--spacing-10) * 8)" }}
          aria-labelledby="settings-processes-heading"
        >
          <VStack gap={4}>
            <VStack gap={2}>
              <Heading level={4} accessibilityLevel={3} id="settings-processes-heading">
                Restricted apps
              </Heading>
              <Text type="supporting">
                Close restricted apps before joining a contest, then scan again.
              </Text>
            </VStack>
            <HStack>
              <Token
                label={
                  !processScan
                    ? securityBusy
                      ? "Checking"
                      : "Not available"
                    : processScan.clean
                      ? "No restricted apps found"
                      : "Action needed"
                }
                color={!processScan ? "gray" : processScan.clean ? "green" : "yellow"}
                size="sm"
              />
            </HStack>
            {!!processScan?.found.length && (
              <List hasDividers density="balanced" aria-label="Restricted apps found">
                {processScan.found.map((name, i) => (
                  <ListItem
                    key={`${name}-${i}`}
                    style={{ paddingInline: 0 }}
                    label={<Text style={wrapText}>{name}</Text>}
                  />
                ))}
              </List>
            )}
            <Text type="supporting">
              {processScan
                ? processScan.clean
                  ? "No restricted processes were found in the latest native scan."
                  : "Close the flagged apps and run the scan again before joining a session."
                : securityBusy
                  ? "Checking the apps running on your device."
                  : "Run a native scan to populate the restricted process result."}
            </Text>
          </VStack>
        </Card>
      </HStack>
    </VStack>
  );
}

export function SettingsAbout() {
  const { version } = useAppVersion();

  return (
    <Card
      padding={6}
      maxWidth="calc(var(--spacing-10) * 18)"
      style={groupStyle}
      aria-labelledby="settings-about-heading"
      data-settings-section="about"
    >
      <VStack gap={5}>
        <VStack gap={2}>
          <Heading level={4} accessibilityLevel={2} id="settings-about-heading">
            About AMS Access
          </Heading>
          <Text type="supporting">
            AMS Access helps verify your identity, check your device, and keep the contest
            environment ready before and during your contests.
          </Text>
        </VStack>
        <MetadataList>
          <MetadataListItem label="App version">{version ?? "Not available"}</MetadataListItem>
        </MetadataList>
        <List hasDividers density="spacious" aria-label="Policies and licenses">
          {[
            {
              label: "Privacy Policy",
              url: "/privacy",
              description: "How your information is handled.",
            },
            {
              label: "Terms of Service",
              url: "/terms",
              description: "Terms for using AMS Access.",
            },
            {
              label: "Open Source Licenses",
              url: "/licenses",
              description: "Licenses for the software used in this app.",
            },
          ].map((item) => (
            <ListItem
              key={item.url}
              href={item.url}
              label={item.label}
              description={<Text type="supporting">{item.description}</Text>}
              style={{ paddingInline: 0 }}
            />
          ))}
        </List>
      </VStack>
    </Card>
  );
}
