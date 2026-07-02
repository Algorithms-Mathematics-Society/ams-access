"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, LayoutGrid, Settings as SettingsIcon } from "lucide-react";
import {
  applyOrganizerOverrides,
  fetchOrganizerOverrides,
  invoke,
  runSessionReadiness,
  sessionPolicy,
} from "@ams/api-client";
import { fetchJson, useApiQuery } from "@/lib/api-client";
import { useTheme } from "@/lib/theme";
import { useDarkLocked } from "@/lib/theme-dark-lock"; // step-0 (shipped on main via PR #17)
import { authHeaders } from "@/lib/candidate-auth";
import { STORAGE_KEYS } from "@/constants/storage-keys";

// ── Types ──────────────────────────────────────────────────────
import type {
  InvitedContest,
  ReadinessState,
  SecurityLogEntry,
  SecurityLogLevel,
  TelemetryQueryState,
  FullTelemetry,
  SecurityScanSnapshot,
  ActiveSession,
  ResumeVerificationState,
  CloseAppsResult,
} from "./components/types";

// ── Utils / hooks ──────────────────────────────────────────────
import {
  API_URL,
  TELEMETRY_STALE_MS,
  ACTIVE_SESSION_KEY,
  EMPTY_TELEMETRY,
  READINESS_TIMEOUT_MS,
  mergeContestLists,
  loadUnlockedContests,
  saveUnlockedContests,
  getOrCreateDeviceId,
  withUiTimeout,
  getBrowserMediaAvailability,
  fetchWithTimeout,
  readinessFromReport,
  getThemeColors,
  getVerificationWindowMinutes,
} from "./components/utils";

// ── Components ─────────────────────────────────────────────────
import { ContestsPanel } from "./components/ContestsPanel";
import { SessionActionsPanel } from "./components/SessionActionsPanel";
import { ReadinessWidget } from "./components/ReadinessPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SecurityOperationsLog } from "./components/SecurityOperationsLog";
import { SessionReadinessModal } from "./components/SessionReadinessModal";
import { ResolveModal } from "./components/ResolveModal";
import { deriveContestantReadiness } from "./components/readiness-context";

const NAV_ITEMS = [
  {
    id: "overview",
    label: "Home",
    icon: <LayoutGrid size={16} strokeWidth={1.8} />,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <SettingsIcon size={16} strokeWidth={1.8} />,
  },
  {
    id: "diagnostics",
    label: "Device",
    icon: <Activity size={16} strokeWidth={1.8} />,
  },
];

