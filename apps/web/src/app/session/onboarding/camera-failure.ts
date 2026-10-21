import { CameraTimeoutError } from "../../../lib/camera-readiness.ts";

export type CameraFailure = "denied" | "missing" | "busy" | "timeout" | "not_ready";

/** Browser exception names take precedence over localized or conflicting text. */
export function classifyCameraFailure(error: unknown): CameraFailure {
  if (error instanceof CameraTimeoutError) return "timeout";
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    case "TimeoutError":
      return "timeout";
    case "AbortError":
    case "InvalidStateError":
    case "NotSupportedError":
    case "OverconstrainedError":
      return "not_ready";
  }
  // Older WebViews and our shared acquisition helper may return generic Error.
  const message = error instanceof Error ? error.message : String(error);
  if (!name || name === "Error") {
    if (/denied|permission|not allowed/i.test(message)) return "denied";
    if (/not found|no camera|not available/i.test(message)) return "missing";
    if (/busy|in use|not readable/i.test(message)) return "busy";
    if (/timed out|timeout/i.test(message)) return "timeout";
  }
  return "not_ready";
}
