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
import { PRACTICE_TICK_MS, isPracticeContest, practiceEntryState } from "./practice-card";

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
  // Readiness uses a neutral connectivity canary so AMS service outages do not
  // look like local network failures.
  return "www.google.com";
}

export function getNetworkLockdownAllowlistHost() {
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
  // Use getUserMedia() instead of enumerateDevices() so that:
  //   1. On macOS (WKWebView), the OS permission dialog is shown on first run.
  //      enumerateDevices() alone never triggers the dialog and returns an
  //      empty list until permission is granted at least once.
  //   2. We confirm the device is actually usable for proctoring (access
  //      granted), not just that the hardware exists.
  // 30 s timeout gives the user time to respond to the system prompt.
  const [camResult, micResult] = await Promise.allSettled([
    getUserMediaWithTimeout({ video: true }, 30_000),
    getUserMediaWithTimeout({ audio: true }, 30_000),
  ]);

  const cameraAvailable = camResult.status === "fulfilled";
  const microphoneAvailable = micResult.status === "fulfilled";

  // Stop tracks immediately — we only needed the permission grant.
  if (cameraAvailable)
    (camResult as PromiseFulfilledResult<MediaStream>).value.getTracks().forEach((t) => t.stop());
  if (microphoneAvailable)
    (micResult as PromiseFulfilledResult<MediaStream>).value.getTracks().forEach((t) => t.stop());

  return { cameraAvailable, microphoneAvailable };
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
      return { label: "Network connection", success: "Network ready", fail: "Network unavailable" };
    case "microphone":
      return { label: "Microphone", success: "Microphone ready", fail: "Microphone not available" };
    case "camera":
      return { label: "Camera", success: "Camera ready", fail: "Camera not available" };
    case "virtualization":
      return {
        label: "Virtual machine check",
        success: "No VM detected",
        fail: "Virtual machine detected",
      };
    case "keyboard_lockdown":
      return {
        label: "Keyboard lockdown",
        success: "Keyboard lockdown ready",
        fail: "Keyboard lockdown unavailable",
      };
    case "restricted_apps":
      return {
        label: "Restricted apps",
        success: "No restricted apps found",
        fail: "Restricted app detected",
      };
    case "platform":
      return {
        label: "Platform compatibility",
        success: "Platform supported",
        fail: "Platform not supported",
      };
    case "contest_id":
      return { label: "Contest link", success: "Contest linked", fail: "Contest not linked" };
    case "device_id":
      return { label: "Device ID", success: "Device registered", fail: "Device not registered" };
    case "clock_integrity":
      return { label: "Clock check", success: "Clock in sync", fail: "Clock out of sync" };
    default:
      return { label: String(kind), success: "Check passed", fail: "Check failed" };
  }
}

export function toPreflightPolicyItem(check: ReadinessCheck, scope: "required" | "optional") {
  const copy = readinessCheckCopy(check.kind);
  const warningLabel = scope === "optional" ? "Optional warning" : "Warning";
  // The platform check reports UnsupportedPlatform both for a genuinely
  // unsupported OS and for Windows launched without Administrator rights. The
  // latter is recoverable in one click (the ResolveModal offers "Relaunch as
  // Administrator"), so surface it as "Administrator required" rather than the
  // dead-end "Platform not supported". Only the no-admin case carries an
  // admin-mentioning detail (see core-rs evaluate_requirement / Platform).
  const needsAdmin =
    check.kind === "platform" && (check.detail?.toLowerCase().includes("administrator") ?? false);
  const failCopy = needsAdmin ? "Administrator required" : copy.fail;
  return {
    key: scope + "-" + check.kind,
    label: copy.label,
    status: readinessCheckStatus(check),
    successLabel: copy.success,
    failLabel: check.outcome === "warn" ? warningLabel : failCopy,
  };
}

// ── Contest entry state ───────────────────────────────────────

