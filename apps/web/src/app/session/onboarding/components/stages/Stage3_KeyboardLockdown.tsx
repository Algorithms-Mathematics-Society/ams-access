import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { useCallback, useEffect, useRef, useState } from "react";
import { StageHeader, StatusBadge } from "../ui";
import { invoke, withNullableTimeout } from "../../support";
import {
  classifyKeyboardOutcome,
  type KeyboardInterceptResult,
  type KeyboardOutcome,
} from "../../keyboard-outcome";

const KEYBOARD_PROBE_ENVELOPE_MS = 40_000;
const POLL_TIMEOUT_S = 60;

function outcomeCopy(kind: KeyboardOutcome["kind"]) {
  if (kind === "linux_control_checked")
    return {
      title: "Shortcut controls checked and restored",
      description:
        "AMS Access temporarily applied and restored the desktop controls it could verify. This check does not prove every system shortcut is blocked. Setup records a warning, and contest entry applies the available controls again.",
      status: "Shortcut coverage checked — review required",
    };
  if (kind === "detection_only")
    return {
      title: "Shortcut detection only",
      description:
        "AMS Access can detect some activity on this desktop, but could not verify compositor-level shortcut control. Continue with the recorded warning.",
      status: "Shortcut blocking not verified",
    };
  if (kind === "unsupported")
    return {
      title: "Shortcut control unsupported",
      description:
        "AMS Access does not have a verified shortcut-control adapter for this desktop environment. Continue with the recorded warning.",
      status: "Shortcut control unsupported on this desktop",
    };
  return {
    title: "Keyboard check unavailable",
    description:
      "The keyboard-control probe did not complete. Any partial probe cleanup remains owned by the desktop service. Continue with the recorded warning.",
    status: "Keyboard controls could not be verified",
  };
}

/**
 * The native command owns the probe and restoration. The 40-second frontend
 * envelope is a presentation safeguard around its 20-second admission guard;
 * timing out here never starts another overlapping probe.
 */
