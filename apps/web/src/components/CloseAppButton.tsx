"use client";

import { useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack, HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { AccessDialog } from "@/components/AccessDialog";
import {
  releaseDeviceControls,
  releaseRestoreStatus,
  type LocalReleaseResult,
} from "@/lib/release-device-controls";

/** Normal native close retains the existing shutdown coordinator. Never kills the process. */
export function CloseAppButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<LocalReleaseResult | null>(null);
  const inFlight = useRef(false);
  async function closeWindow() {
    const bridge = window.__TAURI__;
    if (!bridge) {
      setMessage(
        "This is a browser preview. Close this browser tab to leave; native device restoration cannot be verified here."
      );
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        bridge.window.getCurrentWindow().close(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Close not confirmed")), 3000);
        }),
      ]);
      setMessage(
        "Close requested. If the window remains open, use the app's normal Quit or window-close control."
      );
    } catch {
      setMessage(
        "The app could not confirm closing. Use its normal Quit or window-close control. Any unverified restoration is still shown below."
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async function confirm(closeAfterIncomplete = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (closeAfterIncomplete) {
        await closeWindow();
        return;
      }
      const next = await releaseDeviceControls();
      setResult(next);
      if (next.outcome === "confirmed" || next.outcome === "browser") await closeWindow();
      else
        setMessage(
          "Some device controls could not be verified as restored. Retry restoration, or request normal app closure so its shutdown cleanup can run. Closing is not proof that restoration succeeded."
        );
    } catch {
      setMessage(
        "Restoration could not be verified. You can retry or use the app's normal Quit control."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const incomplete = result && result.outcome !== "confirmed" && result.outcome !== "browser";
  return (
    <>
      <Button
        label="Close app"
        variant="ghost"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
      />
      {open && (
        <AccessDialog
          open
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          title="Close AMS Access?"
          labelId="close-app-dialog"
          width="min(calc(100vw - var(--spacing-8)), calc(var(--spacing-10) * 14))"
        >
          <VStack gap={4}>
            <Text>
              This closes the app. It does not submit solutions or finish an open attempt. Leaving
              does not pause the contest timer; returning depends on the contest's entry rules.
            </Text>
            <Text role="status">{busy ? "Restoring device controls…" : message}</Text>
            {incomplete &&
              releaseRestoreStatus(result)?.items.map((item, index) => (
                <Text key={index} type="supporting">
                  {item.label}
                  {item.fix_command ? ` — Recovery: ${item.fix_command}` : ""}
                </Text>
              ))}
            <HStack gap={3} wrap="wrap" justify="end">
              <Button label="Keep app open" isDisabled={busy} onClick={() => setOpen(false)} />
              <Button
                label={incomplete ? "Retry restoration" : "Close app"}
                isDisabled={busy}
                onClick={() => void confirm()}
              />
              {incomplete && (
                <Button
                  label="Request normal close"
                  isDisabled={busy}
                  onClick={() => void confirm(true)}
                />
              )}
            </HStack>
          </VStack>
        </AccessDialog>
      )}
    </>
  );
}
