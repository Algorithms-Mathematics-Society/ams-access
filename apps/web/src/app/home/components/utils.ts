import { sessionPolicy, type ReadinessCheck, type ReadinessReport } from "@ams/api-client";
import { resolveApiBase } from "@/lib/api-base";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import type {
  InvitedContest,
  ReadinessState,
  ReadinessStatus,
  SecurityScanSnapshot,
  ContestEntryState,
  ContestEntryPhase,
} from "./types";

export { sessionPolicy };
export type { ReadinessCheck, ReadinessReport };

export const API_URL = resolveApiBase();

export const TELEMETRY_STALE_MS = 30_000;
export const DEFAULT_VERIFICATION_WINDOW_MINUTES = 20;
export const CAMERA_RETRY_DELAY_MS = 180;
export const CAMERA_START_TIMEOUT_MS = 6000;
export const READINESS_TIMEOUT_MS = {
  media: 2000,
  platform: 2500,
  process: 3500,
  virtualization: 3500,
  network: 5000,
};

export const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;
export const UNLOCKED_CONTESTS_KEY = STORAGE_KEYS.UNLOCKED_CONTESTS;

export const EMPTY_TELEMETRY = {
  platform: null,
  env: null,
  processes: null,
  virt: null,
  network: null,
  lastScannedAt: null,
  isLoading: false,
  error: null,
};

// ── Contest list helpers ──────────────────────────────────────

export function mergeContestLists(
  primary: InvitedContest[],
  secondary: InvitedContest[]
): InvitedContest[] {
  const byId = new Map<string, InvitedContest>();
  for (const c of secondary) byId.set(c.id, c);
  for (const c of primary) byId.set(c.id, c);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  );
}

export function loadUnlockedContests(): InvitedContest[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_CONTESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InvitedContest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUnlockedContests(list: InvitedContest[]) {
  localStorage.setItem(UNLOCKED_CONTESTS_KEY, JSON.stringify(list));
}

// ── Device identity ──────────────────────────────────────────

export function getOrCreateDeviceId() {
  const existing = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, generated);
  return generated;
}

export function getNetworkProbeHost() {
  try {
    return new URL(API_URL).hostname;
  } catch {}
  return "localhost";
}

// ── Async helpers ─────────────────────────────────────────────

export function withUiTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer));
  });
}

export async function getBrowserMediaAvailability() {
  const devices = await withUiTimeout(
    navigator.mediaDevices?.enumerateDevices?.() ?? Promise.resolve([]),
    READINESS_TIMEOUT_MS.media
  );
  if (!devices) return { cameraAvailable: false, microphoneAvailable: false };
  return {
    cameraAvailable: devices.some((d) => d.kind === "videoinput"),
    microphoneAvailable: devices.some((d) => d.kind === "audioinput"),
  };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  ms = 8000
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  ms = 8000
): Promise<MediaStream> {
  let timedOut = false;
  const request = navigator.mediaDevices.getUserMedia(constraints);
  request.then((stream) => {
    if (timedOut) {
      stream.getTracks().forEach((track) => track.stop());
    }
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Camera request timed out"));
    }, ms);

    request
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isCameraReleaseRaceError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === "NotReadableError" ||
    name === "AbortError" ||
    msg.includes("NotReadable") ||
    msg.includes("Abort") ||
    msg.toLowerCase().includes("busy")
  );
}

export function describeMediaError(err: unknown, kind: "camera" | "microphone") {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const text = `${name} ${message}`.toLowerCase();

  if (text.includes("notallowed") || text.includes("permission") || text.includes("denied")) {
    return `${kind === "camera" ? "Camera" : "Microphone"} permission denied`;
  }
  if (text.includes("notfound") || text.includes("no device") || text.includes("not found")) {
    return `No ${kind} found`;
  }
  if (text.includes("notreadable") || text.includes("abort") || text.includes("busy")) {
    return `${kind === "camera" ? "Camera" : "Microphone"} is busy or unavailable`;
  }
  return `${kind === "camera" ? "Camera" : "Microphone"} check failed`;
}

// ── Readiness helpers ─────────────────────────────────────────

