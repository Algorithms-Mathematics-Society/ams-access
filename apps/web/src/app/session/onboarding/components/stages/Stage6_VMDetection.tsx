import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/Stack";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

export function Stage6_VMDetection({ onPass, onWarn }: { onPass(): void; onWarn?(detail: string): void }) {
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [platform, setPlatform] = useState<string | null>(null);
  const warning = `Virtualization detected${platform ? ` (${platform})` : ""}. Ask your invigilator whether this device is permitted. Continuing keeps this warning; contest entry requirements still apply.`;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function go() {
      const result = await withNullableTimeout(
        invoke<{ detected: boolean; platform: string | null }>("detect_virtualization"),
        3000
      );
      await new Promise((r) => setTimeout(r, 1400));
      if (cancelled) return;
      if (result?.detected) {
        setPhase("warn");
        setPlatform(result.platform);
      } else {
        setPhase("pass");
        timer = setTimeout(() => { if (!cancelled) onPass(); }, 1200);
      }
    }
    void go();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [onPass]);

  return (
    <VStack gap={6} width="100%">
      <StageHeader label="Device compatibility" />
      <Text color="secondary">
        We’re checking whether your contest is running in a virtual machine.
      </Text>
      <MetadataList>
        <MetadataListItem label="Virtual machine">
          {phase === "checking"
            ? "Checking"
            : phase === "pass"
              ? "Not detected"
              : (platform ?? "Detected — platform unknown")}
        </MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        {phase === "checking" && (
          <CheckLine label="Checking your device environment..." status="checking" />
        )}
        {phase === "pass" && (
          <CheckLine label="Device compatibility check complete" status="pass" />
        )}
        {phase === "warn" && (
          <>
            <CheckLine label="Virtualization platform active" status="warn" />
            <Text color="secondary">{warning}</Text>
            <HStack gap={3} wrap="wrap">
              <Button label="Continue with warning" variant="primary" onClick={() => onWarn ? onWarn(warning) : onPass()} />
            </HStack>
          </>
        )}
      </VStack>
    </VStack>
  );
}
