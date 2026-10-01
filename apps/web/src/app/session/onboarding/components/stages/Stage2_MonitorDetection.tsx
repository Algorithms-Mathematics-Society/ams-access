import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useCallback, useEffect, useState } from "react";
import { fetchOrganizerOverrides } from "@ams/api-client";
import { CheckLine, StageHeader } from "../ui";
import { API_URL, availableMonitors, getOrCreateDeviceId, type MonitorInfo } from "../../support";
import { participantToken } from "@/lib/candidate-auth";

export function Stage2_MonitorDetection({
  onPass,
  platform,
  externalDisplayOverride,
}: {
  onPass(): void;
  /** Authoritative device platform ("windows" | "macos" | "linux" | null). */
  platform: string | null;
  /** True when an organizer has waived the `external_display` check for this device. */
  externalDisplayOverride: boolean;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanIndeterminate, setScanIndeterminate] = useState(false);

  // Windows-only hard-block: a second / wireless display is a contest-integrity
  // violation we enforce at the gate (mirrors the `external_display` block in
  // core-rs). On macOS/Linux — or when an organizer override is present — this
  // stays an advisory warning so behavior off-Windows is unchanged.
  const isWindows = platform?.toLowerCase().startsWith("windows") ?? false;
  const multiDisplay = monitors.length > 1;
  const hardBlock = isWindows && multiDisplay && !externalDisplayOverride;

  const runDetection = useCallback(async () => {
    setScanning(true);
    setDone(false);

    // `null` means we could not ask; `[]` means we asked and got nothing.
    // Only the first is a failure to verify. They used to be the same value,
    // which is how a broken API call became a candidate-facing hard block.
    const mons = await Promise.race([
      availableMonitors(),
      new Promise<MonitorInfo[] | null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]).catch(() => null);

    // Windows fail-closed: an enumeration we could not perform is "could not
    // verify", NOT a single screen. Off-Windows (or with an organizer
    // override) keep the advisory synthetic-single fallback so macOS/Linux
    // behavior is unchanged.
    const enumFailed = mons === null;
    const indeterminate = isWindows && !externalDisplayOverride && enumFailed;
    setScanIndeterminate(indeterminate);

    const list =
      mons && mons.length
        ? mons
        : [
            {
              name: "Primary Display",
              position: { x: 0, y: 0 },
              size: { width: window.screen.width, height: window.screen.height },
              scaleFactor: window.devicePixelRatio,
            },
          ];
    setMonitors(list);
    setScanning(false);
    setDone(true);

    // Auto-advance only on a verified single screen. Indeterminate (Windows)
    // and multi-display both hold the candidate at this stage.
    if (!indeterminate && list.length === 1) {
      setTimeout(() => {
        onPass();
      }, 1200);
    }
  }, [onPass, isWindows, externalDisplayOverride]);

  useEffect(() => {
    void runDetection();
  }, [runDetection]);

  // Load-bearing escape: while a Windows block (indeterminate or multi-display)
  // is showing, poll organizer overrides every 10s. An `external_display` waiver
  // means this device is allowed through, so advance via onPass() (the final-
  // stage gate independently re-fetches and honors the same override at
  // page.tsx:3937, so advancing here is consistent). No-op off-Windows / once
  // unblocked. contestId is read from the URL — the same source the parent uses
  // (page.tsx ~3400); this component has no contestId prop.
  const blocked =
    isWindows && !externalDisplayOverride && (scanIndeterminate || monitors.length > 1);
  useEffect(() => {
    if (!blocked) return;
    const contestId =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("contestId")
        : null;
    if (!contestId) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const grants = await fetchOrganizerOverrides(
          API_URL,
          contestId,
          getOrCreateDeviceId(),
          participantToken() ?? ""
        );
        if (!cancelled && grants.some((g) => g.check_kind === "external_display")) {
          clearInterval(id);
          onPass(); // override is a waiver -> advance past Stage 3
        }
      } catch {
        /* transient fetch error — keep polling */
      }
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [blocked, onPass]);

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Display check" />
      <Text color="secondary">
        Use one screen for your contest. Disconnect extra monitors and wireless displays.
      </Text>
      <MetadataList>
        <MetadataListItem label="Primary display">
          {monitors[0]?.name ?? "Checking display"}
        </MetadataListItem>
        <MetadataListItem label="Resolution">
          {monitors[0]?.size.width ?? window.screen.width} ×{" "}
          {monitors[0]?.size.height ?? window.screen.height}
        </MetadataListItem>
        <MetadataListItem label="Color depth">{window.screen.colorDepth}-bit</MetadataListItem>
      </MetadataList>
      {!done && <CheckLine label="Checking connected displays..." status="checking" />}
      {done && (
        <VStack gap={4}>
          <CheckLine
            label={
              scanIndeterminate
                ? "Display count could not be verified"
                : `${monitors.length || 1} screen${(monitors.length || 1) > 1 ? "s" : ""} detected`
            }
            status={
              multiDisplay ? (hardBlock ? "fail" : "warn") : scanIndeterminate ? "fail" : "pass"
            }
          />
          {multiDisplay ? (
            <>
              <CheckLine
                label={
                  hardBlock
                    ? "Disconnect the second / wireless display to continue"
                    : "Multiple displays active — please disconnect external screens"
                }
                status={hardBlock ? "fail" : "warn"}
              />
              {hardBlock && (
                <Banner
                  status="error"
                  title="One screen is required"
                  description="Disconnect the extra display, then check again. Contact your proctor if you need help."
                />
              )}
              {externalDisplayOverride && (
                <CheckLine
                  label="Organizer override active — extra display permitted"
                  status="warn"
                />
              )}
              <Button
                variant="secondary"
                label={scanning ? "Checking displays..." : "Check displays again"}
                onClick={runDetection}
                isDisabled={scanning}
              />
            </>
          ) : (
            !scanIndeterminate && (
              <CheckLine label="Single screen environment confirmed" status="pass" />
            )
          )}
          {scanIndeterminate && !multiDisplay && (
            <>
              <Banner
                status="error"
                title="Could not verify your display setup"
                description="Run the check again. If it keeps failing, ask your proctor to review your setup."
              />
              <Button
                variant="secondary"
                label={scanning ? "Scanning..." : "Re-scan displays"}
                onClick={() => void runDetection()}
                isDisabled={scanning}
              />
            </>
          )}
        </VStack>
      )}
    </VStack>
  );
}
