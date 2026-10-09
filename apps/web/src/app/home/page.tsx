"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  applyOrganizerOverrides,
  fetchOrganizerOverrides,
  invoke,
  runSessionReadiness,
  sessionPolicy,
} from "@ams/api-client";
import { useApiQuery } from "@/lib/api-client";
import { useTheme } from "@/lib/theme";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import {
  type ContestSummary,
  consumeResume,
  getSession,
  latestResumeRequest,
  listContests,
  requestResume,
  restoreToken,
} from "@/lib/proctor-api";

// ── Types ──────────────────────────────────────────────────────
import type {
  InvitedContest,
  ReadinessState,
  SecurityLogEntry,
  SecurityLogLevel,
  TelemetryQueryState,
  FullTelemetry,
  SecurityScanSnapshot,
  TelemetrySnapshot,
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
  getOrCreateDeviceId,
  getBrowserMediaAvailability,
  fetchWithTimeout,
  getNetworkProbeHost,
  readinessFromReport,
  getVerificationWindowMinutes,
} from "./components/utils";
import { hasNativeBridge, nativeCheckFallback } from "./components/readiness-status";
import { withTelemetryTimeout } from "./components/telemetry-timeout";

// ── Components ─────────────────────────────────────────────────
import { DashboardShell, DashboardColumns } from "./components/DashboardShell";
import { VStack } from "@astryxdesign/core/Stack";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { useHomeContestNavigation } from "./components/use-home-contest-navigation";
import { ContestCalendar } from "./components/ContestCalendar";
import { ContestsPanel } from "./components/ContestsPanel";
import { SessionActionsPanel } from "./components/SessionActionsPanel";
import { ReadinessWidget } from "./components/ReadinessPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { SecurityOperationsLog } from "./components/SecurityOperationsLog";
import { SessionReadinessModal } from "./components/SessionReadinessModal";
import { ResolveModal } from "./components/ResolveModal";
import { mergeResumeRequestIntoSession, startResumePolling } from "./components/resume-polling";
import { dateTimeFormatter } from "@/lib/date-time-format";
import { deriveContestantReadiness } from "./components/readiness-context";

/** The participant API's contest shape, in the one the home UI already reads.
 *
 * An adapter rather than a rewrite: `ContestCards` and its siblings are
 * ~7,000 lines of working UI whose only problem was where the data came
 * from. Changing that in one function is a much smaller thing to get wrong. */
function toInvitedContest(contest: ContestSummary): InvitedContest {
  return {
    id: contest.uid,
    title: contest.title,
    description: contest.description || null,
    start_at: contest.starts_at,
    end_at: contest.ends_at,
    status: contest.status,
    org_name: contest.organization_name,
    question_count: contest.problems.length,
    verification_window_minutes: contest.verification_window_minutes,
    // Dropped here until now, so the practice card and the graded card were
    // indistinguishable — a candidate had no way to tell which one counted.
    is_practice: contest.is_practice,
  };
}

