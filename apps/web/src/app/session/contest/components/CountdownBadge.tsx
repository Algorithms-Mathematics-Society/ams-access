import { memo } from "react";
import { Lock, Loader2 } from "lucide-react";
import { type CountdownPhase } from "../countdown";
import { useCountdown } from "./hooks";
import type { ClockSnapshot } from "../session-clock";

export const CountdownBadge = memo(function CountdownBadge({
  clock,
  onExpiry,
}: {
  clock: ClockSnapshot;
  onExpiry?: () => void;
}) {
  const { remaining, phase } = useCountdown(clock, onExpiry);
  const PHASE_COLOR: Record<CountdownPhase, string> = {
    nominal: "#e4e4e7",
    warning: "#a1a1aa",
    critical: "var(--verdict-wa)",
    expired: "var(--text-dim)",
  };
  const color = PHASE_COLOR[phase];
  const isCritical = phase === "critical";
  const isExpired = phase === "expired";
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={isExpired ? "Contest time expired" : `Time remaining ${remaining}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        // A tinted pill contains the timer — always shown; urgency escalates at
        // the critical threshold via shape + red tint (signalled by shape, not
        // colour alone).
        padding: "4px 12px",
        borderRadius: "var(--radius-pill)",
        backgroundColor: isCritical ? "rgba(239, 68, 68, 0.12)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${isCritical ? "rgba(239, 68, 68, 0.30)" : "rgba(255,255,255,0.08)"}`,
        transition:
          "background-color var(--transition-standard), border-color var(--transition-standard)",
        animation: isCritical ? "countdown-pulse 1s ease-in-out infinite" : "none",
      }}
    >
      {isExpired ? (
        <Lock
          size={12}
          strokeWidth={2.5}
          color={color}
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        />
      ) : (
        <Loader2
          size={13}
          strokeWidth={2}
          color={color}
          aria-hidden="true"
          style={{ flexShrink: 0, animation: "spin 2s linear infinite" }}
        />
      )}
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color,
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.02em",
          transition: "color 1s linear",
        }}
      >
        {remaining}
      </span>
    </div>
  );
});
