export async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const tauri = (
    globalThis as unknown as {
      __TAURI__?: {
        core?: { invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<T> };
      };
    }
  ).__TAURI__;
  const fn = tauri?.core?.invoke;
  if (!fn) {
    throw new Error("Tauri bridge unavailable");
  }
  return fn(command, args);
}

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
  | "clock_skew_detected"
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
  /** Device clock vs contest server (server − local, ms); null = no signal. */
  clock_skew_ms?: number | null;
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
    checks: POLICY_CHECKS.map((kind) => {
      // Camera and microphone are advisory-only on EVERY profile — this must
      // mirror SessionPolicy::for_profile in core-rs/src/exam/mod.rs (the Rust
      // side is the source of truth). The microphone starts muted and the
      // camera can be toggled in the contest area; both toggles are
      // audit-logged, so neither device may block entry here.
      const advisory = kind === "camera" || kind === "microphone";
      return {
        kind,
        required: strict && !advisory,
        severity: strict && !advisory ? ("block" as const) : ("warning" as const),
        organizer_override_allowed: !strict,
      };
    }),
  };
}

export function strictContestPolicy(): SessionPolicy {
  return sessionPolicy("strict_contest");
}

export async function collectDeviceState(options: {
  networkHost?: string;
  /** Contest API base URL — enables the device-clock skew measurement. */
  apiUrl?: string | null;
  cameraAvailable?: boolean | null;
  microphoneAvailable?: boolean | null;
  activateKeyboard?: boolean;
}): Promise<DeviceState> {
  return invoke<DeviceState>("collect_device_state", {
    networkHost: options.networkHost ?? null,
    apiUrl: options.apiUrl ?? null,
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
  apiUrl?: string | null;
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
  /** Contest API base URL — the entry-gate readiness report is delivered
   *  there (`POST /contests/:id/readiness-reports`) so the server has a
   *  durable record of what this device claimed. */
  apiUrl?: string | null;
}): Promise<ReadinessReport> {
  return invoke<ReadinessReport>("start_secure_session", {
    policy: options.policy ?? strictContestPolicy(),
    contestId: options.contestId ?? null,
    deviceId: options.deviceId ?? null,
    deviceState: options.deviceState,
    apiUrl: options.apiUrl ?? null,
  });
}

// ── Organizer overrides (live proctor "resolve" channel) ─────────────────────
//
// Organizers can remotely waive a failing readiness check for a specific
// device. The dashboard issues override grants server-side; the candidate app
// fetches them (TLS to the authoritative API is the trust boundary — an
// override only LOOSENS policy, so no client-side signature check is needed)
// and injects them as non-required requirements, which core-rs's
// merge_requirements overlays onto the base policy.

export type OrganizerOverride = {
  check_kind: CheckKind;
  /** Epoch ms after which the grant is ignored. */
  expires_at_ms: number;
  issued_by?: string;
};

/** Identity checks can never be waived remotely. */
const NON_OVERRIDABLE_CHECKS: CheckKind[] = ["contest_id", "device_id"];

const KNOWN_CHECK_KINDS = new Set<string>(POLICY_CHECKS);

export async function fetchOrganizerOverrides(
  apiUrl: string,
  contestId: string,
  deviceId: string
): Promise<OrganizerOverride[]> {
  try {
    const res = await fetch(
      `${apiUrl}/contests/${encodeURIComponent(contestId)}/overrides?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const list = Array.isArray(body)
      ? body
      : Array.isArray((body as { overrides?: unknown[] })?.overrides)
        ? (body as { overrides: unknown[] }).overrides
        : [];
    const now = Date.now();
    return list.filter((entry): entry is OrganizerOverride => {
      const candidate = entry as Partial<OrganizerOverride> | null;
      return (
        !!candidate &&
        typeof candidate.check_kind === "string" &&
        KNOWN_CHECK_KINDS.has(candidate.check_kind) &&
        !NON_OVERRIDABLE_CHECKS.includes(candidate.check_kind as CheckKind) &&
        typeof candidate.expires_at_ms === "number" &&
        candidate.expires_at_ms > now
      );
    });
  } catch {
    // No overrides endpoint / offline — readiness proceeds with base policy.
    return [];
  }
}

export function applyOrganizerOverrides(
  policy: SessionPolicy,
  overrides: OrganizerOverride[]
): SessionPolicy {
  if (overrides.length === 0) return policy;
  return {
    ...policy,
    checks: [
      ...policy.checks,
      // Appended last so merge_requirements lets the override win by kind.
      ...overrides.map((grant) => ({
        kind: grant.check_kind,
        required: false,
        severity: "warning" as const,
        organizer_override_allowed: true,
      })),
    ],
  };
}
