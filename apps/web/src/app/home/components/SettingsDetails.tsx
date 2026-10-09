"use client";

import { memo, useEffect, useState } from "react";
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
import { manualRecoveryCommand, recoveryFailureMessage } from "@/lib/recovery-message";
import { useAppVersion } from "@/lib/use-app-version";
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
  const [unrestored, setUnrestored] = useState<RestoreStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let disposed = false;
    const accept = (next: RestoreStatus | null) => {
      if (!disposed) setUnrestored(next?.pending ? next : null);
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
      const next = await invoke<RestoreStatus>("retry_lockdown_restore");
      setUnrestored(next.pending ? next : null);
      if (!next.pending) {
        setStatus("done");
        setDetail("Every system setting changed for the contest has been restored.");
        setManualCommand(null);
        onSecurityEvent("RECOVERY: remaining system settings restored");
      }
    } catch {
      // The status below stays as it was; the background retry continues.
    } finally {
      setRetrying(false);
    }
  }

  async function restore() {
    setStatus("working");
    setDetail(null);
    // unlock_desktop is the important one — it restores the trackpad gesture
    // prefs and reaps caffeinate. The other two clear the keyboard intercept
    // and flush the firewall allowlist. Independent and idempotent, so run them
    // together and report on the aggregate.
    const results = await Promise.allSettled([
      invoke("unlock_desktop"),
      invoke("disable_keyboard_intercept"),
      invoke("disable_network_lockdown"),
    ]);

    const remaining = await invoke<RestoreStatus>("get_lockdown_restore_status").catch(() => null);
    setUnrestored(remaining?.pending ? remaining : null);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    // Thrown by the api-client when not running inside the desktop shell.
    if (rejected.some((r) => String(r.reason).includes("bridge unavailable"))) {
      setStatus("error");
      setDetail("Recovery is only available inside the AMS Access desktop app.");
      return;
    }
    // Settings the restore is still retrying are listed below with their fix
    // commands; the generic "relaunch" error would only repeat them less
    // usefully. Only an unlock_desktop failure is explained by that list.
    if (remaining?.pending && rejected.every((r) => r === results[0])) {
      setStatus("idle");
      setManualCommand(null);
      onSecurityEvent("RECOVERY: some system settings still pending restore", "warn");
      return;
    }
    if (rejected.length > 0) {
      setStatus("error");
      // Platform-correct, because the previous single string told a Linux
      // candidate to restart their Mac and to relaunch the app, neither of
      // which clears the firewall they are stuck behind. See recovery-message.ts.
      setDetail(recoveryFailureMessage(platform));
      setManualCommand(manualRecoveryCommand(platform));
      onSecurityEvent("RECOVERY: manual restore reported errors", "warn");
      return;
    }
    setStatus("done");
    setManualCommand(null);
    setDetail(
      "Trackpad gestures, keyboard shortcuts, screen sleep, and network access have been restored."
    );
    onSecurityEvent("RECOVERY: system settings restored by user");
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
            title="Manual recovery command"
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
              description="AMS Access keeps retrying in the background. To fix one yourself, paste its command into Terminal."
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
            </HStack>
          </VStack>
        )}
      </VStack>
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
    virt: virtScan,
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
                label="Virtualization check"
                value={
                  virtScan
                    ? virtScan.detected
                      ? `${virtScan.platform ?? "virtualized"} detected (${virtScan.confidence})`
                      : "Bare-metal signals clear"
                    : unavailable
                }
                secure={virtScan ? !virtScan.detected : null}
                loading={securityBusy}
              />
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
