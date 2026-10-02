import { useEffect, useState } from "react";
import { isGatingRelaxed, warnGatingRelaxed, RELAXED_MODE_BADGE } from "@/lib/gating";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { CheckLine, Spinner, StageHeader } from "../ui";
import { type TauriGlobals } from "../tauri-globals";
import { getNetworkProbeHost, invoke, invokeStrict, withNullableTimeout } from "../../support";
import { ensureNetworkHelper } from "../../network-helper";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & TauriGlobals;

export function Stage11_NetworkValidation({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [latency, setLatency] = useState<number | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [helperPhase, setHelperPhase] = useState<
    "skipped" | "checking" | "installing" | "pass" | "warn"
  >("skipped");
  const [helperMessage, setHelperMessage] = useState("Network lockdown helper ready");

  useEffect(() => {
    const controller = new AbortController();
    let advanceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleAdvance = (callback: () => void) => {
      advanceTimer = setTimeout(() => {
        if (!controller.signal.aborted) callback();
      }, 1400);
    };

    async function go() {
      // TEST-ONLY relaxation (build-time flag). Default builds run the real
      // probe + helper install below. Never a hardcoded bypass in a ship build.
      if (isGatingRelaxed()) {
        warnGatingRelaxed("onboarding network-validation stage auto-passed");
        setLatency(1);
        setQuality("excellent");
        setHelperPhase("skipped");
        setHelperMessage(RELAXED_MODE_BADGE);
        setPhase("pass");
        scheduleAdvance(onPass);
        return;
      }

      const [result, helperReady] = await Promise.all([
        withNullableTimeout(
          invoke<{
            reachable: boolean;
            latency_ms: number | null;
            quality: string;
          }>("check_network_stability", { host: getNetworkProbeHost() }),
          3000
        ),
        window.__TAURI__ ? ensureNetworkHelper({
          invoke: invokeStrict,
          signal: controller.signal,
          onProgress: ({ phase, message }) => {
            setHelperPhase(phase);
            setHelperMessage(message);
          },
        }) : Promise.resolve(true),
      ]);

      if (controller.signal.aborted) return;
      let nextPhase: "pass" | "warn";
      if (result?.reachable) {
        setLatency(result.latency_ms);
        setQuality(result.quality);
        nextPhase = result.quality === "poor" || !helperReady ? "warn" : "pass";
        setPhase(nextPhase);
      } else {
        setLatency(null);
        setQuality("unreachable");
        nextPhase = "warn";
        setPhase("warn");
      }
      scheduleAdvance(nextPhase === "warn" ? (onWarn ?? onPass) : onPass);
    }
    void go();
    return () => {
      controller.abort();
      clearTimeout(advanceTimer);
    };
  }, [onPass, onWarn]);

  return (
    <VStack gap={5} style={{ width: "100%", minWidth: 0 }}>
      <StageHeader label="Connection check" />
      <Text color="secondary">We’re checking the connection and preparing any network controls required by your device.</Text>
      {phase === "checking" ? <HStack gap={3} align="center"><Spinner /><Text color="secondary">Checking your connection…</Text></HStack> : <VStack gap={2}>
        <Text type="supporting" color="secondary">Response time</Text>
        <Text style={{ fontSize: "var(--font-size-3xl)", fontVariantNumeric: "tabular-nums" }}>{latency === null ? "Not measured" : `${latency} ms`}</Text>
      </VStack>}
      {phase !== "checking" && <VStack gap={2}>
        <CheckLine label={latency === null ? "No response-time measurement available" : `Response time: ${latency} ms`} status={latency === null ? "unknown" : phase} />
        <CheckLine label={`Connection quality: ${quality ?? "Not measured"}`} status={phase} delay={200} />
        {helperPhase !== "skipped" && <CheckLine label={helperMessage} status={helperPhase === "pass" ? "pass" : "warn"} delay={400} />}
        {phase === "pass" && <CheckLine label="Server connection established" status="pass" delay={600} />}
      </VStack>}
    </VStack>
  );
}
