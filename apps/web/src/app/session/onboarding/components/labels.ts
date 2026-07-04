import { type ReadinessCheck, type ReadinessReport } from "@ams/api-client";
import { STAGES } from "../support";

// ─── Readiness check-kind labels ──────────────────────────────────────────────
//
// Human-readable labels for the readiness check kinds, used when a blocked
// readiness report comes back from the Rust evaluator (`start_secure_session`
// returns Err(JSON-of-report) on a Blocked decision) so the candidate sees a
// clear message instead of a raw JSON blob or an "unknown" kind. The two
// Windows-only entry checks — `external_display` and `remote_server` — are
// included here so they render with a real label and their detail string.
export const CHECK_KIND_LABELS: Record<string, string> = {
  contest_id: "Contest link",
  device_id: "Device registration",
  camera: "Camera",
  microphone: "Microphone",
  network: "Network connection",
  keyboard_lockdown: "Keyboard lockdown",
  restricted_apps: "Restricted applications",
  virtualization: "Virtual machine check",
  platform: "Platform compatibility",
  external_display: "External display",
  remote_server: "Remote-desktop session",
};

export function checkKindLabel(kind: string): string {
  return CHECK_KIND_LABELS[kind] ?? kind;
}

/**
 * Turn a Blocked `ReadinessReport` (the JSON string thrown by
 * `start_secure_session`) into a candidate-facing message. Each blocking check
 * is rendered as "<label> — <detail>" so the Windows-only `external_display` /
 * `remote_server` blocks surface their contract detail strings ("A second or
 * wireless display is connected…", "This machine is hosting a remote-desktop
 * session.") rather than an opaque code. Returns null when `raw` is not a
 * readiness report, so callers can fall back to the original error text.
 */
export function readinessBlockMessage(raw: string): string | null {
  let report: ReadinessReport;
  try {
    report = JSON.parse(raw) as ReadinessReport;
  } catch {
    return null;
  }
  if (!report || report.decision !== "blocked" || !Array.isArray(report.checks)) {
    return null;
  }
  const blocking = report.checks.filter(
    (c): c is ReadinessCheck => !!c && c.blocking && c.outcome === "fail"
  );
  if (blocking.length === 0) return null;
  const lines = blocking.map((c) => {
    const label = checkKindLabel(c.kind);
    return c.detail ? `${label} — ${c.detail}` : label;
  });
  return `Your device isn't ready for a secured contest:\n${lines.join("\n")}`;
}

// ─── Progress indicator labels ────────────────────────────────────────────────

// Friendly, de-jargoned names for each setup phase (the raw STAGES groups still
// drive logic elsewhere; this is display only).
export const PHASE_FRIENDLY_NAME: Record<string, string> = {
  "Workspace Lockdown": "Setting up your workspace",
  "System Checks": "Checking your device",
  "Media Setup": "Camera & microphone",
  "Identity Scan": "Quick identity check",
  Finalizing: "Finishing up",
};

// Contiguous runs of the same group, in stage order — the candidate-facing "phases".
export function computePhases(): { group: string; start: number; end: number }[] {
  const phases: { group: string; start: number; end: number }[] = [];
  for (const s of STAGES) {
    const last = phases[phases.length - 1];
    if (last && last.group === s.group) {
      last.end = s.id;
    } else {
      phases.push({ group: s.group, start: s.id, end: s.id });
    }
  }
  return phases;
}
