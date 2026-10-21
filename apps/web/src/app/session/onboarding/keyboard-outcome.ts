export type KeyboardInterceptResult = {
  active: boolean;
  method: string;
  platform: string;
};

export type KeyboardOutcome =
  | { kind: "control_active"; shouldPass: true }
  | {
      kind: "linux_control_checked" | "detection_only" | "unsupported" | "unavailable";
      shouldPass: false;
    }
  | {
      kind: "permission";
      permission: "accessibility" | "input_monitoring";
      shouldPass: false;
    };

export function classifyKeyboardOutcome(result: KeyboardInterceptResult | null): KeyboardOutcome {
  if (!result) return { kind: "unavailable", shouldPass: false };
  if (result.method === "accessibility_denied")
    return { kind: "permission", permission: "accessibility", shouldPass: false };
  if (result.method === "input_monitoring_denied")
    return { kind: "permission", permission: "input_monitoring", shouldPass: false };

  const platform = result.platform.toLowerCase();
  const method = result.method.toLowerCase();
  if (platform === "linux") {
    if (method.includes("unsupported") || method === "none")
      return { kind: "unsupported", shouldPass: false };
    if (method.includes("detect") || method.includes("monitor") || method.includes("watch"))
      return { kind: "detection_only", shouldPass: false };
    if (result.active) return { kind: "linux_control_checked", shouldPass: false };
    return { kind: "unavailable", shouldPass: false };
  }

  if (result.active) return { kind: "control_active", shouldPass: true };
  if (method === "unsupported" || method === "none")
    return { kind: "unsupported", shouldPass: false };
  return { kind: "unavailable", shouldPass: false };
}
