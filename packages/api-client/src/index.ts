import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Subscribe to a native Tauri event. apps/web must route all Tauri access
 * through this package (never import @tauri-apps/api directly).
 */
export function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!(globalThis as { __TAURI__?: unknown }).__TAURI__) {
    return Promise.resolve(() => {}); // no-op unlisten in a non-Tauri (browser) context
  }
  return tauriListen<T>(event, (e) => handler(e.payload as T));
}

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
  | "clock_integrity"
  | "keyboard_lockdown"
  | "restricted_apps"
  | "virtualization"
  | "platform"
  | "external_display"
  | "remote_server";

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
  | "network_helper_unavailable"
  | "keyboard_lockdown_unavailable"
  | "restricted_application_detected"
  | "virtualization_detected"
  | "unsupported_platform"
  | "clock_skew_detected"
  | "external_display_detected"
  | "external_display_indeterminate"
  | "remote_server_detected"
  | "probe_unavailable";

export type RecoveryAction =
  | "select_contest"
  | "register_device"
  | "grant_media_permission"
  | "connect_network"
  | "install_network_helper"
  | "close_restricted_applications"
  | "use_physical_machine"
  | "use_supported_platform"
  | "disconnect_extra_displays"
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
  /** Linux only: whether the privileged egress-lockdown helper is installed and
   *  reachable. Flows opaquely back into evaluate_session_readiness; `Some(false)`
   *  hard-blocks a strict contest. `null`/absent on other platforms (inert). */
  network_helper_ready?: boolean | null;
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
  "clock_integrity",
  "camera",
  "microphone",
  "external_display",
  "remote_server",
];

/**
 * Platform-aware policy builder — the TS mirror of
 * `SessionPolicy::for_profile_with_platform` in core-rs/src/exam/mod.rs.
 *
 * The Rust side re-seeds the non-windows baseline in `merge_requirements` and
 * overlays `policy.checks`, so the policy emitted here is what makes Windows
 * enforcement real: on a strict Windows session, `camera`, `external_display`
 * and `remote_server` are required + block; everywhere else (non-strict, or
 * non-Windows) they stay advisory so macOS/Linux readiness is unchanged.
 */
export function sessionPolicy(profile: EnforcementProfile, platform?: string): SessionPolicy {
  const strict = profile === "strict_contest";
  // Prefix match so "windows_no_admin" (unelevated Windows) is still treated as
  // Windows — mirrors core-rs; otherwise enforcement disarms on non-admin machines.
  const isWindows = typeof platform === "string" && platform.toLowerCase().startsWith("windows");
  const isMacos = typeof platform === "string" && platform.toLowerCase().startsWith("macos");
  const isWindowsNoAdmin =
    typeof platform === "string" && platform.toLowerCase() === "windows_no_admin";
  return {
    profile,
    checks: POLICY_CHECKS.map((kind) => {
      // Microphone is advisory-only on every profile — many contest machines
      // (lab desktops, headless setups) have no audio input.
      if (kind === "microphone") {
        return {
          kind,
          required: false,
          severity: "warning" as const,
          organizer_override_allowed: !strict,
        };
      }
      // Network is advisory on every profile: egress lockdown is applied
      // best-effort during the contest and is NOT a hard entry gate. A failing/
      // uncollected network surfaces as a warning, never a block. (Mirrors
      // core-rs SessionPolicy + the Microphone precedent above.)
      if (kind === "network") {
        return {
          kind,
          required: false,
          severity: "warning" as const,
          organizer_override_allowed: !strict,
        };
      }
      // Camera and the two Windows-only entry checks (external_display,
      // remote_server) become hard, blocking requirements ONLY under a strict
      // Windows session; everywhere else they remain advisory so macOS/Linux
      // behavior is identical to before.
      if (kind === "camera" || kind === "external_display" || kind === "remote_server") {
        const block = strict && isWindows;
        return {
          kind,
          required: block,
          severity: block ? ("block" as const) : ("warning" as const),
          organizer_override_allowed: !strict,
        };
      }
      // KeyboardLockdown is advisory (warning, not required) on macOS only.
      // CGEventTap requires Accessibility permission which is often unavailable
      // at contest time on macOS. Linux and Windows retain required+block so
      // their lockdown invariants are unchanged.
      if (kind === "keyboard_lockdown" && isMacos) {
        return {
          kind,
          required: false,
          severity: "warning" as const,
          organizer_override_allowed: !strict,
        };
      }
      // Unelevated Windows: keep auto-elevation + the Relaunch-as-Administrator
      // recovery, but downgrade the platform gate to a warning so a candidate who
      // truly cannot elevate is not trapped (no network firewall there; keyboard +
      // process proctoring still hold). A genuinely unsupported OS stays blocking.
      if (kind === "platform" && isWindowsNoAdmin) {
        return {
          kind,
          required: false,
          severity: "warning" as const,
          organizer_override_allowed: !strict,
        };
      }
      return {
        kind,
        required: strict,
        severity: strict ? ("block" as const) : ("warning" as const),
        organizer_override_allowed: !strict,
      };
    }),
  };
}

export function strictContestPolicy(platform?: string): SessionPolicy {
  return sessionPolicy("strict_contest", platform);
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
  if (typeof window !== "undefined") {
    const target = new URL(apiUrl, window.location.href);
    if (target.origin !== window.location.origin) {
      // The public overrides endpoint is not deployed on the remote judge API.
      return [];
    }
  }
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
