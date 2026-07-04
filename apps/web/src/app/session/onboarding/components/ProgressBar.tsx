import { PHASE_FRIENDLY_NAME, computePhases } from "./labels";
import { STAGES, type StageStatus } from "../support";

export function ProgressBar({
  current,
  results,
}: {
  current: number;
  results: Record<number, StageStatus>;
}) {
  const currentStageInfo = STAGES[current - 1];
  const groupLabel = currentStageInfo?.group ?? "Finalizing";
  const phaseName = PHASE_FRIENDLY_NAME[groupLabel] ?? groupLabel;

  const phases = computePhases();
  const phaseIndex = phases.findIndex((p) => current >= p.start && current <= p.end);
  const currentPhase = phaseIndex < 0 ? phases.length : phaseIndex + 1;

  // Rough, reassuring time estimate (~8s/stage). Shown as "about …", never exact.
  const remainingStages = Math.max(0, STAGES.length - current);
  const estMinutes = Math.max(1, Math.ceil((remainingStages * 8) / 60));
  const timeLabel = remainingStages <= 0 ? "Almost done" : `about ${estMinutes} min left`;

  return (
    <div
      style={{
        padding: "24px 32px 0",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "100%",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: "11px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 600,
            color: "#FFF",
            letterSpacing: "0.01em",
          }}
        >
          {phaseName}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 500,
            color: "rgba(255,255,255,0.58)",
          }}
        >
          Step {currentPhase} of {phases.length} · {timeLabel}
        </span>
      </div>

      {/* Segmented telemetry bar — flat dashes grouped by phase (wider gap between groups) */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {phases.map((phase, pi) => {
          const stageIds: number[] = [];
          for (let id = phase.start; id <= phase.end; id++) stageIds.push(id);

          return (
            <div
              // `group` repeats ("Media Setup" covers both the camera and the
              // audio phases), so it is not a unique key; the stage range is.
              key={`${phase.group}-${phase.start}`}
              style={{
                display: "flex",
                gap: "3px",
                marginRight: pi < phases.length - 1 ? 11 : 0,
              }}
            >
              {stageIds.map((id) => {
                const stageResult = results[id];
                let bg: string;
                if (id === current) {
                  bg = "#ffffff"; // active — stark white leading edge
                } else if (id < current) {
                  bg = stageResult === "warn" ? "#f59e0b" : "#d4d4d8"; // completed
                } else {
                  bg = "#27272a"; // pending — barely registers
                }
                return (
                  <div
                    key={id}
                    style={{
                      width: 18,
                      height: 3,
                      borderRadius: 0,
                      background: bg,
                      transition: "background var(--transition-standard)",
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
