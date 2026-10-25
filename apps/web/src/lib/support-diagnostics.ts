/** Automatic support context is deliberately allowlisted. Free-form notes are user-authored. */
const SOURCES = new Set([
  "home_dashboard",
  "resume_flow",
  "resolve_modal",
  "dry_run",
  "readiness_modal",
  "session_readiness",
]);
const ISSUES = new Set([
  "camera",
  "microphone",
  "network",
  "keyboard",
  "display",
  "platform",
  "battery",
  "fullscreen",
  "processes",
  "permissions",
  "screen_capture",
  "mic",
  "restrictedApps",
  "vm",
]);
const RESUME = new Set(["PENDING", "APPROVED", "DENIED", "REJECTED", "CONSUMED", "EXPIRED"]);
const CHECKS = new Set(["pass", "warn", "fail", "ok", "pending", "skipped", "unknown"]);
export function supportDiagnostics(
  input: Record<string, unknown> | undefined
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (!input) return output;
  if (typeof input.source === "string" && SOURCES.has(input.source)) output.source = input.source;
  if (typeof input.issue === "string" && ISSUES.has(input.issue)) output.issue = input.issue;
  if (typeof input.resume_status === "string" && RESUME.has(input.resume_status))
    output.resume_status = input.resume_status;
  if (input.checks && typeof input.checks === "object" && !Array.isArray(input.checks)) {
    const counts: Record<string, number> = {};
    for (const value of Object.values(input.checks).slice(0, 32)) {
      if (typeof value === "string" && CHECKS.has(value)) counts[value] = (counts[value] ?? 0) + 1;
    }
    if (Object.keys(counts).length) output.check_counts = counts;
  }
  return output;
}
