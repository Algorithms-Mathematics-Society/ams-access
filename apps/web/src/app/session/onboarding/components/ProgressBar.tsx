import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { ProgressBar as AstryxProgressBar } from "@astryxdesign/core/ProgressBar";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { PHASE_FRIENDLY_NAME, computePhases } from "./labels";
import { STAGES, type StageStatus } from "../support";
import { setupProgress, setupPhase } from "./progress-state";

export function ProgressBar({ current, results, compact = false, blocked = false }: {
  current: number;
  results: Record<number, StageStatus>;
  compact?: boolean;
  blocked?: boolean;
}) {
  const phases = computePhases();
  const { step, completed } = setupProgress(current, results, STAGES.length);
  return (
    <VStack as="section" aria-label="Setup progress" gap={5} style={{ width: "100%", minWidth: 0 }}>
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={3}>
          <Text weight="semibold">Your setup</Text>
          <Text type="supporting" color="secondary">Step {step} of {STAGES.length}</Text>
        </HStack>
        <AstryxProgressBar label="Setup steps completed" value={completed} max={STAGES.length} variant="accent" isLabelHidden formatValueLabel={(value, max) => `${value} of ${max} steps completed`} />
        <Text type="supporting" color="secondary">{completed} of {STAGES.length} steps completed</Text>
      </VStack>
      {!compact && <VStack as="ol" gap={1} style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {phases.map(phase => {
          const phaseState = setupPhase(phase, step, results, blocked);
          const { active } = phaseState;
          const label = phase.start === 7 ? "Camera setup" : phase.start === 10 ? "Microphone" : PHASE_FRIENDLY_NAME[phase.group] ?? phase.group;
          return <HStack as="li" key={phase.start} gap={3} align="start" aria-current={active ? "step" : undefined} style={{ padding: "var(--spacing-3)", borderRadius: "var(--radius-element)", background: active ? "var(--color-background-card)" : "transparent" }}>
            <StatusDot variant={phaseState.variant} label={phaseState.label} />
            <VStack gap={1} style={{ minWidth: 0 }}>
              <Text weight={active ? "semibold" : "normal"} color={active ? "primary" : "secondary"}>{label}</Text>
              <Text type="supporting" color="secondary">{phaseState.label}</Text>
            </VStack>
          </HStack>;
        })}
      </VStack>}
      {!compact && <Text type="supporting" color="secondary" style={{ paddingInline: "var(--spacing-3)" }}>Checks run in order. If a step needs your attention, follow the guidance beside it.</Text>}
    </VStack>
  );
}
