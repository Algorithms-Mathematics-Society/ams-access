import type { CheckKind, ReadinessRequirement, SessionPolicy } from "@ams/api-client";

export type ReadinessObservation = "pass" | "failure" | "probe_unavailable" | "unsupported";

export type ReadinessAction = {
  decision: "pending" | "pass" | "warn" | "block";
  requirement: ReadinessRequirement | null;
};

export function readinessAction(
  policy: SessionPolicy | null,
  kind: CheckKind,
  observation: ReadinessObservation
): ReadinessAction {
  if (!policy) return { decision: "pending", requirement: null };
  const requirement = [...policy.checks].reverse().find((check) => check.kind === kind) ?? null;
  if (!requirement) return { decision: "pending", requirement: null };
  if (observation === "pass") return { decision: "pass", requirement };
  const severity =
    observation === "unsupported"
      ? (requirement.unsupported_severity ?? "warning")
      : requirement.severity;
  return {
    decision: requirement.required && severity === "block" ? "block" : "warn",
    requirement,
  };
}
