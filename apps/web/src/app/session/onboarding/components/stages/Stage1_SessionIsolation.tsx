import { useEffect, useState } from "react";
import { useTheme } from "../hooks";
import { CheckLine, StageHeader } from "../ui";

export function Stage1_SessionIsolation({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState(0);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2200),
      setTimeout(() => onPass(), 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={1} label="Preparing Your Session" />

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
            Session setup:{" "}
          </span>
          {phase >= 1 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Ready</span>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.58)" }}>Starting</span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Device check:{" "}
          </span>
          {phase >= 2 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Bound to this device</span>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.58)" }}>Pending</span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Contest controls:{" "}
          </span>
          {phase >= 3 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Ready</span>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.58)" }}>Pending</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        {phase >= 1 && <CheckLine label="Session setup ready" status="pass" />}
        {phase >= 2 && <CheckLine label="Device bound to this session" status="pass" />}
        {phase >= 3 && <CheckLine label="Ready for contest controls" status="pass" />}
      </div>
    </div>
  );
}