export function statusFromReport(report: ReadinessReport, kind: string): ReadinessStatus {
  const check = report.checks.find((item) => item.kind === kind);
  if (!check) return "fail";
  return check.outcome === "pass" ? "ok" : "fail";
}

export function readinessFromReport(report: ReadinessReport): ReadinessState {
  return {
    camera: statusFromReport(report, "camera"),
    mic: statusFromReport(report, "microphone"),
    network: statusFromReport(report, "network"),
    keyboard: statusFromReport(report, "keyboard_lockdown"),
    restrictedApps: statusFromReport(report, "restricted_apps"),
    vm: statusFromReport(report, "virtualization"),
    platform: statusFromReport(report, "platform"),
  };
}

export function readinessCheckStatus(check: ReadinessCheck): ReadinessStatus {
  if (check.outcome === "pass") return "ok";
  if (check.outcome === "unknown") return "checking";
  return "fail";
}

export function readinessCheckCopy(kind: ReadinessCheck["kind"]) {
  switch (kind) {
    case "network":
      return { label: "Network Connectivity", success: "Network stable", fail: "Network unstable" };
    case "microphone":
      return { label: "Audio Telemetry", success: "Audio detected", fail: "Audio check pending" };
    case "camera":
      return { label: "Optical Stream", success: "Camera active", fail: "Camera offline" };
    case "virtualization":
      return {
        label: "Virtualization Shield",
        success: "Physical machine clear",
        fail: "Virtualization flagged",
      };
    case "keyboard_lockdown":
      return {
        label: "Keyboard Lockdown",
        success: "Keyboard lock available",
        fail: "Keyboard lock unavailable",
      };
    case "restricted_apps":
      return {
        label: "Restricted Processes",
        success: "Process scan clear",
        fail: "Restricted app flagged",
      };
    case "platform":
      return {
        label: "Native Platform",
        success: "Platform supported",
        fail: "Platform unsupported",
      };
    case "contest_id":
      return { label: "Contest Binding", success: "Contest linked", fail: "Contest missing" };
    case "device_id":
      return { label: "Device Registration", success: "Device registered", fail: "Device missing" };
    default:
      return { label: String(kind), success: "Check passed", fail: "Check failed" };
  }
}

export function toPreflightPolicyItem(check: ReadinessCheck, scope: "required" | "optional") {
  const copy = readinessCheckCopy(check.kind);
  const warningLabel = scope === "optional" ? "Optional warning" : "Warning";
  return {
    key: scope + "-" + check.kind,
    label: copy.label,
    status: readinessCheckStatus(check),
    successLabel: copy.success,
    failLabel: check.outcome === "warn" ? warningLabel : copy.fail,
  };
}

// ── Contest entry state ───────────────────────────────────────

