"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@ams/api-client";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { fetchJson, postJsonKeepalive, SessionBindingError } from "@/lib/api-client";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { isGatingRelaxed } from "@/lib/gating";
import {
  loadPresenceDetector,
  samplePresence,
  type PresenceDetector,
} from "@/lib/presence-monitor";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import {
  CONTEST_EDITOR_THEMES,
  registerAllowedClipboard,
  type ContestEditorThemeId,
} from "./editor-pane";
import {
  isPendingSubmissionStatus,
  isUiBlockingPending,
  normalizeAttemptForRunResult,
  normalizeSubmissionVerdict,
  shouldAutoExpandAttempt,
  type RunAttempt,
  type RunVerdict,
  type SubmissionAttemptRecord,
} from "./submission-state";
import { computeAutosaveDelayMs } from "./autosave-timing";
import {
  parseDescription,
  splitProblemDescription,
  getAvailableProblemTabs,
  enhanceSampleBlocks,
  type ProblemSectionKey,
} from "./components/markdown";
import { VERDICT_COLORS, VERDICT_BG, VERDICT_BORDER } from "./components/verdict-styles";
import {
  LANGUAGE_ID_MAP,
  toLanguageId,
  normalizeLanguageLabel,
  defaultCppStarter,
  defaultStarterFor,
  isPristineStarter,
  questionFileName,
} from "./components/language";
import { type Question, type ContestMeta } from "./components/questions";
import { useFocusTrap } from "./components/hooks";
import { BootScreen, ContestLoadErrorScreen } from "./components/GateScreens";
import { LockGraceToast, BlockedAppsOverlay } from "./components/BlockedOverlay";
import { KioskBanner } from "./components/KioskBanner";
import { FooterTrustStrip } from "./components/FooterTrustStrip";
import { TopBar } from "./components/TopBar";
import { QuestionRail } from "./components/QuestionRail";
import { ProblemPane } from "./components/ProblemPane";
import { EditorPanel, type EditorFile } from "./components/EditorPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { CameraTile } from "./components/CameraTile";
import { deriveSaveIndicator, footerSaveView } from "./save-indicator";
import { deriveSubmitButton } from "./submit-button";
import { saveErrorAfterEdit } from "./save-edit-state";
import { createSaveCoordinator } from "./save-coordinator";
import { loadContestPaper } from "./load-contest-problems";
import { toAttemptRecords } from "./attempt-adapter";
import { flush as flushViolationQueue } from "@/lib/violation-queue";
import {
  activeContent,
  chooseRestore,
  clear as clearAnswerBuffer,
  read as readAnswerBuffer,
  write as writeAnswerBuffer,
} from "./answer-buffer";
import { isBell, paperIsOpen, type ClockPhase, type ClockSnapshot } from "./session-clock";
import {
  connectionLevel,
  initialHeartbeatState,
  onFailure as onHeartbeatFailure,
  onSuccess as onHeartbeatSuccess,
  shouldLockEditor,
} from "@/lib/heartbeat-policy";
import {
  ProctorApiError,
  getDrafts,
  getRun,
  getSession,
  heartbeat,
  listMySubmissions,
  putDraft,
  run as runAgainstSamples,
  serverNow,
  submit as submitSolution,
} from "@/lib/proctor-api";
import { Info, ShieldCheck, Shield, Wifi, WifiOff, Save } from "lucide-react";

const API_URL = resolveApiBase();
const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;
const EDITOR_THEME_KEY = "ams_contest_editor_theme";
const PROBLEM_SPLIT_WIDTH_KEY = "ams_contest_problem_split_width";
const DEFAULT_EDITOR_THEME: ContestEditorThemeId = "ams-terminal";

// Autosave delay policy lives in ./autosave-timing (computeAutosaveDelayMs).
// MAX_SAVE_RETRIES stays here — it caps handleSave's retry counter.
const MAX_SAVE_RETRIES = 5;
// Cap the interactive save/submit request so "Saving…" can't hang unbounded.
// 10s > warm latency (esp. once api min-instances=1 removes the ~15s cold start)
// and < "hung". On timeout the fetch aborts into handleSave's catch → saveError.
const SAVE_TIMEOUT_MS = 10_000;

