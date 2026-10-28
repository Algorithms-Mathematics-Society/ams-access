"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { invoke } from "@ams/api-client";

/** Signed-out screens only. Native also refuses this action during an exam. */
export function MacQuitButton() {
  const [isMac, setIsMac] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void invoke<{ os: string }>("get_platform").then(
      (platform) => {
        if (!cancelled) setIsMac(platform.os === "macos");
      },
      () => {} // Browser preview has no native Quit action.
    );
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);
  if (!isMac) return null;
  async function quit() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await invoke("quit_macos_when_idle");
    } catch (cause) {
      if (mounted.current)
        setError(
          typeof cause === "string"
            ? cause
            : "Could not quit. Try again or use AMS Access > Quit in the menu bar."
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <VStack gap={2} align="end">
      <Button label="Quit" variant="ghost" size="sm" isLoading={busy} onClick={quit} />
      {error && (
        <Text role="alert" type="supporting" style={{ maxWidth: "28ch" }}>
          {error}
        </Text>
      )}
    </VStack>
  );
}
