import type { ReadinessReport } from "@ams/api-client";

/** Use exactly the same population as the summary, including unknown probes. */
export function advisoryReportChecks(report?: ReadinessReport | null) {
  if (!report) return [];
  return (report.decision === "blocked" ? report.optional_checks : report.checks).filter(
    (check) => check.outcome !== "pass"
  );
}
