import { memo } from "react";
import { Clock3, Lock } from "lucide-react";
import { HStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { type CountdownPhase } from "../countdown";
import { useCountdown } from "./hooks";
import type { ClockSnapshot } from "../session-clock";

export const CountdownBadge = memo(function CountdownBadge({ clock, onExpiry }: {
  clock: ClockSnapshot;
  onExpiry?: () => void;
}) {
  const { remaining, phase } = useCountdown(clock, onExpiry);
  const PHASE_COLOR: Record<CountdownPhase, string> = {
    nominal: "var(--color-text-primary)",
    warning: "var(--color-text-yellow)",
    critical: "var(--color-text-red)",
    expired: "var(--color-text-secondary)",
  };
  const color = PHASE_COLOR[phase];
  const isCritical = phase === "critical";
  const isExpired = phase === "expired";
  return <HStack role="timer" aria-live="off" className="contest-countdown" gap={2} align="center" paddingInline={3} paddingBlock={2}
    aria-label={isExpired ? "Contest time expired" : `Time remaining ${remaining}`}
    style={{ color, flexShrink: 0, borderRadius: "var(--radius-md)",
      background: isCritical ? "var(--color-error-muted)" : "var(--color-background-muted)",
      border: `var(--border-width) solid ${isCritical ? "var(--color-border-red)" : "var(--color-border)"}` }}>
    {isExpired ? <Lock size={16} aria-hidden="true" /> : <Clock3 size={16} aria-hidden="true" />}
    <Text type="code" color="inherit" hasTabularNumbers>{remaining}</Text>
    <Text type="supporting" color="inherit" className="contest-countdown-label">{isExpired ? "Time expired" : isCritical ? "Time running out" : "remaining"}</Text>
  </HStack>;
});
