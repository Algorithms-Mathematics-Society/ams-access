import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { useEffect, useState } from "react";
import { StageHeader, StatusBadge } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

/**
 * Keyboard lockdown.
 *
 * A failure here does not block entry (decision 7 — lockdown violations are
 * recorded and warned about, never auto-ejected), but it must be *recorded* as
 * a warning rather than a pass: on a desktop environment where the intercept
 * cannot engage, the candidate keeps Alt+Tab for the whole exam, and the
 * proctor reviewing the session afterwards needs to know that.
 */
export function Stage3_KeyboardLockdown({ onPass, onWarn }: { onPass(): void; onWarn(): void }) {
  const [phase, setPhase] = useState(0);
  const [lockFailed, setLockFailed] = useState(false);
  const [accessibilityDenied, setAccessibilityDenied] = useState(false);
  const [pollElapsed, setPollElapsed] = useState(0);

  const POLL_TIMEOUT_S = 60;

  // Auto-poll every 2 s while waiting for the user to grant Accessibility
  useEffect(() => {
    if (!accessibilityDenied) return;
    let elapsed = 0;
    const id = setInterval(async () => {
      elapsed += 2;
      setPollElapsed(elapsed);
      if (elapsed >= POLL_TIMEOUT_S) {
        clearInterval(id);
        return; // show manual Re-check button instead
      }
      const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
      if (result?.active) {
        clearInterval(id);
        setAccessibilityDenied(false);
        setPhase(4);
        setTimeout(onPass, 600);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [accessibilityDenied, onPass]);

  const recheck = async () => {
    setPollElapsed(0);
    const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
    if (result?.active) {
      setAccessibilityDenied(false);
      setPhase(4);
      setTimeout(onPass, 600);
    } else {
      setAccessibilityDenied(true);
    }
  };

  useEffect(() => {
    async function go() {
      setPhase(1);
      const result = await withNullableTimeout(
        invoke<{ active: boolean; method: string }>("enable_keyboard_intercept"),
        2500
      );
      // macOS hard-block: Accessibility permission required
      if (result?.method === "accessibility_denied") {
        setAccessibilityDenied(true);
        return;
      }
      const failed = result?.active !== true;
      setLockFailed(failed);
      setPhase(4);
      // Warn, not pass. The badge already said "unavailable" here while the
      // stage was recorded as a clean pass, so the final summary and the
      // proctor's record both showed keyboard lockdown green on a machine
      // where it never engaged.
      setTimeout(failed ? onWarn : onPass, 600);
    }

    function handleKey(e: KeyboardEvent) {
      const intercept = [
        e.key === "PrintScreen",
        e.altKey && e.key === "Tab",
        e.altKey && e.key === "F4",
        e.metaKey && e.key === "Tab",
        e.metaKey && e.key === "q",
        e.ctrlKey && e.altKey && e.key === "Delete",
      ];
      if (intercept.some(Boolean)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKey, true);
    void go();
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onPass, onWarn]);

  // One intercept covers all four, so they share one outcome. They used to be
  // staggered on `phase >= 1..4` — but `phase` only ever goes 0 → 1 → 4, so
  // the stagger was animation, and worse, all four rendered a green "Ready"
  // even when the intercept had failed and the badge below said so.
  const settled = phase >= 4;
  const keys = ["Alt+Tab", "Super / Win", "Alt+F4 / Cmd+Q", "PrintScreen"].map((label) => ({
    label,
    locked: settled && !lockFailed,
  }));

  // ── Accessibility denied — hard-block UI ──────────────────────────────────
  if (accessibilityDenied) {
    const timedOut = pollElapsed >= POLL_TIMEOUT_S;
    return (
      <VStack gap={6} width="100%">
        <StageHeader label="Keyboard setup" />
        <Banner
          status="warning"
          title="Allow Accessibility access"
          description="AMS Access needs Accessibility permission to restrict app switching and system shortcuts during the contest."
        />
        <Text color="secondary">
          Open System Settings and allow Accessibility access for AMS Access, then return here.
        </Text>
        <HStack gap={3} wrap="wrap">
          <Button
            variant="primary"
            label="Open System Settings"
            onClick={() => void invoke("open_accessibility_settings")}
          />
          {timedOut && (
            <Button variant="secondary" label="Re-check" onClick={() => void recheck()} />
          )}
        </HStack>
        <StatusBadge
          status="warn"
          label={
            timedOut
              ? "Grant Accessibility access, then click Re-check"
              : `Waiting for permission… checking again in ${2 - (pollElapsed % 2)}s`
          }
        />
      </VStack>
    );
  }

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Keyboard setup" />
      <Text color="secondary">
        We’re preparing shortcut controls to keep your contest workspace in focus.
      </Text>
      <MetadataList>
        {keys.map(({ label, locked }) => (
          <MetadataListItem key={label} label={label}>
            {locked ? "Ready" : settled ? "Not locked" : "Checking"}
          </MetadataListItem>
        ))}
      </MetadataList>
      <StatusBadge
        status={phase >= 4 ? (lockFailed ? "warn" : "pass") : "checking"}
        label={
          phase >= 4
            ? lockFailed
              ? "Keyboard lock unavailable on this desktop environment"
              : "Keyboard controls active"
            : "Setting up keyboard controls..."
        }
      />
    </VStack>
  );
}
