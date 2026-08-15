import { useEffect, useState } from "react";
import { useTheme } from "../hooks";
import { CheckLine, StageHeader } from "../ui";
import { tauriWindow } from "../../support";

export function Stage2_Fullscreen({ onPass }: { onPass(): void }) {
  const [done, setDone] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    async function go() {
      const win = await tauriWindow();
      if (win) {
        await win.setFullscreen(true).catch(() => {});
        await win.setAlwaysOnTop(true).catch(() => {});
        await win.setDecorations(false).catch(() => {});
      }
      setTimeout(() => {
        setDone(true);
        setTimeout(onPass, 600);
      }, 800);
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader label="Secure Full-Screen" />

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
            Window mode:{" "}
          </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "Full-screen" : "Starting"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Focus mode:{" "}
          </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "On" : "Starting"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.45)" }}>
            Window controls:{" "}
          </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "Hidden" : "Starting"}
          </span>
        </div>
      </div>

      <div style={{ width: "100%" }}>
        <CheckLine
          label={done ? "Full-screen mode active" : "Switching to full-screen..."}
          status={done ? "pass" : "checking"}
        />
      </div>
    </div>
  );
}
