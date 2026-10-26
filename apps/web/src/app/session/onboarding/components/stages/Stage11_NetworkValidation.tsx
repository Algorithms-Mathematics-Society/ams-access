import { useEffect, useRef, useState } from "react";
import { isGatingRelaxed, warnGatingRelaxed, RELAXED_MODE_BADGE } from "@/lib/gating";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { CheckLine, Spinner, StageHeader } from "../ui";
import { type TauriGlobals } from "../tauri-globals";
import { getNetworkProbeHost, invoke, invokeStrict, withNullableTimeout } from "../../support";
import { ensureNetworkHelper } from "../../network-helper";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & TauriGlobals;

export function Stage11_NetworkValidation({
  onPass,
  onWarn,
}: {
  onPass(): void;
  onWarn?(detail?: string): void;
}) {
  const [latency, setLatency] = useState<number | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [helperPhase, setHelperPhase] = useState<
    "skipped" | "checking" | "installing" | "pass" | "warn"
  >("skipped");
  const [helperMessage, setHelperMessage] = useState("Network lockdown helper ready");
  // Proxy or VPN routes the native check reports. Lockdown allows only the
  // exam server's own addresses, so traffic sent through either is cut off.
  const [pathWarnings, setPathWarnings] = useState<string[]>([]);
  const [retryKey, setRetryKey] = useState(0);
  const completedRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let advanceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleAdvance = (callback: () => void) => {
      advanceTimer = setTimeout(() => {
        if (!controller.signal.aborted) callback();
      }, 1400);
    };

    async function go() {
      completedRef.current = false;
      setPhase("checking");
      setLatency(null);
      setQuality(null);
      setHelperPhase("skipped");
      setHelperMessage("Network lockdown helper ready");
      setPathWarnings([]);
      // Asked before lockdown is ever enabled, and in relaxed builds too.
      const warningsCheck = withNullableTimeout(
        invoke<string[]>("get_network_path_warnings"),
        3000
      );
      // TEST-ONLY relaxation (build-time flag). Default builds run the real
      // probe + helper install below. Never a hardcoded bypass in a ship build.
      if (isGatingRelaxed()) {
        warnGatingRelaxed("onboarding network-validation stage auto-passed");
        setLatency(1);
        setQuality("excellent");
        setHelperPhase("skipped");
        setHelperMessage(RELAXED_MODE_BADGE);
        const warnings = (await warningsCheck) ?? [];
        if (controller.signal.aborted) return;
        setPathWarnings(warnings);
        setPhase("pass");
        if (warnings.length === 0) scheduleAdvance(onPass);
        return;
      }

      const [result, helperReady, warnings] = await Promise.all([
        withNullableTimeout(
          invoke<{
            reachable: boolean;
            latency_ms: number | null;
            quality: string;
          }>("check_network_stability", { host: getNetworkProbeHost() }),
          3000
        ),
        window.__TAURI__
          ? ensureNetworkHelper({
              invoke: invokeStrict,
              signal: controller.signal,
              onProgress: ({ phase, message }) => {
                setHelperPhase(phase);
                setHelperMessage(message);
              },
            })
          : Promise.resolve(true),
        warningsCheck,
      ]);

      if (controller.signal.aborted) return;
      setPathWarnings(warnings ?? []);
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
      // Warnings hold the stage until the candidate has read them and continues.
      if (nextPhase === "pass" && !warnings?.length) scheduleAdvance(onPass);
    }
    void go();
    return () => {
      controller.abort();
      clearTimeout(advanceTimer);
    };
  }, [onPass, onWarn, retryKey]);

  const retry = () => {
    if (completedRef.current) return;
    setRetryKey((key) => key + 1);
  };

  const continueWithWarning = () => {
    if (completedRef.current || phase !== "warn") return;
    completedRef.current = true;
    const detail =
      helperPhase === "warn"
        ? helperMessage
        : quality === "unreachable"
          ? "Connection check did not receive a response."
          : quality === "poor"
            ? "Connection quality is poor."
            : "Network readiness could not be verified.";
    onWarn?.(`Network readiness warning: ${detail}`);
    if (!onWarn) onPass();
  };

  const continueDespitePath = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    if (onWarn) onWarn(`Network route warning: ${pathWarnings.join(" ")}`);
    else onPass();
  };

  return (
    <VStack gap={5} style={{ width: "100%", minWidth: 0 }}>
      <StageHeader label="Connection check" />
      <Text color="secondary">
        We’re checking the connection and preparing any network controls required by your device.
      </Text>
      {phase === "checking" ? (
        <HStack gap={3} align="center">
          <Spinner />
          <Text color="secondary">Checking your connection…</Text>
        </HStack>
      ) : (
        <VStack gap={2}>
          <Text type="supporting" color="secondary">
            Response time
          </Text>
          <Text style={{ fontSize: "var(--font-size-3xl)", fontVariantNumeric: "tabular-nums" }}>
            {latency === null ? "Not measured" : `${latency} ms`}
          </Text>
        </VStack>
      )}
      {phase !== "checking" && (
        <VStack gap={2}>
          <CheckLine
            label={
              latency === null
                ? "No response-time measurement available"
                : `Response time: ${latency} ms`
            }
            status={latency === null ? "unknown" : phase}
          />
          <CheckLine
            label={`Connection quality: ${quality ?? "Not measured"}`}
            status={phase}
            delay={200}
          />
          {helperPhase !== "skipped" && (
            <CheckLine
              label={helperMessage}
              status={helperPhase === "pass" ? "pass" : "warn"}
              delay={400}
            />
          )}
          {phase === "pass" && (
            <CheckLine label="Server connection established" status="pass" delay={600} />
          )}
          {pathWarnings.length > 0 && (
            <Banner
              status="warning"
              title="This network may be cut off during the contest"
              description={
                <VStack gap={2}>
                  {pathWarnings.map((warning) => (
                    <Text key={warning}>{warning}</Text>
                  ))}
                  <Text>
                    During the contest this Mac may only reach the exam server directly. Turn off
                    the proxy or VPN now if you can, then retry. You can still continue.
                  </Text>
                </VStack>
              }
            />
          )}
          {phase === "pass" && pathWarnings.length > 0 && (
            <HStack gap={3} wrap="wrap">
              <Button variant="secondary" label="Retry connection check" onClick={retry} />
              <Button variant="primary" label="Continue" onClick={continueDespitePath} />
            </HStack>
          )}
          {phase === "warn" && (
            <HStack gap={3} wrap="wrap">
              <Button variant="secondary" label="Retry connection check" onClick={retry} />
              <Button
                variant="secondary"
                label="Continue with warning"
                onClick={continueWithWarning}
              />
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
