import type { ReadinessReport } from "@ams/api-client";

export type { ReadinessReport };

export type InvitedContest = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  timezone?: string;
  status: string;
  org_name: string;
  question_count: number;
  verification_window_minutes?: number | null;
};

export type ReadinessStatus = "ok" | "fail" | "checking";

export type ReadinessState = {
  camera: ReadinessStatus;
  mic: ReadinessStatus;
  network: ReadinessStatus;
  keyboard: ReadinessStatus;
  restrictedApps: ReadinessStatus;
  vm: ReadinessStatus;
  platform: ReadinessStatus;
};

export type SecurityLogEntry = { id: string; text: string };

export type PlatformInfo = {
  os: string;
  arch: string;
  family: string;
};

export type SecurityEnvironment = {
  os: string;
  display_server: string;
  ld_preload_injection: boolean;
  ptrace_scope: number;
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

export type NetworkCheckResult = {
  reachable: boolean;
  latency_ms: number | null;
  jitter_ms: number | null;
  quality: string;
};

export type SecurityScanSnapshot = {
  platform: PlatformInfo | null;
  env: SecurityEnvironment | null;
  processes: ProcessScanResult | null;
  virt: VirtDetectionResult | null;
  network: NetworkCheckResult | null;
};

export type TelemetryQueryState = SecurityScanSnapshot & {
  lastScannedAt: number | null;
  isLoading: boolean;
  error: string | null;
};

export type FullTelemetry = {
  platform: PlatformInfo;
  env: SecurityEnvironment;
  processes: ProcessScanResult;
  virt: VirtDetectionResult;
  network: NetworkCheckResult | null;
};

export type InviteCodeResolveResponse = {
  contest?: InvitedContest;
  eligibility_status: string;
  session_window_state?: string;
  blocked_reason?: string;
  active_session_id?: string;
};

export type ActiveSession = {
  id: string;
  contest_id: string;
  contest_title?: string;
  updated_at?: string;
  candidate_email?: string;
  status?: string;
  expires_at?: string;
};

export type ResumeVerificationState = "none" | "unverified" | "checking" | "verified" | "invalid";

export type ContestEntryPhase =
  | "draft"
  | "too_early"
  | "verification_open"
  | "live"
  | "ended"
  | "blocked"
  | "metadata_unavailable";

export type ContestEntryState = {
  phase: ContestEntryPhase;
  canEnter: boolean;
  sessionType: "new" | "resume";
  ctaLabel: string;
  statusLabel: string;
  timingLabel: string;
  disabledTitle?: string;
};
