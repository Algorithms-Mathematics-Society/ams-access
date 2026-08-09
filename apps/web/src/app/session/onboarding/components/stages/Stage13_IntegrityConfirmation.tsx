import { CheckLine, StageHeader } from "../ui";
import { type StageStatus } from "../../support";

/**
 * The summary, and only the summary.
 *
 * This stage was doing two incompatible jobs. The orchestrator set
 * `currentStage(13)` whenever the entry gate or the readiness report blocked,
 * so a blocked candidate saw the red banner rendered *above* a green
 * "All checks passed — ready to begin". And it auto-advanced on a 3.5s timer
 * regardless, so the flow ran on to stage 14, then 15, then re-evaluated the
 * gate, blocked, and came back here: a silent retry loop about every nine
 * seconds, with no way for the candidate to tell anything was wrong.
 *
 * It no longer advances by itself, and it no longer paints absent results
 * green — a stage that never ran reads "Not run".
 */
export function Stage13_IntegrityConfirmation({
  results,
  onPass,
  blocked = false,
}: {
  results: Record<number, StageStatus>;
  onPass(): void;
  /** True when the orchestrator is showing a block. The summary still
   * renders — it is the useful part — but nothing advances. */
  blocked?: boolean;
}) {
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
  const notRun = items.filter(
    ({ stage }) => results[stage] === undefined || results[stage] === "pending"
  ).length;

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
            // Absent means the stage never ran. It used to render as a pass,
            // which is how a blocked candidate was told everything was fine.
            // Absent means the stage never ran, and `pending` means it was
            // reached but never resolved. Neither is a pass — that mapping is
            // how a blocked candidate was told everything was fine.
            status={
              results[stage] === undefined || results[stage] === "pending"
                ? "unknown"
                : results[stage]
            }
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
          {notRun > 0
            ? `${notRun} check${notRun > 1 ? "s" : ""} did not run`
            : hasWarns
              ? `${warnCount} advisory warning${warnCount > 1 ? "s" : ""} — proceeding with recorded warnings`
              : "All checks passed — ready to begin"}
        </p>
      </div>

      {/* An explicit step, not a timer. Whether to go on is the candidate's
          call, and when they are blocked there is nothing to go on to. */}
      {!blocked && (
        <button type="button" onClick={onPass} className="onboarding-continue">
          Continue
        </button>
      )}
    </div>
  );
}
