import type { StageStatus } from "../support";

/** Display only: a retry starts a new pass through the current and later steps.
 * Preserve the orchestrator's stored results, but do not present those old
 * results as completion of the checks that are now being run again.
 */
export function setupProgress(current: number, results: Record<number, StageStatus>, total: number) {
  const step = Math.min(Math.max(current, 1), total);
  const completed = Object.entries(results).filter(([id, status]) =>
    Number(id) >= 1 && Number(id) < step && (status === "pass" || status === "warn")
  ).length;
  return { step, completed };
}

export function setupPhase(
  phase: { start: number; end: number },
  current: number,
  results: Record<number, StageStatus>,
  blocked = false,
) {
  const active = current >= phase.start && current <= phase.end;
  const statuses = Array.from({ length: phase.end - phase.start + 1 }, (_, i) => {
    const id = phase.start + i;
    return id < current ? results[id] : undefined;
  });
  const failed = statuses.some(status => status === "fail");
  const warned = statuses.some(status => status === "warn");
  const allResolved = statuses.every(status => status === "pass" || status === "warn");
  if ((active && blocked) || failed) return { active, label: "Needs action", variant: "error" as const };
  if (active) return {
    active,
    label: warned ? "In progress · warning recorded" : "In progress",
    variant: warned ? "warning" as const : "accent" as const,
  };
  if (phase.start > current) return { active, label: "Upcoming", variant: "neutral" as const };
  if (!allResolved) return { active, label: "Not fully checked", variant: "neutral" as const };
  return {
    active,
    label: warned ? "Complete with warnings" : "Complete",
    variant: warned ? "warning" as const : "success" as const,
  };
}