function isContestEditorTheme(value: string | null): value is ContestEditorThemeId {
  return Boolean(value && CONTEST_EDITOR_THEMES.some((theme) => theme.id === value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type StoredSession = { id: string; contest_id: string };

/** The session onboarding created, if this device has one.
 *
 * Tolerant of junk: a half-written or hand-edited entry is treated as absent,
 * which routes the candidate back through onboarding rather than throwing
 * inside the bootstrap.
 */
function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed?.id || !parsed?.contest_id) return null;
    return { id: parsed.id, contest_id: parsed.contest_id };
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __TAURI__?: {
      core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
      window: {
        getCurrentWindow: () => {
          setFullscreen: (v: boolean) => Promise<void>;
          setAlwaysOnTop: (v: boolean) => Promise<void>;
          setDecorations: (v: boolean) => Promise<void>;
          setResizable: (v: boolean) => Promise<void>;
          availableMonitors: () => Promise<
            Array<{
              name: string | null;
              position: { x: number; y: number };
              size: { width: number; height: number };
              scaleFactor: number;
            }>
          >;
        };
      };
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function isVideoRendering(video: HTMLVideoElement): boolean {
  return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 3000): Promise<boolean> {
  if (isVideoRendering(video)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      resolve(ok);
    };
    const onReady = () => done(isVideoRendering(video));
    const timer = setTimeout(() => done(isVideoRendering(video)), timeoutMs);

    video.addEventListener("loadeddata", onReady, { once: true });
    video.addEventListener("canplay", onReady, { once: true });
    video.addEventListener("playing", onReady, { once: true });
  });
}

async function attachVideoStream(video: HTMLVideoElement, stream: MediaStream): Promise<boolean> {
  video.muted = true;
  video.playsInline = true;
  if (video.srcObject !== stream) video.srcObject = stream;

  try {
    await video.play();
  } catch {
    // WebKit can reject play before metadata is ready; wait for a real frame below.
  }

  const ready = await waitForVideoFrame(video);
  if (!ready) return false;

  try {
    await video.play();
  } catch {}
  return isVideoRendering(video);
}

export default function ContestPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";
  const isDryRun = (searchParams?.get("mode") ?? "") === "dry-run";

  // SECURITY (defense-in-depth chokepoint): a real (non-dry-run) proctored
  // session may only render the contest if the desktop lockdown is engaged.
  // The ONLY legitimate way in is onboarding → lock_desktop → navigate here, so
  // a lock-engaged check passing means the candidate came through onboarding.
  // States: "checking" (probe in flight — render a neutral securing screen),
  // "ok" (lockdown engaged, dry-run, or no Tauri bridge i.e. dev/browser), or
  // "redirecting" (reached the contest unlocked — bounce back to onboarding).
  const [lockGate, setLockGate] = useState<"checking" | "ok" | "redirecting">(
    isDryRun ? "ok" : "checking"
  );

  const [contest, setContest] = useState<ContestMeta | null>(null);
  // The server's own view of where we are in the contest window. Outranks any
  // deadline arithmetic done here — see `isBell`.
  const [contestPhase, setContestPhase] = useState<ClockPhase>("running");
  // True once the contest is over. The editor goes read-only and Run/Submit
  // stop; nothing is auto-submitted.
  const [bellRung, setBellRung] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQ, setActiveQ] = useState(0);
  const [questionFiles, setQuestionFiles] = useState<Record<string, EditorFile[]>>({});
  const [questionActiveFile, setQuestionActiveFile] = useState<Record<string, string>>({});
  const [editorTheme, setEditorTheme] = useState<ContestEditorThemeId>(DEFAULT_EDITOR_THEME);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("C++17");
  const [problemPaneWidth, setProblemPaneWidth] = useState(35);
  const [problemTab, setProblemTab] = useState<ProblemSectionKey>("statement");
  const [copiedSampleKey, setCopiedSampleKey] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunAttempt | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // Set when the judge hasn't returned a verdict within the polling window — the
  // submission is still queued (distinct from a hard connection error).
  const [runTimedOut, setRunTimedOut] = useState(false);
  // Attempt id of the most recent "Run on Judge" (sample-only) run. Used to pull
  // its per-test results out of `testResults` and render them LeetCode-style in
  // the Output panel. RUN attempts are hidden from the Attempts history, so this
  // is the only place their results surface.
  const [runResultAttemptId, setRunResultAttemptId] = useState<string | null>(null);
  // Kept synced via effect below so fetchSubmissions (a useCallback NOT keyed on
  // runResultAttemptId) can read the LIVE value instead of a stale closure.
  const runResultAttemptIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // Bumped on a failed save so the debounced autosave effect re-arms and retries
  // even when the candidate has stopped typing (e.g. a transient network blip).
  const [saveRetryNonce, setSaveRetryNonce] = useState(0);
  // Consecutive failed-save count, drives the exponential backoff in the autosave
  // effect. Reset to 0 on any successful save.
  const saveRetryCountRef = useRef(0);
  // True once we've blown past MAX_SAVE_RETRIES: the work is buffered locally and
  // we back off to occasional retries instead of a tight retry loop.
  const [savedLocallyOnly, setSavedLocallyOnly] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In-flight guards so double-clicks / rapid retries can't fire a second POST to
  // /submissions while one is already pending (prevents duplicate QUEUED rows).
  const runInFlightRef = useRef(false);
  // True when the initial draft load failed. The autosave path re-seeds its
  // revision from the server's reply instead of assuming it starts at zero.
  const [draftsUnknown, setDraftsUnknown] = useState(false);
  // Problems whose editor was opened from this device's local buffer rather
  // than the server's draft, so the candidate can be told.
  const [restoredFromDevice, setRestoredFromDevice] = useState<string[]>([]);
  // Per-problem autosave revision. A ref rather than state: it is read and
  // bumped inside the save path and must never trigger a render.
  const draftRevisionsRef = useRef<Record<string, number>>({});
  const submitInFlightRef = useRef(false);
  // Guards the exit/teardown path so a manual "Submit & Exit" and the timer-driven
  // expiry can't both run (double unlock / double /submit). Never reset: once exit
  // begins the candidate is leaving.
  const exitInFlightRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Non-blocking warning surfaced after the candidate has been unlocked/exited but
  // we could NOT confirm the final save/submit landed (their work is buffered
  // locally). The exit teardown still runs — they are never trapped.
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [proctoringOk, setProctoringOk] = useState(true);
  // Drives the full-screen soft-block/grace-period ONLY — a cheap, fast (1s)
  // camera-stream-health check, NOT real face detection. Left untouched here.
  const [faceStatus, setFaceStatus] = useState<"ok" | "away" | "unknown">("unknown");
  // The footer's "Face detected" indicator — real BlazeFace presence, not
  // camera health. Deliberately does NOT feed the block/grace-period above;
  // it only reflects the existing audit-tick's result (see the presence
  // monitor effect), so there is zero added inference cost.
  const [presenceDetected, setPresenceDetected] = useState<"ok" | "away" | "unknown">("unknown");
  // Ambient connection signal for the trust strip. Defaults online; the effect
  // syncs the real value on mount (navigator is unavailable during SSR).
  const [browserOnline, setBrowserOnline] = useState(true);
  const [heartbeatState, setHeartbeatState] = useState(initialHeartbeatState);
  // Set when the *server* says this session is over — terminated by an
  // invigilator, or finished elsewhere. Distinct from the bell.
  const [sessionEnded, setSessionEnded] = useState<"terminated" | "submitted" | null>(null);
  // The browser's hint AND the server's silence. Either alone is wrong: the
  // browser lies on a captive portal, and the heartbeat is only sampled once
  // a minute.
  const connection = connectionLevel(heartbeatState);
  const online = browserOnline && connection !== "offline";
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraVideoReady, setCameraVideoReady] = useState(false);
  const processScanInFlightRef = useRef(false);
  const activeViolationDetailRef = useRef("");
  const lastFocusLossRef = useRef(0);
  const lastStatementCopyRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportCategory, setSupportCategory] = useState("camera_not_detected");
  const [customIssueDetail, setCustomIssueDetail] = useState("");
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportSentSuccess, setReportSentSuccess] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingCloseFileId, setPendingCloseFileId] = useState<string | null>(null);
  const [lockGraceActive, setLockGraceActive] = useState(false);
  const [lockGraceCountdown, setLockGraceCountdown] = useState(3);
  const [cameraCollapsed, setCameraCollapsed] = useState(false);
  const [faceGraceCountdown, setFaceGraceCountdown] = useState(5);
  const [faceGraceActive, setFaceGraceActive] = useState(false);

  const [softBlockActive, setSoftBlockActive] = useState(false);
  const prevCameraStatusRef = useRef<{ cameraOk: boolean; blockedCount: number } | null>(null);
  // Camera defaults ON (permission was granted during onboarding); microphone
  // defaults OFF — contestants opt in once inside the contest area. Refs mirror
  // the state so stream (re)acquisition applies the current toggle, and every
  // change is audit-logged for organizers (see applyMediaToggle).
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(false);
  const cameraEnabledRef = useRef(true);
  const micEnabledRef = useRef(false);
  const mediaInitialStateLoggedRef = useRef(false);
  const [hasToggledMedia, setHasToggledMedia] = useState(false);
  const [showMediaToggleWarning, setShowMediaToggleWarning] = useState(false);
  const [pendingMediaToggle, setPendingMediaToggle] = useState<{
    type: "camera" | "mic";
    value: boolean;
  } | null>(null);
  const [terminalTab, setTerminalTab] = useState<"stdout" | "logs" | "submissions">("stdout");
  // Deferred terminal-collapse feature. Shrink-to-tab-strip; the editor (flex:1) reclaims the
  // freed height automatically. Output is NEVER silently hidden on the exam: auto-expand is the
  // primary guarantee, the unread dot is the fallback. All of this only READS run state — the
  // three renderers, isRunSubmission, setTerminalTab, and the run/submit handlers are untouched.
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalUnread, setTerminalUnread] = useState(false);
  const terminalCollapsedRef = useRef(false);
  const lastResultExpandIdRef = useRef<string | null>(null);
  const lastResultStatusRef = useRef<string | null>(null);
  const prevSubmittingRef = useRef(false);
  const [submissionsList, setSubmissionsList] = useState<SubmissionAttemptRecord[]>([]);
  const [submissionsListQId, setSubmissionsListQId] = useState<string | null>(null);
  const [allSubmissionsList, setAllSubmissionsList] = useState<SubmissionAttemptRecord[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any[]>>({});
  const [testResultFilter, setTestResultFilter] = useState<"all" | "failed" | "passed">("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Terminal-collapse effects (state/refs declared above; placed here so isSubmitting is in
  // scope). All READ run state only — no renderer/handler/isRunSubmission is touched.
  // Mirror collapsed state into a ref (so the result effect reads it without re-running on every
  // collapse), and clear the unread dot the moment the panel is expanded/viewed.
  useEffect(() => {
    terminalCollapsedRef.current = terminalCollapsed;
    if (!terminalCollapsed) setTerminalUnread(false);
  }, [terminalCollapsed]);
  useEffect(() => {
    runResultAttemptIdRef.current = runResultAttemptId;
  }, [runResultAttemptId]);
  // PRIMARY — auto-expand ONCE per NEW attempt result, keyed on the runResultAttemptId
  // transition (a new id), NOT on runResult presence. A candidate who reads the output and
  // deliberately re-collapses stays collapsed until the NEXT run's result. A same-attempt status
  // update (e.g. QUEUED -> verdict) does NOT re-expand — it lights the unread dot (FALLBACK) if
  // collapsed, so they still get a signal that their result landed.
  useEffect(() => {
    if (runResultAttemptId && runResultAttemptId !== lastResultExpandIdRef.current) {
      lastResultExpandIdRef.current = runResultAttemptId;
      lastResultStatusRef.current = runResult?.status ?? null;
      setTerminalCollapsed(false);
      return;
    }
    const status = runResult?.status ?? null;
    if (status && status !== lastResultStatusRef.current) {
      lastResultStatusRef.current = status;
      if (terminalCollapsedRef.current) setTerminalUnread(true);
    }
  }, [runResultAttemptId, runResult]);
  // Submit lands in Attempts — open the panel once when a submit is initiated.
  useEffect(() => {
    if (isSubmitting && !prevSubmittingRef.current) setTerminalCollapsed(false);
    prevSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  // Timer expiry auto-submit overlay state.
  const [timeUpState, setTimeUpState] = useState<"idle" | "submitting" | "submitted" | "error">(
    "idle"
  );
  const [savedAnswers, setSavedAnswers] = useState<
    Record<string, { language: string; content: string }>
  >({});

  // SECURITY (defense-in-depth): verify the desktop lockdown is engaged before
  // the contest is usable. Practice (dry-run) is intentionally unlocked, so it
  // is exempt. Outside the Tauri shell (dev/browser preview) there is no real
  // lockdown to engage — the invoke throws "Tauri bridge unavailable" and we
  // ALLOW rather than trap the developer. Only a genuine direct-entry into a
  // live contest (Tauri present, lock NOT engaged) triggers the bounce back to
  // onboarding (replace, not push, to avoid a back-button loop). The normal
  // flow — onboarding locks first, then navigates here — passes the check.
  useEffect(() => {
    if (isDryRun) return; // practice mode is intentionally unlocked
    let cancelled = false;
    (async () => {
      try {
        const engaged = await invoke<boolean>("is_lockdown_engaged");
        if (cancelled) return;
        if (engaged) {
          setLockGate("ok");
        } else {
          // Reached the contest without lockdown — never render it.
          setLockGate("redirecting");
          router.replace(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
        }
      } catch {
        // Tauri unavailable (dev/browser) — no real lockdown exists here.
        if (!cancelled) setLockGate("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDryRun, contestId, router]);

  const fetchSubmissions = useCallback(async () => {
    if (!sessionId || !questions[activeQ]) return;
    setLoadingSubmissions(true);
    try {
      // Adapted, not cast. The two shapes share almost no field names, so
      // the `as unknown as` that used to be here matched nothing and left
      // this panel permanently empty.
      //
      // No run filter: `session_submissions` already excludes them
      // server-side, and the old `isRunSubmission` read `submission_kind`, a
      // field v2 never sends — a filter on a field that does not exist is
      // worse than none, because it reads as one.
      const allSubmissions = toAttemptRecords(await listMySubmissions(sessionId));
      setAllSubmissionsList(allSubmissions);
      const qId = questions[activeQ].id;
      const filtered = allSubmissions.filter((sub) => sub.problem_id === qId);
      filtered.sort((a, b) => b.attempt_no - a.attempt_no);
      setSubmissionsList(filtered);
      setSubmissionsListQId(qId);
      // Nothing here refreshes the run panel any more. This list excludes
      // runs by construction — the server filters on `mode` — so searching it
      // for the run's own row could only ever miss. Runs are polled by uid
      // through `getRun` in `triggerRun`, which is the only place that can
      // see them.
    } catch (err) {
      console.error("Failed to fetch submissions:", err);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [sessionId, activeQ, questions]);

  useEffect(() => {
    fetchSubmissions();
  }, [activeQ, sessionId, fetchSubmissions]);

  useEffect(() => {
    const hasPending = submissionsList.some((sub) => isPendingSubmissionStatus(sub.status));
    if (!hasPending) return;

    const interval = setInterval(() => {
      fetchSubmissions();
    }, 2000);

    return () => clearInterval(interval);
  }, [submissionsList, fetchSubmissions]);

  const fetchTestResults = async (attemptId: string) => {
    if (!sessionId) return;
    try {
      // The per-case breakdown arrives on the submission itself. There is no
      // separate test-results endpoint any more: two sources for one judging
      // pass could disagree, and the one that renders is the one the
      // candidate would believe.
      const submissions = await listMySubmissions(sessionId);
      const match = submissions.find((submission) => submission.uid === attemptId);
      setTestResults((prev) => ({
        ...prev,
        [attemptId]: (match?.testcases ?? []) as unknown as any[],
      }));
    } catch (err) {
      console.error("Failed to fetch test results:", err);
    }
  };

  const toggleExpandAttempt = (attemptId: string) => {
    if (expandedAttemptId === attemptId) {
      setExpandedAttemptId(null);
    } else {
      setExpandedAttemptId(attemptId);
      if (!testResults[attemptId]) {
        fetchTestResults(attemptId);
      }
    }
  };

  const prevSubmissionsRef = useRef<SubmissionAttemptRecord[]>([]);
  useEffect(() => {
    if (submissionsList.length > 0) {
      const latest = submissionsList[0];
      const prevLatest = prevSubmissionsRef.current[0];
      if (shouldAutoExpandAttempt(latest, prevLatest)) {
        setExpandedAttemptId(latest.id);
        fetchTestResults(latest.id);
      }
    }
    prevSubmissionsRef.current = submissionsList;
  }, [submissionsList]);

  function logMediaToggle(type: "camera" | "mic", enabled: boolean) {
    const timestamp = new Date().toISOString();
    const detail = `${type === "camera" ? "Camera" : "Microphone"} turned ${enabled ? "on" : "off"} by contestant`;
    // Server-side incident record — organizers/admins see when and what changed.
    // Use keepalive fetch (not beacon) so the Authorization + X-Device-Id headers
    // are sent; media toggles are user-initiated so we're not on the unload path.
    void postJsonKeepalive(
      `${API_URL}/participant/sessions/${sessionId ?? "unregistered"}/incidents`,
      {
        category: enabled ? "media_toggle_on" : "media_toggle_off",
        detail,
        telemetry: {
          timestamp,
          contest_id: contestId,
          session_id: sessionId ?? "unregistered",
          media: type,
          enabled,
        },
      },
      { headers: authHeaders() }
    ).catch(() => {});
    // Local persistent audit trail (proctoring-events.jsonl) — survives offline.
    void window.__TAURI__?.core
      .invoke("log_proctoring_event", {
        kind: "media_toggle",
        detail,
        timestamp: Date.now(),
        payload: {
          media: type,
          enabled,
          contest_id: contestId,
          session_id: sessionId ?? "unregistered",
        },
      })
      .catch(() => {});
  }

  function applyMediaToggle(type: "camera" | "mic", value: boolean) {
    if (type === "camera") {
      setCameraEnabled(value);
      cameraEnabledRef.current = value;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = value));
      }
    } else {
      setMicEnabled(value);
      micEnabledRef.current = value;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = value));
      }
    }
    logMediaToggle(type, value);
  }

  function handleToggleMedia(type: "camera" | "mic", value: boolean) {
    // The one-time confirmation only applies when turning a device OFF —
    // enabling the (default-off) microphone needs no proctoring warning.
    if (!hasToggledMedia && !value) {
      setPendingMediaToggle({ type, value });
      setShowMediaToggleWarning(true);
      return;
    }
    applyMediaToggle(type, value);
  }

  function confirmMediaToggle() {
    setHasToggledMedia(true);
    setShowMediaToggleWarning(false);
    if (pendingMediaToggle) {
      applyMediaToggle(pendingMediaToggle.type, pendingMediaToggle.value);
      setPendingMediaToggle(null);
    }
  }

  function cancelMediaToggle() {
    setShowMediaToggleWarning(false);
    setPendingMediaToggle(null);
  }

  useEffect(() => {
    const storedTheme = localStorage.getItem(EDITOR_THEME_KEY);
    if (isContestEditorTheme(storedTheme)) setEditorTheme(storedTheme);
  }, []);

  useEffect(() => {
    const storedWidth = localStorage.getItem(
      `${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`
    );
    const parsedWidth = storedWidth ? Number(storedWidth) : NaN;
    if (Number.isFinite(parsedWidth)) setProblemPaneWidth(clamp(parsedWidth, 28, 52));
  }, [contestId]);

  function handleEditorThemeChange(value: string) {
    if (isContestEditorTheme(value) === false) return;
    setEditorTheme(value);
    localStorage.setItem(EDITOR_THEME_KEY, value);
    setThemeMenuOpen(false);
  }

  const handleProblemSplitMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sidebarWidth = sidebarCollapsed ? 52 : 220;
      const availableWidth = Math.max(window.innerWidth - sidebarWidth, 600);
      const storageKey = `${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`;

      const onMove = (moveEvent: MouseEvent) => {
        const nextWidth = clamp(
          ((moveEvent.clientX - sidebarWidth) / availableWidth) * 100,
          28,
          52
        );
        setProblemPaneWidth(nextWidth);
        localStorage.setItem(storageKey, String(Math.round(nextWidth * 10) / 10));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [contestId, sidebarCollapsed]
  );

  function handleProblemBodyClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const button = target?.closest<HTMLButtonElement>("[data-copy-sample]");
    if (!button) return;

    const sample = button.getAttribute("data-copy-sample") ?? "";
    const key = button.getAttribute("data-copy-key") ?? "sample";
    void navigator.clipboard?.writeText(sample).catch(() => {});
    // Mark this sample as an allowed clipboard source so pasting it back into the
    // editor is classified internal (F6), not flagged as an external code dump.
    registerAllowedClipboard(sample);
    setCopiedSampleKey(key);
    window.setTimeout(
      () => setCopiedSampleKey((current) => (current === key ? null : current)),
      1400
    );
  }

  // Monitor faceStatus to trigger face grace period countdown
  useEffect(() => {
    if (faceStatus === "away") {
      if (!faceGraceActive) {
        setFaceGraceActive(true);
        setFaceGraceCountdown(5);
      }
    } else if (faceStatus === "ok") {
      setFaceGraceActive(false);
      setFaceGraceCountdown(5);
      setSoftBlockActive(false);
    }
  }, [faceStatus, faceGraceActive]);

  // Face grace countdown timer
  useEffect(() => {
    if (faceGraceActive && faceGraceCountdown > 0) {
      const timer = setTimeout(() => {
        setFaceGraceCountdown(faceGraceCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (faceGraceActive && faceGraceCountdown === 0) {
      setSoftBlockActive(true);
    }
  }, [faceGraceActive, faceGraceCountdown]);

  // Monitor blockedApps changes to trigger the grace period
  useEffect(() => {
    if (blockedApps.length > 0) {
      if (!lockGraceActive) {
        setLockGraceActive(true);
        setLockGraceCountdown(3);
      }
    } else {
      setLockGraceActive(false);
      setLockGraceCountdown(3);
    }
  }, [blockedApps, lockGraceActive]);

  // Countdown timer for locking
  useEffect(() => {
    if (lockGraceActive && lockGraceCountdown > 0) {
      const timer = setTimeout(() => {
        setLockGraceCountdown(lockGraceCountdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [lockGraceActive, lockGraceCountdown]);

  const supportTelemetry = useMemo(() => {
    return {
      timestamp: new Date().toISOString(),
      contest_id: contestId,
      session_id: sessionId ?? "unregistered",
      device: {
        user_agent: typeof window !== "undefined" ? window.navigator.userAgent : "node",
        screen_resolution:
          typeof window !== "undefined"
            ? `${window.screen.width}x${window.screen.height}`
            : "unknown",
        pixel_ratio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
      },
      proctoring_snapshot: {
        camera_error: cameraError ?? "none",
        face_status: faceStatus,
        restricted_apps: blockedApps,
        proctoring_ok: proctoringOk,
      },
    };
  }, [contestId, sessionId, cameraError, faceStatus, blockedApps, proctoringOk, showSupportModal]);

  async function handleSendSupportReport() {
    setIsSendingReport(true);
    try {
      await postJsonKeepalive(
        `${API_URL}/participant/sessions/${sessionId ?? "unregistered"}/incidents`,
        {
          category: supportCategory,
          detail: supportCategory === "other" ? customIssueDetail : "",
          telemetry: supportTelemetry,
        },
        { headers: authHeaders() }
      ).catch(() => {});
    } catch {}

    await new Promise((r) => setTimeout(r, 1200));
    setIsSendingReport(false);
    setReportSentSuccess(true);
    setTimeout(() => {
      setReportSentSuccess(false);
      setShowSupportModal(false);
      setSupportCategory("camera_not_detected");
      setCustomIssueDetail("");
    }, 2200);
  }

  // stable fallback so useCountdown's effect doesn't restart on every render
  // The clock, straight from the server. There is deliberately no fallback:
  // a fabricated deadline renders identically to a real one, and the previous
  // "one hour from page load" default was what every candidate actually got,
  // because the contest metadata came from a staff route that 403s.
  const clock: ClockSnapshot = useMemo(
    () => ({
      endsAtMs: contest?.end_at ? Date.parse(contest.end_at) : null,
      phase: contestPhase,
    }),
    [contest?.end_at, contestPhase]
  );

  useEffect(() => {
    if (!contestId) {
      setLoadError("Missing contest ID. Please relaunch from your contest list.");
      setLoading(false);
      return;
    }

    if (
      (contestId === "mock-contest-dev" || contestId === "mock-contest-scheduled") &&
      isDryRun &&
      isGatingRelaxed()
    ) {
      const mockEnd = new Date(Date.now() + 5400000).toISOString();
      const titles: Record<string, string> = {
        "mock-contest-dev": "AMS Internal — Dev Test",
        "mock-contest-scheduled": "AMS Internal — Scheduled Test",
      };
      const mockMeta: ContestMeta = {
        id: contestId,
        title: titles[contestId],
        end_at: mockEnd,
        status: "ACTIVE",
        allowed_languages: ["C++17", "Python3", "Java17"],
      };
      setContest(mockMeta);
      setSelectedLanguage(mockMeta.allowed_languages![0]);
      const mockQuestions: Question[] = [
        {
          id: "mock-q-1",
          title: "A. Binary Search",
          description:
            "You are given a non-decreasing array $A$ of $N$ integers and $Q$ query values. For each query $x$, print the 1-based index of the first element $A[i]$ such that $A[i] >= x$. If no such element exists, print $-1$.",
          starter_code: defaultCppStarter(),
          order_index: 0,
          question_type: "code",
        },
        {
          id: "mock-q-2",
          title: "B. Alice and Bob",
          description:
            "Given two integers $a$ and $b$, determine the winner under the rules in the statement. Read input from stdin and print the required answer for each test case.",
          starter_code: defaultCppStarter(),
          order_index: 1,
          question_type: "code",
        },
      ];
      setQuestions(mockQuestions);
      loadQuestion(mockQuestions[0], mockMeta.allowed_languages![0]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    if (!participantToken()) {
      setLoadError("Your sign-in has expired. Please sign in again.");
      setLoading(false);
      router.push("/login");
      return;
    }

    const abortController = new AbortController();
    let disposed = false;

    // The room does not create sessions. Onboarding does, because it is the
    // only place that can attest the lockdown engaged first — a session
    // minted here would be one that never passed a check. This *adopts* what
    // onboarding wrote, and sends anyone without one back to get checked.
    const stored = readStoredSession();
    if (!stored || stored.contest_id !== contestId) {
      router.replace(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
      return;
    }

    (async () => {
      // `getSession` validates ownership server-side — someone else's session
      // is a 404, not a 403 — and syncs the clock offset as a side effect.
      const live = await getSession(stored.id);
      if (disposed) return;

      if (live.status === "submitted" || live.status === "terminated") {
        // Finished. Re-entering needs an invigilator, and that lives on /home.
        router.replace("/home");
        return;
      }

      const { index, questions } = await loadContestPaper(contestId);
      if (disposed) return;

      setContest({
        id: index.uid,
        title: index.title,
        end_at: index.ends_at,
        status: index.phase === "running" ? "ACTIVE" : index.phase.toUpperCase(),
        // cxxprobe judges C++ only, so there is nothing to negotiate. The old
        // `allowed_languages` came from a contest endpoint v2 does not have.
        allowed_languages: ["C++23"],
      });
      setSelectedLanguage("C++23");
      setContestPhase(index.phase);
      setBellRung(isBell({ endsAtMs: Date.parse(index.ends_at), phase: index.phase }, serverNow()));
      setSessionId(live.uid);
      localStorage.setItem(
        ACTIVE_SESSION_KEY,
        JSON.stringify({
          id: live.uid,
          contest_id: contestId,
          contest_title: index.title,
          updated_at: new Date().toISOString(),
        })
      );

      const answersMap: Record<string, { language: string; content: string }> = {};
      const restored: string[] = [];
      try {
        // One draft per problem, keyed by label. The old shape stuffed the
        // whole editor workspace into a single `answer_text` string, so two
        // problems' autosaves contended for one row and recovering "what did
        // they have for C" meant parsing a blob.
        for (const draft of await getDrafts(live.uid)) {
          draftRevisionsRef.current[draft.problem_label] = draft.client_revision;

          // Whichever copy is newer wins, by revision — see `chooseRestore`.
          // The local buffer holds anything the network never accepted, which
          // is exactly what a crash mid-outage leaves behind.
          const buffered = readAnswerBuffer(localStorage, live.uid, draft.problem_label);
          const choice = chooseRestore(buffered, draft);
          if (choice === "buffer" && buffered) {
            answersMap[draft.problem_label] = {
              language: buffered.language,
              content: activeContent(buffered),
            };
            restored.push(draft.problem_label);
          } else {
            answersMap[draft.problem_label] = {
              language: draft.language,
              content: draft.source,
            };
          }
        }
        setSavedAnswers(answersMap);
        if (restored.length > 0) {
          // Say so. Silently restoring is as bad as silently losing — the
          // candidate needs to know which version they are looking at.
          setRestoredFromDevice(restored);
        }
      } catch (err) {
        // Revisions stay empty, so the next autosave would send `1` and the
        // server would drop it as stale — for the rest of the exam, silently.
        // `doSave` re-seeds from the PUT response to recover; flag it so that
        // path knows to, and so the candidate is told rather than guessing.
        console.error("Failed to load saved answers:", err);
        setDraftsUnknown(true);
      }

      setActiveQ(0);
      setQuestions(questions);
      if (questions.length > 0) {
        loadQuestionWithAnswers(questions[0], answersMap, "C++23");
        setLoadError(null);
      } else {
        setLoadError("Questions are not available yet. Please retry in a few seconds.");
      }
      setLoading(false);
    })().catch((error) => {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
      if (error instanceof SessionBindingError) {
        router.push("/home");
        return;
      }
      if (error instanceof ProctorApiError && error.status === 404) {
        // The stored session is gone or was never ours. Go and get a real one.
        router.replace(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
        return;
      }
      if (error instanceof ProctorApiError && error.status === 409) {
        // The paper is not open yet — the contest is inside its verification
        // window. That is a state, not a failure.
        setLoadError("The contest has not started yet. This page will let you in when it does.");
        setLoading(false);
        return;
      }
      setLoadError("Unable to load contest. Check connection and retry.");
      setLoading(false);
    });

    return () => {
      disposed = true;
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function loadQuestionWithAnswers(
    q: Question,
    answersMap: Record<string, { language: string; content: string }>,
    language: string
  ) {
    const cxxprobeQuestion = q.judge_engine === "cxxprobe";
    const candidateSaved = answersMap[q.id];
    const saved =
      !cxxprobeQuestion || candidateSaved?.language === "cpp" ? candidateSaved : undefined;
    let lang = cxxprobeQuestion ? "C++23" : language;
    let content: string;

    if (saved) {
      // Wire format → display format (e.g. "cpp17" → "C++17")
      const displayLang =
        Object.entries(LANGUAGE_ID_MAP).find(([, id]) => id === saved.language)?.[0] ??
        saved.language;
      lang = normalizeLanguageLabel(displayLang);
      content = saved.content;
      setSelectedLanguage(lang);
    } else {
      content = q.starter_code ?? defaultStarterFor(lang);
      if (cxxprobeQuestion) setSelectedLanguage("C++23");
    }

    setQuestionFiles((prev) => {
      if (prev[q.id]) return prev;
      const file: EditorFile = {
        id: `${q.id}:main`,
        name: q.starter_filename ?? questionFileName(q, lang),
        content,
      };
      return { ...prev, [q.id]: [file] };
    });
    setQuestionActiveFile((prev) => {
      if (prev[q.id]) return prev;
      return { ...prev, [q.id]: `${q.id}:main` };
    });
  }

  function loadQuestion(q: Question, language: string) {
    loadQuestionWithAnswers(q, savedAnswers, language);
  }

  // Every piece of run-panel state tied to the current question's run resets
  // together. Single source of truth: two call sites (question switch, run
  // start) each hand-maintained this list and one drifted — switchQuestion
  // missed runTimedOut, leaving a ghost "Still running…" notice on the next
  // question after a timed-out run.
  function resetRunPanelState() {
    setRunResult(null);
    setRunResultAttemptId(null);
    setRunError(null);
    setRunTimedOut(false);
  }

  function switchQuestion(idx: number) {
    if (questions[activeQ] && sessionId) {
      handleSave();
    }
    setActiveQ(idx);
    loadQuestion(questions[idx], selectedLanguage);
    resetRunPanelState();
  }

  function handleLanguageChange(newLanguage: string) {
    const normalizedLanguage = normalizeLanguageLabel(newLanguage);
    if (questions[activeQ]?.judge_engine === "cxxprobe" && normalizedLanguage !== "C++23") {
      return;
    }
    setSelectedLanguage(normalizedLanguage);
    setHasUnsavedChanges(true);
    const q = questions[activeQ];
    if (!q) return;
    setQuestionFiles((prev) => {
      const files = prev[q.id];
      if (!files) return prev;
      return {
        ...prev,
        [q.id]: files.map((f) => {
          if (!f.id.endsWith(":main")) return f;
          return {
            ...f,
            name: questionFileName(q, normalizedLanguage),
            content: isPristineStarter(f.content)
              ? defaultStarterFor(normalizedLanguage)
              : f.content,
          };
        }),
      };
    });
  }

  function handleCodeChange(value: string) {
    setHasUnsavedChanges(true);
    // An edit must NOT clear a real save failure — see save-edit-state.ts. A
    // stale "Not saved" only clears when the next real save attempt runs
    // (autosave re-fires ~600ms after this edit since hasUnsavedChanges stays
    // true), and handleSave clears + re-evaluates it from that attempt's
    // actual outcome.
    setSaveError((prev) => saveErrorAfterEdit(prev));
    const qId = questions[activeQ]?.id ?? "";
    const currentActiveId = questionActiveFile[qId] ?? questionFiles[qId]?.[0]?.id ?? "";
    setQuestionFiles((prev) => ({
      ...prev,
      [qId]: (prev[qId] ?? []).map((f) =>
        f.id === currentActiveId ? { ...f, content: value } : f
      ),
    }));
  }

  function addEditorFile() {
    setHasUnsavedChanges(true);
    const qId = questions[activeQ]?.id ?? "question";
    setQuestionFiles((prev) => {
      const files = prev[qId] ?? [];
      const nextIndex = files.length + 1;
      const file: EditorFile = {
        id: `${qId}:scratch-${Date.now()}`,
        name: `scratch${nextIndex}.cpp`,
        content: defaultCppStarter(),
      };
      setQuestionActiveFile((qaf) => ({ ...qaf, [qId]: file.id }));
      return { ...prev, [qId]: [...files, file] };
    });
  }

  function removeEditorFile(fileId: string) {
    setHasUnsavedChanges(true);
    const qId = questions[activeQ]?.id ?? "";
    setQuestionFiles((prev) => {
      const files = (prev[qId] ?? []).filter((f) => f.id !== fileId);
      return { ...prev, [qId]: files };
    });
    setQuestionActiveFile((prev) => {
      if (prev[qId] !== fileId) return prev;
      const remaining = (questionFiles[qId] ?? []).filter((f) => f.id !== fileId);
      return { ...prev, [qId]: remaining[remaining.length - 1]?.id ?? "" };
    });
  }

  async function triggerRun() {
    if (!questions[activeQ] || !sessionId || isRunning) return;
    // In-flight guard: block a second POST while one is already pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;

    setIsRunning(true);
    resetRunPanelState();
    setSubmitError(null);
    setTerminalTab("stdout");

    // Persist the current code before dispatching to the judge.
    const savedOk = await handleSave();
    if (!savedOk) {
      runInFlightRef.current = false;
      setIsRunning(false);
      setRunError("Save failed — check your connection and retry.");
      return;
    }

    // Dispatch the run. Unscored, judged against the samples only, and at a
    // higher priority than submissions — feedback that arrives after the
    // contest is not feedback.
    let attemptId: string;
    try {
      const created = await runAgainstSamples(sessionId, {
        problemLabel: questions[activeQ].id,
        language: toLanguageId(selectedLanguage),
        source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
      });
      const resolvedId = created.uid;
      attemptId = resolvedId;
      setRunResult({ id: resolvedId, attempt_no: 0, status: "QUEUED" });
      setRunResultAttemptId(resolvedId);
      // Keep results in the Output panel — runs never appear under Attempts.
      setTerminalTab("stdout");
      void fetchSubmissions();
    } catch (caught) {
      setIsRunning(false);
      if (caught instanceof ProctorApiError && caught.status === 429) {
        const wait = caught.retryAfterSeconds;
        setRunError(
          wait
            ? `Please wait ~${wait}s before running again.`
            : "Please wait a few seconds before running again."
        );
      } else if (caught instanceof ProctorApiError && caught.status === 409) {
        setRunError(caught.message);
      } else {
        setRunError("Could not reach the judge. Check your connection and retry.");
      }
      return;
    } finally {
      // The duplicate-POST window closes once the attempt request has resolved;
      // the subsequent polling phase is already gated by isRunning.
      runInFlightRef.current = false;
    }

    // Poll for the result with exponential back-off (max ~25 s total).
    const delays = [600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3500];
    for (const ms of delays) {
      await new Promise<void>((r) => setTimeout(r, ms));
      try {
        // The run is polled by its own uid, not by scanning the submission
        // list: the list deliberately excludes runs, so it never contained
        // the thing being waited for.
        const polled = await getRun(sessionId, attemptId);
        const attempt = {
          id: polled.uid,
          attempt_no: 0,
          status: polled.verdict ?? polled.status.toUpperCase(),
          problem_id: polled.problem_label,
        } as unknown as SubmissionAttemptRecord;
        if (attempt) {
          const normalized = normalizeAttemptForRunResult(attempt);
          setRunResult(normalized);
          if (!isPendingSubmissionStatus(normalized.status)) {
            setIsRunning(false);
            // Compile errors go to the Build tab (as today); sample results render
            // in the Output panel. Runs never appear under Attempts.
            setTerminalTab(normalized.status === "CE" ? "logs" : "stdout");
            // Pull the per-sample results so the Output panel can show them,
            // reusing the same test-results fetch the Attempts expansion uses.
            if (normalized.status !== "CE") {
              void fetchTestResults(attemptId);
            }
            await fetchSubmissions();
            return;
          }
        }
      } catch {
        // transient network error — keep polling
      }
    }

    // Polling window elapsed without a terminal verdict: the submission is still
    // queued on the judge. Surface that clearly instead of leaving a silent spinner.
    setIsRunning(false);
    setRunError(null);
    setRunTimedOut(true);
    // Keep the timed-out state visible in the Output panel — the run is never an
    // Attempts row to navigate to.
    setTerminalTab("stdout");
    void fetchSubmissions();
  }

  // Persist the current editor content locally so an unconfirmed network save
  // is never data loss. Best-effort: storage failures (quota, private mode)
  // must never throw into the save/submit/exit paths.
  //
  // Unlike before, this is *read back* — see `restoreAnswer` in the bootstrap.
  // It previously wrote a key nothing consulted, while the UI told candidates
  // their work was saved locally.
  function writeLocalAnswerBuffer() {
    if (!sessionId) return;
    const qId = questions[activeQ]?.id;
    if (!qId) return;
    writeAnswerBuffer(localStorage, sessionId, qId, {
      language: toLanguageId(selectedLanguage),
      // Every tab, not just the active one. Scratch tabs were persisted
      // nowhere at all — not locally and not on the server, which only ever
      // receives the active file.
      files: editorFiles,
      activeFileId,
      savedAtMs: Date.now(),
      revision: draftRevisionsRef.current[qId] ?? 0,
    });
  }

  function clearLocalAnswerBuffer(questionId: string) {
    if (!sessionId) return;
    clearAnswerBuffer(localStorage, sessionId, questionId);
  }

  // The actual network-save body. Recreated fresh every render (a plain
  // function declaration, same as before this refactor) so it always closes
  // over THIS render's editorFiles/selectedLanguage/activeFileId/sessionId —
  // never stale. Never call this directly; go through `handleSave` below, so
  // overlapping calls are serialized/coalesced by the save coordinator instead
  // of firing concurrent overlapping POSTs to /answers (see
  // ./save-coordinator.ts for why that matters).
  async function doSave(): Promise<boolean> {
    if (!questions[activeQ] || !sessionId) {
      setSaveError("No active session is available. Reopen the contest and try again.");
      return false;
    }

    // Mirror the current content locally before hitting the network, so even a
    // hard failure (or tab close mid-request) leaves the work recoverable.
    writeLocalAnswerBuffer();

    const qId = questions[activeQ].id;
    setSaving(true);
    setSaveError(null);
    try {
      // Monotonic per problem. An autosave retried on a flaky connection can
      // arrive after a newer one, and without a revision the later-arriving
      // older write silently wins — which in an exam is indistinguishable
      // from losing work. The server drops anything at or below what it holds.
      const revision = (draftRevisionsRef.current[qId] ?? 0) + 1;
      draftRevisionsRef.current[qId] = revision;

      const stored = await putDraft(sessionId, qId, {
        source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
        language: toLanguageId(selectedLanguage),
        clientRevision: revision,
      });
      // Re-seed from what the server actually holds. If the initial draft
      // load failed, our counter started at zero and every write would be
      // dropped as stale for the rest of the exam — silently. A stale PUT
      // returns the stored copy unchanged, so this self-heals in one trip.
      draftRevisionsRef.current[qId] = Math.max(revision, stored.client_revision);
      if (draftsUnknown) setDraftsUnknown(false);
      setSavedAnswers((prev) => ({
        ...prev,
        [qId]: {
          language: toLanguageId(selectedLanguage),
          content: editorFiles.find((f) => f.id === activeFileId)?.content || "",
        },
      }));

      // Confirmed save: clear unsaved state, drop the local buffer + backoff.
      setHasUnsavedChanges(false);
      saveRetryCountRef.current = 0;
      setSavedLocallyOnly(false);
      clearLocalAnswerBuffer(qId);
      return true;
    } catch (caught) {
      // The bell, not a failure. The contest closed while this save was in
      // flight — or while the candidate was offline and this is the flush.
      // Their work is on the device and their last accepted version is with
      // the server; saying "save failed" would read as data loss.
      if (caught instanceof ProctorApiError && caught.status === 409) {
        setSaving(false);
        setSaveError(null);
        setBellRung(true);
        return false;
      }
      // The buffer write above means the work is safe locally regardless.
      saveRetryCountRef.current += 1;
      if (saveRetryCountRef.current >= MAX_SAVE_RETRIES) {
        setSavedLocallyOnly(true);
        setSaveError("Save failed — your work is saved locally and will retry automatically.");
      } else {
        setSaveError("Save failed. Check your connection and retry before submitting.");
      }
      // Re-arm the autosave so it keeps trying once connectivity returns, even if
      // the candidate has stopped typing. The effect applies exponential backoff.
      setSaveRetryNonce((n) => n + 1);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // doSaveRef always points at THIS render's fresh `doSave` closure. The
  // coordinator instance below is created exactly once (module-lifetime, via
  // useRef) and must never call a stale closure from the render it was
  // created in — it calls through this ref instead, so every invocation
  // (including a coalesced follow-up that runs renders later) reads live
  // state.
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // One coordinator instance for the lifetime of this component. Serializes
  // doSave calls (never two overlapping network writes) and coalesces any
  // requests that arrive while one is in flight into exactly one fresh
  // follow-up — so the 600ms autosave debounce racing an await-caller
  // (triggerRun/handleSubmitSolution/attemptFinalSubmit) can never produce a
  // stale overwrite or a dropped save. See ./save-coordinator.ts.
  const saveCoordinatorRef = useRef<(() => Promise<boolean>) | null>(null);
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = createSaveCoordinator(() => doSaveRef.current());
  }

  // Public entry point — unchanged call signature for every existing call
  // site (autosave timer, triggerRun, handleSubmitSolution,
  // attemptFinalSubmit). Delegates to the coordinator instead of firing a raw
  // network write directly, so an await-caller here still gets a truthful
  // save of current (or later) content even if an autosave is already in
  // flight.
  function handleSave(): Promise<boolean> {
    return saveCoordinatorRef.current!();
  }

  async function handleSubmitSolution() {
    if (!questions[activeQ] || !sessionId) {
      setSubmissionError("No active session is available.");
      return;
    }
    // In-flight guard: block a second POST while one is pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    setIsSubmitting(true);
    setSubmissionError(null);
    setTerminalTab("submissions");

    try {
      const qId = questions[activeQ].id;
      let created;
      try {
        created = await submitSolution(sessionId, {
          problemLabel: qId,
          language: toLanguageId(selectedLanguage),
          source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
        });
      } catch (caught) {
        if (caught instanceof ProctorApiError) {
          // 409 is a closed session, 429 a rate limit; both already carry a
          // sentence written for a candidate, so pass it through rather than
          // mapping it to a worse one here.
          setSubmissionError(caught.message);
          return;
        }
        throw caught;
      }

      await fetchSubmissions();
    } catch (err: any) {
      setSubmissionError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
  }

  // Exit teardown: release every OS-level lock and stop proctoring. This MUST run
  // on every exit path — confirmed or not — so a network failure can never trap a
  // candidate inside the locked-down shell. Every step is failure-tolerant.
  async function runExitTeardown() {
    try {
      // Remember which session this was before dropping it. The results
      // screen opens after this runs and has nothing else to go on.
      const finished = localStorage.getItem(ACTIVE_SESSION_KEY);
      if (finished) localStorage.setItem(STORAGE_KEYS.LAST_SESSION, finished);
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
      // ignore storage errors
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
    const win = window.__TAURI__?.window.getCurrentWindow();
    if (win) {
      await win.setFullscreen(false).catch(() => {});
      await win.setAlwaysOnTop(false).catch(() => {});
      await win.setDecorations(true).catch(() => {});
    }
    try {
      await window.__TAURI__?.core.invoke("unlock_desktop");
    } catch {
      // even if the native unlock fails, the window chrome above is already restored
    }
  }

  // Attempt the final save + /submit with a bounded retry. Returns whether the
  // submit was confirmed by the backend. SESSION_ALREADY_SUBMITTED and
  // CONTEST_ENDED are treated as SUCCESS (the backend already has the session).
  // Crucially this NEVER unlocks/exits — callers always run runExitTeardown after.
  async function attemptFinalSubmit(): Promise<boolean> {
    if (!sessionId) return false;
    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Always mirror the latest content locally before each network try.
      writeLocalAnswerBuffer();
      try {
        await handleSave();
        const response = await postJsonKeepalive(
          `${API_URL}/participant/sessions/${sessionId}/finish`,
          undefined,
          { headers: authHeaders() }
        );
        if (response.ok) return true;
        const errData = (await response.json().catch(() => ({}))) as { code?: string };
        // Backend already has/closed the session — treat as a confirmed submit.
        if (errData.code === "SESSION_ALREADY_SUBMITTED" || errData.code === "CONTEST_ENDED") {
          return true;
        }
      } catch {
        // network failure — fall through to the backoff and retry
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = Math.min(1500 * 2 ** attempt, 8000) + Math.round(Math.random() * 400);
        await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  async function handleSubmitConfirmed() {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setSubmitError(null);
    setSubmitWarning(null);
    setTimeUpState("submitting");
    const confirmed = await attemptFinalSubmit();
    if (!confirmed) {
      // We couldn't confirm — but we NEVER trap the candidate. Surface a clear
      // non-blocking warning, then unlock anyway. Work is buffered locally.
      setSubmitWarning(
        "We couldn't confirm your final save — your work is stored locally on this device."
      );
    }
    // Teardown ALWAYS runs, regardless of whether the submit was confirmed.
    await runExitTeardown();
    // Show the unified calm confirmation instead of a forced auto-redirect.
    // The candidate leaves on their own from the "submitted" overlay.
    setTimeUpState("submitted");
  }

  // Called by the countdown timer when end_at is reached.
  // Auto-submits the session so candidates never need to manually click "Submit & Exit".
  /**
   * The bell. Locks the room; submits nothing.
   *
   * It used to auto-submit and tear the session down. Two problems with that:
   * a half-finished attempt got judged on the candidate's behalf, and a
   * failed final submit still rendered under the heading "You're all done".
   * The contest ending is not an instruction to send work — the server
   * refuses submissions past the deadline anyway (409), so anything sent here
   * could only fail.
   *
   * The candidate keeps their screen, keeps their code, and leaves by their
   * own hand via Submit & Exit.
   */
  function handleContestExpiry() {
    if (bellRung) return;
    setBellRung(true);
    setSubmitConfirm(false);
    setRunError(null);
    setSubmissionError(null);
    // One last draft write. If the server has already closed the window it
    // answers 409, which `doSave` renders as "the contest ended" rather than
    // as a save failure.
    void handleSave();
  }

  useEffect(() => {
    if (loading) return; // Wait for contest load to ensure <video> ref is in DOM
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is unavailable in this environment.");
      setProctoringOk(false);
      setFaceStatus("away");
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const stopStream = (stream: MediaStream | null) => {
      stream?.getTracks().forEach((track) => track.stop());
    };

    const displayCameraError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes("NotAllowed") ||
        msg.includes("not allowed") ||
        msg.includes("denied") ||
        msg.includes("Permission")
        ? "Camera access was denied. Please check your system settings to grant camera permission."
        : msg.includes("NotFound") || msg.includes("not found")
          ? "No camera was found. Please ensure your camera is connected securely."
          : "Camera is currently unavailable. Please check your camera settings and try again.";
    };

    async function bindStream(stream: MediaStream, attempt: number) {
      const video = cameraVideoRef.current;
      if (!video) {
        if (attempt < 3) {
          retryTimer = setTimeout(() => {
            if (!cancelled) void bindStream(stream, attempt + 1);
          }, 150);
        }
        return;
      }

      const ready = await attachVideoStream(video, stream);
      if (cancelled || cameraStreamRef.current !== stream) return;

      setCameraVideoReady(ready);
      if (!ready) setProctoringOk(false);
      if (!ready && attempt < 2) {
        stopStream(stream);
        retryTimer = setTimeout(() => {
          if (!cancelled) void acquire(attempt + 1);
        }, 700);
      } else if (!ready) {
        setCameraError(
          "Camera opened, but no video frames were received. Close other camera apps and try again."
        );
      }
    }

    async function acquire(attempt = 0) {
      try {
        const stream = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            audio: true,
          }),
          8000,
          "Camera request timed out"
        );
        if (cancelled) {
          stopStream(stream);
          return;
        }

        stopStream(cameraStreamRef.current);
        cameraStreamRef.current = stream;
        // Honor the current toggles on every (re)acquisition: camera defaults
        // on, microphone defaults off until the contestant enables it.
        stream.getVideoTracks().forEach((t) => (t.enabled = cameraEnabledRef.current));
        stream.getAudioTracks().forEach((t) => (t.enabled = micEnabledRef.current));
        setCameraStream(stream);
        setCameraVideoReady(false);
        setCameraError(null);
        if (!mediaInitialStateLoggedRef.current) {
          mediaInitialStateLoggedRef.current = true;
          void window.__TAURI__?.core
            .invoke("log_proctoring_event", {
              kind: "media_initial_state",
              detail: `camera ${cameraEnabledRef.current ? "on" : "off"}, microphone ${micEnabledRef.current ? "on" : "off"}`,
              timestamp: Date.now(),
              payload: {
                camera_enabled: cameraEnabledRef.current,
                mic_enabled: micEnabledRef.current,
                contest_id: contestId,
              },
            })
            .catch(() => {});
        }
        void bindStream(stream, attempt);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const shouldRetry =
          attempt < 2 &&
          (msg.includes("NotReadable") ||
            msg.includes("Abort") ||
            msg.includes("busy") ||
            msg.includes("timed out"));

        if (shouldRetry) {
          retryTimer = setTimeout(() => {
            if (!cancelled) void acquire(attempt + 1);
          }, 900);
          return;
        }

        setCameraVideoReady(false);
        setProctoringOk(false);
        setFaceStatus("away");
        setCameraError(displayCameraError(err));
      }
    }

    void acquire();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      stopStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      setCameraVideoReady(false);
    };
  }, [loading]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    /**
     * Liveness — and the only way the app learns anything changed.
     *
     * This was `fetch(...).catch(() => {})`, so the response was discarded.
     * A candidate whose session an invigilator had terminated kept typing
     * into a dead session and found out at submit time; the clock never
     * resynced; and a dropped network was invisible because nothing counted
     * the failures.
     */
    const beat = async () => {
      try {
        const live = await heartbeat(sessionId);
        if (cancelled) return;

        setHeartbeatState((prev) => onHeartbeatSuccess(prev, Date.now()));

        // The server's word on where we are, once a minute. This corrects any
        // drift and is authoritative over local deadline arithmetic.
        setContestPhase(live.phase);
        if (live.ends_at) setContest((prev) => (prev ? { ...prev, end_at: live.ends_at! } : prev));
        if (
          isBell(
            { endsAtMs: live.ends_at ? Date.parse(live.ends_at) : null, phase: live.phase },
            serverNow()
          )
        ) {
          handleContestExpiry();
        }

        if (live.status === "terminated") {
          setSessionEnded("terminated");
        } else if (live.status === "submitted") {
          setSessionEnded("submitted");
        }
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ProctorApiError && caught.status === 401) {
          // The token expired mid-exam. Keep `ams_active_session` so the
          // resume path still has something to resume.
          router.push("/login");
          return;
        }
        setHeartbeatState(onHeartbeatFailure);
      }
    };

    void beat();
    const id = setInterval(() => void beat(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, router]);

  // Flush the moment the connection comes back, rather than waiting out the
  // autosave backoff. A candidate who reconnects with thirty seconds left
  // should not lose them to a timer.
  const wasOnlineRef = useRef(true);
  useEffect(() => {
    const recovered = online && !wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (!recovered || !sessionId || bellRung) return;
    void handleSave();
    void flushViolationQueue(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, sessionId, bellRung]);

  // `navigator.onLine` is a hint, not a fact — it is true on a captive portal
  // and true when the wifi is up but the exam server is unreachable. It is
  // combined with the heartbeat's own verdict below.
  useEffect(() => {
    const sync = () => setBrowserOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Arm the native event-stream uploader: the Rust side tails the local
  // violation/proctoring spool and ships batches to
  // POST /sessions/:id/events with retry/backoff once it knows the session.
  useEffect(() => {
    if (!sessionId) return;
    void window.__TAURI__?.core
      .invoke("configure_event_stream", { apiUrl: API_URL, sessionId, token: participantToken() })
      .catch(() => {});
  }, [sessionId]);

  // ── Periodic presence verification (jittered 30–90 s) ──────────────────────
  // Samples the live camera with BlazeFace and logs presence_ok /
  // face_missing / multiple_faces proctoring events (thumbnails only on
  // anomalies — see lib/presence-monitor.ts for the retention notes). Uses a
  // detached <video> bound to the stream so sampling is independent of the
  // camera panel being collapsed. Deliberately does NOT drive faceStatus (the
  // block/grace-period signal) — only the footer's presenceDetected, on this
  // same tick, at zero added inference cost.
  useEffect(() => {
    if (!cameraStream) {
      setPresenceDetected("unknown");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detectorFailed = false;
    let detector: PresenceDetector | null = null;
    const canvas = document.createElement("canvas");

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = cameraStream;
    void video.play().catch(() => {});

    const logPresence = (kind: string, detail: string, payload: Record<string, unknown>) => {
      void window.__TAURI__?.core
        .invoke("log_proctoring_event", {
          kind,
          detail,
          timestamp: Date.now(),
          payload: { ...payload, contest_id: contestId },
        })
        .catch(() => {});
    };

    async function tick() {
      if (cancelled) return;
      try {
        if (!cameraEnabledRef.current) {
          // Camera is policy-allowed off; attest that no sample was possible
          // so the organizer timeline has no silent gaps.
          logPresence(
            "presence_skipped_camera_off",
            "presence check skipped: camera disabled by contestant",
            {}
          );
          setPresenceDetected("unknown");
        } else {
          if (!detector && !detectorFailed) {
            try {
              detector = await loadPresenceDetector();
            } catch {
              detectorFailed = true;
              logPresence(
                "presence_monitor_unavailable",
                "face detector failed to initialise; periodic presence checks disabled",
                {}
              );
              setPresenceDetected("unknown");
            }
          }
          if (detector && !cancelled) {
            const sample = await samplePresence(video, detector, canvas);
            if (sample && !cancelled) {
              logPresence(sample.status, `presence check: ${sample.faces} face(s) detected`, {
                faces: sample.faces,
                thumbnail: sample.thumbnail,
              });
              // presence_ok = exactly one face confirmed by BlazeFace; anything
              // else (none, or multiple) is not a clean confirmed presence.
              setPresenceDetected(sample.status === "presence_ok" ? "ok" : "away");
            }
          }
        }
      } catch {
        // Sampling must never disturb the exam surface.
      } finally {
        if (!cancelled && !detectorFailed) schedule();
      }
    }

    function schedule() {
      timer = setTimeout(() => void tick(), 30_000 + Math.random() * 60_000);
    }
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      video.srcObject = null;
      detector?.dispose?.();
      detector = null;
    };
  }, [cameraStream, contestId]);

  useEffect(() => {
    if (!cameraStream || !cameraVideoRef.current) return;
    let cancelled = false;
    void attachVideoStream(cameraVideoRef.current, cameraStream).then((ready) => {
      if (!cancelled) setCameraVideoReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [cameraCollapsed, cameraStream]);

  useEffect(() => {
    if (!cameraStream) return;

    const updateCameraStatus = () => {
      const video = cameraVideoRef.current;
      const cameraOk = cameraStream.active && Boolean(video && isVideoRendering(video));
      const next = { cameraOk, blockedCount: blockedApps.length };
      const prev = prevCameraStatusRef.current;
      if (prev?.cameraOk === next.cameraOk && prev.blockedCount === next.blockedCount) return;
      prevCameraStatusRef.current = next;

      setFaceStatus(cameraOk ? "ok" : "away");
      setProctoringOk(cameraOk && blockedApps.length === 0);
      if (cameraOk) {
        setFaceGraceActive(false);
        setFaceGraceCountdown(5);
        setSoftBlockActive(false);
      }
    };

    updateCameraStatus();
    const interval = setInterval(updateCameraStatus, 1000);
    return () => clearInterval(interval);
  }, [blockedApps.length, cameraStream, cameraVideoReady]);

  // Periodic process scan — every 5s, log + alert on violation
  useEffect(() => {
    const tauriCore = window.__TAURI__?.core;
    if (!tauriCore) return;
    const invoke = tauriCore.invoke.bind(tauriCore);

    const prettyName: Record<string, string> = {
      obs: "OBS Studio",
      obs64: "OBS Studio",
      discord: "Discord",
      teamviewer: "TeamViewer",
      anydesk: "AnyDesk",
      wireshark: "Wireshark",
      "cheat engine": "Cheat Engine",
      cheatengine: "Cheat Engine",
      zoom: "Zoom",
      teams: "Microsoft Teams",
      mstsc: "Remote Desktop",
    };

    async function scan() {
      if (processScanInFlightRef.current) return;
      processScanInFlightRef.current = true;
      try {
        const result = await withTimeout(
          invoke<{ found: string[]; clean: boolean }>("scan_processes"),
          2500,
          "Process scan timed out"
        );
        if (!result.clean && result.found.length > 0) {
          const detail = result.found
            .map((f) => f.toLowerCase())
            .sort()
            .join(", ");
          setBlockedApps(result.found.map((f) => prettyName[f.toLowerCase()] ?? f));
          setProctoringOk(false);
          if (detail !== activeViolationDetailRef.current) {
            const previousDetail = activeViolationDetailRef.current;
            if (previousDetail) {
              // Use keepalive fetch (not beacon) so the auth header is sent.
              void postJsonKeepalive(
                `${API_URL}/participant/sessions/${sessionId ?? "unregistered"}/incidents`,
                {
                  category: "blocked_app_resolved",
                  detail: previousDetail,
                  telemetry: {
                    timestamp: new Date().toISOString(),
                    contest_id: contestId,
                    session_id: sessionId ?? "unregistered",
                  },
                },
                { headers: authHeaders() }
              ).catch(() => {});
              await invoke("log_violation", {
                kind: "blocked_app_resolved",
                detail: previousDetail,
              });
            }

            activeViolationDetailRef.current = detail;
            // Use keepalive fetch (not beacon) so the auth header is sent.
            void postJsonKeepalive(
              `${API_URL}/participant/sessions/${sessionId ?? "unregistered"}/incidents`,
              {
                category: "blocked_app_started",
                detail: result.found.join(", "),
                telemetry: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
              },
              { headers: authHeaders() }
            ).catch(() => {});
            await invoke("log_violation", {
              kind: "blocked_app_started",
              detail: result.found.join(", "),
            });
          }
        } else {
          const previousDetail = activeViolationDetailRef.current;
          if (previousDetail) {
            activeViolationDetailRef.current = "";
            // Use keepalive fetch (not beacon) so the auth header is sent.
            void postJsonKeepalive(
              `${API_URL}/participant/sessions/${sessionId ?? "unregistered"}/incidents`,
              {
                category: "blocked_app_resolved",
                detail: previousDetail,
                telemetry: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
              },
              { headers: authHeaders() }
            ).catch(() => {});
            await invoke("log_violation", {
              kind: "blocked_app_resolved",
              detail: previousDetail,
            });
          }
          setBlockedApps([]);
          setProctoringOk(true);
        }
      } catch {
        // Tauri not available or scan timed out; keep the last known state.
      } finally {
        processScanInFlightRef.current = false;
      }
    }

    void scan();
    const id = setInterval(() => void scan(), 5000);
    return () => clearInterval(id);
  }, [contestId, sessionId]);

  useEffect(() => {
    function blockShortcuts(e: KeyboardEvent) {
      const blocked =
        e.key === "F11" ||
        e.key === "Escape" ||
        e.key === "PrintScreen" ||
        (e.altKey && (e.key === "Tab" || e.key === "F4" || e.key === "Escape")) ||
        e.metaKey ||
        (e.ctrlKey && e.key === "w") ||
        (e.ctrlKey && e.key === "W") ||
        (e.ctrlKey && e.shiftKey && e.key === "I") ||
        (e.ctrlKey && e.shiftKey && e.key === "J") ||
        (e.ctrlKey && e.key === "u") ||
        (e.ctrlKey && e.key === "U");
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", blockShortcuts, { capture: true });
    return () => window.removeEventListener("keydown", blockShortcuts, { capture: true });
  }, []);

  // Focus-loss proctoring — when the locked window is hidden/blurred (alt-tab,
  // minimize, another window, virtual-desktop switch), log a violation. This is
  // the immediate signal; a native backstop exists elsewhere. Debounced so one
  // switch (which can fire both blur and visibilitychange) logs at most once.
  useEffect(() => {
    const reportFocusLoss = (detail: "document_hidden" | "window_blur") => {
      const now = Date.now();
      if (now - lastFocusLossRef.current < 1000) return;
      lastFocusLossRef.current = now;
      try {
        void window.__TAURI__?.core.invoke("log_violation", {
          kind: "focus_loss",
          detail,
        });
      } catch {
        // Tauri not available (browser/dev); ignore.
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) reportFocusLoss("document_hidden");
    };
    const onBlur = () => reportFocusLoss("window_blur");

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Statement copy proctoring (F6) — copying *out of the problem statement* is a
  // weak cheating signal (e.g. pasting it into an external tool), so log it as a
  // medium-severity event. We never block it (candidates legitimately copy sample
  // I/O), and never record the copied text — metadata only. Debounced like the
  // focus-loss effect so one gesture logs at most once.
  useEffect(() => {
    const reportStatementCopy = (verb: "copy" | "cut") => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const anchor = selection.anchorNode;
      const anchorEl = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      if (!anchorEl?.closest(".pb-body")) return;

      const now = Date.now();
      if (now - lastStatementCopyRef.current < 1000) return;
      lastStatementCopyRef.current = now;

      try {
        void window.__TAURI__?.core.invoke("log_proctoring_event", {
          kind: "clipboard_copy",
          detail: `Statement ${verb}`,
          timestamp: Date.now(),
          payload: {
            source: "statement",
            len: String(selection).length,
            severity: "medium",
          },
        });
      } catch {
        // Tauri not available (browser/dev); ignore.
      }
    };

    const onCopy = () => reportStatementCopy("copy");
    const onCut = () => reportStatementCopy("cut");

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
    };
  }, []);

  const currentQuestion = questions[activeQ];
  const currentQId = currentQuestion?.id ?? "";
  const editorFiles = questionFiles[currentQId] ?? [];
  const activeFileId = questionActiveFile[currentQId] ?? editorFiles[0]?.id ?? "";
  const activeFile = editorFiles.find((file) => file.id === activeFileId) ?? editorFiles[0] ?? null;
  const isEditorEmpty = !activeFile?.content;
  const currentCode = activeFile?.content ?? "";

  // Debounced autosave: persist the active answer ~600ms after the candidate stops
  // editing, so saving is invisible and they never sit on an "unsaved" warning.
  // Re-arms on every content/language/file change (debounces typing) and on a
  // failed save (retry). Switching question bumps currentQId, whose cleanup clears
  // any pending timer; switchQuestion already saves the outgoing answer first.
  useEffect(() => {
    if (!hasUnsavedChanges || !sessionId || !currentQId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    // Fresh edit debounces at AUTOSAVE_DEBOUNCE_MS (~600ms); consecutive failures
    // back off exponentially on the (separate) retry base. See ./autosave-timing.
    const delayMs = computeAutosaveDelayMs(saveRetryCountRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void handleSave();
    }, delayMs);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasUnsavedChanges,
    currentCode,
    selectedLanguage,
    activeFileId,
    currentQId,
    sessionId,
    saveRetryNonce,
  ]);
  const currentDescriptionMd = currentQuestion?.description ?? "*No description provided.*";
  const problemSections = useMemo(
    () => splitProblemDescription(currentDescriptionMd),
    [currentDescriptionMd]
  );
  const availableProblemTabs = useMemo(
    () => getAvailableProblemTabs(problemSections),
    [problemSections]
  );
  const activeProblemTab = availableProblemTabs.includes(problemTab) ? problemTab : "statement";
  const problemBodyHtml = useMemo(
    () =>
      enhanceSampleBlocks(
        parseDescription(
          problemSections[activeProblemTab] || currentDescriptionMd,
          currentQuestion?.cxxprobe
            ? {
                statementPath: currentQuestion.cxxprobe.statement.path,
                assets: currentQuestion.cxxprobe.assets,
              }
            : undefined
        ),
        copiedSampleKey
      ),
    [activeProblemTab, copiedSampleKey, currentDescriptionMd, currentQuestion, problemSections]
  );
  const editorContest = useMemo(
    () =>
      currentQuestion?.judge_engine === "cxxprobe" && contest
        ? { ...contest, allowed_languages: ["C++23"] }
        : contest,
    [contest, currentQuestion?.judge_engine]
  );
  // Why Run and Submit are unavailable, if they are. This used to hold
  // "C++23 judging is not available in this release" for every cxxprobe
  // problem — the third copy of that block, and the one that actually kept
  // the buttons disabled after the two inline guards were removed.
  // The editor goes read-only on a *sustained* outage, not the first dropped
  // packet — see `heartbeat-policy`. Locking a whole exam hall on one lost
  // packet would be a self-inflicted incident.
  const editorLocked = shouldLockEditor(heartbeatState) || bellRung || Boolean(sessionEnded);

  const judgingUnavailableReason = sessionEnded
    ? sessionEnded === "terminated"
      ? "An invigilator ended this session."
      : "This session has already been submitted."
    : bellRung
      ? "The contest has ended. Your work is saved — you can read it, but not change it."
      : !paperIsOpen({ endsAtMs: null, phase: contestPhase })
        ? "The contest has not started yet."
        : editorLocked
          ? "We can't reach the exam server. Your work is saved on this device and will sync when the connection returns."
          : null;

  // One trustworthy, invisible-saving model (Google-Docs style): the candidate
  // never sees an alarming "unsaved" warning. Any pending or in-flight write reads
  // "Saving…"; once persisted it reads "All changes saved"; only a real failure is
  // surfaced (and the debounced autosave keeps retrying in the background).
  const saveIndicator = deriveSaveIndicator({ saveError, saving, hasUnsavedChanges });
  // Submit button state = SUBMIT only (never autosave) — see submit-button.ts.
  const submitButton = deriveSubmitButton({
    isSubmitting,
    submissionError,
    hasSession: Boolean(sessionId),
    editorEmpty: isEditorEmpty,
    judgingPending:
      submissionsListQId === currentQId &&
      submissionsList.some((s) => isUiBlockingPending(s.status, s.created_at, Date.now())),
  });
  const runStatusLabelMap: Record<RunVerdict, string> = {
    QUEUED: "Queued",
    RUNNING: "Running…",
    AC: "Accepted",
    WA: "Wrong answer",
    TLE: "Too slow (time limit)",
    MLE: "Out of memory",
    RE: "Runtime error",
    CE: "Didn’t compile",
    OLE: "Too much output",
    SE: "Judging failed",
    IE: "Judge error — please retry",
  };
  const runStatus = runError
    ? {
        // Client-side failure reaching the judge — distinct from a judge verdict.
        label: "Couldn’t reach the judge",
        color: "#fca5a5",
        bg: "rgba(239,68,68,0.1)",
        border: "rgba(239,68,68,0.28)",
        icon: "error" as const,
      }
    : runTimedOut
      ? {
          // Verdict not back yet — the submission is still queued on the judge.
          label: "Still running…",
          color: "#fcd34d",
          bg: "rgba(245,158,11,0.1)",
          border: "rgba(245,158,11,0.28)",
          icon: "pending" as const,
        }
      : runResult
        ? {
            label: runStatusLabelMap[runResult.status] ?? runResult.status,
            color: VERDICT_COLORS[runResult.status] ?? "#94a3b8",
            bg: VERDICT_BG[runResult.status] ?? "rgba(100,116,139,0.12)",
            border: VERDICT_BORDER[runResult.status] ?? "rgba(100,116,139,0.3)",
            icon:
              runResult.status === "QUEUED" || runResult.status === "RUNNING"
                ? ("loading" as const)
                : ("dot" as const),
          }
        : null;
  const runProgressPhase = runError
    ? 3
    : !runResult
      ? isRunning
        ? 0
        : -1
      : runResult.status === "QUEUED"
        ? 0
        : runResult.status === "RUNNING"
          ? 2
          : 3;
  const runProgressSteps = ["Queued", "Compiling", "Running", "Result"];
  const runMetrics =
    runResult && runResult.status !== "QUEUED" && runResult.status !== "RUNNING"
      ? [
          runResult.runtime_ms != null ? `${runResult.runtime_ms}ms` : null,
          runResult.memory_kb != null ? `${Math.round(runResult.memory_kb / 1024)}MB` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const shouldShowRunProgress = Boolean(isRunning || runResult || runError || runTimedOut);
  // Per-sample results for the most recent "Run on Judge". Pulled from the same
  // `testResults` cache the Attempts expansion uses, keyed by the run's attempt
  // id. Only populated once the run reaches a terminal (non-CE) verdict.
  const runSampleTests: any[] | null =
    runResultAttemptId && runResult && !isPendingSubmissionStatus(runResult.status)
      ? (testResults[runResultAttemptId] ?? null)
      : null;
  const latestAttempt = submissionsList[0] ?? null;
  const latestAttemptTests = latestAttempt ? testResults[latestAttempt.id] : null;
  const latestAttemptPending = latestAttempt
    ? latestAttempt.status === "QUEUED" || latestAttempt.status === "RUNNING"
    : false;
  const latestAttemptPassed = latestAttemptTests
    ? latestAttemptTests.filter((tr: any) => tr.verdict === "AC").length
    : 0;
  const latestAttemptFirstFailed =
    latestAttemptTests?.find((tr: any) => tr.verdict !== "AC") ?? null;
  const submissionsByQuestion = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    for (const sub of allSubmissionsList) {
      const qId = String(sub.problem_id ?? "");
      if (!qId) continue;
      grouped[qId] = [...(grouped[qId] ?? []), sub];
    }
    Object.values(grouped).forEach((items) =>
      items.sort((a, b) => Number(b.attempt_no ?? 0) - Number(a.attempt_no ?? 0))
    );
    return grouped;
  }, [allSubmissionsList]);
  const questionStatusMap = useMemo(() => {
    const map: Record<
      string,
      { label: string; shortLabel: string; color: string; bg: string; border: string }
    > = {};
    for (const q of questions) {
      const attempts = submissionsByQuestion[q.id] ?? [];
      const hasAccepted = attempts.some((sub) => (sub.final_verdict ?? sub.status) === "AC");
      const hasPending = attempts.some(
        (sub) => sub.status === "QUEUED" || sub.status === "RUNNING"
      );
      const hasAttempt = attempts.length > 0;
      const isActiveUnsaved = q.id === currentQId && hasUnsavedChanges;
      if (hasAccepted) {
        map[q.id] = {
          label: "Accepted",
          shortLabel: "AC",
          color: "var(--verdict-ac)",
          bg: "color-mix(in srgb, var(--verdict-ac) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-ac) 28%, transparent)",
        };
      } else if (hasPending) {
        map[q.id] = {
          label: "Attempted",
          shortLabel: "Run",
          color: "var(--color-accent-base)",
          bg: "rgb(var(--accent-rgb) / 0.1)",
          border: "rgb(var(--accent-rgb) / 0.28)",
        };
      } else if (hasAttempt) {
        map[q.id] = {
          label: "Needs review",
          shortLabel: "Review",
          color: "var(--verdict-tle)",
          bg: "color-mix(in srgb, var(--verdict-tle) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-tle) 28%, transparent)",
        };
      } else if (isActiveUnsaved) {
        map[q.id] = {
          label: "Unsaved",
          shortLabel: "Unsaved",
          color: "var(--verdict-tle)",
          bg: "color-mix(in srgb, var(--verdict-tle) 10%, transparent)",
          border: "color-mix(in srgb, var(--verdict-tle) 24%, transparent)",
        };
      } else if (savedAnswers[q.id]) {
        map[q.id] = {
          label: "Saved",
          shortLabel: "Saved",
          // A muted green — distinct from the bright AC token so "saved" never
          // reads as "accepted" in the nav.
          color: "color-mix(in srgb, var(--verdict-ac) 55%, var(--text-dim))",
          bg: "color-mix(in srgb, var(--verdict-ac) 8%, transparent)",
          border: "color-mix(in srgb, var(--verdict-ac) 22%, transparent)",
        };
      } else {
        map[q.id] = {
          label: "Not started",
          shortLabel: "Open",
          color: "var(--text-dim)",
          bg: "rgba(255,255,255,0.04)",
          border: "rgba(255,255,255,0.12)",
        };
      }
    }
    return map;
  }, [currentQId, hasUnsavedChanges, questions, savedAnswers, submissionsByQuestion]);
  const attemptedQuestionCount = questions.filter(
    (q) => (submissionsByQuestion[q.id] ?? []).length > 0
  ).length;
  const acceptedQuestionCount = questions.filter((q) =>
    (submissionsByQuestion[q.id] ?? []).some((sub) => (sub.final_verdict ?? sub.status) === "AC")
  ).length;
  const remainingQuestionCount = Math.max(questions.length - attemptedQuestionCount, 0);
  // Coverage shown on the calm post-submit confirmation: problems the candidate
  // engaged with (submitted to OR saved an answer for). Derived from LOCAL state
  // only — never correctness/verdicts/scores (those unlock after the 48h embargo).
  const engagedQuestionCount = questions.filter(
    (q) => (submissionsByQuestion[q.id] ?? []).length > 0 || Boolean(savedAnswers[q.id])
  ).length;
  // Who is sitting this exam, for display only. There is no email: candidates
  // sign in with a printed slip and the platform has no address for them.
  const candidateName =
    typeof window !== "undefined" ? (localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) ?? "") : "";
  useEffect(() => {
    if (!availableProblemTabs.includes(problemTab)) setProblemTab("statement");
    setCopiedSampleKey(null);
  }, [activeQ, availableProblemTabs, problemTab]);

  const cameraHealthy = Boolean(cameraStream && cameraVideoReady && !cameraError);
  const cameraStatusLabel = !cameraEnabled
    ? "Camera off"
    : cameraHealthy
      ? "Camera active"
      : cameraError
        ? "Camera issue"
        : "Camera starting";
  // Footer status-dot badge — a small corner LED per proctoring icon. Decorative colour cue
  // (aria-hidden); the real status stays in each icon's colour + its sr-only live region.
  // green = working, red = not working, off-white = transient (saving / camera starting).
  const footerStatusDot = (color: string) => (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "-2px",
        right: "-3px",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: color,
        border: "1.5px solid #0F0F0F",
      }}
    />
  );
  const shouldShowFaceBlock = softBlockActive && faceStatus !== "ok";
  const faceBlockTitle = cameraHealthy ? "Integrity Check Paused" : "Camera Check Required";
  const faceBlockMessage = cameraHealthy
    ? "Please face the camera to resume your exam."
    : cameraError
      ? cameraError
      : "Waiting for a live camera frame. Check the camera preview before continuing.";
  const lockViolationDialogRef = useFocusTrap<HTMLDivElement>(
    lockGraceActive && lockGraceCountdown === 0
  );
  const faceBlockDialogRef = useFocusTrap<HTMLDivElement>(shouldShowFaceBlock);
  const mediaWarningDialogRef = useFocusTrap<HTMLDivElement>(
    showMediaToggleWarning,
    cancelMediaToggle
  );
  const supportDialogRef = useFocusTrap<HTMLDivElement>(showSupportModal, () =>
    setShowSupportModal(false)
  );

  // SECURITY: while the lockdown probe is pending — or while bouncing an
  // unlocked direct-entry back to onboarding — render a neutral securing screen.
  // Never flash the contest UI before lockdown is confirmed engaged.
  if (lockGate !== "ok") {
    return <BootScreen label="Securing session…" />;
  }

  if (loading) {
    return <BootScreen label="Loading contest..." />;
  }

  if (loadError) {
    return <ContestLoadErrorScreen loadError={loadError} router={router} />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#0F0F0F",
        fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <KioskBanner />
      {/* Floating warning toast during grace period */}
      {lockGraceActive && lockGraceCountdown > 0 && (
        <LockGraceToast lockGraceCountdown={lockGraceCountdown} />
      )}

      {/* ── Blocked app violation overlay ── */}
      {lockGraceActive && lockGraceCountdown === 0 && (
        <BlockedAppsOverlay
          lockViolationDialogRef={lockViolationDialogRef}
          blockedApps={blockedApps}
        />
      )}

      {/* ── Top bar ── */}
      <TopBar
        contest={contest}
        clock={clock}
        handleContestExpiry={handleContestExpiry}
        setShowSupportModal={setShowSupportModal}
        submitConfirm={submitConfirm}
        setSubmitConfirm={setSubmitConfirm}
        submitError={submitError}
        setSubmitError={setSubmitError}
        handleSubmitConfirmed={handleSubmitConfirmed}
        timeUpState={timeUpState}
      />

      {/* ── Body ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          background: "#0F0F0F",
          position: "relative",
        }}
      >
        {/* Question list sidebar */}
        <QuestionRail
          questions={questions}
          activeQ={activeQ}
          switchQuestion={switchQuestion}
          sidebarCollapsed={sidebarCollapsed}
          setSidebarCollapsed={setSidebarCollapsed}
          questionStatusMap={questionStatusMap}
          acceptedQuestionCount={acceptedQuestionCount}
        />

        {/* Contest problems. The follow-up and Markov question types
            belonged to the retired assessment platform; cxxprobe judges
            code, and nothing produces those question types any more. */}
        {/* Middle pane: Problem Description */}
        <ProblemPane
          problemPaneWidth={problemPaneWidth}
          availableProblemTabs={availableProblemTabs}
          activeProblemTab={activeProblemTab}
          setProblemTab={setProblemTab}
          questions={questions}
          activeQ={activeQ}
          problemBodyHtml={problemBodyHtml}
          handleProblemBodyClick={handleProblemBodyClick}
        />

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize problem and editor panes"
          title="Drag to resize"
          onMouseDown={handleProblemSplitMouseDown}
          onMouseEnter={(e) => {
            const bar = e.currentTarget.querySelector<HTMLDivElement>("[data-split-bar]");
            if (bar) {
              bar.style.width = "3px";
              bar.style.background = "rgb(var(--accent-rgb) / 0.6)";
            }
          }}
          onMouseLeave={(e) => {
            const bar = e.currentTarget.querySelector<HTMLDivElement>("[data-split-bar]");
            if (bar) {
              bar.style.width = "2px";
              bar.style.background = "rgba(255,255,255,0.14)";
            }
          }}
          style={{
            width: "10px",
            flexShrink: 0,
            cursor: "col-resize",
            background: "#0F0F0F",
            borderRight: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* A single 2px·16px grab bar that thickens + brightens on hover,
                replacing the near-invisible 5-dot column. */}
          <div
            data-split-bar
            style={{
              width: "2px",
              height: "16px",
              borderRadius: "var(--radius-pill)",
              background: "rgba(255,255,255,0.14)",
              pointerEvents: "none",
              transition: "width var(--transition-fast), background-color var(--transition-fast)",
            }}
          />
        </div>

        {/* Right panel: Editor (Top) + Terminal (Bottom) */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "#0F0F0F",
            minWidth: 0,
          }}
        >
          {/* Top Right: Code Editor */}
          <EditorPanel
            editorFiles={editorFiles}
            activeFileId={activeFileId}
            pendingCloseFileId={pendingCloseFileId}
            setPendingCloseFileId={setPendingCloseFileId}
            setQuestionActiveFile={setQuestionActiveFile}
            currentQId={currentQId}
            removeEditorFile={removeEditorFile}
            addEditorFile={addEditorFile}
            selectedLanguage={selectedLanguage}
            handleLanguageChange={handleLanguageChange}
            contest={editorContest}
            themeMenuOpen={themeMenuOpen}
            setThemeMenuOpen={setThemeMenuOpen}
            editorTheme={editorTheme}
            handleEditorThemeChange={handleEditorThemeChange}
            isRunning={isRunning}
            sessionId={sessionId}
            triggerRun={triggerRun}
            judgingUnavailableReason={judgingUnavailableReason}
            readOnly={editorLocked}
            submitButton={submitButton}
            isSubmitting={isSubmitting}
            isEditorEmpty={isEditorEmpty}
            handleSubmitSolution={handleSubmitSolution}
            submissionError={submissionError}
            saveError={saveError}
            activeQ={activeQ}
            activeFile={activeFile}
            currentCode={currentCode}
            handleCodeChange={handleCodeChange}
          />

          {/* Bottom Right: Terminal — collapses to just the tab strip; editor reclaims. */}
          <TerminalPanel
            terminalCollapsed={terminalCollapsed}
            setTerminalCollapsed={setTerminalCollapsed}
            shouldShowRunProgress={shouldShowRunProgress}
            terminalTab={terminalTab}
            setTerminalTab={setTerminalTab}
            runResult={runResult}
            isRunning={isRunning}
            runTimedOut={runTimedOut}
            runResultAttemptId={runResultAttemptId}
            runSampleTests={runSampleTests}
            runError={runError}
            isEditorEmpty={isEditorEmpty}
            submissionsList={submissionsList}
            loadingSubmissions={loadingSubmissions}
            expandedAttemptId={expandedAttemptId}
            toggleExpandAttempt={toggleExpandAttempt}
            testResults={testResults}
            testResultFilter={testResultFilter}
            setTestResultFilter={setTestResultFilter}
            latestAttempt={latestAttempt}
            latestAttemptTests={latestAttemptTests}
            latestAttemptPending={latestAttemptPending}
            latestAttemptPassed={latestAttemptPassed}
            latestAttemptFirstFailed={latestAttemptFirstFailed}
            runStatus={runStatus}
            runMetrics={runMetrics}
            runProgressSteps={runProgressSteps}
            runProgressPhase={runProgressPhase}
            terminalUnread={terminalUnread}
          />
        </div>
        {/* Docked Camera feed — v1.2: a self-contained video box with the cam/mic toggles
            overlaid top-right (no separate bar, no wrapping label). Health is conveyed by the
            border tint + title/aria-label, not a truncating text chip. */}
        <CameraTile
          cameraVideoRef={cameraVideoRef}
          cameraStream={cameraStream}
          cameraError={cameraError}
          sidebarCollapsed={sidebarCollapsed}
          cameraStatusLabel={cameraStatusLabel}
          cameraHealthy={cameraHealthy}
          cameraEnabled={cameraEnabled}
          micEnabled={micEnabled}
          handleToggleMedia={handleToggleMedia}
        />
      </div>

      {/* ── Proctoring footer ── */}
      <FooterTrustStrip
        proctoringOk={proctoringOk}
        footerStatusDot={footerStatusDot}
        faceStatus={presenceDetected}
        online={online}
        saveIndicator={saveIndicator}
        activeQ={activeQ}
        questions={questions}
        attemptedQuestionCount={attemptedQuestionCount}
        acceptedQuestionCount={acceptedQuestionCount}
        remainingQuestionCount={remainingQuestionCount}
      />

      {/* ── Face proctoring soft-block overlay ── */}
      {shouldShowFaceBlock && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="face-block-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-critical)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2,4,10,0.92)",
            backdropFilter: "blur(16px) brightness(0.5)",
            animation: "fadeIn 280ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            ref={faceBlockDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "8px",
              padding: "32px 28px",
              background: "#1F1F1F",
              border: "1px solid rgb(var(--accent-rgb) / 0.2)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgb(var(--accent-rgb) / 0.1)",
                border: "1px solid rgb(var(--accent-rgb) / 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-accent-light)"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12a4 4 0 008 0" />
                <path d="M9 9h.01M15 9h.01" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
            <h4
              id="face-block-title"
              className="text-subsection-title"
              style={{ color: "#f8fafc", marginBottom: "8px" }}
            >
              {faceBlockTitle}
            </h4>
            <p className="text-body-copy" style={{ color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>
              {faceBlockMessage}
            </p>
          </div>
        </div>
      )}

      {/* ── Media Toggle Warning Modal ── */}
      {showMediaToggleWarning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="media-toggle-warning-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-overlay)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,15,15,0.75)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            ref={mediaWarningDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "8px",
              padding: "24px",
              background: "#1F1F1F",
              border: "1px solid rgba(245,158,11,0.28)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            <h4
              id="media-toggle-warning-title"
              style={{
                color: "#f8fafc",
                margin: "0 0 8px 0",
                fontSize: "15px",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              This action will be logged.
            </h4>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "13px",
                lineHeight: 1.6,
                margin: "0 0 24px 0",
                fontFamily: "Inter, system-ui, sans-serif",
              }}
            >
              Turning off your camera or microphone may affect proctoring validation.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={cancelMediaToggle}
                style={{
                  padding: "8px 16px",
                  border: "1px solid #475569",
                  background: "transparent",
                  color: "#e2e8f0",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmMediaToggle}
                style={{
                  padding: "8px 16px",
                  border: "1px solid rgba(245,158,11,0.38)",
                  background: "rgba(245,158,11,0.12)",
                  color: "#fbbf24",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Time's Up Auto-Submit Overlay ── */}
      {timeUpState !== "idle" && (
        <div
          role="alertdialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-critical)",
            background: "rgba(10,10,10,0.92)",
            backdropFilter: "blur(16px) saturate(180%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            {timeUpState === "submitted" ? "Submitted" : "Contest Ended"}
          </div>
          {timeUpState === "submitting" && (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0" }}>
                Submitting your session...
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Mono', 'Consolas', monospace",
                  fontSize: 12,
                  color: "#64748b",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                <style>{`
                  @keyframes ams-cursor-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                  }
                  @media (prefers-reduced-motion: no-preference) {
                    .ams-telemetry-cursor {
                      animation: ams-cursor-blink 1s step-end infinite;
                    }
                  }
                `}</style>
                Status: Transmitting data<span className="ams-telemetry-cursor">_</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-dim)",
                  maxWidth: 340,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                Your work is autosaved. It&rsquo;s safe to leave.
              </div>
              {/*
               * Escape hatches while auto-submit is in-flight. Navigating away is
               * intentionally allowed here: the candidate's work is already autosaved
               * and the submission/teardown promise will continue to resolve after
               * unmount. A stuck network request must never trap the candidate on
               * this screen.
               */}
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 4 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() => router.push(`/results?contestId=${encodeURIComponent(contestId)}`)}
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
          {timeUpState === "submitted" && (
            <>
              <div style={{ fontSize: 26, fontWeight: 600, color: "#e2e8f0" }}>
                You&rsquo;re all done
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "#94a3b8",
                  maxWidth: 380,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                {submitWarning ?? "Your work has been submitted safely."}
              </div>
              {submitWarning && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#fbbf24",
                    maxWidth: 380,
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  You have been unlocked and can exit safely. We&rsquo;ll keep retrying the upload
                  in the background.
                </div>
              )}
              {questions.length > 0 && engagedQuestionCount > 0 && (
                <div style={{ fontSize: 13, color: "#64748b" }}>
                  You worked on {engagedQuestionCount} of {questions.length} problem
                  {questions.length !== 1 ? "s" : ""}.
                </div>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "#64748b",
                  maxWidth: 400,
                  textAlign: "center",
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                Results unlock in 48 hours.
                {candidateName ? (
                  <>
                    {" "}
                    They&rsquo;ll be here under{" "}
                    <span style={{ color: "#94a3b8" }}>{candidateName}</span> when they&rsquo;re
                    ready.
                  </>
                ) : (
                  <> Sign back in to see them when they&rsquo;re ready.</>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 12 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() => router.push(`/results?contestId=${encodeURIComponent(contestId)}`)}
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
          {timeUpState === "error" && (
            <>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#e2e8f0" }}>
                Could not submit automatically.
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 340, textAlign: "center" }}>
                Your answers are saved. Reconnect and click the button below to submit.
              </div>
              <button
                onClick={() => {
                  setTimeUpState("submitting");
                  void handleContestExpiry();
                }}
                style={{
                  marginTop: 8,
                  padding: "10px 24px",
                  background: "var(--color-accent-deep)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in srgb, var(--color-accent-deep), #fff 12%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--color-accent-deep)";
                }}
              >
                Retry Submit
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 4 }}>
                <button
                  onClick={() => router.push("/home")}
                  style={{
                    padding: "10px 24px",
                    background: "var(--color-accent-base)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "opacity var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.88";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                >
                  Back to home
                </button>
                <button
                  onClick={() => router.push(`/results?contestId=${encodeURIComponent(contestId)}`)}
                  style={{
                    padding: "10px 0",
                    background: "none",
                    color: "#a1a1aa",
                    border: "none",
                    fontSize: 14,
                    cursor: "pointer",
                    transition: "color var(--transition-fast)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ffffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#a1a1aa";
                  }}
                >
                  Check results status
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Support Incident Modal Overlay ── */}
      {showSupportModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: "var(--modal-z-overlay)",
            background: "rgba(15,15,15,0.85)",
            backdropFilter: "blur(16px) saturate(180%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            ref={supportDialogRef}
            tabIndex={-1}
            style={{
              width: "100%",
              maxWidth: "800px",
              background: "#1F1F1F",
              border: "1px solid rgb(var(--accent-rgb) / 0.2)",
              borderRadius: "8px",
              padding: "32px",
              boxShadow: "0 24px 64px rgb(var(--accent-rgb) / 0.08)",
              position: "relative",
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: "32px",
            }}
          >
            {/* Left Column: Form & Categories */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h3
                  id="support-modal-title"
                  className="text-subsection-title"
                  style={{ color: "#ffffff", marginBottom: "var(--density-compact)" }}
                >
                  Report an Incident
                </h3>
                <p className="text-body-copy" style={{ color: "#64748b", margin: 0 }}>
                  Select the issue encountered. Our operations team will receive this report
                  instantly along with diagnostic system telemetry.
                </p>
              </div>

              {/* Success Screen */}
              {reportSentSuccess ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "220px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "rgba(34,197,94,0.1)",
                      border: "1px solid rgba(34,197,94,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6l2 2 5-5"
                        stroke="#22c55e"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h4
                    className="text-subsection-title"
                    style={{ color: "#22c55e", marginBottom: "var(--density-compact)" }}
                  >
                    Incident Ticket Transmitted
                  </h4>
                  <p
                    className="text-body-copy"
                    style={{ color: "#94a3b8", maxWidth: "280px", margin: 0 }}
                  >
                    Incident logged successfully. System telemetry bundle [ID: 8F9A2] has been
                    transmitted to proctoring staff. You may resume your exam.
                  </p>
                </div>
              ) : (
                <>
                  {/* Category choices */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[
                      { value: "camera_not_detected", label: "Camera not detected" },
                      { value: "internet_unstable", label: "Internet unstable" },
                      { value: "app_crashed", label: "App crashed" },
                      { value: "fullscreen_issue", label: "Fullscreen issue" },
                      { value: "audio_issue", label: "Audio issue" },
                      { value: "submission_issue", label: "Submission issue" },
                      { value: "other", label: "Other issue..." },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "10px 14px",
                          borderRadius: "8px",
                          background:
                            supportCategory === opt.value
                              ? "rgb(var(--accent-rgb) / 0.08)"
                              : "rgba(255,255,255,0.01)",
                          border: `1px solid ${supportCategory === opt.value ? "rgb(var(--accent-rgb) / 0.3)" : "rgba(255,255,255,0.05)"}`,
                          cursor: "pointer",
                          fontSize: "13px",
                          color: supportCategory === opt.value ? "#ffffff" : "#94a3b8",
                          transition: "all 150ms ease",
                        }}
                      >
                        <input
                          type="radio"
                          name="supportCategory"
                          value={opt.value}
                          checked={supportCategory === opt.value}
                          onChange={(e) => setSupportCategory(e.target.value)}
                          style={{
                            accentColor: "var(--color-accent-base)",
                            cursor: "pointer",
                          }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>

                  {supportCategory === "other" && (
                    <textarea
                      aria-label="Describe the issue in detail"
                      placeholder="Describe the issue in detail..."
                      value={customIssueDetail}
                      onChange={(e) => setCustomIssueDetail(e.target.value)}
                      spellCheck={false}
                      style={{
                        width: "100%",
                        height: "70px",
                        resize: "none",
                        background: "#0F0F0F",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                        fontFamily: "inherit",
                        outline: "2px solid transparent",
                      }}
                    />
                  )}

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                    <button
                      onClick={handleSendSupportReport}
                      disabled={
                        isSendingReport ||
                        (supportCategory === "other" && !customIssueDetail.trim())
                      }
                      style={{
                        flex: 1,
                        height: "38px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#f59e0b",
                        color: "#0F0F0F",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: isSendingReport ? "not-allowed" : "pointer",
                        transition: "all 200ms ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 4px 12px rgba(245,158,11,0.2)",
                      }}
                    >
                      {isSendingReport ? "Sending..." : "Submit report"}
                    </button>
                    <button
                      onClick={() => setShowSupportModal(false)}
                      disabled={isSendingReport}
                      style={{
                        height: "38px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "transparent",
                        color: "#94a3b8",
                        padding: "0 16px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "all 200ms ease",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Right Column: Auto Attached Telemetry Preview */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                borderLeft: "1px solid rgba(255,255,255,0.05)",
                paddingLeft: "32px",
                overflow: "hidden",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#22c55e",
                  }}
                />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#22c55e",
                    fontFamily: "Inter, system-ui, sans-serif",
                    letterSpacing: "0",
                  }}
                >
                  Attached diagnostics
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#0F0F0F",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
                  padding: "16px",
                  overflowY: "auto",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "10.5px",
                  color: "rgb(var(--accent-rgb) / 0.8)",
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(supportTelemetry, null, 2)}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .sr-only {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
        }
        @keyframes pulse-preview {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 1px solid rgb(var(--accent-rgb) / 0.3); outline-offset: 0; }
        textarea::-webkit-scrollbar { width: 6px; }
        textarea::-webkit-scrollbar-track { background: transparent; }
        textarea::-webkit-scrollbar-thumb { background: rgb(var(--accent-rgb) / 0.2); border-radius: 3px; }

        /* Problem description markdown */
        /* The marking scheme, in the statement. Restrictions are a gate —
           breaking one zeroes the problem — so they are the one thing here
           that is allowed to shout. */
        .pb-marking { margin: 28px 0 8px; padding-top: 18px; border-top: 1px solid var(--theme-border); max-width: 720px; }
        .pb-marking-title { font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--theme-text-muted); margin: 0 0 10px; }
        .pb-marking-note { font-size: 13px; color: var(--theme-text-muted); margin: 0; line-height: 1.6; }
        .pb-marking-list { margin: 0; padding-left: 18px; color: #cbd5e1; font-size: 13px; line-height: 1.8; }
        .pb-marking-weight { color: var(--theme-text-muted); }
        .pb-marking-gate { margin-top: 14px; border: 1px solid rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.06); border-radius: var(--radius-md); padding: 12px 14px; }
        .pb-marking-gate-title { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #fca5a5; margin: 0 0 8px; }
        .pb-marking-gate-list { margin: 0; padding-left: 18px; color: #fecaca; font-size: 13px; line-height: 1.75; }
        .pb-marking-gate-list code { background: rgba(0, 0, 0, 0.25); padding: 1px 5px; border-radius: 4px; }
        .pb-marking-gate-note { margin: 10px 0 0; font-size: 12.5px; color: #fca5a5; line-height: 1.6; }
        .pb-body { color: #cbd5e1; font-size: 14px; line-height: 1.7; }
        .pb-body-editorial { font-size: var(--text-base); line-height: 1.65; max-width: 720px; }
        .pb-body p { margin: 0 0 14px; }
        .pb-body h1,.pb-body h2,.pb-body h3,.pb-body h4 { color: #f1f5f9; font-family: Inter, system-ui, sans-serif; font-weight: 700; margin: 24px 0 10px; line-height: 1.28; letter-spacing: 0; }
        .pb-body h1 { font-size: 22px; } .pb-body h2 { font-size: 18px; } .pb-body h3 { font-size: 15px; }
        .pb-body strong { color: #f1f5f9; font-weight: 600; }
        .pb-body em { color: #a5b4fc; font-style: italic; }
        .pb-body code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 400; background: #1E1E24; color: #e4e4e7; padding: 1px 5px; border-radius: var(--radius-sm, 4px); border: 1px solid rgba(255,255,255,0.08); }
        .pb-body pre { background: #071124; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
        .pb-body pre code { background: none; border: none; padding: 0; color: #94a3b8; font-size: 12.5px; }
        .pb-sample-block { position: relative; margin: 14px 0; }
        .pb-sample-block pre { margin: 0; padding-top: 38px; }
        .pb-copy-button {
          position: absolute;
          top: 8px;
          right: 8px;
          height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          border: 1px solid rgba(148,163,184,0.16);
          background: rgba(15,23,42,0.82);
          color: #cbd5e1;
          font-family: Inter, system-ui, sans-serif;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .pb-copy-button:hover { border-color: rgb(var(--accent-rgb) / 0.35); color: #d8b4fe; }
        .pb-body ul,.pb-body ol { padding-left: 20px; margin: 0 0 12px; }
        .pb-body li { margin-bottom: 4px; color: #cbd5e1; }
        .pb-body a { color: var(--color-accent-base); text-decoration: underline; text-decoration-color: rgb(var(--accent-rgb) / 0.4); }
        .pb-body a:hover { color: var(--color-accent-light); }
        .pb-body img { max-width: 100%; border-radius: 8px; margin: 8px 0; border: 1px solid rgba(255,255,255,0.06); }
        .pb-body blockquote { border-left: 3px solid rgb(var(--accent-rgb) / 0.4); margin: 12px 0; padding: 4px 0 4px 14px; color: #94a3b8; }
        .pb-body hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 16px 0; }
        .pb-body table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
        .pb-body th,.pb-body td { border: 1px solid rgba(255,255,255,0.06); padding: 6px 10px; text-align: left; }
        .pb-body th { background: rgb(var(--accent-rgb) / 0.08); color: #e2e8f0; font-weight: 600; }
        /* KaTeX math — sized to flow with the 14px statement body. */
        .pb-body .katex { font-size: 1.05em; color: #e2e8f0; }
        .pb-body .katex-display { margin: 12px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
        .pb-body .pb-math-error { color: #fca5a5; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); }

        /* Interactive widgets embedded in <code> blocks — strip inline-code boxing */
        .pb-body code:has(div),
        .pb-body code:has(input),
        .pb-body code:has(button) {
          background: none; border: none; padding: 0; color: inherit; border-radius: 0; font-size: inherit;
        }
        /* Widget container: terminal-grade card */
        .pb-body code > div {
          background: #071124;
          border: 1px solid rgba(255,255,255,0.06);
          padding: 14px 16px;
          margin: 12px 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #94a3b8;
        }
        .pb-body code > div * { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: inherit; }
        /* Machine the range input into a 2px linear meter with a hard square thumb */
        .pb-body input[type="range"] {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 2px;
          background: rgba(255,255,255,0.08);
          border: none; cursor: pointer; margin: 10px 0; display: block;
        }
        .pb-body input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 10px; height: 10px;
          background: var(--color-accent-base); border-radius: 0; cursor: pointer;
        }
        .pb-body input[type="range"]::-moz-range-thumb {
          width: 10px; height: 10px;
          background: var(--color-accent-base); border-radius: 0; border: none; cursor: pointer;
        }
        .pb-body input[type="range"]::-webkit-slider-runnable-track { background: rgba(255,255,255,0.08); height: 2px; }
        /* Nested output spans inside widgets */
        .pb-body code > div span { color: #64748b; }
        .pb-body code > div span[id] { color: #c4b5fd; }
      `}</style>
    </div>
  );
}