export function Stage3_KeyboardLockdown({
  onPass,
  onWarn,
  onQuitAndReopen,
}: {
  onPass(): void;
  onWarn(): void;
  /** macOS applies some grants only to a new process. */
  onQuitAndReopen?(): void;
}) {
  const [phase, setPhase] = useState(0);
  const [outcome, setOutcome] = useState<KeyboardOutcome | null>(null);
  const [accessibilityDenied, setAccessibilityDenied] = useState(false);
  const [missingPermission, setMissingPermission] = useState<"accessibility" | "input_monitoring">(
    "accessibility"
  );
  const [pollElapsed, setPollElapsed] = useState(0);
  const [pollRound, setPollRound] = useState(0);
  const pendingProbeRef = useRef<Promise<KeyboardInterceptResult | null> | null>(null);
  const generationRef = useRef(0);
  const permissionGenerationRef = useRef(0);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runProbe = useCallback(() => {
    if (pendingProbeRef.current) return pendingProbeRef.current;
    const pending = invoke<KeyboardInterceptResult>("enable_keyboard_intercept");
    pendingProbeRef.current = pending;
    void pending.finally(() => {
      if (pendingProbeRef.current === pending) pendingProbeRef.current = null;
    });
    return pending;
  }, []);

  const clearAdvance = () => {
    if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = null;
  };

  const scheduleAdvance = useCallback(
    (shouldPass: boolean) => {
      clearAdvance();
      advanceTimerRef.current = setTimeout(shouldPass ? onPass : onWarn, 600);
    },
    [onPass, onWarn]
  );

  useEffect(() => {
    if (!accessibilityDenied) return;
    const generation = ++permissionGenerationRef.current;
    let elapsed = 0;
    let stopped = false;
    let inFlight = false;
    const id = setInterval(() => {
      elapsed += 2;
      setPollElapsed(elapsed);
      if (elapsed >= POLL_TIMEOUT_S) {
        clearInterval(id);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      const ownedProbe = runProbe();
      void withNullableTimeout(ownedProbe, KEYBOARD_PROBE_ENVELOPE_MS).then((result) => {
        inFlight = false;
        if (stopped || permissionGenerationRef.current !== generation) return;
        const next = classifyKeyboardOutcome(result);
        if (next.kind === "permission") {
          setMissingPermission(next.permission);
          return;
        }
        if (next.shouldPass) {
          stopped = true;
          clearInterval(id);
          setAccessibilityDenied(false);
          setOutcome(next);
          setPhase(4);
          scheduleAdvance(true);
        }
      });
    }, 2000);
    return () => {
      stopped = true;
      permissionGenerationRef.current += 1;
      clearInterval(id);
    };
  }, [accessibilityDenied, pollRound, runProbe, scheduleAdvance]);

  const recheck = () => {
    setPollElapsed(0);
    setPollRound((round) => round + 1);
  };

  useEffect(() => {
    const generation = ++generationRef.current;
    setPhase(1);
    const ownedProbe = runProbe();
    void withNullableTimeout(ownedProbe, KEYBOARD_PROBE_ENVELOPE_MS).then((result) => {
      if (generationRef.current !== generation) return;
      const next = classifyKeyboardOutcome(result);
      if (next.kind === "permission") {
        setMissingPermission(next.permission);
        setAccessibilityDenied(true);
        return;
      }
      setOutcome(next);
      setPhase(4);
      scheduleAdvance(next.shouldPass);
    });

    function handleKey(event: KeyboardEvent) {
      const intercept = [
        event.key === "PrintScreen",
        event.altKey && event.key === "Tab",
        event.altKey && event.key === "F4",
        event.metaKey && event.key === "Tab",
        event.metaKey && event.key === "q",
        event.ctrlKey && event.altKey && event.key === "Delete",
      ];
      if (intercept.some(Boolean)) event.preventDefault();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => {
      generationRef.current += 1;
      clearAdvance();
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [runProbe, scheduleAdvance]);

  if (accessibilityDenied) {
    const timedOut = pollElapsed >= POLL_TIMEOUT_S;
    const paneName =
      missingPermission === "input_monitoring" ? "Input Monitoring" : "Accessibility";
    return (
      <VStack gap={6} width="100%">
        <StageHeader label="Keyboard setup" />
        <Banner
          status="warning"
          title={`Allow ${paneName} access`}
          description={`AMS Access needs ${paneName} permission to restrict app switching and system shortcuts during the contest.`}
        />
        <VStack gap={2}>
          <Text color="secondary">1. Select Open System Settings below.</Text>
          <Text color="secondary">
            2. In Privacy &amp; Security → {paneName}, turn on AMS Access. If it is not listed,
            select +, choose AMS Access from Applications, and turn it on.
          </Text>
          <Text color="secondary">
            3. Come back here. The check runs again automatically every few seconds. If it still
            fails, quit and reopen AMS Access so macOS applies the permission.
          </Text>
          <Text color="secondary">
            If AMS Access is already switched on, select it, click –, add it again with +, then quit
            and reopen.
          </Text>
        </VStack>
        <HStack gap={3} wrap="wrap">
          <Button
            variant="primary"
            label="Open System Settings"
            onClick={() => void invoke("open_privacy_settings", { section: missingPermission })}
          />
          {onQuitAndReopen && (
            <Button
              variant="secondary"
              label="Quit & reopen AMS Access"
              onClick={onQuitAndReopen}
            />
          )}
          {timedOut && <Button variant="secondary" label="Re-check" onClick={recheck} />}
        </HStack>
        <StatusBadge
          status="warn"
          label={
            timedOut
              ? `Grant ${paneName} access, then click Re-check`
              : `Waiting for permission… checking again in ${2 - (pollElapsed % 2)}s`
          }
        />
      </VStack>
    );
  }

  const settled = phase >= 4;
  const isControlActive = outcome?.kind === "control_active";
  const detail =
    outcome && !outcome.shouldPass && outcome.kind !== "permission"
      ? outcomeCopy(outcome.kind)
      : null;
  const itemValue = isControlActive
    ? "Ready"
    : outcome?.kind === "linux_control_checked"
      ? "Not individually verified"
      : outcome?.kind === "detection_only"
        ? "Detection only"
        : settled
          ? "Not controlled"
          : "Checking";

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Keyboard setup" />
      <Text color="secondary">
        We’re checking shortcut controls for this desktop. The contest applies available controls
        again when secure entry starts.
      </Text>
      {detail && <Banner status="warning" title={detail.title} description={detail.description} />}
      <MetadataList>
        {["Alt+Tab", "Super / Win", "Alt+F4 / Cmd+Q", "PrintScreen"].map((label) => (
          <MetadataListItem key={label} label={label}>
            {itemValue}
          </MetadataListItem>
        ))}
      </MetadataList>
      <StatusBadge
        status={settled ? (isControlActive ? "pass" : "warn") : "checking"}
        label={
          settled
            ? isControlActive
              ? "Keyboard controls active"
              : (detail?.status ?? "Keyboard controls could not be verified")
            : "Checking keyboard-control coverage…"
        }
      />
    </VStack>
  );
}
