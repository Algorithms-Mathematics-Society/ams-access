import { useEffect, useState } from "react";
import { CheckLine, StageHeader } from "../ui";

export function Stage14_LockInCountdown({ onPass }: { onPass(): void }) {
  const [count, setCount] = useState(5);
  const [tickKey, setTickKey] = useState(0); // force re-mount to re-trigger animation

  useEffect(() => {
    const t = setInterval(
      () =>
        setCount((c) => {
          if (c <= 1) {
            clearInterval(t);
            setTimeout(onPass, 400);
            return 0;
          }
          setTickKey((k) => k + 1);
          return c - 1;
        }),
      1000
    );
    return () => clearInterval(t);
  }, [onPass]);

  const isUrgent = count <= 2;
  const numColor = isUrgent ? "var(--color-error)" : "#FFFFFF";
  const glowColor = isUrgent ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.2)";
  const borderColor = isUrgent ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.12)";

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={14} label="Starting Your Session" />

      <div
        style={{
          position: "relative",
          width: 320,
          height: 140,
          background: "#0F0F0F",
          border: `2px solid ${borderColor}`,
          borderRadius: "var(--radius-lg)",
          fontFamily: "'JetBrains Mono', monospace",
          marginBottom: "24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transition: "border-color var(--transition-standard)",
          overflow: "hidden",
        }}
      >
        {/* Radial glow behind number */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${glowColor}, transparent)`,
            pointerEvents: "none",
            transition: "background var(--transition-standard)",
          }}
        />

        {/* Number with per-tick scale pulse */}
        <span
          key={tickKey}
          style={{
            fontSize: "var(--text-3xl)",
            fontWeight: 700,
            color: numColor,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            textShadow: `0 0 32px ${glowColor}, 0 0 8px ${glowColor}`,
            animation: "countdown-tick 0.4s cubic-bezier(0.22,1,0.36,1) forwards",
            transition: "color var(--transition-standard), text-shadow var(--transition-standard)",
            position: "relative",
            zIndex: 1,
          }}
        >
          {String(count).padStart(2, "0")}
        </span>

        {/* Fill bars */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            marginTop: "16px",
            position: "relative",
            zIndex: 1,
          }}
        >
          {Array.from({ length: 5 }).map((_, idx) => {
            const isLit = idx < count;
            return (
              <div
                key={idx}
                style={{
                  width: "24px",
                  height: "6px",
                  borderRadius: "var(--radius-sm)",
                  background: isLit
                    ? isUrgent
                      ? "var(--color-error)"
                      : "#FFFFFF"
                    : "rgba(255,255,255,0.08)",
                  boxShadow: isLit ? `0 0 8px ${glowColor}` : "none",
                  transition:
                    "background var(--transition-standard), box-shadow var(--transition-standard)",
                }}
              />
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {[
          "Keyboard controls active",
          "Session monitoring active",
          "Secure session ready",
          "Contest environment ready",
        ].map((label, i) => (
          <CheckLine key={label} label={label} status="pass" delay={i * 120} />
        ))}
      </div>

      <style>{`
        @keyframes countdown-tick {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
