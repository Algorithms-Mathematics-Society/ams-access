import { useEffect } from "react";
import { CheckLine, StageHeader } from "../ui";
import { type StageStatus } from "../../support";

export function Stage13_IntegrityConfirmation({
  results,
  onPass,
}: {
  results: Record<number, StageStatus>;
  onPass(): void;
}) {
  useEffect(() => {
    setTimeout(onPass, 3500);
  }, [onPass]);

  const items = [
    { label: "Session prepared", stage: 1 },
    { label: "Full-screen mode on", stage: 2 },
    { label: "Display checked", stage: 3 },
    { label: "Keyboard controls active", stage: 4 },
    { label: "Setup verified", stage: 5 },
    { label: "No conflicting apps", stage: 6 },
    { label: "Device verified", stage: 7 },
    { label: "Camera ready", stage: 8 },
    { label: "Face scan complete", stage: 9 },
    { label: "Presence confirmed", stage: 10 },
    { label: "Microphone ready", stage: 11 },
    { label: "Connection stable", stage: 12 },
  ];

  const warnCount = items.filter(({ stage }) => results[stage] === "warn").length;
  const hasWarns = warnCount > 0;

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={13} label="Almost Ready" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: "40px",
          rowGap: "14px",
          width: "100%",
          maxWidth: "380px",
          marginBottom: "28px",
        }}
      >
        {items.map(({ label, stage }, i) => (
          <CheckLine
            key={label}
            label={label}
            status={results[stage] === "warn" ? "warn" : "pass"}
            delay={i * 120}
          />
        ))}
      </div>

      <div
        style={{
          borderRadius: "var(--radius-sm)",
          padding: "12px 24px",
          background: hasWarns ? "rgba(245,158,11,0.05)" : "rgba(34,197,94,0.05)",
          border: `1px solid ${hasWarns ? "rgba(245,158,11,0.22)" : "rgba(34,197,94,0.18)"}`,
        }}
      >
        <p
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: hasWarns ? "#fcd34d" : "#22c55e",
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          {hasWarns
            ? `${warnCount} advisory warning${warnCount > 1 ? "s" : ""} — proceeding with recorded warnings`
            : "All checks passed — ready to begin"}
        </p>
      </div>
    </div>
  );
}