export function formatDurationUntil(targetMs: number, now: number, elapsedLabel = "now") {
  const diff = targetMs - now;
  if (diff <= 0) return elapsedLabel;
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return minutes === 1 ? "1m" : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatStartsIn(startAt: string, now: number) {
  return formatDurationUntil(new Date(startAt).getTime(), now, "Starting now");
}

function formatContestDateTime(
  value: string | number,
  timezone: string | undefined,
  options: Intl.DateTimeFormatOptions
) {
  const date = new Date(value);
  const withTimezone = timezone ? { ...options, timeZone: timezone } : options;
  try {
    return new Intl.DateTimeFormat(undefined, withTimezone).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

export function formatContestClock(value: string | number, timezone?: string) {
  return formatContestDateTime(value, timezone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatContestDateLabel(startAt: string, endAt: string, timezone?: string) {
  const startLabel = formatContestDateTime(startAt, timezone, { month: "short", day: "numeric" });
  const endLabel = formatContestDateTime(endAt, timezone, { month: "short", day: "numeric" });
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
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
    statusLabel: "TIMING UNAVAILABLE",
    timingLabel: "timing unavailable",
    actionHelper: "Contest timing unavailable. Refresh or contact support.",
    verificationOpensAt: "Unavailable",
    contestStartsAt: "Unavailable",
    contestEndsAt: "Unavailable",
    contestDateLabel: "Date unavailable",
    disabledTitle: "Contest timing metadata is unavailable",
  };

  // Before every time-based branch, including the metadata one — see
  // practice-card.ts for why.
  if (isPracticeContest(c)) return practiceEntryState();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return unavailable;

  const verificationOpen = start - verificationWindowMinutes * 60 * 1000;
  // Format all displayed times in the candidate's LOCAL timezone (no contest-tz
  // override), so they agree with the countdown which uses absolute Date.now().
  const verificationOpensAt = formatContestClock(verificationOpen);
  const contestStartsAt = formatContestClock(c.start_at);
  const contestEndsAt = formatContestClock(c.end_at);
  const contestDateLabel = formatContestDateLabel(c.start_at, c.end_at);

  if (status === "DRAFT") {
    return {
      phase: "draft",
      canEnter: false,
      sessionType: "new",
      ctaLabel: "Draft",
      statusLabel: "DRAFT",
      timingLabel: "not published",
      actionHelper: "This contest is not published for contestants yet.",
      verificationOpensAt,
      contestStartsAt,
      contestEndsAt,
      contestDateLabel,
      disabledTitle: "This contest is still in draft",
    };
  }

  if (status === "ENDED" || now >= end) {
    return {
      phase: "ended",
      canEnter: false,
      sessionType: "resume",
      ctaLabel: "Ended",
      statusLabel: "ENDED",
      timingLabel: `ended at ${contestEndsAt}`,
      actionHelper: `Contest ended at ${contestEndsAt}.`,
      verificationOpensAt,
      contestStartsAt,
      contestEndsAt,
      contestDateLabel,
      disabledTitle: "This contest has ended",
    };
  }

  // A missing/blank status is UNKNOWN — checked AFTER the time-based ENDED branch
  // above so an ended contest still surfaces its results CTA. For a live/upcoming
  // window we can't confirm eligibility, so show "unavailable" (refresh / contact
  // support), not a hard "blocked". A known-but-unhandled status falls through to
  // the blocked default below.
  if (!status) return unavailable;

  if (now < verificationOpen) {
    const opensIn = formatDurationUntil(verificationOpen, now);
    return {
      phase: "too_early",
      canEnter: false,
      sessionType: "new",
      ctaLabel: "Not open yet",
      statusLabel: "SCHEDULED",
      timingLabel: `verification opens in ${opensIn}`,
      actionHelper: `Verification opens at ${verificationOpensAt}.`,
      verificationOpensAt,
      contestStartsAt,
      contestEndsAt,
      contestDateLabel,
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
      timingLabel: `contest starts in ${formatDurationUntil(start, now)}`,
      actionHelper: `Verification is open. Contest starts at ${contestStartsAt}.`,
      verificationOpensAt,
      contestStartsAt,
      contestEndsAt,
      contestDateLabel,
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
      actionHelper: `Contest is live until ${contestEndsAt}.`,
      verificationOpensAt,
      contestStartsAt,
      contestEndsAt,
      contestDateLabel,
    };
  }

  return {
    phase: "blocked",
    canEnter: false,
    sessionType: "new",
    ctaLabel: "Blocked",
    statusLabel: status || "BLOCKED",
    timingLabel: "entry unavailable",
    actionHelper: "Entry is unavailable for this contest. Refresh or contact support.",
    verificationOpensAt,
    contestStartsAt,
    contestEndsAt,
    contestDateLabel,
    disabledTitle: "This contest is not open for entry",
  };
}

export function getScheduledContestTickDelay(contest: InvitedContest, now: number) {
  if (isPracticeContest(contest)) return PRACTICE_TICK_MS;
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
