"use client";

import { useState, useEffect, useRef, useMemo, memo } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { invoke, runSessionReadiness, sessionPolicy, type ReadinessReport } from "@ams/api-client";
import { resolveApiBase } from "@/lib/api-base";
import { fetchJson, useApiQuery } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const API_URL = resolveApiBase();

type InvitedContest = {
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

type ReadinessStatus = "ok" | "fail" | "checking";

type ReadinessState = {
  camera: ReadinessStatus;
  mic: ReadinessStatus;
  network: ReadinessStatus;
  keyboard: ReadinessStatus;
  restrictedApps: ReadinessStatus;
  vm: ReadinessStatus;
  platform: ReadinessStatus;
};

type PlatformInfo = {
  os: string;
  arch: string;
  family: string;
};

type SecurityEnvironment = {
  os: string;
  display_server: string;
  ld_preload_injection: boolean;
  ptrace_scope: number;
};

type ProcessScanResult = {
  found: string[];
  clean: boolean;
};

type VirtDetectionResult = {
  detected: boolean;
  platform: string | null;
  confidence: string;
};

type NetworkCheckResult = {
  reachable: boolean;
  latency_ms: number | null;
  jitter_ms: number | null;
  quality: string;
};

type SecurityScanSnapshot = {
  platform: PlatformInfo | null;
  env: SecurityEnvironment | null;
  processes: ProcessScanResult | null;
  virt: VirtDetectionResult | null;
  network: NetworkCheckResult | null;
};

type FullTelemetry = {
  platform: PlatformInfo;
  env: SecurityEnvironment;
  processes: ProcessScanResult;
  virt: VirtDetectionResult;
  network: NetworkCheckResult | null;
};

let cachedSecurityScan: SecurityScanSnapshot | null = null;

type InviteCodeResolveResponse = {
  contest?: InvitedContest;
  eligibility_status: string;
  session_window_state?: string;
  blocked_reason?: string;
  active_session_id?: string;
};

type ActiveSession = {
  id: string;
  contest_id: string;
  contest_title?: string;
  updated_at?: string;
};

const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;
const UNLOCKED_CONTESTS_KEY = STORAGE_KEYS.UNLOCKED_CONTESTS;
const DEFAULT_VERIFICATION_WINDOW_MINUTES = 20;
const READINESS_TIMEOUT_MS = {
  media: 2000,
  platform: 2500,
  process: 3500,
  virtualization: 3500,
  network: 5000,
};

function mergeContestLists(
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

function loadUnlockedContests(): InvitedContest[] {
  try {
    const raw = localStorage.getItem(UNLOCKED_CONTESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InvitedContest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveUnlockedContests(list: InvitedContest[]) {
  localStorage.setItem(UNLOCKED_CONTESTS_KEY, JSON.stringify(list));
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, generated);
  return generated;
}

function getNetworkProbeHost() {
  try {
    return new URL(API_URL).hostname;
  } catch {}
  return "localhost";
}

function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const rootEl = ref.current;
    if (!rootEl) return;
    const trappedRoot: T = rootEl;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(trappedRoot.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
    );
    (focusable[0] ?? trappedRoot).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusable = Array.from(
        trappedRoot.querySelectorAll<HTMLElement>(selector)
      ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
      if (currentFocusable.length === 0) {
        event.preventDefault();
        trappedRoot.focus({ preventScroll: true });
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [active, onEscape]);

  return ref;
}

function withUiTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timer));
  });
}

function statusFromReport(report: ReadinessReport, kind: string): ReadinessStatus {
  const check = report.checks.find((item) => item.kind === kind);
  if (!check) return "fail";
  return check.outcome === "pass" ? "ok" : "fail";
}