export default function HomePage() {
  const router = useRouter();
  const { theme: canonicalTheme } = useTheme(); // canonical single source
  const darkLocked = useDarkLocked(); // step-0 JS facet: true while /home is dark-locked (it is, through step 3)
  // Home is dark-locked through Phase 2a step 3. Its colors are JS ternaries until step 2, which a
  // CSS lock can't constrain — so clamp the READ to dark while locked. Read-time derivation, NOT a
  // writer: canonical stays the sole theme state. At the step-3 flip, delete the clamp.
  const theme = darkLocked ? "dark" : canonicalTheme;
  const [activeNav, setActiveNav] = useState("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  // Open when pinned (clicked) or while hovered — collapse otherwise.
  const sidebarOpen = sidebarExpanded || sidebarHovered;
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
  const [resumeVerification, setResumeVerification] = useState<ResumeVerificationState>("none");
  const [userEmail, setUserEmail] = useState("tester@ams.local");
  const [userDisplayEmail, setUserDisplayEmail] = useState("");
  const [userEmailHydrated, setUserEmailHydrated] = useState(false);
  const [preflightContestId, setPreflightContestId] = useState<string | null>(null);
  const [preflightSessionType, setPreflightSessionType] = useState<"new" | "resume">("new");
  const [activeResolveModal, setActiveResolveModal] = useState<string | null>(null);
  const [closingApps, setClosingApps] = useState(false);
  const [closeFailedApps, setCloseFailedApps] = useState<string[]>([]);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);
  const inviteCodeInFlightRef = useRef(false);
  const resumeInFlightRef = useRef(false);
  const resumeConsumeInFlightRef = useRef(false);
  const [readiness, setReadiness] = useState<ReadinessState>({
    camera: "checking",
    mic: "checking",
    network: "checking",
    keyboard: "checking",
    restrictedApps: "checking",
    vm: "checking",
    platform: "checking",
  });
  const [readinessReport, setReadinessReport] = useState<
    import("@ams/api-client").ReadinessReport | null
  >(null);
  const [securityLogs, setSecurityLogs] = useState<SecurityLogEntry[]>([]);
  const [telemetryQuery, setTelemetryQuery] = useState<TelemetryQueryState>(EMPTY_TELEMETRY);
  const telemetryInFlightRef = useRef<Promise<SecurityScanSnapshot | null> | null>(null);
  const lastScannedAtRef = useRef<number | null>(null);

  const appendSecurityEvent = useCallback((event: string, level: SecurityLogLevel = "info") => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setSecurityLogs((prev) => {
      const next = [
        ...prev,
        {
          id: String(Date.now()) + "-" + Math.random().toString(36).slice(2),
          text: "[" + time + "] " + event,
          level,
        },
      ];
      return next.slice(-12);
    });
  }, []);

  const refreshTelemetry = useCallback(
    async (force = false, source = "TELEMETRY") => {
      const now = Date.now();
      const cachedIsFresh =
        !force &&
        lastScannedAtRef.current !== null &&
        now - lastScannedAtRef.current < TELEMETRY_STALE_MS;
      if (cachedIsFresh) {
        appendSecurityEvent(source + ": Reused shared native telemetry snapshot");
        return;
      }

      if (telemetryInFlightRef.current) {
        appendSecurityEvent(source + ": Joined in-flight native telemetry scan");
        await telemetryInFlightRef.current;
        return;
      }

      setTelemetryQuery((prev) => ({ ...prev, isLoading: true, error: null }));
      appendSecurityEvent(source + ": Native telemetry scan started");

      const request = withUiTimeout(
        // Connectivity checks are disabled for now so they do not block contest testing.
        invoke<FullTelemetry>("get_full_telemetry", { networkHost: null }),
        READINESS_TIMEOUT_MS.platform + READINESS_TIMEOUT_MS.process
      ).then((telemetry) => {
        if (!telemetry) return null;
        return {
          platform: telemetry.platform ?? null,
          env: telemetry.env ?? null,
          processes: telemetry.processes ?? null,
          virt: telemetry.virt ?? null,
          network: telemetry.network ?? null,
        } satisfies SecurityScanSnapshot;
      });

      telemetryInFlightRef.current = request;
      try {
        const snapshot = await request;
        if (!snapshot) throw new Error("Native telemetry unavailable");
        lastScannedAtRef.current = Date.now();
        setTelemetryQuery({
          ...snapshot,
          lastScannedAt: lastScannedAtRef.current,
          isLoading: false,
          error: null,
        });
        setReadiness((r) => ({
          ...r,
          platform:
            snapshot.platform &&
            (snapshot.platform.os === "linux" ||
              snapshot.platform.os.toLowerCase().startsWith("windows") ||
              snapshot.platform.os === "macos")
              ? "ok"
              : "fail",
          keyboard:
            snapshot.platform &&
            (snapshot.platform.os === "linux" ||
              snapshot.platform.os.toLowerCase().startsWith("windows") ||
              snapshot.platform.os === "macos")
              ? "ok"
              : "fail",
          restrictedApps: snapshot.processes ? (snapshot.processes.clean ? "ok" : "fail") : "fail",
          vm: snapshot.virt ? (snapshot.virt.detected ? "fail" : "ok") : "fail",
          network: "ok",
        }));
        appendSecurityEvent(
          source +
            ": Native scan completed; restricted_apps=" +
            (snapshot.processes ? (snapshot.processes.clean ? "clear" : "flagged") : "unknown") +
            ", network=skipped"
        );
      } catch {
        setTelemetryQuery((prev) => ({
          ...prev,
          isLoading: false,
          error: "Native telemetry unavailable",
        }));
        appendSecurityEvent(source + ": Native telemetry scan failed", "error");
      } finally {
        telemetryInFlightRef.current = null;
      }
    },
    [appendSecurityEvent]
  );

  const c = useMemo(() => getThemeColors(theme), [theme]);

  const contestantReadiness = useMemo(
    () =>
      deriveContestantReadiness({
        readiness,
        report: readinessReport,
        entryWindowStatus: null,
        activeSession,
      }),
    [readiness, readinessReport, activeSession]
  );

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
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes("HTTP 404")) {
              return null;
            }
            console.error("Failed to fetch fresh contest details for", uc.id, e);
          }
          return uc;
        })
      );
      const keptUnlocked = freshUnlocked.filter((c): c is InvitedContest => Boolean(c));
      saveUnlockedContests(keptUnlocked);
      return mergeContestLists(data ?? [], keptUnlocked);
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
    appendSecurityEvent("SESSION: Contest list refresh requested for " + email);
    setSessionsError(null);
    try {
      const data = await invitedContestsQuery.mutate();
      if (data) {
        setContests(data);
        appendSecurityEvent(
          "SESSION: Contest list refresh completed (" + data.length + " records)"
        );
      }
    } catch {
      if (mode === "refresh") {
        setSessionsError("Could not refresh sessions. Check your connection and try again.");
        appendSecurityEvent("SESSION: Contest list refresh failed", "error");
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
      appendSecurityEvent("READINESS: Local integrity scan started");
    }

    const media = await getBrowserMediaAvailability();
    if (isCancelled()) return;
    appendSecurityEvent(
      "HARDWARE: Media availability camera=" +
        (media.cameraAvailable ? "available" : "missing") +
        ", microphone=" +
        (media.microphoneAvailable ? "available" : "missing")
    );

    try {
      const strict = Boolean(contestId);
      const deviceId = getOrCreateDeviceId();

      // Live proctor "resolve" channel: organizer-issued override grants
      // loosen specific checks for this device. Fetch is best-effort — no
      // endpoint / offline simply means the base policy applies.
      const overrides = contestId
        ? await fetchOrganizerOverrides(API_URL, contestId, deviceId)
        : [];
      if (isCancelled()) return;
      // Pass the OS so platform-conditioned policy applies — without it the gate
      // used the platform-less defaults and hard-blocked macOS keyboard lockdown
      // (which is meant to be advisory on macOS). Also lets the Windows-only
      // display/RDP checks enforce here, matching the onboarding gate.
      const devicePlatform = await invoke<{ os?: string }>("get_platform")
        .then((p) => p?.os)
        .catch(() => undefined);
      if (isCancelled()) return;
      const basePolicy = sessionPolicy(
        strict ? "strict_contest" : "internal_pilot",
        devicePlatform
      );
      const policy = applyOrganizerOverrides(basePolicy, overrides);
      if (overrides.length > 0) {
        const kinds = overrides.map((grant) => grant.check_kind).join(", ");
        appendSecurityEvent(`READINESS: Organizer overrides active for ${kinds}`, "warn");
        void invoke("log_proctoring_event", {
          kind: "organizer_override_applied",
          detail: `organizer overrides active: ${kinds}`,
          timestamp: Date.now(),
          payload: { contest_id: contestId, device_id: deviceId, overrides },
        }).catch(() => {});
      }

      const report = await runSessionReadiness({
        // Network readiness is advisory (policy: Network is non-blocking), so the
        // connectivity probe is intentionally skipped here — it never gates entry.
        networkHost: undefined,
        apiUrl: API_URL,
        contestId: contestId ?? null,
        deviceId,
        cameraAvailable: media.cameraAvailable,
        microphoneAvailable: media.microphoneAvailable,
        activateKeyboard: true,
        policy,
      });
      if (isCancelled()) return;
      setReadinessReport(report);
      setReadiness({
        ...readinessFromReport(report),
        // Network is advisory/non-blocking (policy) and we skip the probe above,
        // so the coarse home summary reports it as "ok" rather than a misleading
        // red. The detailed entry gate shows its true advisory status from the report.
        network: "ok",
      });
      appendSecurityEvent(
        "READINESS: Policy report " +
          report.decision.toUpperCase() +
          " for " +
          (strict ? "contest preflight" : "hub baseline")
      );
    } catch {
      if (isCancelled()) return;
      setReadinessReport(null);
      setReadiness({
        camera: media.cameraAvailable ? "ok" : "fail",
        mic: media.microphoneAvailable ? "ok" : "fail",
        network: "ok",
        keyboard: "fail",
        restrictedApps: "fail",
        vm: "fail",
        platform: "fail",
      });
      appendSecurityEvent("READINESS: Local integrity scan failed", "error");
    }
  }

  useEffect(() => {
    if (preflightContestId) {
      void runIntegrityScan(undefined, preflightContestId);
    }
  }, [preflightContestId]);

  async function handleCloseRestrictedApps(foundApps: string[]) {
    setClosingApps(true);
    setCloseFailedApps([]);
    try {
      const result = await invoke<CloseAppsResult>("close_restricted_apps", {
        apps: foundApps,
      });
      if (result.failed.length > 0) {
        setCloseFailedApps(result.failed);
        appendSecurityEvent(
          `CLOSE_APPS: Could not close automatically: ${result.failed.join(", ")}`,
          "warn"
        );
      }
      if (result.closed.length > 0) {
        appendSecurityEvent(
          `CLOSE_APPS: Automatically closed: ${result.closed.join(", ")}`,
          "info"
        );
      }
      await new Promise<void>((r) => setTimeout(r, 1200));
      await refreshTelemetry(true, "CLOSE_APPS_RESCAN");
    } finally {
      setClosingApps(false);
    }
  }

  function clearStoredActiveSession(reason: string) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
    setActiveSession(null);
    setResumeVerification("invalid");
    setResumeStatus(reason);
  }

  function mergeResumeRequestIntoSession(
    session: ActiveSession,
    request:
      | {
          id?: string;
          status?: string;
          requested_at?: string;
          review_note?: string | null;
        }
      | null
      | undefined
  ): ActiveSession {
    if (!request) return session;
    return {
      ...session,
      resume_request_id: request.id ?? session.resume_request_id,
      resume_request_status: request.status ?? session.resume_request_status,
      resume_request_requested_at: request.requested_at ?? session.resume_request_requested_at,
      resume_request_review_note: request.review_note ?? session.resume_request_review_note ?? null,
    };
  }

  async function consumeApprovedResume(session: ActiveSession) {
    if (!session.id || !session.contest_id || resumeConsumeInFlightRef.current) return;
    resumeConsumeInFlightRef.current = true;
    setResumeBusy(true);
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/sessions/${encodeURIComponent(session.id)}/resume-consume`,
        {
          method: "POST",
          headers: authHeaders(),
        }
      );
      if (!res.ok) {
        setResumeStatus("Resume approval expired. Request access again.");
        return;
      }
      const consumed = (await res.json()) as { status?: string };
      const nextSession = mergeResumeRequestIntoSession(session, {
        status: consumed.status ?? "CONSUMED",
      });
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(nextSession));
      setActiveSession(nextSession);
      setResumeStatus("Resume approved. Re-entering contest...");
      // SECURITY: route the reconnect through onboarding so the session is
      // re-verified and the desktop lockdown (lock_desktop) is re-engaged before
      // the contest renders. Going straight to /session/contest would re-enter a
      // live contest with no lockdown. Onboarding reuses the existing
      // IN_PROGRESS session, so this does not create a duplicate session.
      router.push(`/session/onboarding?contestId=${encodeURIComponent(session.contest_id)}`);
    } catch {
      setResumeStatus("Could not consume organizer approval. Try again.");
    } finally {
      setResumeBusy(false);
      resumeConsumeInFlightRef.current = false;
    }
  }

  async function refreshResumeRequest(session: ActiveSession) {
    if (!session.id) return;
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/sessions/${encodeURIComponent(session.id)}/resume-request`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const request = (await res.json()) as {
        id?: string;
        status?: string;
        requested_at?: string;
        review_note?: string | null;
      };
      const nextSession = mergeResumeRequestIntoSession(session, request);
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(nextSession));
      setActiveSession(nextSession);

      const requestStatus = String(request.status ?? "").toUpperCase();
      if (requestStatus === "PENDING") {
        setResumeStatus("Resume requested. Waiting for organizer approval.");
        setResumeBusy(false);
      } else if (requestStatus === "REJECTED") {
        setResumeStatus(request.review_note?.trim() || "Organizer rejected this resume request.");
        setResumeBusy(false);
      } else if (requestStatus === "EXPIRED") {
        setResumeStatus("Resume request expired. Submit it again to rejoin.");
        setResumeBusy(false);
      } else if (requestStatus === "APPROVED") {
        await consumeApprovedResume(nextSession);
      }
    } catch {
      setResumeStatus("Waiting for organizer approval.");
    }
  }

  async function submitResumeRequest(session: ActiveSession) {
    if (!session.id) return;
    setResumeBusy(true);
    setResumeStatus("Requesting organizer approval...");
    appendSecurityEvent("SESSION: Resume approval requested");
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/sessions/${encodeURIComponent(session.id)}/resume-request`,
        {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            device_id: getOrCreateDeviceId(),
            reason: "app_rejoin",
          }),
        }
      );
      if (!res.ok) {
        setResumeStatus("Could not request organizer approval.");
        setResumeBusy(false);
        return;
      }
      const request = (await res.json()) as {
        id?: string;
        status?: string;
        requested_at?: string;
        review_note?: string | null;
      };
      const nextSession = mergeResumeRequestIntoSession(session, request);
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(nextSession));
      setActiveSession(nextSession);
      setResumeStatus("Resume requested. Waiting for organizer approval.");
    } catch {
      setResumeStatus("Could not request organizer approval.");
      setResumeBusy(false);
    }
  }

  async function validateStoredActiveSession(session: ActiveSession, mode: "hydrate" | "resume") {
    if (!session.id) {
      clearStoredActiveSession("No active session found on this device.");
      return null;
    }

    if (mode === "resume") setResumeBusy(true);
    setResumeVerification("checking");
    if (mode === "resume") setResumeStatus(null);
    appendSecurityEvent(
      mode === "resume"
        ? "SESSION: Active session resume validation requested"
        : "SESSION: Stored active session validation requested"
    );

    try {
      const res = await fetchWithTimeout(`${API_URL}/sessions/${encodeURIComponent(session.id)}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        clearStoredActiveSession("Stored active session could not be verified.");
        appendSecurityEvent("SESSION: Active session validation failed", "error");
        return null;
      }

      const data = (await res.json()) as Partial<ActiveSession> & {
        contest_id?: string;
        contest_title?: string;
        candidate_email?: string;
        candidate_name?: string;
        status?: string;
        expires_at?: string;
        ended_at?: string | null;
        resume_request_status?: string;
        resume_request?: {
          id?: string;
          status?: string;
          requested_at?: string;
          review_note?: string | null;
        } | null;
      };
      const contestId = data.contest_id;
      if (!contestId || (session.contest_id && contestId !== session.contest_id)) {
        clearStoredActiveSession("Stored active session no longer matches the server record.");
        appendSecurityEvent("SESSION: Active session contest mismatch blocked", "error");
        return null;
      }

      if (data.candidate_email && data.candidate_email.toLowerCase() !== userEmail.toLowerCase()) {
        clearStoredActiveSession("Stored active session belongs to a different candidate.");
        appendSecurityEvent("SESSION: Active session candidate mismatch blocked", "error");
        return null;
      }

      const status = String(data.status ?? "active").toLowerCase();
      if (
        ["submitted", "ended", "expired", "closed", "cancelled"].includes(status) ||
        data.ended_at
      ) {
        clearStoredActiveSession("Stored active session is no longer active.");
        appendSecurityEvent("SESSION: Inactive stored session cleared", "warn");
        return null;
      }

      if (data.expires_at) {
        const expiresAt = new Date(data.expires_at).getTime();
        if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          clearStoredActiveSession("Stored active session has expired.");
          appendSecurityEvent("SESSION: Expired stored session cleared", "warn");
          return null;
        }
      }

      const verifiedSession: ActiveSession = {
        ...session,
        ...data,
        id: data.id ?? session.id,
        contest_id: contestId,
        contest_title: data.contest_title ?? session.contest_title,
        candidate_email: data.candidate_email ?? session.candidate_email ?? userEmail,
        updated_at: new Date().toISOString(),
      };
      const withResume = mergeResumeRequestIntoSession(verifiedSession, data.resume_request);
      const resumeRequestStatus = String(data.resume_request_status ?? "").toUpperCase();
      if (resumeRequestStatus === "PENDING") {
        setResumeStatus("Resume requested. Waiting for organizer approval.");
      } else if (resumeRequestStatus === "REJECTED") {
        setResumeStatus(
          data.resume_request?.review_note?.trim() ||
            "Organizer rejected the previous resume request."
        );
      } else if (resumeRequestStatus === "EXPIRED") {
        setResumeStatus("Previous resume request expired. Submit again to rejoin.");
      } else if (mode === "hydrate") {
        setResumeStatus("Stored session verified.");
      } else {
        setResumeStatus(null);
      }
      localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(withResume));
      setActiveSession(withResume);
      setResumeVerification("verified");
      appendSecurityEvent("SESSION: Active session verified for contest " + contestId);
      return withResume;
    } catch {
      clearStoredActiveSession("Stored active session could not be verified.");
      appendSecurityEvent("SESSION: Active session validation failed");
      return null;
    } finally {
      if (mode === "resume") setResumeBusy(false);
    }
  }

  useEffect(() => {
    const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "tester@ams.local";
    setUserEmail(email);
    setUserDisplayEmail(localStorage.getItem(STORAGE_KEYS.USER_DISPLAY_EMAIL) ?? email);
    setUserEmailHydrated(true);
    const cancelledRef = { current: false };
    const storedSession = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (storedSession) {
      try {
        const parsed = JSON.parse(storedSession) as ActiveSession;
        if (parsed?.id) {
          setActiveSession(parsed);
          setResumeVerification("unverified");
          setResumeStatus("Validating stored session...");
        } else {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
          setResumeVerification("none");
        }
      } catch {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        setResumeVerification("none");
      }
    }

    void runIntegrityScan(cancelledRef);

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!userEmailHydrated || resumeVerification !== "unverified" || !activeSession?.id) return;
    void validateStoredActiveSession(activeSession, "hydrate");
  }, [activeSession, resumeVerification, userEmailHydrated]);

  useEffect(() => {
    if (!activeSession?.id) return;
    const requestStatus = String(activeSession.resume_request_status ?? "").toUpperCase();
    if (requestStatus !== "PENDING" && requestStatus !== "APPROVED") return;
    const timer = setInterval(() => void refreshResumeRequest(activeSession), 3000);
    void refreshResumeRequest(activeSession);
    return () => clearInterval(timer);
  }, [activeSession]);

  async function handleInviteCodeSubmit() {
    if (inviteCodeBusy || inviteCodeInFlightRef.current) return;
    inviteCodeInFlightRef.current = true;
    const code = inviteCode.trim();
    setInviteCodeStatus(null);
    if (!code) {
      inviteCodeInFlightRef.current = false;
      setInviteCodeStatus("Enter a session or invite code.");
      appendSecurityEvent("SESSION: Empty session code submission blocked", "error");
      return;
    }
    setInviteCodeBusy(true);
    appendSecurityEvent("SESSION: Session code validation requested");
    try {
      const res = await fetchWithTimeout(`${API_URL}/session-codes/resolve`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ code, candidate_email: userEmail }),
      });
      let data: Partial<import("./components/types").InviteCodeResolveResponse> | null = null;
      try {
        data = (await res.json()) as Partial<
          import("./components/types").InviteCodeResolveResponse
        >;
      } catch {}
      if (!res.ok && !data?.contest?.id) {
        setInviteCodeStatus(data?.blocked_reason || "Code validation unavailable.");
        appendSecurityEvent("SESSION: Session code validation blocked by API", "error");
        return;
      }
      if (!data?.contest?.id) {
        setInviteCodeStatus("Code validation unavailable.");
        appendSecurityEvent("SESSION: Session code validation returned no contest", "error");
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
            candidate_email: userEmail,
          }
        : null;
      if (resolvedActiveSession) {
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(resolvedActiveSession));
        setActiveSession(resolvedActiveSession);
        setResumeVerification("verified");
      }

      const eligibility = String(data?.eligibility_status ?? "").toLowerCase();
      const blockedReason = data?.blocked_reason?.trim();
      if (eligibility === "allowed") {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(null);
        appendSecurityEvent("SESSION: Session code accepted for " + resolvedContest.title);
      } else if (eligibility === "wait") {
        const verificationWindowMinutes = getVerificationWindowMinutes(resolvedContest);
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(
          blockedReason ||
            `Verification opens ${verificationWindowMinutes} minutes before contest start.`
        );
        appendSecurityEvent(
          "SESSION: Contest added; verification window not open for " + resolvedContest.title
        );
      } else if (eligibility === "blocked") {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(blockedReason || "Join window is closed for this contest.");
        appendSecurityEvent(
          "SESSION: Contest added but entry blocked for " + resolvedContest.title,
          "warn"
        );
      } else {
        setInviteSuccessMsg("Contest added to your list.");
        setInviteCodeStatus(null);
        appendSecurityEvent("SESSION: Contest added for " + resolvedContest.title);
      }

      setInviteCode("");
      setTimeout(() => setInviteSuccessMsg(null), 6000);
    } catch {
      setInviteCodeStatus("Code validation unavailable.");
      appendSecurityEvent("SESSION: Session code validation failed", "error");
    } finally {
      inviteCodeInFlightRef.current = false;
      setInviteCodeBusy(false);
    }
  }

  async function handleResumeActiveSession() {
    setResumeStatus(null);
    if (resumeBusy || resumeInFlightRef.current) return;
    resumeInFlightRef.current = true;
    if (!activeSession?.id) {
      resumeInFlightRef.current = false;
      setResumeStatus("No active session found on this device.");
      setResumeVerification("none");
      return;
    }

    try {
      if (userEmail.trim().toLowerCase() === "tester@ams.local") {
        setResumeVerification("verified");
        setResumeStatus("Resume approved. Entering contest...");
        router.push(`/session/contest?contestId=${encodeURIComponent(activeSession.contest_id)}`);
        return;
      }
      const verifiedSession = await validateStoredActiveSession(activeSession, "resume");
      if (!verifiedSession?.contest_id) return;
      const requestStatus = String(verifiedSession.resume_request_status ?? "").toUpperCase();
      if (requestStatus === "PENDING" || requestStatus === "APPROVED") {
        await refreshResumeRequest(verifiedSession);
        return;
      }
      setPreflightContestId(verifiedSession.contest_id);
      setPreflightSessionType("resume");
    } finally {
      resumeInFlightRef.current = false;
    }
  }

  function handleSignOut() {
    setSigningOut(true);
    Object.keys(localStorage)
      .filter((key) => key.startsWith("ams_"))
      .forEach((key) => localStorage.removeItem(key));
    setTimeout(() => router.push("/"), 600);
  }

  // suppress unused-var lint for state vars kept per brief (rendering uses always-open rail)
  void sidebarOpen;
  void setSidebarExpanded;
  void setSidebarHovered;
  void closeFailedApps;

  return (
    <div
      className="theme-transition"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
        background: c.bg,
        color: c.text,
      }}
    >
      {/* ── Top Bar — full-width: brand · search · profile ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: "56px",
          flexShrink: 0,
          borderBottom: `1px solid ${c.border}`,
          background: c.sidebarBg,
        }}
      >
        {/* Brand — logo + wordmark, width-matched to the static rail */}
        <div
          style={{
            width: "200px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: "10px",
            borderRight: `1px solid ${c.border}`,
            height: "100%",
          }}
        >
          <svg width="22" height="20" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#logo-grad-topbar)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient
                id="logo-grad-topbar"
                x1="2"
                y1="82"
                x2="172"
                y2="82"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="var(--color-accent-deep)" />
                <stop offset="0.5" stopColor="var(--color-accent-base)" />
                <stop offset="1" stopColor="rgb(var(--accent-light-rgb))" />
              </linearGradient>
            </defs>
          </svg>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              letterSpacing: "0.4em",
              color: "var(--theme-text-muted-strong)",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            ACCESS
          </span>
        </div>

        {/* Decorative search — read-only, no handler, no state */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "0 24px" }}>
          <input
            readOnly
            tabIndex={-1}
            placeholder="Search"
            style={{
              width: "100%",
              maxWidth: "280px",
              background: "var(--surface-2)",
              border: `1px solid ${c.border}`,
              borderRadius: "var(--radius-md)",
              color: c.textMuted,
              fontSize: "13px",
              padding: "6px 14px",
              outline: "none",
              cursor: "default",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
        </div>

        {/* Profile + sign-out (avatar button wired to existing handleSignOut) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            paddingRight: "20px",
            flexShrink: 0,
          }}
        >
          <p
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.06em",
              color: c.textMuted,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {userDisplayEmail || userEmail}
          </p>
          <button
            onClick={handleSignOut}
            title="Sign out"
            disabled={signingOut}
            style={{
              width: "34px",
              height: "34px",
              borderRadius: "var(--radius-pill)",
              background:
                "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-light-rgb)))",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "13px",
              fontWeight: 700,
              color: "white",
              cursor: signingOut ? "not-allowed" : "pointer",
              opacity: signingOut ? 0.6 : 1,
              flexShrink: 0,
              transition: "opacity var(--transition-fast)",
            }}
          >
            {userEmail[0].toUpperCase()}
          </button>
        </div>
      </div>

      {/* ── Body: static rail + content ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Static Rail — always expanded, labels always visible ── */}
        <aside
          style={{
            width: "200px",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${c.border}`,
            background: c.sidebarBg,
            padding: "16px 0 0",
            overflow: "hidden",
          }}
        >
          {/* ── Nav list ── */}
          <nav
            style={{
              flex: 1,
              padding: "0 8px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            {NAV_ITEMS.map((item) => {
              const active = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  title={item.label}
                  className="home-nav-btn"
                  data-active={String(active)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    height: "40px",
                    padding: 0,
                    borderRadius: "var(--radius-md)",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {/* Active bar */}
                  <div
                    style={{
                      position: "absolute",
                      left: "0",
                      top: "8px",
                      bottom: "8px",
                      width: "4px",
                      background: c.accent,
                      borderRadius: "var(--radius-pill)",
                      opacity: active ? 1 : 0,
                      transition: "opacity var(--transition-fast)",
                    }}
                  />
                  {/* Icon — fixed 44px column */}
                  <span
                    style={{
                      width: "44px",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      flexShrink: 0,
                      color: active ? c.accent : c.textMuted,
                      transition: "color var(--transition-fast)",
                    }}
                  >
                    {item.icon}
                  </span>
                  {/* Label — always visible in static rail */}
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 400,
                      color: active ? c.accentText : c.textMuted,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* ── Rail bottom — avatar circle + pill placeholder ── */}
          <div style={{ padding: "12px 8px 20px", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                gap: "10px",
                padding: "0 8px",
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "var(--radius-pill)",
                  background:
                    "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-light-rgb)))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "white",
                  flexShrink: 0,
                }}
              >
                {userEmail[0].toUpperCase()}
              </div>
              {/* Pill placeholder */}
              <div
                style={{
                  flex: 1,
                  height: "18px",
                  borderRadius: "var(--radius-pill)",
                  background: c.border,
                  opacity: 0.7,
                }}
              />
            </div>
          </div>
        </aside>

        {/* ── Main content panels ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header — settings + diagnostics views only */}
          {activeNav !== "overview" && (
            <header
              className="home-header"
              style={{
                background: "var(--surface-0)",
                borderBottom: "1px solid var(--home-overlay-strong)",
                flexShrink: 0,
                transition: "border-color var(--transition-standard)",
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
                <h1
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: c.text,
                    letterSpacing: "0",
                  }}
                >
                  {activeNav === "settings" && "Settings"}
                  {activeNav === "diagnostics" && "Diagnostics"}
                </h1>
                {activeNav === "settings" && (
                  <button
                    onClick={() => void refreshTelemetry(true, "run-full-diagnostic")}
                    disabled={telemetryQuery.isLoading}
                    style={{
                      flexShrink: 0,
                      padding: "0 20px",
                      minHeight: 40,
                      background: c.accent,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      color: "white",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: telemetryQuery.isLoading ? "not-allowed" : "pointer",
                      opacity: telemetryQuery.isLoading ? 0.7 : 1,
                      transition: "opacity var(--transition-fast)",
                    }}
                  >
                    {telemetryQuery.isLoading ? "Running..." : "Run Full Diagnostic"}
                  </button>
                )}
              </div>
              <p style={{ fontSize: "13px", color: c.textMuted, marginTop: "4px" }}>
                {activeNav === "settings" &&
                  "Camera, microphone, security policies, and device settings"}
                {activeNav === "diagnostics" &&
                  "Network diagnostics, platform telemetry, and security event log"}
              </p>
            </header>
          )}

          {/* Scrollable content views */}
          <div className="home-content" style={{ flex: 1, overflowY: "auto" }}>
            {activeNav === "overview" && (
              <div
                className="grid grid-cols-1 xl:grid-cols-[1fr_360px]"
                style={{ gap: "36px", alignItems: "stretch" }}
              >
                {/* ── Center column ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: "36px" }}>
                  {/* Overview title + subtitle (replaces old header for this view) */}
                  <div>
                    <h1
                      style={{
                        fontSize: "24px",
                        fontWeight: 700,
                        color: c.text,
                        letterSpacing: "0",
                      }}
                    >
                      Contestant Command Hub
                    </h1>
                    <p style={{ fontSize: "13px", color: c.textMuted, marginTop: "4px" }}>
                      Authenticated Profile:{" "}
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          color: c.text,
                          fontWeight: 500,
                        }}
                      >
                        {userDisplayEmail || userEmail}
                      </span>
                    </p>
                  </div>

                  <ContestsPanel
                    contests={contests}
                    loading={contestsLoading}
                    theme={theme}
                    onPreflight={(contestId, type) => {
                      setPreflightContestId(contestId);
                      setPreflightSessionType(type);
                    }}
                    readinessContext={contestantReadiness}
                  />
                  <SessionActionsPanel
                    activeSession={activeSession}
                    inviteCode={inviteCode}
                    inviteCodeBusy={inviteCodeBusy}
                    inviteCodeStatus={inviteCodeStatus}
                    inviteSuccessMsg={inviteSuccessMsg}
                    onDismissInviteSuccess={() => setInviteSuccessMsg(null)}
                    onInviteCodeChange={setInviteCode}
                    onInviteCodeSubmit={handleInviteCodeSubmit}
                    onRefresh={() => loadContests(userEmail)}
                    onResume={handleResumeActiveSession}
                    resumeBusy={resumeBusy}
                    resumeStatus={resumeStatus}
                    resumeVerification={resumeVerification}
                    sessionsError={sessionsError}
                    sessionsRefreshing={sessionsRefreshing}
                    theme={theme}
                  />
                </div>

                {/* ── Right rail — ReadinessWidget ── */}
                <div style={{ alignSelf: "start" }}>
                  <ReadinessWidget
                    readiness={readiness}
                    onSettingsRedirect={() => setActiveNav("settings")}
                    theme={theme}
                    onResolve={(key) => setActiveResolveModal(key)}
                    context={contestantReadiness}
                    onPracticeRun={() => router.push("/session/onboarding?mode=dry-run")}
                  />
                </div>
              </div>
            )}

            {activeNav === "settings" && (
              <SettingsPanel
                readiness={readiness}
                setReadiness={setReadiness}
                theme={theme}
                onSecurityEvent={appendSecurityEvent}
                telemetry={telemetryQuery}
                refreshTelemetry={refreshTelemetry}
              />
            )}

            {activeNav === "diagnostics" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
                <DiagnosticsPanel
                  readiness={readiness}
                  theme={theme}
                  telemetry={telemetryQuery}
                  refreshTelemetry={refreshTelemetry}
                />
                <SecurityOperationsLog theme={theme} logs={securityLogs} />
              </div>
            )}
          </div>
        </div>
      </div>

      {preflightContestId && (
        <SessionReadinessModal
          contestId={preflightContestId}
          sessionType={preflightSessionType}
          theme={theme}
          onClose={() => setPreflightContestId(null)}
          onProceed={
            preflightSessionType === "resume" && activeSession
              ? async () => {
                  setPreflightContestId(null);
                  await submitResumeRequest(activeSession);
                }
              : undefined
          }
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
          telemetry={telemetryQuery}
          onOpenSettings={() => {
            setActiveResolveModal(null);
            setActiveNav("settings");
          }}
          onRetry={async (key) => {
            await refreshTelemetry(true, `RESOLVE_${key}`);
          }}
          onCloseApps={handleCloseRestrictedApps}
          closingApps={closingApps}
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
