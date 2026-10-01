import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/Stack";
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
export function Stage12_IntegrityConfirmation({
  results,
  onPass,
  blocked = false,
  warningDetails = {},
}: {
  results: Record<number, StageStatus>;
  warningDetails?: Record<number, string>;
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
  })).sort((a, b) => Number(results[b.stage] === "warn" || results[b.stage] === "fail") - Number(results[a.stage] === "warn" || results[a.stage] === "fail"));

  const warnCount = items.filter(({ stage }) => results[stage] === "warn").length;
  const hasWarns = warnCount > 0;
  const notRun = items.filter(
    ({ stage }) => results[stage] === undefined || results[stage] === "pending"
  ).length;

  const hasFailures = items.some(({ stage }) => results[stage] === "fail");
  const hasPending = items.some(({ stage }) => results[stage] === "checking");

  return (
    <VStack gap={5} style={{ width: "100%", minWidth: 0 }}>
      <StageHeader label="Review your setup" />
      <Banner
        status={blocked || hasFailures ? "error" : hasWarns || notRun > 0 || hasPending ? "warning" : "success"}
        title={blocked ? "Contest entry is blocked" : hasFailures ? "Some checks need attention" : notRun > 0 ? `${notRun} check${notRun > 1 ? "s" : ""} did not run` : hasPending ? "Some checks are still in progress" : hasWarns ? `${warnCount} advisory warning${warnCount > 1 ? "s" : ""}` : "Your setup checks passed"}
        description={blocked ? "Follow the guidance above before trying again." : "Review your results, then continue. Your contest’s entry requirements are checked before the workspace opens."}
      />
      <VStack gap={0}>
        {items.map(({ label, stage }) => <VStack key={label} style={{ borderBottom: "var(--border-width) solid var(--color-border)", paddingBlock: "var(--spacing-1)" }}>
          <CheckLine
            label={STAGES.find(s => s.id === stage)?.label ?? label}
            status={results[stage] === undefined || results[stage] === "pending" ? "unknown" : results[stage]}
          />
          {results[stage] === "warn" && <Text type="supporting" color="secondary" style={{ paddingInline: "var(--spacing-3)", paddingBottom: "var(--spacing-3)" }}>
            {warningDetails[stage] ?? WARNING_GUIDANCE[stage] ?? "This check completed with a warning. Ask your invigilator if you need help; contest entry requirements are checked before your workspace opens."}
          </Text>}
        </VStack>)}
      </VStack>
      {!blocked && <Button type="button" variant="primary" label="Continue" onClick={onPass} />}
    </VStack>
  );
}

const WARNING_GUIDANCE: Record<number, string> = {
  1: "Full-screen setup needs attention. Keep this app in the foreground. Your contest’s required screen controls are checked again before entry.",
  3: "Keyboard controls need attention. Check your system permissions or ask an invigilator. Required keyboard controls are verified before entry.",
  5: "The application check reported a warning. Close other apps before entry and ask an invigilator if you need help.",
  6: "Virtualization was detected. Ask your invigilator whether this device is permitted. Continuing does not bypass contest entry requirements.",
  8: "The face scan used the invigilator review option. Ask an invigilator for help if you need to confirm your setup.",
  9: "Presence could not be confirmed cleanly. Stay alone in the camera frame with your face clearly visible, and ask an invigilator if needed.",
  10: "Microphone access was unavailable. Check microphone permissions and close other apps using it. Ask your invigilator if access remains unavailable.",
  11: "The connection or network controls reported a warning. Check your connection and ask an invigilator for help with any system permission request. Required network controls are verified before entry.",
};