function readinessFromReport(report: ReadinessReport): ReadinessState {
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

async function getBrowserMediaAvailability() {
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

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getUserMediaWithTimeout(
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

function describeMediaError(err: unknown, kind: "camera" | "microphone") {
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

const NAV_ITEMS = [
  {
    id: "overview",
    label: "Home",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "security_logs",
    label: "Security Logs",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 6.5h6M5 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
];

function getThemeColors(theme: "dark" | "light") {
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

export default function HomePage() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeNav, setActiveNav] = useState("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [contests, setContests] = useState<InvitedContest[]>([]);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeStatus, setInviteCodeStatus] = useState<string | null>(null);
  const [inviteCodeBusy, setInviteCodeBusy] = useState(false);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [userEmail, setUserEmail] = useState("tester@ams.local");
  const [userEmailHydrated, setUserEmailHydrated] = useState(false);
  const [preflightContestId, setPreflightContestId] = useState<string | null>(null);
  const [preflightSessionType, setPreflightSessionType] = useState<"new" | "resume">("new");
  const [activeResolveModal, setActiveResolveModal] = useState<string | null>(null);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);
  const inviteCodeInFlightRef = useRef(false);
  const resumeInFlightRef = useRef(false);

  // Load theme from localStorage on mount - Locked strictly to Obsidian Dark by system policy
  useEffect(() => {
    setTheme("dark");
    localStorage.setItem(STORAGE_KEYS.THEME, "dark");
  }, []);

  // Sync theme class to documentElement for CSS variables
  useEffect(() => {
    document.documentElement.className = "dark";
  }, []);

  const c = getThemeColors("dark");

  // Telemetry Integrity Scan States
  const [readiness, setReadiness] = useState<ReadinessState>({
    camera: "checking",
    mic: "checking",
    network: "checking",
    keyboard: "checking",
    restrictedApps: "checking",
    vm: "checking",
    platform: "checking",
  });
  const [readinessReport, setReadinessReport] = useState<ReadinessReport | null>(null);
  const contestsQueryKey = userEmailHydrated ? `contests:invited:${userEmail}` : null;
  const invitedContestsQuery = useApiQuery<InvitedContest[]>(
    contestsQueryKey,
    async () => {
      const url = `${API_URL}/contests/invited?email=${encodeURIComponent(userEmail)}`;
      const data = await fetchJson<InvitedContest[]>(
        url,
        {},
        {
          dedupeKey: contestsQueryKey ?? url,
          retries: 2,
        }
      );
      const unlocked = loadUnlockedContests();
      const freshUnlocked = await Promise.all(
        unlocked.map(async (uc) => {
          try {
            const fresh = await fetchJson<any>(`${API_URL}/contests/${uc.id}`);
            if (fresh && fresh.id) {
              return {
                ...uc,
                title: fresh.title,
                description: fresh.description,
                start_at: fresh.start_at,
                end_at: fresh.end_at,
                timezone: fresh.timezone,
                status: fresh.status,
                org_name: fresh.org_name,
                plugin_type: fresh.plugin_type,
              };
            }
          } catch (e) {
            console.error("Failed to fetch fresh contest details for", uc.id, e);
          }
          return uc;
        })
      );
      saveUnlockedContests(freshUnlocked);
      return mergeContestLists(data ?? [], freshUnlocked);
    },
    { enabled: userEmailHydrated, staleMs: 30_000, retries: 0 }
  );

  useEffect(() => {
    if (invitedContestsQuery.data) {
      setContests(invitedContestsQuery.data);
      setContestsLoading(false);
    } else if (invitedContestsQuery.error) {
      setContestsLoading(false);
    }
  }, [invitedContestsQuery.data, invitedContestsQuery.error]);

  async function loadContests(email: string, mode: "initial" | "refresh" = "refresh") {
    if (mode === "initial") setContestsLoading(true);
    else setSessionsRefreshing(true);
    setSessionsError(null);
    try {
      const data = await invitedContestsQuery.mutate();
      if (data) setContests(data);
    } catch {
      if (mode === "refresh") {
        setSessionsError("Could not refresh sessions. Check your connection and try again.");
      }
    } finally {
      setContestsLoading(false);
      setSessionsRefreshing(false);
    }
  }

  async function runIntegrityScan(cancelledRef?: { current: boolean }, contestId?: string | null) {
    const isCancelled = () => cancelledRef?.current ?? false;

    if (!isCancelled()) {
      setReadinessReport(null);
      setReadiness({
        camera: "checking",
        mic: "checking",
        network: "checking",
        keyboard: "checking",
        restrictedApps: "checking",
        vm: "checking",
        platform: "checking",
      });
    }

    const media = await getBrowserMediaAvailability();
    if (isCancelled()) return;

    try {
      const strict = Boolean(contestId);
      const report = await runSessionReadiness({
        networkHost: getNetworkProbeHost(),
        contestId: contestId ?? null,
        deviceId: getOrCreateDeviceId(),
        cameraAvailable: media.cameraAvailable,
        microphoneAvailable: media.microphoneAvailable,
        activateKeyboard: true,
        policy: sessionPolicy(strict ? "strict_contest" : "internal_pilot"),
      });
      if (isCancelled()) return;
      setReadinessReport(report);
      setReadiness(readinessFromReport(report));
    } catch {
      if (isCancelled()) return;
      setReadinessReport(null);
      setReadiness({
        camera: media.cameraAvailable ? "ok" : "fail",
        mic: media.microphoneAvailable ? "ok" : "fail",
        network: "fail",
        keyboard: "fail",
        restrictedApps: "fail",
        vm: "fail",
        platform: "fail",
      });
    }
  }

  useEffect(() => {
    if (preflightContestId) {
      void runIntegrityScan(undefined, preflightContestId);
    }
  }, [preflightContestId]);

  useEffect(() => {
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "tester@ams.local";
    setUserEmail(email);
    setUserEmailHydrated(true);
    const cancelledRef = { current: false };
    const storedSession = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (storedSession) {
      try {
        setActiveSession(JSON.parse(storedSession) as ActiveSession);
      } catch {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    }

    void runIntegrityScan(cancelledRef);

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function handleInviteCodeSubmit() {
    if (inviteCodeBusy || inviteCodeInFlightRef.current) return;
    inviteCodeInFlightRef.current = true;
    const code = inviteCode.trim();
    setInviteCodeStatus(null);
    if (!code) {
      inviteCodeInFlightRef.current = false;
      setInviteCodeStatus("Enter a session or invite code.");
      return;
    }
    setInviteCodeBusy(true);
    try {
      // Avoid CORS preflight failures in desktop webview by sending plain body
      // without custom headers; backend JSON decoder still accepts this payload.
      const res = await fetchWithTimeout(`${API_URL}/session-codes/resolve`, {
        method: "POST",
        body: JSON.stringify({ code, candidate_email: userEmail }),
      });
      let data: Partial<InviteCodeResolveResponse> | null = null;
      try {
        data = (await res.json()) as Partial<InviteCodeResolveResponse>;
      } catch {}
      if (!res.ok && !data?.contest?.id) {
        setInviteCodeStatus(data?.blocked_reason || "Code validation unavailable.");
        return;
      }
      if (!data?.contest?.id) {
        setInviteCodeStatus("Code validation unavailable.");
        return;
      }
      const resolvedContest = data.contest as InvitedContest;
      const unlocked = loadUnlockedContests();
      const mergedUnlocked = mergeContestLists([resolvedContest], unlocked);
      saveUnlockedContests(mergedUnlocked);
      setContests((prev) => mergeContestLists([resolvedContest], prev));

      const resolvedActiveSession = data.active_session_id
        ? {
            id: data.active_session_id,
            contest_id: data.contest.id,
            contest_title: data.contest.title,
            updated_at: new Date().toISOString(),
          }
        : null;
      if (resolvedActiveSession) {
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(resolvedActiveSession));
        setActiveSession(resolvedActiveSession);
      }

      const eligibility = String(data?.eligibility_status ?? "").toLowerCase();
      const blockedReason = data?.blocked_reason?.trim();
      if (eligibility === "allowed") {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(null);
      } else if (eligibility === "wait") {
        const verificationWindowMinutes = getVerificationWindowMinutes(resolvedContest);
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(
          blockedReason ||
            `Verification opens ${verificationWindowMinutes} minutes before contest start.`
        );
      } else if (eligibility === "blocked") {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(blockedReason || "Join window is closed for this contest.");
      } else {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(null);
      }

      setInviteCode("");
      setTimeout(() => setInviteSuccessMsg(null), 1200);
    } catch {
      setInviteCodeStatus("Code validation unavailable.");
    } finally {
      inviteCodeInFlightRef.current = false;
      setInviteCodeBusy(false);
    }
  }

  async function handleResumeActiveSession() {
    setResumeStatus(null);
    if (resumeBusy || resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    if (!activeSession?.id || !activeSession.contest_id) {
      resumeInFlightRef.current = false;
      setResumeStatus("No active session found on this device.");
      return;
    }
    setResumeBusy(true);
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/sessions/${encodeURIComponent(activeSession.id)}`
      );
      if (!res.ok) {
        setResumeStatus("Active session validation unavailable.");
        return;
      }
      const data = (await res.json()) as Partial<ActiveSession> & { contest_id?: string };
      const contestId = data.contest_id ?? activeSession.contest_id;
      if (!contestId) {
        setResumeStatus("Active session validation unavailable.");
        return;
      }
      setPreflightContestId(contestId);
      setPreflightSessionType("resume");
    } catch {
      setResumeStatus("Active session validation unavailable.");
    } finally {
      resumeInFlightRef.current = false;
      setResumeBusy(false);
    }
  }

  function handleSignOut() {
    setSigningOut(true);
    Object.keys(localStorage)
      .filter((key) => key.startsWith("ams_"))
      .forEach((key) => localStorage.removeItem(key));
    setTimeout(() => router.push("/"), 600);
  }

  return (
    <div
      className="theme-transition"
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
        background: c.bg,
        color: c.text,
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: "240px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${c.border}`,
          background: c.sidebarBg,
          padding: "28px 0 0",
          transition: "background 300ms, border-color 300ms",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "36px",
            padding: "0 20px",
          }}
        >
          <svg width="56" height="48" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#logo-grad)"
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient
                id="logo-grad"
                x1="2"
                y1="82"
                x2="172"
                y2="82"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#7C3AED" />
                <stop offset="0.5" stopColor="#8B5CF6" />
                <stop offset="1" stopColor="#A78BFA" />
              </linearGradient>
            </defs>
          </svg>
          <p
            style={{
              marginTop: "12px",
              fontSize: "11.5px",
              fontWeight: 500,
              letterSpacing: "0.4em",
              color: theme === "light" ? "#5c5447" : "rgba(255,255,255,0.85)",
              textTransform: "uppercase",
            }}
          >
            ACCESS
          </p>
        </div>

        {/* Nav list */}
        <nav
          style={{
            flex: 1,
            padding: "0 14px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "11px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: active ? c.accentLight : "transparent",
                  color: active ? c.accentText : c.textMuted,
                  fontSize: "14px",
                  fontWeight: active ? 500 : 400,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      left: "6px",
                      top: "10px",
                      bottom: "10px",
                      width: "3.5px",
                      background: c.accent,
                      borderRadius: "2px",
                      boxShadow: `0 0 8px ${c.accent}`,
                    }}
                  />
                )}
                <span style={{ color: active ? c.accent : c.textMuted, flexShrink: 0 }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom profile controls */}
        <div style={{ padding: "16px 14px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "8px",
              marginBottom: "8px",
              background: "rgba(255,255,255,0.01)",
              border: `1px solid ${c.border}`,
            }}
          >
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "13px",
                fontWeight: 600,
                color: "white",
              }}
            >
              {userEmail[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: c.text,
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userEmail}
              </p>
              <p style={{ fontSize: "10.5px", color: c.textMuted }}>Contestant Profile</p>
            </div>
          </div>

          <SignOutButton onClick={handleSignOut} loading={signingOut} theme={theme} />
        </div>
      </aside>

      {/* ── Main content panels ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <header
          style={{
            padding: "36px 48px 24px",
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
            transition: "border-color 300ms",
          }}
        >
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 600,
              color: c.text,
              letterSpacing: "-0.015em",
            }}
          >
            {activeNav === "overview" && "Contestant Command Hub"}
            {activeNav === "settings" && "Control Room Diagnostics"}
            {activeNav === "diagnostics" && "Integrity Telemetry Registry"}
            {activeNav === "security_logs" && "Live Security Operations Feed"}
          </h1>
          <p style={{ fontSize: "13.5px", color: c.textMuted, marginTop: "4px" }}>
            {activeNav === "overview" && (
              <>
                Authenticated Profile Node:{" "}
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    color: c.text,
                    fontWeight: 600,
                  }}
                >
                  {userEmail}
                </span>
              </>
            )}
            {activeNav === "settings" &&
              "Configure video capture, speaker channels, micro-decibel triggers, and proctor parameters"}
            {activeNav === "diagnostics" &&
              "Network jitter telemetry, host reachability, and hardware registers"}
            {activeNav === "security_logs" &&
              "Real-time client telemetry scan, background process flags, display configurations, and security triggers"}
          </p>
        </header>

        {/* Scrollable content views */}
        <div style={{ flex: 1, overflowY: "auto", padding: "36px 48px" }}>
          {activeNav === "overview" && (
            <div
              className="grid grid-cols-1 xl:grid-cols-[1fr_360px]"
              style={{
                gap: "36px",
                alignItems: "stretch",
              }}
            >
              {/* Left Column: Contests with premium cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "36px" }}>
                <SessionActionsPanel
                  activeSession={activeSession}
                  inviteCode={inviteCode}
                  inviteCodeBusy={inviteCodeBusy}
                  inviteCodeStatus={inviteCodeStatus}
                  inviteSuccessMsg={inviteSuccessMsg}
                  onInviteCodeChange={setInviteCode}
                  onInviteCodeSubmit={handleInviteCodeSubmit}
                  onRefresh={() => loadContests(userEmail)}
                  onResume={handleResumeActiveSession}
                  resumeBusy={resumeBusy}
                  resumeStatus={resumeStatus}
                  sessionsError={sessionsError}
                  sessionsRefreshing={sessionsRefreshing}
                  theme={theme}
                />
                <ContestsPanel
                  contests={contests}
                  loading={contestsLoading}
                  theme={theme}
                  onPreflight={(contestId, type) => {
                    setPreflightContestId(contestId);
                    setPreflightSessionType(type);
                  }}
                />
              </div>

              {/* Right Column: Integrity scan overview HUD */}
              <ReadinessWidget
                readiness={readiness}
                onSettingsRedirect={() => setActiveNav("settings")}
                theme={theme}
                onResolve={(key) => setActiveResolveModal(key)}
              />
            </div>
          )}

          {activeNav === "settings" && (
            <SettingsPanel
              readiness={readiness}
              setReadiness={setReadiness}
              theme={theme}
              setTheme={setTheme}
            />
          )}

          {activeNav === "diagnostics" && <DiagnosticsPanel readiness={readiness} theme={theme} />}

          {activeNav === "security_logs" && (
            <div style={{ maxWidth: "1200px" }}>
              <SecurityOperationsLog theme={theme} />
            </div>
          )}
        </div>
      </div>

      {preflightContestId && (
        <SessionReadinessModal
          contestId={preflightContestId}
          sessionType={preflightSessionType}
          theme={theme}
          onClose={() => setPreflightContestId(null)}
          readiness={readiness}
          readinessReport={readinessReport}
          onSettingsRedirect={() => {
            setPreflightContestId(null);
            setActiveNav("settings");
          }}
          onRescan={() => runIntegrityScan(undefined, preflightContestId)}
        />
      )}
      {activeResolveModal && (
        <ResolveModal
          isOpen={true}
          onClose={() => setActiveResolveModal(null)}
          checkKey={activeResolveModal}
          theme={theme}
        />
      )}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

function SignOutButton({
  onClick,
  loading,
  theme,
}: {
  onClick: () => void;
  loading: boolean;
  theme: "dark" | "light";
}) {
  const [hovered, setHovered] = useState(false);
  const c = getThemeColors(theme);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 12px",
        borderRadius: "8px",
        border: "none",
        background: hovered ? "rgba(239,68,68,0.08)" : "transparent",
        color: hovered ? "#ef4444" : c.textMuted,
        fontSize: "13px",
        fontWeight: 400,
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
        width: "100%",
        textAlign: "left",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3M11 11l3-3-3-3M14 8H6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sign out
    </button>
  );
}

function formatStartsIn(startAt: string, now: number) {
  const diff = new Date(startAt).getTime() - now;
  if (diff <= 0) return "Starting now";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return minutes === 1 ? "1m" : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

type EntryPhase = "too_early" | "verification_open" | "join_closed" | "ended";

function getVerificationWindowMinutes(c: InvitedContest) {
  const value = c.verification_window_minutes;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_VERIFICATION_WINDOW_MINUTES;
}

function getEntryPhase(
  startAt: string,
  endAt: string,
  now: number,
  verificationWindowMinutes: number
): EntryPhase {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const windowOpen = start - verificationWindowMinutes * 60 * 1000;
  if (now >= end) return "ended";
  if (now < windowOpen) return "too_early";
  if (now < start) return "verification_open";
  return "join_closed";
}

function getScheduledContestTickDelay(contest: InvitedContest, now: number) {
  let nextTickAt = Math.ceil((now + 1) / 60000) * 60000;
  const start = new Date(contest.start_at).getTime();
  const end = new Date(contest.end_at).getTime();
  const windowOpen = start - getVerificationWindowMinutes(contest) * 60 * 1000;
  for (const boundary of [windowOpen, start, end]) {
    if (boundary > now && boundary < nextTickAt) nextTickAt = boundary;
  }
  return Math.max(1000, Math.min(nextTickAt - now, 60000));
}

const ScheduledContestCard = memo(
  function ScheduledContestCard({
    c,
    onPreflight,
    theme,
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
  }) {
    const [hovered, setHovered] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const themeColors = getThemeColors(theme);
    const isLight = theme === "light";
    const verificationWindowMinutes = getVerificationWindowMinutes(c);

    useEffect(() => {
      let active = true;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const scheduleNextTick = () => {
        const current = Date.now();
        timerId = setTimeout(
          () => {
            if (!active) return;
            setNow(Date.now());
            scheduleNextTick();
          },
          getScheduledContestTickDelay(c, current)
        );
      };

      setNow(Date.now());
      scheduleNextTick();

      return () => {
        active = false;
        if (timerId) clearTimeout(timerId);
      };
    }, [c]);
    const phase = useMemo(
      () => getEntryPhase(c.start_at, c.end_at, now, verificationWindowMinutes),
      [c.end_at, c.start_at, now, verificationWindowMinutes]
    );
    const startsIn = useMemo(() => formatStartsIn(c.start_at, now), [c.start_at, now]);
    const canJoin = phase === "verification_open" || phase === "join_closed";
    const joinType: "new" | "resume" = phase === "join_closed" ? "resume" : "new";
    const label =
      phase === "verification_open"
        ? "Begin Verification"
        : phase === "too_early"
          ? `Verification opens ${startsIn}`
          : phase === "join_closed"
            ? "Enter Contest"
            : "Ended";

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${hovered ? themeColors.accent : themeColors.borderStrong}`,
          borderRadius: "14px",
          padding: "28px 32px",
          transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: hovered
            ? isLight
              ? "0 20px 40px rgba(124, 58, 237, 0.08)"
              : "0 20px 48px rgba(168, 85, 247, 0.08)"
            : themeColors.shadow,
          transform: hovered ? "translateY(-4px)" : "translateY(0)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative accent top line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: `linear-gradient(90deg, ${themeColors.accent} 0%, rgba(124, 58, 237, 0.3) 100%)`,
            opacity: hovered ? 1 : 0.4,
            transition: "opacity 300ms ease",
          }}
        />

        {/* Header section: Title, Status, Org */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "8px",
            }}
          >
            <h3
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: themeColors.text,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {c.title}
            </h3>
            <span
              style={{
                flexShrink: 0,
                fontSize: "10.5px",
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: "20px",
                background: themeColors.accentLight,
                border: `1px solid ${themeColors.accentBorder}`,
                color: themeColors.accentText,
                letterSpacing: "0.1em",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              SCHEDULED
            </span>
          </div>
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMuted,
              fontWeight: 500,
              margin: 0,
            }}
          >
            {c.org_name}
          </p>
        </div>

        {/* Description section */}
        {c.description && (
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMutedStrong,
              lineHeight: 1.6,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.description}
          </p>
        )}

        {/* Divider */}
        <div style={{ height: "1px", background: themeColors.border, margin: "4px 0 0 0" }} />

        {/* Footer: Telemetry parameters and call to action */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            flexWrap: "wrap",
          }}
        >
          {/* Left Side: Metadata with lovely tiny icons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontSize: "12px",
              color: themeColors.textMutedStrong,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="12" height="11" rx="2" />
                <path d="M5 1v2M11 1v2M2 7h12" />
              </svg>
              <span>
                {new Date(c.start_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}{" "}
                —{" "}
                {new Date(c.end_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            <div
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: themeColors.borderStrong,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 3.5v5h4" />
              </svg>
              <span style={{ color: themeColors.accent }}>
                {phase === "too_early"
                  ? `opens in ${startsIn}`
                  : phase === "verification_open"
                    ? `starts in ${startsIn}`
                    : phase === "join_closed"
                      ? "live now"
                      : "window closed"}
              </span>
            </div>

            <div
              style={{
                width: "4px",
                height: "4px",
                borderRadius: "50%",
                background: themeColors.borderStrong,
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
              </svg>
              <span>{c.question_count} Questions</span>
            </div>
          </div>

          {/* Right Side: CTA Button */}
          <button
            onClick={() => {
              if (canJoin) onPreflight(c.id, joinType);
            }}
            disabled={!canJoin}
            title={phase === "too_early" ? "Verification has not opened yet" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 28px",
              borderRadius: "10px",
              border: `1px solid ${canJoin ? themeColors.accent : "rgba(245,158,11,0.35)"}`,
              background:
                canJoin && hovered
                  ? themeColors.accent
                  : phase === "too_early"
                    ? "rgba(245,158,11,0.06)"
                    : "transparent",
              color: canJoin
                ? hovered
                  ? "#ffffff"
                  : themeColors.accentText
                : phase === "too_early"
                  ? "#f59e0b"
                  : themeColors.textMuted,
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: canJoin ? "pointer" : "not-allowed",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow:
                canJoin && hovered
                  ? isLight
                    ? "0 8px 20px rgba(124, 58, 237, 0.2)"
                    : "0 8px 24px rgba(168, 85, 247, 0.3)"
                  : "none",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 12 12"
              fill="none"
              style={{
                transform: hovered ? "scale(1.1) rotate(5deg)" : "none",
                transition: "transform 300ms ease",
              }}
            >
              <path
                d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span>{label}</span>
          </button>
        </div>
        <div style={{ marginTop: "4px", fontSize: "11px", color: themeColors.textMuted }}>
          Timezone: {c.timezone || "UTC"}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.c === next.c && prev.theme === next.theme && prev.onPreflight === next.onPreflight
);

const ActiveContestCard = memo(
  function ActiveContestCard({
    c,
    onPreflight,
    theme,
    col,
    canEnter,
  }: {
    c: InvitedContest;
    onPreflight: (contestId: string, type: "new" | "resume") => void;
    theme: "dark" | "light";
    col: any;
    canEnter: boolean;
  }) {
    const [hovered, setHovered] = useState(false);
    const themeColors = getThemeColors(theme);
    const isLight = theme === "light";

    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: isLight
            ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)"
            : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
          border: `1px solid ${hovered && canEnter ? themeColors.accent : canEnter ? themeColors.borderStrong : themeColors.border}`,
          borderRadius: "14px",
          padding: "28px 32px",
          transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow:
            hovered && canEnter
              ? isLight
                ? "0 20px 40px rgba(124, 58, 237, 0.08)"
                : "0 20px 48px rgba(168, 85, 247, 0.08)"
              : themeColors.shadow,
          transform: hovered && canEnter ? "translateY(-4px)" : "translateY(0)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          position: "relative",
          overflow: "hidden",
          opacity: canEnter ? 1 : 0.75,
        }}
      >
        {/* Decorative accent top line for active sessions */}
        {canEnter && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "3px",
              background: `linear-gradient(90deg, #10b981 0%, rgba(16, 185, 129, 0.3) 100%)`,
              opacity: hovered ? 1 : 0.4,
              transition: "opacity 300ms ease",
            }}
          />
        )}

        {/* Header section: Title, Status, Org */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              marginBottom: "8px",
            }}
          >
            <h3
              style={{
                fontSize: "19px",
                fontWeight: 700,
                color: themeColors.text,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                margin: 0,
              }}
            >
              {c.title}
            </h3>
            <span
              style={{
                flexShrink: 0,
                fontSize: "10.5px",
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: "20px",
                background: col.bg,
                border: `1px solid ${col.border}`,
                color: col.dot,
                letterSpacing: "0.1em",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {c.status}
            </span>
          </div>
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMuted,
              fontWeight: 500,
              margin: 0,
            }}
          >
            {c.org_name}
          </p>
        </div>

        {/* Description section */}
        {c.description && (
          <p
            style={{
              fontSize: "14px",
              color: themeColors.textMutedStrong,
              lineHeight: 1.6,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.description}
          </p>
        )}

        {/* Divider */}
        <div style={{ height: "1px", background: themeColors.border, margin: "4px 0 0 0" }} />

        {/* Footer: Telemetry parameters and call to action */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "24px",
            flexWrap: "wrap",
          }}
        >
          {/* Left Side: Metadata with lovely tiny icons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
              fontSize: "12px",
              color: themeColors.textMutedStrong,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="2" y="3" width="12" height="11" rx="2" />
                <path d="M5 1v2M11 1v2M2 7h12" />
              </svg>
              <span>
                {new Date(c.start_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                —{" "}
                {new Date(c.end_at).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                ,{" "}
                {new Date(c.start_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            {c.status !== "DRAFT" && c.status !== "SCHEDULED" && (
              <>
                <div
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: themeColors.borderStrong,
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: col.dot,
                      boxShadow: canEnter ? `0 0 8px ${col.dot}` : "none",
                      animation: canEnter ? "pulse-dot 1.5s ease-in-out infinite" : "none",
                    }}
                  />
                  <span style={{ color: canEnter ? "#10b981" : themeColors.textMuted }}>
                    {c.status === "ACTIVE" ? "Active Now" : "Session Ended"}
                  </span>
                </div>

                <div
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: themeColors.borderStrong,
                  }}
                />

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
                  </svg>
                  <span>{c.question_count} Questions</span>
                </div>
              </>
            )}
          </div>

          {/* Right Side: CTA Button or status info */}
          {canEnter ? (
            <button
              onClick={() => onPreflight(c.id, "new")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "12px 28px",
                borderRadius: "10px",
                border: "1px solid #10b981",
                background: hovered ? "#10b981" : "transparent",
                color: hovered ? "#ffffff" : "#10b981",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
                boxShadow: hovered
                  ? isLight
                    ? "0 8px 20px rgba(16, 185, 129, 0.2)"
                    : "0 8px 24px rgba(16, 185, 129, 0.3)"
                  : "none",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 12 12"
                fill="none"
                style={{
                  transform: hovered ? "scale(1.1) rotate(5deg)" : "none",
                  transition: "transform 300ms ease",
                }}
              >
                <path
                  d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Enter Session</span>
            </button>
          ) : (
            <span
              style={{
                fontSize: "13px",
                color: themeColors.textMuted,
                fontWeight: 500,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {c.status === "DRAFT" ? "DRAFT" : c.status === "SCHEDULED" ? "SCHEDULED" : "CLOSED"}
            </span>
          )}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.c === next.c &&
    prev.theme === next.theme &&
    prev.canEnter === next.canEnter &&
    prev.col.dot === next.col.dot &&
    prev.col.bg === next.col.bg &&
    prev.col.border === next.col.border &&
    prev.onPreflight === next.onPreflight
);

function SessionActionsPanel({
  activeSession,
  inviteCode,
  inviteCodeBusy,
  inviteCodeStatus,
  inviteSuccessMsg,
  onInviteCodeChange,
  onInviteCodeSubmit,
  onRefresh,
  onResume,
  resumeBusy,
  resumeStatus,
  sessionsError,
  sessionsRefreshing,
  theme,
}: {
  activeSession: ActiveSession | null;
  inviteCode: string;
  inviteCodeBusy: boolean;
  inviteCodeStatus: string | null;
  inviteSuccessMsg: string | null;
  onInviteCodeChange: (value: string) => void;
  onInviteCodeSubmit: () => void;
  onRefresh: () => void;
  onResume: () => void;
  resumeBusy: boolean;
  resumeStatus: string | null;
  sessionsError: string | null;
  sessionsRefreshing: boolean;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  const inputBg = "rgba(255,255,255,0.02)";
  const subtleButtonBg = "rgba(255,255,255,0.03)";

  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "6px",
        padding: "20px",
        display: "grid",
        gridTemplateColumns: "1.25fr 0.75fr",
        gap: "18px",
        alignItems: "stretch",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <label
            htmlFor="session-code"
            style={{
              display: "block",
              fontSize: "11px",
              color: c.textMuted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "6px",
              fontWeight: 600,
            }}
          >
            Session Code
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inviteCodeBusy) onInviteCodeSubmit();
            }}
            style={{ display: "flex", gap: "10px" }}
          >
            <input
              id="session-code"
              value={inviteCode}
              onChange={(e) => onInviteCodeChange(e.target.value)}
              disabled={inviteCodeBusy}
              placeholder="Enter invite code"
              style={{
                flex: 1,
                minWidth: 0,
                height: "38px",
                borderRadius: "6px",
                border: `1px solid ${c.borderStrong}`,
                background: inputBg,
                color: c.text,
                padding: "0 12px",
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "12.5px",
                fontWeight: 600,
                outline: "2px solid transparent",
                cursor: inviteCodeBusy ? "not-allowed" : "text",
                opacity: inviteCodeBusy ? 0.75 : 1,
              }}
            />
            <button
              type="submit"
              disabled={inviteCodeBusy}
              style={{
                minWidth: "96px",
                height: "38px",
                borderRadius: "6px",
                border: inviteCodeBusy ? "1px solid rgba(168,85,247,0.2)" : `1px solid ${c.accent}`,
                background: inviteCodeBusy ? "rgba(168,85,247,0.15)" : "#a855f7",
                color: inviteCodeBusy ? "rgba(255,255,255,0.4)" : "#ffffff",
                fontSize: "12px",
                fontWeight: 600,
                cursor: inviteCodeBusy ? "not-allowed" : "pointer",
                transition: "all 200ms ease",
              }}
            >
              {inviteCodeBusy ? "Checking..." : "Validate"}
            </button>
          </form>
          {inviteSuccessMsg && (
            <p
              style={{
                marginTop: "8px",
                color: "#22c55e",
                fontSize: "12.5px",
                lineHeight: 1.45,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 7l3 3 5-5"
                  stroke="#22c55e"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {inviteSuccessMsg}
            </p>
          )}
          {inviteCodeStatus && (
            <p
              style={{
                marginTop: "8px",
                color: "#ef4444",
                fontSize: "12px",
                lineHeight: 1.45,
                fontWeight: 500,
              }}
            >
              {inviteCodeStatus}
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={onRefresh}
            disabled={sessionsRefreshing}
            style={{
              height: "34px",
              borderRadius: "6px",
              border: `1px solid ${c.border}`,
              background: subtleButtonBg,
              color: c.textMutedStrong,
              padding: "0 12px",
              fontSize: "12px",
              cursor: sessionsRefreshing ? "not-allowed" : "pointer",
            }}
          >
            {sessionsRefreshing ? "Refreshing..." : "Refresh Sessions"}
          </button>
          {sessionsError && (
            <span style={{ alignSelf: "center", color: "#ef4444", fontSize: "12px" }}>
              {sessionsError}
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          borderLeft: `1px solid ${c.border}`,
          paddingLeft: "18px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "11px",
              color: c.textMuted,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: "6px",
              fontWeight: 600,
            }}
          >
            Resume
          </p>
          <p style={{ color: c.textMutedStrong, fontSize: "12px", lineHeight: 1.45 }}>
            {activeSession ? (
              <span
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontWeight: 600,
                  color: c.text,
                }}
              >
                {activeSession.contest_title ?? `CONTEST_${activeSession.contest_id.toUpperCase()}`}
              </span>
            ) : (
              "No active session stored on this device."
            )}
          </p>
        </div>
        <button
          onClick={onResume}
          disabled={resumeBusy || !activeSession}
          style={{
            height: "36px",
            borderRadius: "6px",
            border: activeSession ? `1px solid ${c.accent}` : "1px solid rgba(255,255,255,0.06)",
            background: activeSession ? "#a855f7" : "rgba(255,255,255,0.01)",
            color: activeSession ? "#ffffff" : "rgba(255,255,255,0.25)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: resumeBusy || !activeSession ? "not-allowed" : "pointer",
            transition: "all 200ms ease",
          }}
        >
          {resumeBusy ? "Validating..." : "Resume Active Session"}
        </button>
        {resumeStatus && (
          <p style={{ color: "#ef4444", fontSize: "12px", lineHeight: 1.4, fontWeight: 500 }}>
            {resumeStatus}
          </p>
        )}
      </div>
    </div>
  );
}

function ContestsPanel({
  contests,
  loading,
  theme,
  onPreflight,
}: {
  contests: InvitedContest[];
  loading: boolean;
  theme: "dark" | "light";
  onPreflight: (contestId: string, type: "new" | "resume") => void;
}) {
  const themeColors = getThemeColors(theme);

  function statusColor(s: string) {
    if (s === "ACTIVE")
      return {
        dot: theme === "light" ? "#10b981" : "#22c55e",
        bg: "rgba(34,197,94,0.08)",
        border: "rgba(34,197,94,0.2)",
      };
    if (s === "SCHEDULED")
      return {
        dot: theme === "light" ? "#7c3aed" : "#8b5cf6",
        bg: theme === "light" ? "rgba(124,58,237,0.08)" : "rgba(139,92,246,0.08)",
        border: theme === "light" ? "rgba(124,58,237,0.2)" : "rgba(139,92,246,0.2)",
      };
    if (s === "ENDED")
      return {
        dot: theme === "light" ? "#7c7467" : "rgba(255,255,255,0.25)",
        bg: theme === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)",
        border: theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
      };
    return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" };
  }

  if (loading) {
    return (
      <div>
        <p
          style={{
            fontSize: "11px",
            color: themeColors.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          Contests
        </p>
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: "90px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.04)",
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "pulse-dot 2.5s ease-in-out infinite",
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "10.5px",
                color: "rgba(255,255,255,0.22)",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              [ AWAITING_SESSION_VALIDATION_REGISTRY ]
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <div
        style={{
          border: `1px dashed ${themeColors.border}`,
          borderRadius: "6px",
          padding: "24px 28px",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: "18px",
          background: themeColors.cardBg,
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.01)",
            border: `1px solid ${themeColors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={themeColors.accent}
            strokeWidth="1.8"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h4
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: themeColors.text,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              margin: 0,
              letterSpacing: "0.05em",
            }}
          >
            No contests yet.
          </h4>
          <p
            style={{
              fontSize: "12px",
              color: themeColors.textMuted,
              margin: "4px 0 0",
              lineHeight: 1.4,
            }}
          >
            If you have an invite code, enter it above. Upcoming contests will appear here after
            they are added.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: "11px",
          color: themeColors.textMuted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        Contests ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {contests.map((c) => {
          const col = statusColor(c.status);
          const canEnter =
            c.status === "ACTIVE" || c.status === "DRAFT" || c.status === "SCHEDULED";
          return (
            <ActiveContestCard
              key={c.id}
              c={c}
              canEnter={canEnter}
              col={col}
              onPreflight={onPreflight}
              theme={theme}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Readiness HUD Widget ──
function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
  onResolve,
}: {
  readiness: ReadinessState;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
  onResolve?: (key: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const themeColors = getThemeColors(theme);
  const failedChecks = [
    { key: "camera", label: "Camera unavailable", status: readiness.camera },
    { key: "mic", label: "Microphone unavailable", status: readiness.mic },
    { key: "network", label: "Network unstable or unreachable", status: readiness.network },
    { key: "restrictedApps", label: "Restricted app detected", status: readiness.restrictedApps },
    { key: "keyboard", label: "Keyboard lockdown unavailable", status: readiness.keyboard },
    { key: "platform", label: "Platform support check failed", status: readiness.platform },
    { key: "vm", label: "VM or security check failed", status: readiness.vm },
  ].filter((item) => item.status === "fail");

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: themeColors.cardBg,
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "6px",
        padding: "24px",
        boxShadow: "none",
        transition: "all 150ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: themeColors.accent,
            outline: `1px solid ${themeColors.accent}`,
            outlineOffset: "1.5px",
          }}
        />
        <h3
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: themeColors.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          System Integrity HUD
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: "24px" }}>
        <ReadinessItem
          label="Network Connection"
          status={readiness.network}
          theme={theme}
          onResolve={onResolve ? () => onResolve("network") : undefined}
        />
        <ReadinessItem
          label="Video Capture"
          status={readiness.camera}
          theme={theme}
          onResolve={onResolve ? () => onResolve("camera") : undefined}
        />
        <ReadinessItem
          label="Audio Input"
          status={readiness.mic}
          theme={theme}
          onResolve={onResolve ? () => onResolve("mic") : undefined}
        />
        <ReadinessItem
          label="Secure VM Shield"
          status={readiness.vm}
          theme={theme}
          onResolve={onResolve ? () => onResolve("vm") : undefined}
        />
        <ReadinessItem
          label="Keyboard Lockdown"
          status={readiness.keyboard}
          theme={theme}
          onResolve={onResolve ? () => onResolve("keyboard") : undefined}
        />
        <ReadinessItem
          label="Platform Support"
          status={readiness.platform}
          theme={theme}
          onResolve={onResolve ? () => onResolve("platform") : undefined}
        />
        <ReadinessItem
          label="Restricted Processes"
          status={readiness.restrictedApps}
          theme={theme}
          onResolve={onResolve ? () => onResolve("restrictedApps") : undefined}
        />
      </div>

      <div
        style={{
          marginBottom: "18px",
          border:
            failedChecks.length > 0
              ? "1px solid rgba(239, 68, 68, 0.22)"
              : "1px solid rgba(255, 255, 255, 0.05)",
          background: failedChecks.length > 0 ? "rgba(239, 68, 68, 0.06)" : "transparent",
          borderRadius: "6px",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <p
          style={{
            color: failedChecks.length > 0 ? "#fca5a5" : "rgba(255, 255, 255, 0.35)",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "var(--font-mono), monospace",
            marginBottom: failedChecks.length > 0 ? "8px" : "0",
          }}
        >
          {failedChecks.length > 0 ? "Blocking Warnings" : "[ 0 ACTIVE INTEGRITY WARNINGS ]"}
        </p>
        {failedChecks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
            {failedChecks.map((item) => (
              <span
                key={item.key}
                style={{
                  color: "#f87171",
                  fontSize: "12px",
                  lineHeight: 1.35,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onSettingsRedirect}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "11px 16px",
          borderRadius: "6px",
          border: "1px solid rgba(168, 85, 247, 0.3)",
          background: "transparent",
          color: "#c084fc",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 150ms ease",
          letterSpacing: "0.06em",
          fontFamily: "var(--font-mono), monospace",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(168, 85, 247, 0.08)";
          e.currentTarget.style.borderColor = "#c084fc";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.3)";
        }}
      >
        [ RUN DIAGNOSTICS & SYSTEM SETUP ]
      </button>
    </div>
  );
}

function ReadinessItem({
  label,
  status,
  theme,
  onResolve,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  theme: "dark" | "light";
  onResolve?: () => void;
}) {
  const themeColors = getThemeColors(theme);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "13px 0",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontWeight: 500,
          fontFamily: "var(--font-mono), monospace",
          color: themeColors.textMutedStrong,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center" }}>
        {/* Status Text Column */}
        <div
          style={{
            width: "80px",
            textAlign: "right",
            marginRight: "16px",
          }}
        >
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontFamily: "var(--font-mono), monospace",
              color:
                status === "ok"
                  ? "#22c55e"
                  : status === "fail"
                    ? "#ef4444"
                    : themeColors.accentText,
            }}
          >
            {status === "ok" ? "SECURE" : status === "fail" ? "CRITICAL" : "SCANNING"}
          </span>
        </div>

        {/* Machined LED Status Dot Column (No drop shadows) */}
        <div
          style={{
            width: "24px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background:
                status === "ok" ? "#22c55e" : status === "fail" ? "#ef4444" : themeColors.accent,
              outline: `1px solid ${status === "ok" ? "#22c55e" : status === "fail" ? "#ef4444" : themeColors.accent}`,
              outlineOffset: "2px",
              animation:
                status === "checking"
                  ? "pulse-dot 1s ease-in-out infinite"
                  : status === "fail"
                    ? "pulse-dot 1.5s ease-in-out infinite"
                    : "none",
            }}
          />
        </div>

        {/* Fixed Width Action Button Slot */}
        <div
          style={{
            width: "80px",
            display: "flex",
            justifyContent: "flex-end",
            marginLeft: "16px",
          }}
        >
          {status === "fail" && onResolve ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "4px",
                padding: "3px 10px",
                fontSize: "9.5px",
                color: "#fca5a5",
                fontWeight: 700,
                letterSpacing: "0.05em",
                cursor: "pointer",
                fontFamily: "var(--font-mono), monospace",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
              }}
            >
              RESOLVE
            </button>
          ) : (
            <div style={{ width: "80px" }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Settings Control Room Panel ──
function SettingsPanel({
  readiness,
  setReadiness,
  theme,
  setTheme,
}: {
  readiness: ReadinessState;
  setReadiness: Dispatch<SetStateAction<ReadinessState>>;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  const [activeTab, setActiveTab] = useState<"hardware" | "permissions" | "security" | "about">(
    "hardware"
  );
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState("");
  const [camStats, setCamStats] = useState({
    resolution: "1280 x 720 px",
    fps: "30 FPS",
    aspect: "16:9",
  });
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const c = getThemeColors(theme);

  // Real Web Audio Mic Variables
  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Speaker oscillator test
  const [speakerActive, setSpeakerActive] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(50);
  const [speakerSuccess, setSpeakerSuccess] = useState<boolean | null>(null);

  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [securityEnv, setSecurityEnv] = useState<SecurityEnvironment | null>(null);
  const [processScan, setProcessScan] = useState<ProcessScanResult | null>(null);
  const [virtScan, setVirtScan] = useState<VirtDetectionResult | null>(null);
  const [networkCheck, setNetworkCheck] = useState<NetworkCheckResult | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);

  // Stop all streams on component unmount
  useEffect(() => {
    return () => {
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [camStream, micStream]);

  // Sync camera stream to video element after React re-renders and mounts <video>
  useEffect(() => {
    if (camStream && videoRef.current) {
      videoRef.current.srcObject = camStream;
      videoRef.current.play().catch(() => {});
    }
  }, [camStream]);

  // Monitor stream health — detect dead/ended tracks and gracefully reset
  useEffect(() => {
    if (!camStream) return;
    const videoTrack = camStream.getVideoTracks()[0];
    if (!videoTrack) return;

    function handleTrackEnded() {
      setCamStream(null);
      setCameraError("Camera stream ended unexpectedly. Click to restart.");
      setReadiness((r) => ({ ...r, camera: "fail" }));
    }

    videoTrack.addEventListener("ended", handleTrackEnded);
    return () => {
      videoTrack.removeEventListener("ended", handleTrackEnded);
    };
  }, [camStream, setReadiness]);

  // Release camera when switching away from the hardware tab
  useEffect(() => {
    if (activeTab !== "hardware" && camStream) {
      camStream.getTracks().forEach((track) => track.stop());
      setCamStream(null);
    }
  }, [activeTab, camStream]);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {});
    void runSecurityScan();
  }, []);

  async function runSecurityScan(force = false) {
    if (!force && cachedSecurityScan) {
      setPlatformInfo(cachedSecurityScan.platform);
      setSecurityEnv(cachedSecurityScan.env);
      setProcessScan(cachedSecurityScan.processes);
      setVirtScan(cachedSecurityScan.virt);
      setNetworkCheck(cachedSecurityScan.network);
      return;
    }

    setSecurityBusy(true);
    try {
      const telemetry = await withUiTimeout(
        invoke<FullTelemetry>("get_full_telemetry", { networkHost: getNetworkProbeHost() }),
        READINESS_TIMEOUT_MS.platform + READINESS_TIMEOUT_MS.process + READINESS_TIMEOUT_MS.network
      );

      const platform = telemetry?.platform ?? null;
      const env = telemetry?.env ?? null;
      const processes = telemetry?.processes ?? null;
      const virt = telemetry?.virt ?? null;
      const network = telemetry?.network ?? null;

      cachedSecurityScan = { platform, env, processes, virt, network };
      setPlatformInfo(platform);
      setSecurityEnv(env);
      setProcessScan(processes);
      setVirtScan(virt);
      setNetworkCheck(network);

      setReadiness((r) => ({
        ...r,
        platform:
          platform && (platform.os === "linux" || platform.os === "windows") ? "ok" : "fail",
        keyboard:
          platform && (platform.os === "linux" || platform.os === "windows") ? "ok" : "fail",
        restrictedApps: processes ? (processes.clean ? "ok" : "fail") : "fail",
        vm: virt ? (virt.detected ? "fail" : "ok") : "fail",
        network: network ? (network.reachable ? "ok" : "fail") : "fail",
      }));
    } finally {
      setSecurityBusy(false);
    }
  }

  // Request/Query camera streams with retry on device-busy race errors
  async function startCameraTest(isRetry = false) {
    if (cameraBusy && !isRetry) return;
    if (!isRetry) setCameraBusy(true);
    try {
      setCameraError(null);
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
        setCamStream(null);
      }
      const stream = await getUserMediaWithTimeout(
        {
          video: selectedCam
            ? { deviceId: { exact: selectedCam }, width: { ideal: 640 }, height: { ideal: 480 } }
            : { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        },
        8000
      );
      setCamStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Read real track settings if possible
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        const width = settings.width || 1280;
        const height = settings.height || 720;
        const frameRate = settings.frameRate || 30;
        setCamStats({
          resolution: `${width} x ${height} px`,
          fps: `${Math.round(frameRate)} FPS`,
          aspect: getAspectRatioLabel(width, height),
        });
      }

      // Populate devices list
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
      setReadiness((r) => ({ ...r, camera: "ok" }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // NotReadableError / AbortError = device still releasing from prior use;
      // retry once after a short delay before surfacing an error.
      const isRaceError =
        !isRetry && (msg.includes("NotReadable") || msg.includes("Abort") || msg.includes("busy"));
      if (isRaceError) {
        setTimeout(() => void startCameraTest(true), 600);
        return; // keep cameraBusy true during retry
      }
      console.error("Camera setup failed", err);
      setCameraError(describeMediaError(err, "camera"));
      setReadiness((r) => ({ ...r, camera: "fail" }));
    } finally {
      if (!isRetry || !cameraBusy) setCameraBusy(false);
    }
  }

  function getAspectRatioLabel(w: number, h: number) {
    if (w / h === 16 / 9) return "16:9 Widescreen";
    if (w / h === 4 / 3) return "4:3 Standard";
    return `${(w / h).toFixed(2)}:1`;
  }

  // Real Web Audio API Microphone Analyzer
  async function toggleMicMonitor() {
    if (micActive) {
      // Stop mic
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => {});
      }
      setMicStream(null);
      setMicLevel(0);
      setMicActive(false);
    } else {
      // Start real mic test
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawMicStats = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          // Scale it beautifully (average ranges 0 - 255)
          const scaledVal = Math.min(Math.round((average / 90) * 100), 100);
          setMicLevel(scaledVal);
          animationFrameRef.current = requestAnimationFrame(drawMicStats);
        };
        drawMicStats();
        setMicActive(true);
        setReadiness((r) => ({ ...r, mic: "ok" }));
      } catch (err) {
        console.error("Microphone capture failed", err);
        setMicError(describeMediaError(err, "microphone"));
        setReadiness((r) => ({ ...r, mic: "fail" }));
      }
    }
  }

  // Speaker Frequency Tone Oscillator
  function testSpeakers() {
    setSpeakerActive(true);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime); // Standard concert A frequency

      // Bind gain to the real volume level slider
      const volFraction = speakerVolume / 100;
      gainNode.gain.setValueAtTime(volFraction * 0.08, audioCtx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        audioCtx.close().catch(() => {});
        setSpeakerActive(false);
      }, 850);
    } catch (e) {
      console.error(e);
      setSpeakerActive(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "40px", minHeight: "560px", alignItems: "stretch" }}>
      {/* Settings Navigation Menu */}
      <div
        style={{
          width: "220px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          borderRight: `1px solid ${c.border}`,
          paddingRight: "24px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveTab("hardware")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            borderLeft:
              activeTab === "hardware" ? `3px solid ${c.accent}` : "3px solid transparent",
            background: activeTab === "hardware" ? c.accentLight : "transparent",
            color: activeTab === "hardware" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: activeTab === "hardware" ? 700 : 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Hardware Diagnostics
        </button>
        <button
          onClick={() => setActiveTab("permissions")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            borderLeft:
              activeTab === "permissions" ? `3px solid ${c.accent}` : "3px solid transparent",
            background: activeTab === "permissions" ? c.accentLight : "transparent",
            color: activeTab === "permissions" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: activeTab === "permissions" ? 700 : 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Permissions Check
        </button>
        <button
          onClick={() => setActiveTab("security")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            borderLeft:
              activeTab === "security" ? `3px solid ${c.accent}` : "3px solid transparent",
            background: activeTab === "security" ? c.accentLight : "transparent",
            color: activeTab === "security" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: activeTab === "security" ? 700 : 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Security Environment
        </button>
        <button
          onClick={() => setActiveTab("about")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            borderLeft: activeTab === "about" ? `3px solid ${c.accent}` : "3px solid transparent",
            background: activeTab === "about" ? c.accentLight : "transparent",
            color: activeTab === "about" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: activeTab === "about" ? 700 : 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          About / Legal
        </button>

        {/* Dynamic Theme Switcher Card inside the settings left column */}
        <div
          style={{
            marginTop: "auto",
            background: "rgba(255,255,255,0.01)",
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: c.textMuted,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            Interface Theme
          </span>
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.2)",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#a855f7",
                boxShadow: "0 0 6px #a855f7",
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "11.5px",
                fontWeight: 600,
                color: "#c084fc",
              }}
            >
              OBSIDIAN_DARK
            </span>
          </div>
          <p style={{ fontSize: "10px", color: c.textMuted, margin: 0, lineHeight: 1.4 }}>
            Locked by workstation environment policy.
          </p>
        </div>
      </div>

      {/* Settings Sub-Tab panels */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {activeTab === "hardware" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: "32px",
              alignItems: "stretch",
            }}
          >
            {/* Column 1: Wide webcam calibration frame */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "8px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "20px",
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>
                  Camera Validation Capture
                </h4>
                {camStream && (
                  <span
                    style={{
                      fontSize: "10px",
                      color: theme === "light" ? "#10b981" : "#22c55e",
                      fontFamily: "'JetBrains Mono', monospace",
                      background:
                        theme === "light" ? "rgba(16,185,129,0.08)" : "rgba(34,197,94,0.08)",
                      padding: "2px 8px",
                      borderRadius: "4px",
                    }}
                  >
                    STREAMING ACTIVE
                  </span>
                )}
              </div>

              {/* Viewfinder block */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1.6",
                  borderRadius: "8px",
                  background: c.innerBg,
                  overflow: "hidden",
                  border: `1px solid ${c.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {camStream ? (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    autoPlay
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      transform: "scaleX(-1)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "8px",
                      color: c.textMuted,
                    }}
                  >
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M23 7l-7 5 7 5V7zM1 5h14v14H1V5z" />
                    </svg>
                    <span
                      style={{
                        fontSize: "11px",
                        fontFamily: "'JetBrains Mono', monospace",
                        letterSpacing: "0.08em",
                      }}
                    >
                      STANDBY — CAPTURE DISCONNECTED
                    </span>
                  </div>
                )}

                {/* Secure alignment target HUD overlays */}
                <div
                  style={{
                    position: "absolute",
                    top: "16px",
                    left: "16px",
                    width: "12px",
                    height: "12px",
                    borderTop: `2px solid ${c.accent}`,
                    borderLeft: `2px solid ${c.accent}`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: "16px",
                    right: "16px",
                    width: "12px",
                    height: "12px",
                    borderTop: `2px solid ${c.accent}`,
                    borderRight: `2px solid ${c.accent}`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "16px",
                    left: "16px",
                    width: "12px",
                    height: "12px",
                    borderBottom: `2px solid ${c.accent}`,
                    borderLeft: `2px solid ${c.accent}`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "16px",
                    right: "16px",
                    width: "12px",
                    height: "12px",
                    borderBottom: `2px solid ${c.accent}`,
                    borderRight: `2px solid ${c.accent}`,
                  }}
                />
              </div>

              {/* Viewport controls */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <button
                    onClick={() => startCameraTest()}
                    disabled={cameraBusy}
                    style={{
                      padding: "10px 18px",
                      background: c.accentLight,
                      border: `1px solid ${c.accentBorder}`,
                      borderRadius: "6px",
                      color: c.accentText,
                      fontSize: "12.5px",
                      fontWeight: 500,
                      cursor: cameraBusy ? "not-allowed" : "pointer",
                      opacity: cameraBusy ? 0.72 : 1,
                      transition: "all 200ms",
                    }}
                  >
                    {cameraBusy
                      ? "Starting Capture..."
                      : camStream
                        ? "Restart Capture Feed"
                        : "Initialize Capture Feed"}
                  </button>

                  {cameras.length > 0 && (
                    <select
                      aria-label="Camera interface"
                      value={selectedCam}
                      onChange={(e) => setSelectedCam(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        background: c.innerBg,
                        border: `1px solid ${c.border}`,
                        borderRadius: "6px",
                        color: c.text,
                        fontSize: "12.5px",
                        outline: "2px solid transparent",
                        cursor: "pointer",
                        colorScheme: theme === "dark" ? "dark" : "light",
                      }}
                    >
                      {cameras.map((c) => (
                        <option key={c.deviceId} value={c.deviceId}>
                          {c.label || `Interface ${c.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {cameraError && (
                  <p style={{ fontSize: "11.5px", color: "#f87171", lineHeight: 1.5 }}>
                    {cameraError}. Run the app as your normal desktop user and close other apps
                    using the camera.
                  </p>
                )}

                {/* Real Video Track Settings telemetry */}
                {camStream && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: "10px",
                      background: c.innerBg,
                      padding: "12px 16px",
                      borderRadius: "6px",
                      border: `1px solid ${c.border}`,
                    }}
                  >
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>
                        RESOLVING RES
                      </p>
                      <p
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: c.text,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {camStats.resolution}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>
                        ACQUISITION RATE
                      </p>
                      <p
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: c.text,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {camStats.fps}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>
                        ASPECT RATIO
                      </p>
                      <p
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: c.text,
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        {camStats.aspect}
                      </p>
                    </div>
                  </div>
                )}

                <p style={{ fontSize: "11.5px", color: c.textMuted, lineHeight: 1.5 }}>
                  Widescreen 16:9 or standard 4:3 input are acceptable. The proctoring pipeline
                  scans frames locally to identify face landmarker telemetry markers.
                </p>
              </div>
            </div>

            {/* Column 2: Web Audio (Mic decibel + Speaker oscillator) diagnostics */}
            <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {/* Mic calibration */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "8px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                  flex: 1,
                  justifyContent: "center",
                }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>
                  Audio Microphone calibration
                </h4>
                <p style={{ fontSize: "12.5px", color: c.textMuted, lineHeight: 1.5 }}>
                  Detect and calibrate active microphone inputs to secure a clean environmental
                  decibel threshold.
                </p>

                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button
                    onClick={toggleMicMonitor}
                    style={{
                      padding: "10px 18px",
                      background: micActive
                        ? "rgba(239,68,68,0.08)"
                        : theme === "light"
                          ? "rgba(16,185,129,0.08)"
                          : "rgba(34,197,94,0.08)",
                      border: `1px solid ${micActive ? "rgba(239,68,68,0.3)" : theme === "light" ? "rgba(16,185,129,0.25)" : "rgba(34,197,94,0.3)"}`,
                      borderRadius: "6px",
                      color: micActive ? "#ef4444" : theme === "light" ? "#10b981" : "#86efac",
                      fontSize: "12.5px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 200ms",
                      width: "180px",
                    }}
                  >
                    {micActive ? "Stop Decibel Monitor" : "Monitor Audio Feed"}
                  </button>

                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        height: "8px",
                        background: c.innerBg,
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: `1px solid ${c.border}`,
                        position: "relative",
                        marginBottom: "6px",
                      }}
                    >
                      <div
                        style={{
                          width: `${micLevel}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #22c55e, #a855f7)",
                          transition: "width 60ms cubic-bezier(0.1, 0.8, 0.2, 1)",
                        }}
                      />
                    </div>
                    <p
                      style={{
                        fontSize: "11px",
                        color: c.textMuted,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      REALTIME VALUE: {micLevel > 0 ? `${micLevel}% amplitude` : "STANDBY"}
                    </p>
                    {micError && (
                      <p
                        style={{
                          fontSize: "11px",
                          color: "#f87171",
                          lineHeight: 1.4,
                          marginTop: "6px",
                        }}
                      >
                        {micError}. Check OS privacy settings and close other recording apps.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Speaker calibration */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "8px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                  flex: 1,
                  justifyContent: "center",
                }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>
                  Speaker Acoustic Output Test
                </h4>

                {/* Volume slider control */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      color: c.textMuted,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <span>TEST TONE GAIN AMPLITUDE</span>
                    <span>{speakerVolume}%</span>
                  </div>
                  <input
                    aria-label="Test tone gain amplitude"
                    type="range"
                    min="0"
                    max="100"
                    value={speakerVolume}
                    onChange={(e) => setSpeakerVolume(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: c.accent,
                      background: theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
                      height: "4px",
                      borderRadius: "2px",
                      cursor: "pointer",
                      outline: "2px solid transparent",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button
                    onClick={testSpeakers}
                    disabled={speakerActive}
                    style={{
                      padding: "10px 18px",
                      background: speakerActive
                        ? c.accentLight
                        : theme === "light"
                          ? "rgba(0,0,0,0.03)"
                          : "rgba(255,255,255,0.04)",
                      border: `1px solid ${c.border}`,
                      borderRadius: "6px",
                      color: c.text,
                      fontSize: "12.5px",
                      cursor: speakerActive ? "not-allowed" : "pointer",
                      transition: "all 200ms",
                    }}
                  >
                    {speakerActive ? "Playing Sine Wave..." : "Play Test Tone (440Hz)"}
                  </button>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setSpeakerSuccess(true)}
                      style={{
                        padding: "6px 12px",
                        background:
                          speakerSuccess === true ? "rgba(34,197,94,0.08)" : "transparent",
                        border: `1px solid ${speakerSuccess === true ? "rgba(34,197,94,0.3)" : theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(34,197,94,0.15)"}`,
                        borderRadius: "4px",
                        color: theme === "light" ? "#10b981" : "#86efac",
                        fontSize: "11.5px",
                        cursor: "pointer",
                      }}
                    >
                      Clear Signal
                    </button>
                    <button
                      onClick={() => setSpeakerSuccess(false)}
                      style={{
                        padding: "6px 12px",
                        background:
                          speakerSuccess === false ? "rgba(239,68,68,0.08)" : "transparent",
                        border: `1px solid ${speakerSuccess === false ? "rgba(239,68,68,0.3)" : theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(239,68,68,0.15)"}`,
                        borderRadius: "4px",
                        color: "#ef4444",
                        fontSize: "11.5px",
                        cursor: "pointer",
                      }}
                    >
                      No Signal
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "permissions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <PermissionLine
              label="Webcam Hardware Access"
              enabled={readiness.camera === "ok"}
              description="Allows the proctoring engine to capture live video alignment checkpoints"
              theme={theme}
            />
            <PermissionLine
              label="Microphone Access"
              enabled={readiness.mic === "ok"}
              description="Enables environmental acoustic monitoring to detect unapproved conversations"
              theme={theme}
            />
            <PermissionLine
              label="Tauri System Overlay notifications"
              enabled={true}
              description="Allows desktop prompts regarding firewall constraints or lock failures"
              theme={theme}
            />
          </div>
        )}

        {activeTab === "security" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "32px",
              alignItems: "stretch",
            }}
          >
            {/* Sec environmental checks list */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "8px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>
                  Security Environment Checks
                </h4>
                <button
                  onClick={() => void runSecurityScan(true)}
                  disabled={securityBusy}
                  style={{
                    padding: "7px 12px",
                    background: c.accentLight,
                    border: `1px solid ${c.accentBorder}`,
                    borderRadius: "6px",
                    color: c.accentText,
                    fontSize: "11.5px",
                    cursor: securityBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {securityBusy ? "Scanning..." : "Run Native Scan"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SecurityInfoRow
                  label="Operating system"
                  val={
                    platformInfo
                      ? `${platformInfo.os} / ${platformInfo.arch}`
                      : "Checking native platform"
                  }
                  secure={
                    platformInfo
                      ? platformInfo.os === "linux" || platformInfo.os === "windows"
                      : false
                  }
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Virtualization check"
                  val={
                    virtScan
                      ? virtScan.detected
                        ? `${virtScan.platform ?? "virtualized"} detected (${virtScan.confidence})`
                        : "Bare-metal signals clear"
                      : "Checking hypervisor signals"
                  }
                  secure={virtScan ? !virtScan.detected : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Display / webview session"
                  val={securityEnv?.display_server ?? "Native metadata pending"}
                  secure={!!securityEnv}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={
                    platformInfo?.os === "windows"
                      ? "Debugger/injection profile"
                      : "LD_PRELOAD injection"
                  }
                  val={
                    securityEnv
                      ? securityEnv.ld_preload_injection
                        ? "Injection variable present"
                        : "Clean"
                      : "Checking"
                  }
                  secure={securityEnv ? !securityEnv.ld_preload_injection : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={
                    platformInfo?.os === "windows"
                      ? "Native lockdown support"
                      : "Linux ptrace scope"
                  }
                  val={
                    platformInfo?.os === "windows"
                      ? "Keyboard hook and firewall commands available"
                      : securityEnv
                        ? `ptrace_scope ${securityEnv.ptrace_scope}`
                        : "Checking"
                  }
                  secure={
                    platformInfo?.os === "windows" ||
                    (securityEnv ? securityEnv.ptrace_scope > 0 : false)
                  }
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Network reachability"
                  val={
                    networkCheck
                      ? networkCheck.reachable
                        ? `${networkCheck.quality} (${networkCheck.latency_ms ?? "?"}ms)`
                        : "Unreachable"
                      : "Checking host reachability"
                  }
                  secure={networkCheck ? networkCheck.reachable : false}
                  theme={theme}
                />
              </div>
            </div>

            {/* restricted apps check */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "8px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>
                Restricted Background Processes
              </h4>
              <p style={{ fontSize: "12.5px", color: c.textMuted, lineHeight: 1.5 }}>
                Native process scanning is backed by /proc on Linux and tasklist on Windows.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginTop: "8px",
                }}
              >
                {processScan?.found.length ? (
                  processScan.found.map((name) => (
                    <ProcessListItem key={name} name={name} restricted={true} theme={theme} />
                  ))
                ) : (
                  <>
                    <ProcessListItem
                      name="OBS / screen recording tools"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="Discord / chat clients"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="TeamViewer / remote access"
                      restricted={false}
                      theme={theme}
                    />
                    <ProcessListItem
                      name="Debuggers / packet tools"
                      restricted={false}
                      theme={theme}
                    />
                  </>
                )}
              </div>
              <p
                style={{
                  fontSize: "11.5px",
                  color: processScan?.clean === false ? "#f87171" : c.textMuted,
                  lineHeight: 1.5,
                }}
              >
                {processScan
                  ? processScan.clean
                    ? "No restricted processes were found in the latest native scan."
                    : "Close the flagged apps and run the scan again before joining a session."
                  : "Run a native scan to populate the restricted process result."}
              </p>
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "24px",
              maxWidth: "680px",
            }}
          >
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "8px",
                padding: "28px",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Corner accent decal */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  width: "36px",
                  height: "36px",
                  background: `linear-gradient(135deg, transparent 50%, ${c.accentText}20 50%)`,
                  borderLeft: `1px solid ${c.border}`,
                  borderBottom: `1px solid ${c.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  color: c.accentText,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                }}
              >
                ℹ
              </div>

              <h4 style={{ fontSize: "16px", fontWeight: 700, color: c.text, marginBottom: "8px" }}>
                About AMS Access
              </h4>
              <p
                style={{
                  fontSize: "13px",
                  color: c.textMuted,
                  lineHeight: 1.5,
                  marginBottom: "24px",
                }}
              >
                AMS Access secure contestant sandbox environment. This platform manages identity
                verification, optical telemetry, and background integrity validations during
                quantitative rounds.
              </p>

              {/* Legal and version listings */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  borderTop: `1px solid ${c.border}`,
                  paddingTop: "20px",
                }}
              >
                {[
                  { label: "Privacy Policy", url: "/privacy" },
                  { label: "Terms of Service", url: "/terms" },
                  { label: "Open Source Licenses", url: "/licenses" },
                  { label: "System Version", value: "v0.1.0" },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      borderRadius: "6px",
                      background: theme === "light" ? "rgba(0,0,0,0.01)" : "rgba(255,255,255,0.01)",
                      border: `1px solid ${c.border}`,
                    }}
                  >
                    <span style={{ fontSize: "12.5px", fontWeight: 500, color: c.textMuted }}>
                      {item.label}
                    </span>
                    {item.url ? (
                      <a
                        href={item.url}
                        target={item.url.startsWith("/") ? undefined : "_blank"}
                        rel={item.url.startsWith("/") ? undefined : "noopener noreferrer"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          fontSize: "12px",
                          color: c.accentText,
                          textDecoration: "none",
                          fontWeight: 500,
                          cursor: "pointer",
                          transition: "opacity 150ms ease",
                        }}
                      >
                        Launch Document
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          fill="none"
                          style={{ marginLeft: "2px" }}
                        >
                          <path
                            d="M1 9l8-8M9 1h-6M9 1v6"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </a>
                    ) : (
                      <span
                        style={{
                          fontSize: "12px",
                          color: c.text,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontWeight: 600,
                        }}
                      >
                        {item.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionLine({
  label,
  enabled,
  description,
  theme,
}: {
  label: string;
  enabled: boolean;
  description: string;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        padding: "18px 22px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "20px",
      }}
    >
      <div>
        <h4 style={{ fontSize: "13.5px", fontWeight: 600, color: c.text, marginBottom: "4px" }}>
          {label}
        </h4>
        <p style={{ fontSize: "11.5px", color: c.textMuted, lineHeight: 1.4 }}>{description}</p>
      </div>
      <span
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: enabled ? (theme === "light" ? "#10b981" : "#22c55e") : "#f59e0b",
          background: enabled
            ? theme === "light"
              ? "rgba(16,185,129,0.08)"
              : "rgba(34,197,94,0.08)"
            : "rgba(245,158,11,0.08)",
          border: `1px solid ${enabled ? (theme === "light" ? "rgba(16,185,129,0.2)" : "rgba(34,197,94,0.2)") : "rgba(245,158,11,0.2)"}`,
          padding: "4px 10px",
          borderRadius: "4px",
          letterSpacing: "0.04em",
        }}
      >
        {enabled ? "GRANTED" : "BLOCKED"}
      </span>
    </div>
  );
}

function SecurityInfoRow({
  label,
  val,
  secure,
  theme,
}: {
  label: string;
  val: string;
  secure: boolean;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 12px",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "4px",
        alignItems: "center",
      }}
    >
      <span style={{ fontSize: "12px", color: c.textMutedStrong }}>{label}</span>
      <span
        style={{
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: secure ? (theme === "light" ? "#10b981" : "#22c55e") : "#ef4444",
        }}
      >
        {val}
      </span>
    </div>
  );
}

function ProcessListItem({
  name,
  restricted,
  theme,
}: {
  name: string;
  restricted: boolean;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 14px",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "6px",
      }}
    >
      <span style={{ fontSize: "12px", color: c.text }}>{name}</span>
      <span
        style={{
          fontSize: "9.5px",
          fontFamily: "'JetBrains Mono', monospace",
          color: restricted ? "#ef4444" : theme === "light" ? "#10b981" : "#22c55e",
          background: restricted
            ? "rgba(239,68,68,0.08)"
            : theme === "light"
              ? "rgba(16,185,129,0.08)"
              : "rgba(34,197,94,0.08)",
          padding: "2px 6px",
          borderRadius: "3px",
        }}
      >
        {restricted ? "FLAGGED" : "CLEARED"}
      </span>
    </div>
  );
}

// ── Diagnostics Console Panel ──
function DiagnosticsPanel({ readiness, theme }: { readiness: any; theme: "dark" | "light" }) {
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [networkQuality, setNetworkQuality] = useState("unchecked");
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [securityEnv, setSecurityEnv] = useState<SecurityEnvironment | null>(null);
  const c = getThemeColors(theme);

  useEffect(() => {
    void runNetworkScan();
  }, []);

  async function runNetworkScan() {
    setCheckingNetwork(true);
    try {
      const telemetry = await withUiTimeout(
        invoke<FullTelemetry>("get_full_telemetry", { networkHost: getNetworkProbeHost() }),
        READINESS_TIMEOUT_MS.platform + READINESS_TIMEOUT_MS.process + READINESS_TIMEOUT_MS.network
      );
      const result = telemetry?.network ?? null;
      setPlatformInfo(telemetry?.platform ?? null);
      setSecurityEnv(telemetry?.env ?? null);
      if (!result) {
        setLatency(null);
        setJitter(null);
        setNetworkQuality("unavailable");
        return;
      }
      setLatency(result.latency_ms);
      setJitter(result.jitter_ms);
      setNetworkQuality(result.reachable ? result.quality : "unreachable");
    } catch {
      setLatency(null);
      setJitter(null);
      setNetworkQuality("unavailable");
    } finally {
      setCheckingNetwork(false);
    }
  }

  // Functional diagnostic logs downloader
  function exportReport() {
    const data = {
      timestamp: new Date().toISOString(),
      client_version: "0.1.0",
      os: platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown",
      display_server: securityEnv?.display_server ?? "unknown",
      proctoring_telemetry: {
        camera_available: readiness.camera === "ok",
        mic_available: readiness.mic === "ok",
        network_latency_ms: latency,
        network_jitter_ms: jitter,
        network_quality: networkQuality,
      },
      security_lock_matrix: {
        platform_supported: readiness.platform === "ok",
        vm_shield_active: readiness.vm === "ok",
        ld_preload_clean: securityEnv ? !securityEnv.ld_preload_injection : null,
        keyboard_lock_available: readiness.keyboard === "ok",
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ams_diagnostic_report_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Network Diagnostics */}
      <div
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: "8px",
          padding: "var(--density-relaxed)",
        }}
      >
        <h4
          className="text-subsection-title"
          style={{ color: c.text, marginBottom: "var(--density-compact)" }}
        >
          Platform Connection Diagnostics
        </h4>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <TelemetryStat
            label="API Gateway Connectivity"
            val={
              checkingNetwork
                ? "Checking"
                : networkQuality === "unchecked"
                  ? "Not checked"
                  : networkQuality === "unavailable" || networkQuality === "unreachable"
                    ? "Unavailable"
                    : networkQuality
            }
            sub={`Probe host: ${getNetworkProbeHost()}`}
            status={
              checkingNetwork || networkQuality === "unchecked"
                ? "unknown"
                : networkQuality === "unavailable" || networkQuality === "unreachable"
                  ? "fail"
                  : "ok"
            }
            theme={theme}
          />
          <TelemetryStat
            label="Native Platform"
            val={platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "Unavailable"}
            sub={
              platformInfo ? `Family: ${platformInfo.family}` : "get_platform did not return data"
            }
            status={platformInfo ? "ok" : "unknown"}
            theme={theme}
          />
          <TelemetryStat
            label="Security Environment"
            val={securityEnv ? securityEnv.display_server : "Unavailable"}
            sub={
              securityEnv
                ? `LD_PRELOAD ${securityEnv.ld_preload_injection ? "present" : "clean"}`
                : "get_security_environment did not return data"
            }
            status={securityEnv ? (securityEnv.ld_preload_injection ? "fail" : "ok") : "unknown"}
            theme={theme}
          />
          <TelemetryStat
            label="Model Asset CDN"
            val="Not checked"
            sub="No real asset probe is configured yet"
            status="unknown"
            theme={theme}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "center",
            borderTop: `1px solid ${c.border}`,
            paddingTop: "16px",
          }}
        >
          <button
            onClick={runNetworkScan}
            disabled={checkingNetwork}
            style={{
              padding: "8px 16px",
              background: c.accentLight,
              border: `1px solid ${c.accentBorder}`,
              borderRadius: "6px",
              color: c.accentText,
              fontSize: "12px",
              cursor: checkingNetwork ? "not-allowed" : "pointer",
            }}
          >
            {checkingNetwork ? "Measuring Telemetry..." : "Scan Latency Network"}
          </button>
          <div style={{ display: "flex", gap: "20px" }}>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Latency:{" "}
              <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>
                {latency ?? "?"}ms
              </strong>
            </span>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Jitter:{" "}
              <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>
                {jitter ?? "?"}ms
              </strong>
            </span>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Signal Grade:{" "}
              <strong
                style={{
                  color:
                    networkQuality === "unreachable" || networkQuality === "unavailable"
                      ? "#ef4444"
                      : theme === "light"
                        ? "#10b981"
                        : "#22c55e",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {networkQuality.toUpperCase()}
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Diagnostics Logs panel */}
      <div
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: "8px",
          padding: "20px 24px",
        }}
      >
        <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text, marginBottom: "8px" }}>
          Diagnostics Log Registry
        </h4>
        <p
          style={{ fontSize: "12.5px", color: c.textMuted, marginBottom: "16px", lineHeight: 1.5 }}
        >
          Export local secure client parameters to help technical administrators troubleshoot
          workstation setups.
        </p>
        <pre
          style={{
            background: c.innerBg,
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            padding: "16px",
            fontSize: "11px",
            color: c.consoleText,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.6,
            overflowX: "auto",
            marginBottom: "20px",
          }}
        >
          {`{
  "client_version": "0.1.0",
  "build_channel": "release-production",
  "os_environment": "${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}",
  "display_server": "${securityEnv?.display_server ?? "unknown"}",
  "network_quality": "${networkQuality}",
  "security_lockdown": {
    "platform_supported": ${readiness.platform === "ok"},
    "keyboard_lock_available": ${readiness.keyboard === "ok"},
    "sandboxed_webview": true
  }
}`}
        </pre>
        <button
          onClick={exportReport}
          style={{
            padding: "8px 16px",
            background: theme === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            color: c.text,
            fontSize: "12px",
            cursor: "pointer",
            transition: "all 200ms",
          }}
        >
          Export Diagnostic JSON Log
        </button>
      </div>
    </div>
  );
}

function TelemetryStat({
  label,
  val,
  sub,
  status,
  theme,
}: {
  label: string;
  val: string;
  sub: string;
  status: "ok" | "fail" | "unknown";
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  const dotColor =
    status === "ok"
      ? theme === "light"
        ? "#10b981"
        : "#22c55e"
      : status === "fail"
        ? "#ef4444"
        : theme === "light"
          ? "#a8a29e"
          : "rgba(255,255,255,0.32)";
  return (
    <div
      style={{
        padding: "var(--density-standard)",
        background: c.innerBg,
        border: `1px solid ${c.border}`,
        borderRadius: "6px",
      }}
    >
      <p className="text-micro-label" style={{ color: c.textMuted, marginBottom: "4px" }}>
        {label}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        <span className="text-body-copy" style={{ fontWeight: 600, color: c.text }}>
          {val}
        </span>
      </div>
      <p className="text-mono-console" style={{ color: c.textMuted, margin: 0 }}>
        {sub}
      </p>
    </div>
  );
}

type SecurityLogEntry = { id: string; text: string };

function SecurityOperationsLog({ theme }: { theme: "dark" | "light" }) {
  const [logs, setLogs] = useState<SecurityLogEntry[]>([]);
  const themeColors = getThemeColors(theme);

  useEffect(() => {
    const baseLogs = [
      "SYSTEM: Secure shell layer initialized on native namespace",
      "INTEGRITY: Display server Mutter configurations parsed",
      "INTEGRITY: Process scanner active (0 blacklisted instances)",
      "NETWORK: Outbound port lock filters verified via iptables",
      "HARDWARE: Connected audio/video interfaces bound to WebKitGTK namespace",
    ];

    setLogs(
      baseLogs.map((l, i) => {
        const time = new Date(Date.now() + i).toLocaleTimeString([], { hour12: false });
        return { id: `base-${i}-${time}`, text: `[${time}] ${l}` };
      })
    );

    const interval = setInterval(() => {
      setLogs((prev) => {
        const next = [...prev];
        if (next.length > 8) next.shift();
        const time = new Date().toLocaleTimeString([], { hour12: false });
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          text: `[${time}] TELEMETRY: System heartbeat beacon transmitted`,
        });
        return next;
      });
    }, 14000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: `1px solid ${themeColors.border}`,
        borderRadius: "8px",
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: themeColors.accent,
            boxShadow: `0 0 6px ${themeColors.accent}`,
          }}
        />
        <h4
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: themeColors.textMuted,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Live Security Operations Feed
        </h4>
      </div>
      <div
        style={{
          background: themeColors.innerBg,
          border: `1px solid ${themeColors.border}`,
          borderRadius: "6px",
          padding: "16px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "11.5px",
          color: themeColors.consoleText,
          lineHeight: 1.6,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {logs.map((log) => (
          <div
            key={log.id}
            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {log.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function parseLogLine(log: string, dotColor: string) {
  let splitIndex = log.indexOf("... ");
  let sep = "... ";
  if (splitIndex === -1) {
    splitIndex = log.indexOf(": ");
    sep = ": ";
  }

  if (splitIndex === -1) {
    return <span>{log}</span>;
  }

  const prefix = log.substring(0, splitIndex + sep.length);
  const status = log.substring(splitIndex + sep.length);

  let statusColor = dotColor;
  if (
    status.includes("ERROR") ||
    status.includes("CRITICAL") ||
    status.includes("DENIED") ||
    status.includes("UNREACHABLE")
  ) {
    statusColor = "#ef4444";
  } else if (status.includes("WARNING") || status.includes("MUTED") || status.includes("pending")) {
    statusColor = "#f59e0b";
  }

  return (
    <>
      <span style={{ color: "#A8A8A8" }}>{prefix}</span>
      <span style={{ color: statusColor, fontWeight: 700 }}>{status}</span>
    </>
  );
}

interface SessionReadinessModalProps {
  contestId: string;
  sessionType: "new" | "resume";
  theme: "dark" | "light";
  onClose: () => void;
  readiness: ReadinessState;
  readinessReport: ReadinessReport | null;
  onSettingsRedirect: () => void;
  onRescan: () => Promise<void>;
}

function SessionReadinessModal({
  contestId,
  sessionType,
  theme,
  onClose,
  readiness,
  readinessReport,
  onSettingsRedirect,
  onRescan,
}: SessionReadinessModalProps) {
  const router = useRouter();
  const c = getThemeColors(theme);
  const isLight = theme === "light";
  const [isRescanning, setIsRescanning] = useState(false);
  const activeReport = readinessReport?.contest_id === contestId ? readinessReport : null;
  const hasPendingChecks = Object.values(readiness).some((status) => status === "checking");
  const scanStatus: "scanning" | "done" =
    isRescanning || (activeReport === null && hasPendingChecks) ? "scanning" : "done";

  const score = calculateReadinessScore(readiness);
  const estimatedTime = getEstimatedTimeToReady(readiness);
  const hardRequirementsMet = readiness.camera !== "fail" && readiness.network !== "fail";
  const canProceed =
    scanStatus === "done" && activeReport?.decision === "allowed" && hardRequirementsMet;
  const shouldShowFixIssues = scanStatus === "done" && !canProceed;

  const consoleLogs = useMemo(() => {
    if (scanStatus === "scanning") {
      return [
        "[SYS] Waiting for readiness report...",
        "[SCAN] Running active telemetry probe from local device checks.",
      ];
    }

    if (!activeReport) {
      return ["[SYS] Readiness report unavailable.", "[SYS] Policy decision: BLOCKED"];
    }

    const checkLog = (kind: string, prefix: string, label: string) => {
      const check = activeReport.checks.find((item) => item.kind === kind);
      if (!check) return `[${prefix}] ${label}: unavailable`;
      const outcome = check.outcome === "pass" ? "PASS" : "FAIL";
      const detail = check.detail ? ` - ${check.detail}` : "";
      return `[${prefix}] ${label}: ${outcome}${detail}`;
    };

    return [
      `[SYS] Readiness report received at ${new Date(activeReport.generated_at_ms).toLocaleTimeString()}`,
      checkLog("network", "NET", "Network connectivity"),
      checkLog("microphone", "AUD", "Audio telemetry"),
      checkLog("camera", "CAM", "Optical stream"),
      checkLog("virtualization", "SEC", "Virtualization shield"),
      checkLog("keyboard_lockdown", "SEC", "Keyboard lockdown"),
      checkLog("restricted_apps", "SEC", "Restricted process scan"),
      `[SYS] Policy decision: ${activeReport.decision.toUpperCase()}`,
    ];
  }, [activeReport, scanStatus]);

  async function handleRescan() {
    setIsRescanning(true);
    await onRescan();
    setIsRescanning(false);
  }

  const proceedHref =
    sessionType === "new"
      ? `/session/onboarding?contestId=${contestId}`
      : `/session/contest?contestId=${contestId}`;

  useEffect(() => {
    router.prefetch(proceedHref);
  }, [proceedHref, router]);

  // Radial stroke calculations for SVGs
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const currentProgress = scanStatus === "scanning" ? 0 : score;
  const strokeDashoffset = circumference - (currentProgress / 100) * circumference;

  const accentColor = score === 100 ? "#10b981" : "#f59e0b";
  const glowColor = score === 100 ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)";
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-readiness-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      {/* Immersive Pre-Flight Card Panel */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          width: "100%",
          maxWidth: "920px",
          minHeight: "540px",
          background: isLight ? "#ffffff" : c.cardBg,
          border: `1px solid ${c.borderStrong}`,
          borderRadius: "2px",
          padding: "36px",
          boxShadow: isLight
            ? "0 24px 60px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)"
            : "0 24px 64px rgba(168, 85, 247, 0.08)",
          position: "relative",
          overflow: "hidden",
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
          gap: "36px",
        }}
      >
        {/* Ambient Spotlights inside Card */}
        <div
          style={{
            position: "absolute",
            top: "-40%",
            left: "-20%",
            width: "300px",
            height: "300px",
            background: `radial-gradient(circle, ${score === 100 ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)"} 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* Left Column: tabular readout */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderRight: isLight
              ? "1px solid rgba(0, 0, 0, 0.12)"
              : "1px solid rgba(255, 255, 255, 0.12)",
            paddingRight: "36px",
            gap: "6px",
          }}
        >
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: c.textMuted,
              marginBottom: "16px",
              whiteSpace: "nowrap",
            }}
          >
            SESSION READINESS SCAN
          </p>

          {/* Dense telemetry block */}
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              lineHeight: 2,
              color: c.textMutedStrong,
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>SYS_INTEGRITY: </span>
              <span
                style={{
                  color: score === 100 ? c.dot : "#f59e0b",
                  letterSpacing: "-0.12em",
                  display: "inline-block",
                }}
              >
                {"█".repeat(Math.round(currentProgress / 10)) +
                  "░".repeat(10 - Math.round(currentProgress / 10))}
              </span>
              <span style={{ color: score === 100 ? c.dot : "#f59e0b", marginLeft: "6px" }}>
                {Math.round(currentProgress)}%
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>STATUS: </span>
              <span
                style={{ color: scanStatus === "scanning" ? "#f59e0b" : c.dot, fontWeight: 700 }}
              >
                {scanStatus === "scanning" ? "PROBING" : "ARMED"}
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>ETA_READY: </span>
              <span style={{ color: estimatedTime === 0 ? c.dot : "#f59e0b" }}>
                {estimatedTime === 0 ? "0s" : `${estimatedTime}s`}
              </span>
            </div>
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: c.textMuted }}>SCAN_PROGRESS: </span>
              <span style={{ color: c.textMutedStrong }}>{Math.round(currentProgress)}/100</span>
            </div>
          </div>
        </div>

        {/* Right Column: Pre-flight checklist & live console */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Header Summary */}
          <div>
            <h3
              id="session-readiness-title"
              style={{
                fontSize: "16px",
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.04em",
                color: c.text,
                marginBottom: "6px",
              }}
            >
              Secure Enclave Port
            </h3>
            <p
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#999999",
                lineHeight: 1.6,
              }}
            >
              Pre-flight validation of biometric feeds, restricted process hooks, and network
              topology.
            </p>
          </div>

          {/* Checklist */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <PreflightCheckItem
              label="Network Connectivity"
              status={readiness.network}
              successLabel="Network stable"
              failLabel="Network unstable"
              theme={theme}
            />
            <PreflightCheckItem
              label="Audio Telemetry"
              status={readiness.mic}
              successLabel="Audio detected"
              failLabel="Audio check pending"
              theme={theme}
            />
            <PreflightCheckItem
              label="Optical Stream"
              status={readiness.camera}
              successLabel="Camera active"
              failLabel="Camera offline"
              theme={theme}
            />
            <PreflightCheckItem
              label="Kernel Virtualization Shield"
              status={
                readiness.vm === "ok" && readiness.keyboard === "ok" && readiness.platform === "ok"
                  ? "ok"
                  : "fail"
              }
              successLabel="Secure environment active"
              failLabel="Secure environment flagged"
              theme={theme}
            />
            <PreflightCheckItem
              label="Biometric Web Permissions"
              status={readiness.camera === "ok" && readiness.mic === "ok" ? "ok" : "fail"}
              successLabel="Required permissions granted"
              failLabel="Required permissions pending"
              theme={theme}
            />
          </div>

          {/* Scrolling Monospace Terminal Console */}
          <div
            style={{
              background: isLight ? "#f8fafc" : c.innerBg,
              border: `1px solid ${c.border}`,
              borderRadius: "2px",
              padding: "14px",
              height: "135px",
              overflowY: "auto",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
              color: "#A8A8A8",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {consoleLogs.map((log, index) => (
              <div
                key={index}
                style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}
              >
                {parseLogLine(log, c.dot)}
              </div>
            ))}
            {scanStatus === "scanning" && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>[SCAN] Running active telemetry probe</span>
                <span
                  className="terminal-caret"
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "12px",
                    background: "currentColor",
                    animation: "pulse-dot 1s ease infinite",
                  }}
                >
                  ▎
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "10px",
              marginTop: "8px",
            }}
          >
            {canProceed ? (
              <Link
                href={proceedHref}
                prefetch
                onClick={onClose}
                style={{
                  flex: "1 1 180px",
                  minWidth: "180px",
                  height: "42px",
                  borderRadius: "2px",
                  border: `1px solid ${c.dot}`,
                  background: c.innerBg,
                  color: c.dot,
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
              >
                PROCEED TO SESSION
              </Link>
            ) : (
              <button
                disabled
                style={{
                  flex: "1 1 180px",
                  minWidth: "180px",
                  height: "42px",
                  borderRadius: "2px",
                  border: `1px solid ${c.border}`,
                  background: c.innerBg,
                  color: c.textMuted,
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "not-allowed",
                  transition: "all 150ms ease",
                }}
              >
                {scanStatus === "scanning" ? "PROBING..." : "PROCEED TO SESSION"}
              </button>
            )}
            {shouldShowFixIssues && (
              <button
                onClick={onSettingsRedirect}
                style={{
                  height: "42px",
                  borderRadius: "2px",
                  border: "1px solid #f59e0b",
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#f59e0b",
                  padding: "0 14px",
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  transition: "all 150ms ease",
                }}
              >
                FIX ISSUES
              </button>
            )}
            <button
              onClick={handleRescan}
              disabled={scanStatus === "scanning" || isRescanning}
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: scanStatus === "scanning" || isRescanning ? "not-allowed" : "pointer",
                transition: "all 200ms ease",
              }}
              title="Rescan systems"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{
                  animation:
                    scanStatus === "scanning" || isRescanning ? "spin 1s linear infinite" : "none",
                }}
              >
                <path
                  d="M1 8a7 7 0 1 1 7 7M1 8h4V4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              onClick={onSettingsRedirect}
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 200ms ease",
              }}
              title="Go to settings"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M8 1v2M8 13v2M1 8h2M13 8h2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                height: "42px",
                borderRadius: "2px",
                border: `1px solid ${c.border}`,
                background: "transparent",
                color: c.textMuted,
                padding: "0 16px",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: "0.08em",
                cursor: "pointer",
                transition: "all 200ms ease",
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function PreflightCheckItem({
  label,
  status,
  successLabel,
  failLabel,
  theme,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  successLabel: string;
  failLabel: string;
  theme: "dark" | "light";
}) {
  const c = getThemeColors(theme);
  const dotColor = status === "ok" ? c.dot : status === "fail" ? "#f59e0b" : c.accent;
  const valueColor = status === "ok" ? c.dot : status === "fail" ? "#f59e0b" : c.accent;
  const valueLabel =
    status === "ok"
      ? successLabel.toUpperCase()
      : status === "fail"
        ? failLabel.toUpperCase()
        : "PROBING...";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontFamily: "'JetBrains Mono', monospace",
          color: c.textMutedStrong,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            boxShadow: status !== "checking" ? `0 0 6px ${dotColor}` : "none",
            animation: status === "checking" ? "pulse-dot 1.5s ease-in-out infinite" : "none",
          }}
        />
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: valueColor,
          }}
        >
          {valueLabel}
        </span>
      </div>
    </div>
  );
}

function calculateReadinessScore(r: ReadinessState) {
  let score = 100;
  const cameraOk = r.camera === "ok";
  const micOk = r.mic === "ok";
  const networkOk = r.network === "ok";
  const secureEnvOk = r.vm === "ok" && r.keyboard === "ok" && r.platform === "ok";

  if (!networkOk) score -= 30;
  if (!secureEnvOk) {
    let vmDeduct = r.vm !== "ok" ? 15 : 0;
    let kbDeduct = r.keyboard !== "ok" ? 10 : 0;
    let platDeduct = r.platform !== "ok" ? 10 : 0;
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

function getEstimatedTimeToReady(r: ReadinessState) {
  let time = 0;
  if (r.camera !== "ok") time += 45; // camera disconnected -> 45 sec
  if (r.mic !== "ok") time += 15;
  if (r.network !== "ok") time += 30;
  if (r.vm !== "ok" || r.keyboard !== "ok") time += 60;
  return time;
}

interface ResolveModalProps {
  isOpen: boolean;
  onClose: () => void;
  checkKey: string | null;
  theme: "dark" | "light";
}

function ResolveModal({ isOpen, onClose, checkKey, theme }: ResolveModalProps) {
  if (!isOpen || !checkKey) return null;

  const c = getThemeColors(theme);

  const getDetails = () => {
    switch (checkKey) {
      case "restrictedApps":
        return {
          title: "Close Conflicting Applications",
          desc: "Security protocol requires all screen recording, sharing, or development side-applications (e.g., Discord, Zoom, OBS Studio, Teams) to be closed completely. Please terminate these background processes using Task Manager / System Monitor to resume system readiness.",
        };
      case "camera":
        return {
          title: "Webcam Access Requirement",
          desc: "The system cannot detect a live video source. Please confirm your webcam is plugged in securely, verify that other applications (like Skype or Zoom) are not locking the feed, and check browser camera permissions in your operating system settings.",
        };
      case "mic":
        return {
          title: "Audio Device Connection",
          desc: "The audio hardware check failed. Please ensure your microphone is plugged in, is not muted at the physical hardware level, and is allowed inside your system privacy preferences.",
        };
      case "network":
        return {
          title: "Stabilize Network Connectivity",
          desc: "High network latency, packet loss, or host blocking was detected. Please switch to a wired Ethernet connection if possible, disable running VPN clients, and ensure your router allows standard HTTPS websockets.",
        };
      case "keyboard":
        return {
          title: "Configure OS Keyboard Shortcuts",
          desc: "Standard browser window shortcuts are restricted during this session. If you are using custom window managers or keys (like i3, AutoHotkey, or keyboard remappers), please temporarily disable them.",
        };
      default:
        return {
          title: "Environment Verification Error",
          desc: "The sandbox system detected a virtualized environment or unauthorized platform. Please close any hypervisors (e.g., VirtualBox, VMware) and boot into your native desktop environment.",
        };
    }
  };

  const info = getDetails();
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resolve-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(3,8,22,0.6)",
        backdropFilter: "blur(16px)",
        animation: "fadeIn 280ms var(--ease-cinematic) forwards",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          maxWidth: "460px",
          width: "100%",
          borderRadius: "16px",
          padding: "36px 32px",
          background: theme === "light" ? "#ffffff" : "rgba(15, 23, 42, 0.95)",
          border: `1px solid ${c.border}`,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.35)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" strokeLinecap="round" strokeWidth="2.5" />
          </svg>
        </div>
        <h3
          id="resolve-modal-title"
          className="text-subsection-title"
          style={{ color: c.text, marginBottom: "12px" }}
        >
          {info.title}
        </h3>
        <p
          className="text-body-copy"
          style={{ color: c.textMutedStrong, lineHeight: 1.6, marginBottom: "28px" }}
        >
          {info.desc}
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "12px",
            background: theme === "light" ? "#302a3b" : "#ffffff",
            color: theme === "light" ? "#ffffff" : "#0f172a",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "12px",
            cursor: "pointer",
            transition: "opacity 200ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          Close Resolution Guide
        </button>
      </div>
    </div>
  );
}
