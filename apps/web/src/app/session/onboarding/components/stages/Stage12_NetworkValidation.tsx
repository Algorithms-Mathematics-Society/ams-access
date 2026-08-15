import { useEffect, useState } from "react";
import { isGatingRelaxed, warnGatingRelaxed, RELAXED_MODE_BADGE } from "@/lib/gating";
import { CheckLine, Spinner, StageHeader } from "../ui";
import { type TauriGlobals } from "../tauri-globals";
import { getNetworkProbeHost, invoke, invokeStrict, withNullableTimeout } from "../../support";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & TauriGlobals;

export function Stage12_NetworkValidation({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
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

  const qualityColor =
    quality === "excellent" || quality === "good"
      ? "#22c55e"
      : quality === "fair"
        ? "var(--color-indicator-warn)"
        : "var(--color-error)";

  return (
    <div className="flex flex-col items-center">
      <StageHeader label="Connection Check" />

      <div
        className="mb-10 relative flex flex-col items-center justify-center"
        style={{
          width: 180,
          height: 80,
          borderRadius: "var(--radius-sm)",
          background: "#0F0F0F",
          border: `1px solid ${phase === "checking" ? "rgba(255,255,255,0.06)" : phase === "pass" ? "rgba(34,197,94,0.4)" : "#ef4444"}`,
          transition: "border-color var(--transition-slow)",
        }}
      >
        {phase === "checking" ? (
          <Spinner size={24} />
        ) : (
          <div className="text-center" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <p
              style={{
                fontSize: "var(--text-lg)",
                fontWeight: 700,
                color: qualityColor,
                lineHeight: 1,
              }}
            >
              {latency} MS
            </p>
            <p
              style={{
                fontSize: "11px",
                color: "rgba(255,255,255,0.58)",
                marginTop: "6px",
                letterSpacing: "0.1em",
              }}
            >
              Response time
            </p>
          </div>
        )}
      </div>

      {phase !== "checking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <CheckLine label={`Response time: ${latency}ms`} status={phase} />
          <CheckLine label={`Connection quality: ${quality ?? "-"}`} status={phase} delay={200} />
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
        </div>
      )}
    </div>
  );
}
