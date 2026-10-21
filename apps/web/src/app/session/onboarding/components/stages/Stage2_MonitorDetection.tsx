import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOrganizerOverrides,
  type OrganizerOverride,
  type SessionPolicy,
} from "@ams/api-client";
import { displayObservation } from "../../display-check";
import { readinessAction, type ReadinessObservation } from "../../readiness-action";
import { CheckLine, StageHeader } from "../ui";
import { API_URL, availableMonitors, getOrCreateDeviceId, type MonitorInfo } from "../../support";
import { participantToken } from "@/lib/candidate-auth";

export function Stage2_MonitorDetection({
  onPass,
  policy,
  overrideActive,
  onWarn,
  onOverridesChanged,
}: {
  onPass(): void;
  onWarn(detail: string): void;
  policy: SessionPolicy | null;
  overrideActive: boolean;
  onOverridesChanged(grants: OrganizerOverride[]): void;
}) {
  const [monitors, setMonitors] = useState<MonitorInfo[] | null>(null);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanIndeterminate, setScanIndeterminate] = useState(false);
  const [observation, setObservation] = useState<ReadinessObservation>("probe_unavailable");

  const action = readinessAction(policy, "external_display", observation);
  const multiDisplay = (monitors?.length ?? 0) > 1;
  const generationRef = useRef(0);
  const advancedRef = useRef(false);
  const passTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const cancelPass = () => {
    if (passTimerRef.current !== null) clearTimeout(passTimerRef.current);
    passTimerRef.current = null;
  };
  const hardBlock = done && action.decision === "block";

  const runDetection = useCallback(async () => {
    const generation = ++generationRef.current;
    advancedRef.current = false;
    cancelPass();
    setScanning(true);
    setDone(false);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const mons = await Promise.race([
      availableMonitors(),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 2000);
      }),
    ])
      .catch(() => null)
      .finally(() => clearTimeout(timeout));
    if (generationRef.current !== generation) return;
    // Preserve null as unavailable. An empty successful Tauri enumeration keeps
    // the established Windows primary-display contract; thrown/time-out probes
    // arrive as null and remain fail-closed under strict Windows policy.
    const nextObservation = displayObservation(mons);
    setObservation(nextObservation);
    setScanIndeterminate(mons === null);
    setMonitors(mons);
    setScanning(false);
    setDone(true);
    if (
      readinessAction(policyRef.current, "external_display", nextObservation).decision === "pass"
    ) {
      passTimerRef.current = setTimeout(() => {
        if (generationRef.current !== generation || advancedRef.current) return;
        if (
          readinessAction(policyRef.current, "external_display", nextObservation).decision !==
          "pass"
        )
          return;
        advancedRef.current = true;
        onPass();
      }, 1200);
    }
  }, [onPass, policy]);

  useEffect(() => {
    void runDetection();
    return () => {
      generationRef.current += 1;
      cancelPass();
    };
  }, [runDetection]);

  // Fetch only authoritative organizer grants; parent recomputes policy.
  // A grant does not change what this scan observed or imply a verified pass.
  const blocked = done && action.decision === "block";
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
          onOverridesChanged(grants);
        }
      } catch {
        /* transient fetch error — keep polling */
      }
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [blocked, onOverridesChanged]);

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Display check" />
      <Text color="secondary">
        Use one screen for your contest. Disconnect extra monitors and wireless displays.
      </Text>
      <MetadataList>
        <MetadataListItem label="Primary display">
          {monitors?.[0]?.name ??
            (done ? (monitors === null ? "Not verified" : "Primary Display") : "Checking display")}
        </MetadataListItem>
        <MetadataListItem label="Resolution">
          {monitors?.[0]?.size.width ?? (monitors === null ? "—" : window.screen.width)} ×{" "}
          {monitors?.[0]?.size.height ?? (monitors === null ? "—" : window.screen.height)}
        </MetadataListItem>
        <MetadataListItem label="Color depth">{window.screen.colorDepth}-bit</MetadataListItem>
      </MetadataList>
      {!done && <CheckLine label="Checking connected displays..." status="checking" />}
      {done && (
        <VStack gap={4}>
          <CheckLine
            label={
              scanIndeterminate
                ? monitors === null
                  ? "Display count could not be verified"
                  : "No displays returned by the scan"
                : `${Math.max(monitors?.length ?? 0, 1)} screen${(monitors?.length ?? 0) > 1 ? "s" : ""} detected`
            }
            status={
              action.decision === "pending"
                ? "checking"
                : action.decision === "block"
                  ? "fail"
                  : action.decision === "warn"
                    ? "warn"
                    : "pass"
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
              {overrideActive && (
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
          {action.decision === "warn" && (
            <Button
              variant="secondary"
              label={overrideActive ? "Continue with organizer approval" : "Continue with warning"}
              onClick={() => {
                if (
                  advancedRef.current ||
                  scanning ||
                  readinessAction(policyRef.current, "external_display", observation).decision !==
                    "warn"
                )
                  return;
                advancedRef.current = true;
                generationRef.current += 1;
                cancelPass();
                onWarn(
                  scanIndeterminate
                    ? "Display count could not be verified."
                    : "Multiple displays were detected."
                );
              }}
            />
          )}
        </VStack>
      )}
    </VStack>
  );
}
