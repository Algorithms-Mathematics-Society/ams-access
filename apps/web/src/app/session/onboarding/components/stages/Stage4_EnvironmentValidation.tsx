import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

interface WindowsCaptureStatus {
  status: "exclusion" | "monitor_fallback" | "failed";
  reason: string;
}

export function Stage4_EnvironmentValidation({ onPass }: { onPass(): void }) {
  interface Check {
    label: string;
    status: "checking" | "pass" | "warn";
  }
  const [checks, setChecks] = useState<Check[]>([]);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function pushCheck(label: string) {
      if (!cancelled) setChecks((prev) => [...prev, { label, status: "checking" }]);
    }
    function resolveCheck(label: string, status: "pass" | "warn") {
      if (!cancelled)
        setChecks((prev) => prev.map((c) => (c.label === label ? { ...c, status } : c)));
    }

    async function runChecks() {
      await new Promise((r) => setTimeout(r, 100));

      pushCheck("Display settings");
      await new Promise((r) => setTimeout(r, 300));
      const singleScreen = window.screen.width === window.screen.availWidth;
      resolveCheck("Display settings", singleScreen ? "pass" : "warn");

      pushCheck("Full-screen mode");
      await new Promise((r) => setTimeout(r, 200));
      const isFs =
        !!document.fullscreenElement || window.innerHeight >= window.screen.height * 0.94;
      resolveCheck("Full-screen mode", isFs ? "pass" : "warn");

      pushCheck("Keyboard controls");
      const kbr = await withNullableTimeout(
        invoke<{ active: boolean }>("enable_keyboard_intercept"),
        2500
      );
      resolveCheck("Keyboard controls", kbr?.active ? "pass" : "warn");

      pushCheck("Screen capture guard");
      if (navigator.platform.toLowerCase().startsWith("win")) {
        const capture = await withNullableTimeout(
          invoke<WindowsCaptureStatus>("get_windows_capture_protection_status"),
          2500
        );
        if (!cancelled) {
          setCaptureMessage(
            capture?.status === "exclusion"
              ? `Exclusion requested. ${capture.reason}`
              : capture?.status === "monitor_fallback"
                ? `Limited monitor fallback. ${capture.reason}`
                : `Capture protection failed. ${capture?.reason ?? "Status unavailable or timed out"}`
          );
        }
        resolveCheck("Screen capture guard", capture?.status === "exclusion" ? "pass" : "warn");
      } else {
        const capture = await withNullableTimeout(
          invoke<boolean>("apply_capture_protection"),
          2500
        );
        resolveCheck("Screen capture guard", capture === true ? "pass" : "warn");
      }

      // "Session baseline" is gone. It slept 300 ms and passed; there was no
      // baseline, and nothing anywhere else in the codebase referred to one.

      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) onPass();
    }

    void runChecks();
    return () => {
      cancelled = true;
    };
  }, [onPass]);

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Setup verification" />
      <Text color="secondary">
        We’re confirming your display, keyboard and screen capture settings before continuing.
      </Text>
      <VStack gap={2}>
        {checks.map((c) => (
          <CheckLine key={c.label} label={c.label} status={c.status} />
        ))}
      </VStack>
      {captureMessage && (
        <Text type="supporting" color="secondary">
          {captureMessage}
        </Text>
      )}
    </VStack>
  );
}