export function formatStartsIn(startAt: string, now: number) {
  const diff = new Date(startAt).getTime() - now;
  if (diff <= 0) return "Starting now";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return minutes === 1 ? "1m" : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function getVerificationWindowMinutes(c: InvitedContest) {
  const value = c.verification_window_minutes;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_VERIFICATION_WINDOW_MINUTES;
}

export function getContestEntryState(c: InvitedContest, now: number): ContestEntryState {
  const status = String(c.status ?? "").toUpperCase();
  const start = new Date(c.start_at).getTime();
  const end = new Date(c.end_at).getTime();
  const verificationWindowMinutes = getVerificationWindowMinutes(c);

  const unavailable: ContestEntryState = {
    phase: "metadata_unavailable",
    canEnter: false,
    sessionType: "new",
    ctaLabel: "Unavailable",
    statusLabel: "METADATA PENDING",
    timingLabel: "metadata pending",
    disabledTitle: "Contest timing metadata is unavailable",
  };

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return unavailable;
  if (status === "DRAFT") {
    return {
      phase: "draft",
      canEnter: false,
      sessionType: "new",
      ctaLabel: "Draft",
      statusLabel: "DRAFT",
      timingLabel: "not published",
      disabledTitle: "This contest is still in draft",
    };
  }

  if (status === "ENDED" || now >= end) {
    return {
      phase: "ended",
      canEnter: false,
      sessionType: "resume",
      ctaLabel: "Ended",
      statusLabel: "CLOSED",
      timingLabel: "window closed",
      disabledTitle: "This contest has ended",
    };
  }

  const windowOpen = start - verificationWindowMinutes * 60 * 1000;
  if (now < windowOpen) {
    return {
      phase: "too_early",
      canEnter: false,
      sessionType: "new",
      ctaLabel: `Verification opens ${formatStartsIn(c.start_at, now)}`,
      statusLabel: "SCHEDULED",
      timingLabel: `opens in ${formatStartsIn(c.start_at, now)}`,
      disabledTitle: "Verification has not opened yet",
    };
  }

  if (now < start) {
    return {
      phase: "verification_open",
      canEnter: status === "SCHEDULED" || status === "ACTIVE",
      sessionType: "new",
      ctaLabel: "Begin Verification",
      statusLabel: "VERIFICATION OPEN",
      timingLabel: `starts in ${formatStartsIn(c.start_at, now)}`,
    };
  }

  if (status === "SCHEDULED" || status === "ACTIVE") {
    return {
      phase: "live",
      canEnter: true,
      sessionType: "resume",
      ctaLabel: "Enter Contest",
      statusLabel: "LIVE",
      timingLabel: "live now",
    };
  }

  return {
    phase: "blocked",
    canEnter: false,
    sessionType: "new",
    ctaLabel: "Blocked",
    statusLabel: status || "BLOCKED",
    timingLabel: "entry unavailable",
    disabledTitle: "This contest is not open for entry",
  };
}

export function getScheduledContestTickDelay(contest: InvitedContest, now: number) {
  let nextTickAt = Math.ceil((now + 1) / 60000) * 60000;
  const start = new Date(contest.start_at).getTime();
  const end = new Date(contest.end_at).getTime();
  const windowOpen = start - getVerificationWindowMinutes(contest) * 60 * 1000;
  for (const boundary of [windowOpen, start, end]) {
    if (boundary > now && boundary < nextTickAt) nextTickAt = boundary;
  }
  return Math.max(1000, Math.min(nextTickAt - now, 60000));
}

// ── Theme ─────────────────────────────────────────────────────

export function getThemeColors(_theme: "dark" | "light") {
  return {
    bg: "var(--theme-bg)",
    sidebarBg: "var(--theme-sidebar-bg)",
    cardBg: "var(--theme-card-bg)",
    innerBg: "var(--theme-inner-bg)",
    border: "var(--theme-border)",
    borderStrong: "var(--theme-border-strong)",
    text: "var(--theme-text)",
    textMuted: "var(--theme-text-muted)",
    textMutedStrong: "var(--theme-text-muted-strong)",
    accent: "var(--theme-accent)",
    accentLight: "var(--theme-accent-light)",
    accentBorder: "var(--theme-accent-border)",
    accentText: "var(--theme-accent-text)",
    consoleText: "var(--theme-console-text)",
    shadow: "var(--theme-shadow)",
    shadowHover: "var(--theme-shadow-hover)",
    dot: "var(--theme-dot)",
  };
}

// ── Readiness scoring ─────────────────────────────────────────

export function calculateReadinessScore(r: ReadinessState) {
  let score = 100;
  const cameraOk = r.camera === "ok";
  const micOk = r.mic === "ok";
  const networkOk = r.network === "ok";
  const secureEnvOk = r.vm === "ok" && r.keyboard === "ok" && r.platform === "ok";

  if (!networkOk) score -= 30;
  if (!secureEnvOk) {
    const vmDeduct = r.vm !== "ok" ? 15 : 0;
    const kbDeduct = r.keyboard !== "ok" ? 10 : 0;
    const platDeduct = r.platform !== "ok" ? 10 : 0;
    score -= vmDeduct + kbDeduct + platDeduct;
  }

  if (!cameraOk && !micOk) {
    score -= 25;
  } else if (!cameraOk) {
    score -= 8;
  } else if (!micOk) {
    score -= 6;
  }

  return Math.max(10, Math.min(100, score));
}

export function getEstimatedTimeToReady(r: ReadinessState) {
  let time = 0;
  if (r.camera !== "ok") time += 45;
  if (r.mic !== "ok") time += 15;
  if (r.network !== "ok") time += 30;
  if (r.vm !== "ok" || r.keyboard !== "ok") time += 60;
  return time;
}
