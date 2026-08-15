import { CheckLine, StageHeader } from "../ui";
import { REVIEW_STAGE, STAGES, type StageStatus } from "../../support";

/**
 * Outcome phrasing for the summary, keyed by the stage's own label.
 *
 * The summary reads better in the past tense ("Camera ready") than the stage
 * table does ("Camera Setup"), so the wording differs — but the *set* of rows
 * and their stage numbers are derived from `STAGES` below rather than written
 * out again. The hand-written list this replaced still carried the numbering
 * from before two stages were deleted, so every row after the third was
 * reporting the result of a different check than it named.
 */
const OUTCOME_LABEL: Record<string, string> = {
  "Secure Full-Screen": "Full-screen mode on",
  "Display Check": "Display checked",
  "Keyboard Setup": "Keyboard controls active",
  "Setup Verification": "Setup verified",
  "Application Check": "No conflicting apps",
  "Device Compatibility": "Device verified",
  "Camera Setup": "Camera ready",
  "Face Scan": "Face scan complete",
  "Presence Check": "Presence confirmed",
  "Microphone Check": "Microphone ready",
  "Connection Check": "Connection stable",
};

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
  // Every stage before this one — this stage is the summary, and the one
  // after it is the secure start, so neither has a result to report.
  const items = STAGES.filter((s) => s.id < REVIEW_STAGE).map((s) => ({
    stage: s.id,
    label: OUTCOME_LABEL[s.label] ?? s.label,
  }));

  const warnCount = items.filter(({ stage }) => results[stage] === "warn").length;
  const hasWarns = warnCount > 0;
  const notRun = items.filter(
    ({ stage }) => results[stage] === undefined || results[stage] === "pending"
  ).length;

  return (
    <div className="flex flex-col items-center">
      <StageHeader label="Almost Ready" />

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
