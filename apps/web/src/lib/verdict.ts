// Single source of truth for judge-verdict colors and plain-language labels,
// shared by the exam screen (session/contest/client.tsx) and the results page
// so a verdict never renders differently across screens. Colors resolve to the
// --verdict-* tokens in globals.css. UI only — verdict codes are unchanged.

export type VerdictCode =
  | "AC"
  | "WA"
  | "TLE"
  | "MLE"
  | "RE"
  | "CE"
  | "OLE"
  | "IE"
  | "RUNNING"
  | "QUEUED"
  | "UNATTEMPTED"
  | string
  | null
  | undefined;

export function verdictColor(v: VerdictCode): string {
  switch (v) {
    case "AC":
      return "var(--verdict-ac)";
    case "WA":
      return "var(--verdict-wa)";
    case "TLE":
      return "var(--verdict-tle)";
    case "MLE":
    case "OLE":
      return "var(--verdict-mle)";
    case "RE":
      return "var(--verdict-re)";
    case "CE":
      return "var(--verdict-ce)";
    case "IE":
      return "var(--verdict-ie)";
    case "RUNNING":
    case "QUEUED":
      return "var(--verdict-running)";
    case "UNATTEMPTED":
      return "var(--verdict-none)";
    default:
      return "var(--verdict-none)";
  }
}

// Standard CP verdict names — used by VerdictBadge and any text that names a verdict.
export function verdictLabel(v: VerdictCode): string {
  if (v == null || v === "") return "—";
  switch (v) {
    case "AC":
      return "Accepted";
    case "WA":
      return "Wrong Answer";
    case "TLE":
      return "Time Limit Exceeded";
    case "MLE":
      return "Memory Limit Exceeded";
    case "RE":
      return "Runtime Error";
    case "CE":
      return "Compilation Error";
    case "OLE":
      return "Output Limit Exceeded";
    case "IE":
      return "Internal Error";
    case "RUNNING":
      return "Running";
    case "QUEUED":
      return "Queued";
    case "UNATTEMPTED":
      return "Not attempted";
    default:
      return (v as string) ?? "—";
  }
}

// The bare verdict code for compact badges/chips (e.g. "WA"). Nullish → em-dash.
export function verdictShort(v: VerdictCode): string {
  if (v == null || v === "") return "—";
  return v as string;
}

// A verdict is terminal once the judge has finished — RUNNING/QUEUED/pending are
// not. Drives the one-shot verdict-reveal animation (only fire when resolved).
export function isTerminalVerdict(v: VerdictCode): boolean {
  switch (v) {
    case "AC":
    case "WA":
    case "TLE":
    case "MLE":
    case "RE":
    case "CE":
    case "OLE":
    case "IE":
      return true;
    default:
      return false;
  }
}
