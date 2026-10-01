import { useEffect, useState } from "react";
import { isGatingRelaxed, warnGatingRelaxed, RELAXED_MODE_BADGE } from "@/lib/gating";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { CheckLine, Spinner, StageHeader } from "../ui";
import { type TauriGlobals } from "../tauri-globals";
import { getNetworkProbeHost, invoke, invokeStrict, withNullableTimeout } from "../../support";

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
    async function ensureNetworkHelper() {
      if (!window.__TAURI__) return true;

      // macOS (LaunchDaemon) and Linux (systemd + polkit) both apply egress
      // lockdown through a privileged out-of-process helper that must be
      // installed before the contest. Windows locks in-process and needs none.
      const platform = await invoke<{ os: string }>("get_platform");
      if (platform?.os !== "macos" && platform?.os !== "linux") return true;

      setHelperPhase("checking");
      const running = await invoke<boolean>("network_helper_running");
      if (running) {
        setHelperPhase("pass");
        setHelperMessage("Network lockdown helper ready");
        return true;
      }

      setHelperPhase("installing");
      setHelperMessage("Administrator approval requested");
      try {
        await invokeStrict("install_network_helper");
        const ready = await invoke<boolean>("network_helper_running");
        setHelperPhase(ready ? "pass" : "warn");
        setHelperMessage(
          ready ? "Network lockdown helper ready" : "Network lockdown helper unavailable"
        );
        return Boolean(ready);
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error ?? "helper install failed");
        setHelperPhase("warn");
        setHelperMessage(
          msg.includes("admin_auth_cancelled")
            ? "Administrator approval was cancelled"
            : msg.includes("pkexec_not_available")
              ? "Admin authorization tool (pkexec) is unavailable — ask your organizer to pre-install the helper"
              : "Network lockdown helper unavailable"
        );
        return false;
      }
    }

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
        setTimeout(() => onPass(), 1400);
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
        ensureNetworkHelper(),
      ]);

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
      setTimeout(() => (nextPhase === "warn" ? (onWarn ?? onPass)() : onPass()), 1400);
    }
    void go();
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
