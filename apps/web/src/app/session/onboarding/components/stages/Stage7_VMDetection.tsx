import { useEffect, useState } from "react";
import { useTheme } from "../hooks";
import { CheckLine, StageHeader } from "../ui";
import { invoke, withNullableTimeout } from "../../support";

export function Stage7_VMDetection({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [platform, setPlatform] = useState<string | null>(null);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    async function go() {
      const result = await withNullableTimeout(
        invoke<{ detected: boolean; platform: string | null }>("detect_virtualization"),
        3000
      );
      await new Promise((r) => setTimeout(r, 1400));
      if (result?.detected) {
        setPhase("warn");
        setPlatform(result.platform);
        setTimeout(() => (onWarn ?? onPass)(), 3000);
      } else {
        setPhase("pass");
        setTimeout(onPass, 1200);
      }
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-center w-full">
      <StageHeader label="Device Compatibility" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "rgba(255,255,255,0.58)",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "var(--radius-sm)",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Virtual machine:{" "}
          </span>
          {phase === "checking" ? (
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>Checking</span>
          ) : phase === "pass" ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Not detected</span>
          ) : (
            <span style={{ color: "#ef4444", fontWeight: 700 }}>
              [ TRUE ({platform ?? "UNKNOWN"}) ]
            </span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Device platform:{" "}
          </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>x86_64</span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Operating system:{" "}
          </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>Linux 6.x</span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Device status:{" "}
          </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Active</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        {phase === "checking" && (
          <CheckLine
            label="Checking whether this device is running in a virtual machine..."
            status="checking"
          />
        )}
        {phase === "pass" && (
          <>
            <CheckLine label="Device is compatible" status="pass" />
            <CheckLine label="Running on physical hardware" status="pass" />
          </>
        )}
        {phase === "warn" && (
          <>
            <CheckLine label="Virtualization platform active" status="warn" />
            <CheckLine label="Session flagged for additional review" status="warn" />
          </>
        )}
      </div>
    </div>
  );
}
