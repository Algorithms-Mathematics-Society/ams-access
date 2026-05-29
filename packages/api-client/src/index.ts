import { invoke } from "@tauri-apps/api/core";

export { invoke };

export type CheckKind =
  | "contest_id"
  | "device_id"
  | "camera"
  | "microphone"
  | "network"
  | "keyboard_lockdown"
  | "restricted_apps"
  | "virtualization"
  | "platform";

export type EnforcementProfile = "practice" | "internal_pilot" | "strict_contest";
export type BlockingSeverity = "info" | "warning" | "block";
export type CheckOutcome = "pass" | "warn" | "fail" | "unknown";
export type EnforcementDecision = "allowed" | "allowed_with_warnings" | "blocked";

export type FailureReasonCode =
  | "contest_id_missing"
  | "device_id_missing"
  | "camera_unavailable"
  | "microphone_unavailable"
  | "network_unreachable"
  | "keyboard_lockdown_unavailable"
  | "restricted_application_detected"
  | "virtualization_detected"
  | "unsupported_platform"
  | "probe_unavailable";

export type RecoveryAction =
  | "select_contest"
  | "register_device"
  | "grant_media_permission"
  | "connect_network"
  | "close_restricted_applications"
  | "use_physical_machine"
  | "use_supported_platform"
  | "retry_readiness_scan"
  | "contact_organizer";

export type ReadinessRequirement = {
  kind: CheckKind;
  required: boolean;
  severity: BlockingSeverity;
  organizer_override_allowed: boolean;
};

export type SessionPolicy = {
  profile: EnforcementProfile;
  checks: ReadinessRequirement[];
};

export type NetworkCheckResult = {
  reachable: boolean;
  latency_ms: number | null;
  jitter_ms: number | null;
  quality: string;
};

export type KeyboardInterceptResult = {
  active: boolean;
  method: string;
  platform: string;
};

export type ProcessScanResult = {
  found: string[];
  clean: boolean;
};

export type VirtDetectionResult = {
  detected: boolean;
  platform: string | null;
  confidence: string;
};

export type DeviceState = {
  platform: string | null;
  camera_available: boolean | null;
  microphone_available: boolean | null;
  network: NetworkCheckResult | null;
  keyboard: KeyboardInterceptResult | null;
  restricted_processes: ProcessScanResult | null;
  virtualization: VirtDetectionResult | null;
};

export type ReadinessCheck = {
  kind: CheckKind;
  required: boolean;
  severity: BlockingSeverity;
  outcome: CheckOutcome;
  blocking: boolean;
  organizer_override_allowed: boolean;
  reason: FailureReasonCode | null;
  recovery_actions: RecoveryAction[];
  detail: string | null;
};

export type ReadinessReport = {
  contest_id: string | null;
  device_id: string | null;
  policy_profile: EnforcementProfile;
  decision: EnforcementDecision;
  checks: ReadinessCheck[];
  required_checks: ReadinessCheck[];
  optional_checks: ReadinessCheck[];
  blocking_reasons: FailureReasonCode[];
  generated_at_ms: number;
};

const POLICY_CHECKS: CheckKind[] = [
  "contest_id",
  "device_id",
  "platform",
  "restricted_apps",
  "virtualization",
  "keyboard_lockdown",
  "network",
  "camera",
  "microphone",
];

export function sessionPolicy(profile: EnforcementProfile): SessionPolicy {
  const strict = profile === "strict_contest";
  return {
    profile,
    checks: POLICY_CHECKS.map((kind) => ({
      kind,
      required: strict,
      severity: strict ? "block" : "warning",
      organizer_override_allowed: !strict,
    })),
  };
}

export function strictContestPolicy(): SessionPolicy {
  return sessionPolicy("strict_contest");
}

export async function collectDeviceState(options: {
  networkHost?: string;
  cameraAvailable?: boolean | null;
  microphoneAvailable?: boolean | null;
  activateKeyboard?: boolean;
}): Promise<DeviceState> {
  return invoke<DeviceState>("collect_device_state", {
    networkHost: options.networkHost ?? null,
    cameraAvailable: options.cameraAvailable ?? null,
    microphoneAvailable: options.microphoneAvailable ?? null,
    activateKeyboard: options.activateKeyboard ?? false,
  });
}

export async function evaluateSessionReadiness(options: {
  policy?: SessionPolicy | null;
  contestId?: string | null;
  deviceId?: string | null;
  deviceState: DeviceState;
}): Promise<ReadinessReport> {
  return invoke<ReadinessReport>("evaluate_session_readiness", {
    policy: options.policy ?? null,
    contestId: options.contestId ?? null,
    deviceId: options.deviceId ?? null,
    deviceState: options.deviceState,
  });
}

export async function runSessionReadiness(options: {
  networkHost?: string;
  contestId?: string | null;
  deviceId?: string | null;
  cameraAvailable?: boolean | null;
  microphoneAvailable?: boolean | null;
  activateKeyboard?: boolean;
  policy?: SessionPolicy | null;
}): Promise<ReadinessReport> {
  const deviceState = await collectDeviceState(options);
  return evaluateSessionReadiness({
    policy: options.policy ?? strictContestPolicy(),
    contestId: options.contestId ?? null,
    deviceId: options.deviceId ?? null,
    deviceState,
  });
}

export async function startSecureSession(options: {
  policy?: SessionPolicy | null;
  contestId?: string | null;
  deviceId?: string | null;
  deviceState: DeviceState;
}): Promise<ReadinessReport> {
  return invoke<ReadinessReport>("start_secure_session", {
    policy: options.policy ?? strictContestPolicy(),
    contestId: options.contestId ?? null,
    deviceId: options.deviceId ?? null,
    deviceState: options.deviceState,
  });
}