export default function HomePage() {
  const router = useRouter();
  const { theme } = useTheme(); // canonical single source
  const [activeNav, setActiveNav] = useState<"overview" | "settings" | "diagnostics">("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [contestSearch, setContestSearch] = useState("");
  const [homeHelpOpen, setHomeHelpOpen] = useState(false);
  const { highlightedContestId, showContest } = useHomeContestNavigation(
    setContestSearch,
    activeNav === "overview"
  );
  const [contests, setContests] = useState<InvitedContest[]>([]);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);
  const [activeSession, setActiveSessionState] = useState<ActiveSession | null>(null);
  const activeSessionRef = useRef<ActiveSession | null>(null);
  const setActiveSession = useCallback((session: ActiveSession | null) => {
    activeSessionRef.current = session;
    setActiveSessionState(session);
  }, []);
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeVerification, setResumeVerification] = useState<ResumeVerificationState>("none");
  // Who is signed in, for display. There is no email: candidates sign in with
  // a printed slip and the platform has no address for them.
  const [displayName, setDisplayName] = useState("");
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [preflightContestId, setPreflightContestId] = useState<string | null>(null);
  const [preflightSessionType, setPreflightSessionType] = useState<"new" | "resume">("new");
  const [activeResolveModal, setActiveResolveModal] = useState<string | null>(null);
  const [closingApps, setClosingApps] = useState(false);
  const [closeFailedApps, setCloseFailedApps] = useState<string[]>([]);
  const resumeInFlightRef = useRef(false);
  const resumeConsumeInFlightRef = useRef(false);
  const resumePollInFlightRef = useRef(false);
  const scanGenerationRef = useRef(0);
  const [readiness, setReadiness] = useState<ReadinessState>({
    camera: "checking",
    mic: "checking",
    network: "checking",
    networkLockdown: "checking",
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
  const telemetryInFlightRef = useRef<Promise<TelemetrySnapshot | null> | null>(null);
  const lastScannedAtRef = useRef<number | null>(null);

  const appendSecurityEvent = useCallback((event: string, level: SecurityLogLevel = "info") => {
    const time = dateTimeFormatter({
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).format(new Date());
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
      if (!hasNativeBridge()) {
        setTelemetryQuery((prev) => ({
          ...prev,
          isLoading: false,
          error: "Native device checks are unavailable in this browser. Use the desktop app.",
        }));
        return;
      }

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

      const request = withTelemetryTimeout(
        invoke<FullTelemetry>("get_full_telemetry", {
          networkHost: API_URL,
          apiUrl: API_URL,
        })
      ).then((telemetry) => {
        if (!telemetry) return null;
        return {
          platform: telemetry.platform ?? null,
          env: telemetry.env ?? null,
          processes: telemetry.processes ?? null,
          virt: telemetry.virt ?? null,
          network: telemetry.network ?? null,
          // Carried separately from `error`: the scan as a whole succeeded,
          // and these name the individual probes that did not.
          scanErrors: telemetry.scan_errors ?? [],
        } satisfies TelemetrySnapshot;
      });

      // The owning scan reports failures below. Joined callers must not reject
      // independently when a Settings effect or another panel requests the scan.
      telemetryInFlightRef.current = request.catch(() => null);
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
          network: snapshot.network ? (snapshot.network.reachable ? "ok" : "warn") : "unavailable",
        }));
        appendSecurityEvent(
          source +
            ": Native scan completed; restricted_apps=" +
            (snapshot.processes ? (snapshot.processes.clean ? "clear" : "flagged") : "unknown") +
            ", network=" +
            (snapshot.network ? snapshot.network.quality : "unchecked")
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setTelemetryQuery((prev) => ({
          ...prev,
          isLoading: false,
          error: detail || "Native telemetry unavailable",
        }));
        appendSecurityEvent(source + ": Native telemetry scan failed: " + detail, "error");
      } finally {
        telemetryInFlightRef.current = null;
      }
    },
    [appendSecurityEvent]
  );

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

  const contestsQueryKey = identityHydrated ? "contests:invited" : null;
  const invitedContestsQuery = useApiQuery<InvitedContest[]>(
    contestsQueryKey,
    async () => {
      // Whose contests these are comes from the participant token, not from a
      // `?email=` parameter — the old endpoint took the identity as a query
      // string, which made it both spoofable and dependent on an address the
      // platform does not have for a slip-authenticated candidate.
      const contests = await listContests();
      return contests.map(toInvitedContest);
    },
    { enabled: identityHydrated, staleMs: 30_000, retries: 0 }
  );

  useEffect(() => {
    if (invitedContestsQuery.data) {
      setContests(invitedContestsQuery.data);
      setContestsLoading(false);
    } else if (invitedContestsQuery.error) {
      setContestsLoading(false);
    }
  }, [invitedContestsQuery.data, invitedContestsQuery.error]);

  const loadContests = useCallback(
    async (mode: "initial" | "refresh" = "refresh") => {
      if (mode === "initial") setContestsLoading(true);
      else setSessionsRefreshing(true);
      appendSecurityEvent("SESSION: Contest list refresh requested");
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
    },
    [invitedContestsQuery.mutate, appendSecurityEvent]
  );
  const refreshContests = useCallback(() => {
    void loadContests();
  }, [loadContests]);
  const openPreflight = useCallback((contestId: string, type: "new" | "resume") => {
    setPreflightContestId(contestId);
    setPreflightSessionType(type);
  }, []);

  async function runIntegrityScan(cancelledRef?: { current: boolean }, contestId?: string | null) {
    const generation = ++scanGenerationRef.current;
    const isCancelled = () =>
      Boolean(cancelledRef?.current) || generation !== scanGenerationRef.current;

    if (!isCancelled()) {
      setReadinessReport(null);
      setReadiness({
        camera: "checking",
        mic: "checking",
        network: "checking",
        networkLockdown: "checking",
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
        ? await fetchOrganizerOverrides(API_URL, contestId, deviceId, participantToken() ?? "")
        : [];
      if (isCancelled()) return;
      // Pass the OS so platform-conditioned policy applies — without it the gate
      // used the platform-less defaults and hard-blocked macOS keyboard lockdown
      // (which is meant to be advisory on macOS). Also lets the Windows-only
      // display/RDP checks enforce here, matching the onboarding gate.
      // `label`, not `os`. `os` is the bare "windows", which cannot say
      // whether this build was meant to raise a firewall — so the policy left
      // the platform check required+blocking and every ordinary unelevated
      // contestant saw a red "Platform compatibility" in Required checks.
      // Falls back to `os` for an older shell that has no `label`.
      const devicePlatform = await invoke<{ label?: string; os?: string }>("get_platform")
        .then((p) => p?.label ?? p?.os)
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
        // Run it. Skipping the probe did not make network readiness advisory —
        // the policy already does that — it only meant the check had no result,
        // which the report then recorded as a failure and the log printed as
        // "FAIL - readiness probe did not return a result". Advisory means it
        // must not *block*, not that it must not be *measured*.
        networkHost: getNetworkProbeHost(),
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
      // No network override any more. It was there because the probe above was
      // skipped, so the honest value would have been a red that meant nothing;
      // now the probe runs, the real result is the right thing to show, and
      // "advisory" is expressed by the status being `warn` rather than `fail`.
      setReadiness({
        ...readinessFromReport(report),
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
      // Camera and microphone come from the browser, so they are real results
      // either way. The rest are native probes: in a browser they do not exist
      // rather than fail, and saying "fix 4 required checks" about probes that
      // cannot run there is advice nobody can act on.
      const native = nativeCheckFallback(hasNativeBridge());
      setReadiness({
        camera: media.cameraAvailable ? "ok" : "fail",
        mic: media.microphoneAvailable ? "ok" : "fail",
        // The scan threw, so nothing was measured. "ok" was a guess that
        // happened to be green; `unavailable` says we do not know, which is
        // the only true thing available here.
        network: "unavailable",
        networkLockdown: "unavailable",
        keyboard: native,
        restrictedApps: native,
        vm: native,
        platform: native,
      });
      appendSecurityEvent("READINESS: Local integrity scan failed", "error");
    }
  }

  useEffect(() => {
    if (!identityHydrated) return;
    const cancelled = { current: false };
    // Closing preflight starts a fresh baseline; cancelling its strict scan
    // alone would otherwise leave Home's shared summary stuck on checking.
    void runIntegrityScan(cancelled, preflightContestId);
    return () => {
      cancelled.current = true;
      // Also invalidate a manual rescan when this preflight closes or changes.
      scanGenerationRef.current += 1;
    };
  }, [preflightContestId, identityHydrated]);

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

  async function consumeApprovedResume(session: ActiveSession) {
    if (!session.id || !session.contest_id || resumeConsumeInFlightRef.current) return;
    resumeConsumeInFlightRef.current = true;
    setResumeBusy(true);
    try {
      // 409 here means the grant was spent, rejected or has lapsed — the
      // server decides, and it is the only thing that can.
      await consumeResume(session.id);
      const nextSession = mergeResumeRequestIntoSession(session, { status: "CONSUMED" });
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

  async function refreshResumeRequest(session: ActiveSession, isCancelled = () => false) {
    if (!session.id || resumePollInFlightRef.current || resumeConsumeInFlightRef.current) return;
    resumePollInFlightRef.current = true;
    const isStale = () =>
      isCancelled() ||
      activeSessionRef.current?.id !== session.id ||
      activeSessionRef.current?.resume_request_id !== session.resume_request_id ||
      activeSessionRef.current?.resume_request_status !== session.resume_request_status;
    try {
      const latest = await latestResumeRequest(session.id);
      if (!latest || isStale()) return;
      const request = {
        id: latest.uid,
        status: latest.status,
        requested_at: latest.created_at,
        review_note: latest.review_note,
      };
      const currentSession = activeSessionRef.current!;
      const nextSession = mergeResumeRequestIntoSession(currentSession, request);
      if (nextSession !== currentSession) {
        localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(nextSession));
        setActiveSession(nextSession);
      }

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
      if (!isStale()) setResumeStatus("Waiting for organizer approval.");
    } finally {
      resumePollInFlightRef.current = false;
    }
  }
  const refreshResumeRequestRef = useRef(refreshResumeRequest);
  refreshResumeRequestRef.current = refreshResumeRequest;

  async function submitResumeRequest(session: ActiveSession) {
    if (!session.id) return;
    setResumeBusy(true);
    setResumeStatus("Requesting organizer approval...");
    appendSecurityEvent("SESSION: Resume approval requested");
    try {
      const created = await requestResume(session.id, {
        deviceFingerprint: getOrCreateDeviceId(),
        reason: "The app was closed or crashed and is rejoining.",
      });
      const request = {
        id: created.uid,
        status: created.status,
        requested_at: created.created_at,
        review_note: created.review_note,
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
      let live;
      try {
        live = await getSession(session.id);
      } catch {
        // A 404 is the normal answer for someone else's session as well as a
        // deleted one — the API deliberately does not distinguish them.
        clearStoredActiveSession("Stored active session could not be verified.");
        appendSecurityEvent("SESSION: Active session validation failed", "error");
        return null;
      }

      // The stored resume request, if any, is fetched separately now: the
      // session response is about the session, and folding a review decision
      // into it made two different lifecycles share one payload.
      const pending = await latestResumeRequest(session.id).catch(() => null);
      const data: Partial<ActiveSession> & {
        contest_id?: string;
        status?: string;
        ended_at?: string | null;
        resume_request_status?: string;
        resume_request?: {
          id?: string;
          status?: string;
          requested_at?: string;
          review_note?: string | null;
        } | null;
      } = {
        id: live.uid,
        contest_id: live.contest_uid,
        status: live.status,
        ended_at: live.ended_at,
        resume_request_status: pending?.status,
        resume_request: pending
          ? {
              id: pending.uid,
              status: pending.status,
              requested_at: pending.created_at,
              review_note: pending.review_note,
            }
          : null,
      };
      const contestId = data.contest_id;
      if (!contestId || (session.contest_id && contestId !== session.contest_id)) {
        clearStoredActiveSession("Stored active session no longer matches the server record.");
        appendSecurityEvent("SESSION: Active session contest mismatch blocked", "error");
        return null;
      }

      // No candidate-identity comparison here any more. The session is
      // fetched with this participant's own token and the API answers 404 for
      // anyone else's, so ownership is enforced where it cannot be bypassed
      // rather than by the client checking a field the client was sent.

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
    // The token outlives the page: restoring it here is what lets a candidate
    // whose app restarted mid-exam carry on instead of signing in again.
    restoreToken();
    setDisplayName(localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) ?? "");
    setIdentityHydrated(true);
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

    return () => {
      scanGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!identityHydrated || resumeVerification !== "unverified" || !activeSession?.id) return;
    void validateStoredActiveSession(activeSession, "hydrate");
  }, [activeSession, resumeVerification, identityHydrated]);

  useEffect(() => {
    if (!activeSession?.id) return;
    const requestStatus = String(activeSession.resume_request_status ?? "").toUpperCase();
    if (requestStatus !== "PENDING" && requestStatus !== "APPROVED") return;
    return startResumePolling((isCancelled) => {
      const current = activeSessionRef.current;
      if (current) return refreshResumeRequestRef.current(current, isCancelled);
    });
  }, [activeSession?.id, activeSession?.resume_request_id, activeSession?.resume_request_status]);

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

  void closeFailedApps;

  // Match the existing resume guards; keep position stable while the action runs.
  const prioritizeRecovery = Boolean(
    activeSession &&
    resumeVerification === "verified" &&
    String(activeSession.resume_request_status ?? "").toUpperCase() !== "PENDING"
  );
  const contestsPanel = (
    <ContestsPanel
      key="contests"
      onRefresh={refreshContests}
      refreshing={sessionsRefreshing}
      highlightedContestId={highlightedContestId}
      contests={contests}
      loading={contestsLoading}
      theme={theme}
      searchQuery={contestSearch}
      onSearchChange={setContestSearch}
      error={sessionsError ?? (invitedContestsQuery.error ? "Could not load your contests." : null)}
      onPreflight={openPreflight}
      readinessContext={contestantReadiness}
    />
  );
  const recoveryPanel = (
    <SessionActionsPanel
      key="recovery"
      activeSession={activeSession}
      onResume={handleResumeActiveSession}
      resumeBusy={resumeBusy}
      resumeStatus={resumeStatus}
      resumeVerification={resumeVerification}
      sessionsError={sessionsError}
      theme={theme}
    />
  );

  return (
    <>
      <DashboardShell
        activeNav={activeNav}
        onNavigate={setActiveNav}
        displayName={displayName}
        onSignOut={handleSignOut}
        signingOut={signingOut}
        calendar={
          activeNav === "overview" ? (
            <ContestCalendar
              contests={contests}
              loading={contestsLoading}
              onSelectContest={showContest}
              error={invitedContestsQuery.error ? "Could not load your contests." : null}
            />
          ) : undefined
        }
        headerAction={
          activeNav === "overview" ? (
            <AstryxButton label="Get help" variant="ghost" onClick={() => setHomeHelpOpen(true)} />
          ) : activeNav === "settings" ? (
            <AstryxButton
              label={telemetryQuery.isLoading ? "Running..." : "Run Full Diagnostic"}
              isDisabled={telemetryQuery.isLoading}
              onClick={() => void refreshTelemetry(true, "run-full-diagnostic")}
            />
          ) : undefined
        }
      >
        {activeNav === "overview" && (
          <DashboardColumns
            readiness={
              <ReadinessWidget
                readiness={readiness}
                onSettingsRedirect={() => setActiveNav("settings")}
                theme={theme}
                onResolve={(key) => setActiveResolveModal(key)}
                context={contestantReadiness}
                onPracticeRun={() => router.push("/session/onboarding?mode=dry-run")}
              />
            }
          >
            {prioritizeRecovery ? [recoveryPanel, contestsPanel] : [contestsPanel, recoveryPanel]}
          </DashboardColumns>
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
          <VStack gap={6}>
            <DiagnosticsPanel
              onOpenSettings={() => setActiveNav("settings")}
              readiness={readiness}
              telemetry={telemetryQuery}
              refreshTelemetry={refreshTelemetry}
            />
            <SecurityOperationsLog logs={securityLogs} />
          </VStack>
        )}
      </DashboardShell>

      <HelpRequestModal
        open={homeHelpOpen}
        onClose={() => setHomeHelpOpen(false)}
        kind="OTHER"
        summary="I need help with my assigned contests or home page."
        details={{ source: "home_dashboard" }}
      />

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
    </>
  );
}
