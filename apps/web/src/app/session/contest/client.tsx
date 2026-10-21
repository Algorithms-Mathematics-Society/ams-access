"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { ContestSponsor } from "@/components/ContestSponsor";
import { AppShell } from "@astryxdesign/core/AppShell";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Dialog } from "@astryxdesign/core/Dialog";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { TextArea } from "@astryxdesign/core/TextArea";
import {
  canNavigateDiagnostic,
  firstCompilerError,
  type DiagnosticNavigation,
} from "./compiler-diagnostics";
import { ContestOverlay } from "./components/ContestOverlay";
import { WorkspaceControls } from "./components/WorkspaceControls";
import { WorkspaceResizeHandle } from "./components/WorkspaceResizeHandle";
import { boundedPercent, parseQuestionMarks } from "./workspace-preferences";
import { CONTEST_STYLES } from "./components/workspace-styles";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke, type RestoreStatus } from "@ams/api-client";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import {
  clearQueryCache,
  fetchJson,
  postJsonKeepalive,
  SessionBindingError,
} from "@/lib/api-client";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { cameraSession, isTrackDelivering } from "@/lib/camera-session";
import { INTERVAL_MS, captureFrame } from "@/lib/identity-photo";
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
  attemptsForProblem,
  isPendingSubmissionStatus,
  isUiBlockingPending,
  normalizeAttemptForRunResult,
  normalizeSubmissionVerdict,
  shouldAutoExpandAttempt,
  type RunAttempt,
  type RunVerdict,
  type SubmissionAttemptRecord,
} from "./submission-state";
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
import { footerCameraStatus } from "./camera-status";
import { TopBar } from "./components/TopBar";
import { QuestionRail } from "./components/QuestionRail";
import { ProblemPane } from "./components/ProblemPane";
import { EditorPanel, type EditorFile } from "./components/EditorPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { CameraTile } from "./components/CameraTile";
import { deriveSaveIndicator } from "./save-indicator";
import { getSnapshot as getAppThemeSnapshot, useTheme } from "@/lib/theme";
import {
  connectionDraftAssurance,
  draftStatus,
  requestFinish,
  type SourceSnapshot,
} from "./contest-confidence";
import { deriveSubmitButton } from "./submit-button";
import { createDraftSaveQueue, restoreDraftWorkspace } from "./draft-workspace";
import { loadContestPaper } from "./load-contest-problems";
import { releaseCandidateQuestionAssets } from "./candidate-question-projection";
import { mergeAttemptTestResults, toAttemptRecords } from "./attempt-adapter";
import { flush as flushViolationQueue } from "@/lib/violation-queue";
import {
  activeContent,
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
  getRun,
  getSession,
  heartbeat,
  listMySubmissions,
  logout,
  run as runAgainstSamples,
  serverNow,
  startSession,
  submit as submitSolution,
  uploadIdentityPhoto,
} from "@/lib/proctor-api";
import { Info, ShieldCheck, Shield, Wifi, WifiOff, Save } from "lucide-react";
import {
  MAX_CUSTOM_CASES,
  type CustomCase,
  canRun as canRunCustom,
  newCase,
  toWire,
} from "./custom-cases";

const SUPPORT_CATEGORIES = [
  { value: "camera_not_detected", label: "Camera not detected" },
  { value: "internet_unstable", label: "Internet unstable" },
  { value: "app_crashed", label: "App crashed" },
  { value: "fullscreen_issue", label: "Fullscreen issue" },
  { value: "audio_issue", label: "Audio issue" },
  { value: "submission_issue", label: "Submission issue" },
  { value: "other", label: "Other issue" },
];

const API_URL = resolveApiBase();
const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;
const EDITOR_THEME_KEY = "ams_contest_editor_theme";
const PROBLEM_SPLIT_WIDTH_KEY = "ams_contest_problem_split_width";
const DEFAULT_EDITOR_THEME: ContestEditorThemeId = "ams-terminal";

// Autosave delay policy lives in ./autosave-timing (computeAutosaveDelayMs).
// Caps the interactive submit request so it cannot hang unbounded. 10s is
// comfortably above warm latency and well below "hung". Draft saving no longer
// uses this: it is a local write that cannot time out.
const SAVE_TIMEOUT_MS = 10_000;
// Automatic reloads after a retryable load failure (prestart 409, timeout,
// unreachable). Backoff doubles from 2 s to a 15 s cap; after this many the
// gate keeps its Retry button and stops polling on its own.
const MAX_AUTO_LOAD_RETRIES = 20;

function isContestEditorTheme(value: string | null): value is ContestEditorThemeId {
  return Boolean(value && CONTEST_EDITOR_THEMES.some((theme) => theme.id === value));
}

// Cmd shortcuts that leave the exam or open system UI. Mirrors the native key
// tap in platform-rs; every other Cmd combo (copy, paste, undo, find, select
// all...) must reach the editor. `code` is used because Shift changes `key`.
function isBlockedCmdShortcut(e: KeyboardEvent): boolean {
  if (["Tab", "Backquote", "KeyQ", "KeyW", "KeyH", "KeyM", "Space"].includes(e.code)) return true;
  if (e.altKey && ["Escape", "KeyD", "KeyI", "KeyJ", "KeyU"].includes(e.code)) return true;
  if (e.shiftKey && ["Digit3", "Digit4", "Digit5", "Digit6"].includes(e.code)) return true;
  return e.ctrlKey && e.code === "KeyF";
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
        availableMonitors: () => Promise<
          Array<{
            name: string | null;
            position: { x: number; y: number };
            size: { width: number; height: number };
            scaleFactor: number;
          }>
        >;
        getCurrentWindow: () => {
          setFullscreen: (v: boolean) => Promise<void>;
          /** macOS: full-screen without a Space of its own. Elsewhere the same as setFullscreen. */
          setSimpleFullscreen: (v: boolean) => Promise<void>;
          isFullscreen: () => Promise<boolean>;
          setAlwaysOnTop: (v: boolean) => Promise<void>;
          setDecorations: (v: boolean) => Promise<void>;
          setResizable: (v: boolean) => Promise<void>;
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

// The camera feed is proctoring, not media. WebKit treats a playing <video>
// with a microphone track as something to control: it offers play/pause on
// hover, in Now Playing and on the media keys. Pausing froze the frame the
// presence check samples, and the control then vanished because nothing was
// playing any more. No native controls, and any pause is undone at once.
function keepPlaying(video: HTMLVideoElement) {
  video.controls = false;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  if (video.dataset.keepPlaying) return;
  video.dataset.keepPlaying = "1";
  video.addEventListener("pause", () => {
    const stream = video.srcObject as MediaStream | null;
    if (stream?.getVideoTracks().some((track) => track.readyState === "live")) {
      void video.play().catch(() => {});
    }
  });
}

async function attachVideoStream(video: HTMLVideoElement, stream: MediaStream): Promise<boolean> {
  video.muted = true;
  video.playsInline = true;
  keepPlaying(video);
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

const RecoveryBannerRegion = motion.create(VStack);

export default function ContestPageClient() {
  const reduceMotion = useReducedMotion();
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
  const { theme: appTheme } = useTheme();
  const [editorThemeOverride, setEditorThemeOverride] = useState<ContestEditorThemeId | null>(null);
  const editorTheme =
    editorThemeOverride ?? (appTheme === "light" ? "monaco-light" : DEFAULT_EDITOR_THEME);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("C++17");
  const [problemPaneWidth, setProblemPaneWidth] = useState(35);
  const [outputHeightPercent, setOutputHeightPercent] = useState(34);
  const [editorFocused, setEditorFocused] = useState(false);
  const [markedQuestionIds, setMarkedQuestionIds] = useState<string[]>([]);
  const previousLayoutRef = useRef({ sidebarCollapsed: false, terminalCollapsed: false });
  const [diagnosticNavigation, setDiagnosticNavigation] = useState<DiagnosticNavigation | null>(
    null
  );
  const [runSourceSnapshot, setRunSourceSnapshot] = useState<
    | (SourceSnapshot & {
        questionId: string;
        fileId: string;
        filename: string;
        problemTitle?: string;
      })
    | null
  >(null);
  const [problemTab, setProblemTab] = useState<ProblemSectionKey>("statement");
  const [copiedSampleKey, setCopiedSampleKey] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<RunAttempt | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runMode, setRunMode] = useState<"all" | "custom">("all");
  const [runError, setRunError] = useState<string | null>(null);
  // Set when the judge hasn't returned a verdict within the polling window — the
  // submission is still queued (distinct from a hard connection error).
  const [runTimedOut, setRunTimedOut] = useState(false);
  // The candidate's own cases, per question. Local only, exactly like the
  // code itself -- there is no server copy of a draft any more, and a test
  // case someone typed is no more worth persisting than the code it tests.
  const [questionCustomCases, setQuestionCustomCases] = useState<Record<string, CustomCase[]>>({});
  // Attempt id of the most recent "Run on Judge" (sample-only) run. Used to pull
  // its per-test results out of `testResults` and render them LeetCode-style in
  // the run pane. RUN attempts are excluded from the submissions endpoint, so the
  // run pane above the attempts list is the only place their results surface.
  const [runResultAttemptId, setRunResultAttemptId] = useState<string | null>(null);
  // Kept synced via effect below so fetchSubmissions (a useCallback NOT keyed on
  // runResultAttemptId) can read the LIVE value instead of a stale closure.
  const runResultAttemptIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped to re-run the load effect: by the backoff timer, or by Retry.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadRetryable, setLoadRetryable] = useState(false);
  const autoLoadRetriesRef = useRef(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const latestActiveDraftRef = useRef<{
    questionId: string;
    fileId: string;
    source: string;
    language: string;
  } | null>(null);
  // Bumped on a failed save so the debounced autosave effect re-arms and retries
  // even when the candidate has stopped typing (e.g. a transient network blip).
  const [saveRetryNonce, setSaveRetryNonce] = useState(0);
  // Consecutive failed-save count, drives the exponential backoff in the autosave
  // In-flight guards so double-clicks / rapid retries can't fire a second POST to
  // /submissions while one is already pending (prevents duplicate QUEUED rows).
  const runInFlightRef = useRef(false);
  const runVisitRef = useRef(0);
  // True when the initial draft load failed. The autosave path re-seeds its
  // revision from the server's reply instead of assuming it starts at zero.
  // Problems whose editor was opened from this device's local buffer rather
  // than the server's draft, so the candidate can be told.
  const [restoredFromDevice, setRestoredFromDevice] = useState<string[]>([]);
  // Problems whose latest local write failed (quota, blocked storage). Their
  // only copy is the in-memory editor. The ref is read by the finish path,
  // which runs after awaits and would otherwise see a stale closure.
  const [unsavedOnDevice, setUnsavedOnDevice] = useState<string[]>([]);
  const unsavedOnDeviceRef = useRef<string[]>([]);
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
  // Presence is sampled and logged for the invigilator; it is deliberately
  // not held in state any more, because state is what gets rendered. See
  // camera health. Deliberately does NOT feed the block/grace-period above;
  // it only reflects the existing audit-tick's result (see the presence
  // monitor effect), so there is zero added inference cost.
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
  // macOS simple fullscreen draws the page under a MacBook notch, which hid
  // the countdown in the middle of the top bar. Keep the page below it; the
  // desktop reports 0 everywhere else, and a browser has no __TAURI__.
  const [topSafeInset, setTopSafeInset] = useState(0);
  useEffect(() => {
    const tauri = window.__TAURI__;
    if (!tauri) return;
    const measure = () => {
      void tauri.core
        .invoke<number>("get_top_safe_inset")
        .then((inset) => setTopSafeInset(inset > 0 ? inset : 0))
        .catch(() => {});
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  // Set once the exam is over: no retry or reconnect may reopen the camera.
  const cameraClosedRef = useRef(false);
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
  const [supportReportError, setSupportReportError] = useState<string | null>(null);
  // Local acknowledgements only: no organizer read/reply status is inferred.
  const [sentReports, setSentReports] = useState<
    Array<{ sessionId: string; category: string; sentAt: string }>
  >([]);
  const supportInFlightRef = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lockGraceActive, setLockGraceActive] = useState(false);
  const [lockGraceCountdown, setLockGraceCountdown] = useState(3);
  const [cameraCollapsed, setCameraCollapsed] = useState(true);
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
  // Deferred terminal-collapse feature. Shrink-to-tab-strip; the editor (flex:1) reclaims the
  // freed height automatically. Output is NEVER silently hidden on the exam: auto-expand is the
  // primary guarantee, the unread dot is the fallback. All of this only READS run state — the
  // three renderers, isRunSubmission, and the run/submit handlers are untouched.
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalUnread, setTerminalUnread] = useState(false);
  const terminalCollapsedRef = useRef(false);
  const lastResultExpandIdRef = useRef<string | null>(null);
  const lastResultStatusRef = useRef<string | null>(null);
  const prevSubmittingRef = useRef(false);
  const [allSubmissionsList, setAllSubmissionsList] = useState<SubmissionAttemptRecord[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionHistoryStatus, setSubmissionHistoryStatus] = useState<
    "loading" | "available" | "unavailable" | "stale"
  >("loading");
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
  // Leaving the page cancels any run poll still waiting on the judge.
  useEffect(
    () => () => {
      runVisitRef.current += 1;
    },
    []
  );
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
  // Settings a finished exam could not put back; shown on the end screen.
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus | null>(null);
  const redirectInFlightRef = useRef(false);
  const redirectSaveRef = useRef(writeLocalAnswerBuffer);
  redirectSaveRef.current = writeLocalAnswerBuffer;
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [submittedSources, setSubmittedSources] = useState<Record<string, SourceSnapshot>>({});
  const [dismissedRecoveryQuestions, setDismissedRecoveryQuestions] = useState<string[]>([]);
  const [finalDraftSaved, setFinalDraftSaved] = useState(false);
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
          void redirectAfterRelease(
            `/session/onboarding?contestId=${encodeURIComponent(contestId)}`
          );
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
      // One list, unfiltered. The per-problem view is derived from it below
      // rather than stored: a stored copy is written by whichever fetch
      // resolves last, and fetches outlive the problem they were started for.
      // Submit on A (which arms a 2s poll), switch to B, and A's reply would
      // land and repaint B's Attempts panel with A's history.
      const attempts = toAttemptRecords(await listMySubmissions(sessionId));
      setAllSubmissionsList(attempts);
      // Each list response already contains the per-case results. Refresh the
      // cache as pending attempts complete, preserving separately polled runs.
      setTestResults((previous) => mergeAttemptTestResults(previous, attempts));
      setSubmissionHistoryStatus("available");
      // Nothing here refreshes the run panel any more. This list excludes
      // runs by construction — the server filters on `mode` — so searching it
      // for the run's own row could only ever miss. Runs are polled by uid
      // through `getRun` in `triggerRun`, which is the only place that can
      // see them.
    } catch (err) {
      setSubmissionHistoryStatus((prev) =>
        prev === "available" || prev === "stale" ? "stale" : "unavailable"
      );
      console.error("Failed to fetch submissions:", err);
    } finally {
      setLoadingSubmissions(false);
    }
  }, [sessionId, activeQ, questions]);

  /**
   * The active problem's attempts, newest first.
   *
   * Derived, so it cannot disagree with the problem on screen. The old stored
   * version needed a `submissionsListQId` beside it to say which problem it
   * described — and that guard was only ever consulted by the Submit button,
   * never by the panel that rendered the rows.
   */
  const activeQLabel = questions[activeQ]?.id ?? "";
  const submissionsList = useMemo(
    () => attemptsForProblem(allSubmissionsList, activeQLabel),
    [allSubmissionsList, activeQLabel]
  );

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

  const toggleExpandAttempt = (attemptId: string) => {
    if (expandedAttemptId === attemptId) {
      setExpandedAttemptId(null);
    } else {
      setExpandedAttemptId(attemptId);
    }
  };

  const prevSubmissionsRef = useRef<SubmissionAttemptRecord[]>([]);
  useEffect(() => {
    if (submissionsList.length > 0) {
      const latest = submissionsList[0];
      const prevLatest = prevSubmissionsRef.current[0];
      if (shouldAutoExpandAttempt(latest, prevLatest)) {
        setExpandedAttemptId(latest.id);
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
        message: detail,
        diagnostics: {
          timestamp,
          contest_id: contestId,
          session_id: sessionId ?? "unregistered",
          media: type,
          enabled,
        },
        contact: "",
        contest_uid: contestId,
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
      // Without a live audio track (denied, or no device) the microphone
      // cannot be on — never report or audit-log a state that isn't real.
      const hasLiveAudio = cameraStreamRef.current
        ?.getAudioTracks()
        .some((t) => t.readyState === "live");
      // macOS only; other platforms keep the previous toggle behavior.
      if (value && !hasLiveAudio && /Mac/i.test(navigator.userAgent)) return;
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

  const cancelMediaToggle = useCallback(() => {
    setShowMediaToggleWarning(false);
    setPendingMediaToggle(null);
  }, []);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(EDITOR_THEME_KEY);
      // Light-mode entry takes precedence over a previous dark editor choice.
      // Read the applied theme directly: hydration initially reports dark.
      if (
        isContestEditorTheme(storedTheme) &&
        (getAppThemeSnapshot() !== "light" || storedTheme === "monaco-light")
      ) {
        setEditorThemeOverride(storedTheme);
      }
    } catch {
      /* Without storage, the editor follows the app theme. */
    }
  }, []);

  useEffect(() => {
    try {
      setProblemPaneWidth(
        boundedPercent(
          localStorage.getItem(`${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`),
          35,
          28,
          52
        )
      );
      setOutputHeightPercent(
        boundedPercent(localStorage.getItem(`ams_contest_output_height:${contestId}`), 34, 18, 55)
      );
    } catch {
      /* Layout preferences must never block a contest. */
    }
  }, [contestId]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      setMarkedQuestionIds(
        parseQuestionMarks(localStorage.getItem(`ams_contest_marks:${sessionId}`))
      );
    } catch {
      setMarkedQuestionIds([]);
    }
  }, [sessionId]);

  const toggleQuestionMark = useCallback(
    (id: string) => {
      if (!sessionId) return;
      const next = markedQuestionIds.includes(id)
        ? markedQuestionIds.filter((item) => item !== id)
        : [...markedQuestionIds, id];
      setMarkedQuestionIds(next);
      try {
        localStorage.setItem(`ams_contest_marks:${sessionId}`, JSON.stringify(next));
      } catch {
        /* Keep the in-memory mark. */
      }
    },
    [sessionId, markedQuestionIds]
  );

  function handleEditorThemeChange(value: string) {
    if (isContestEditorTheme(value) === false) return;
    setEditorThemeOverride(value);
    try {
      localStorage.setItem(EDITOR_THEME_KEY, value);
    } catch {
      /* In-memory preference still applies. */
    }
    setThemeMenuOpen(false);
  }

  function updateProblemWidth(value: number) {
    setProblemPaneWidth(value);
  }
  function updateOutputHeight(value: number) {
    setOutputHeightPercent(value);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          `${PROBLEM_SPLIT_WIDTH_KEY}:${contestId || "default"}`,
          String(problemPaneWidth)
        );
        localStorage.setItem(`ams_contest_output_height:${contestId}`, String(outputHeightPercent));
      } catch {}
    }, 200);
    return () => window.clearTimeout(timer);
  }, [contestId, problemPaneWidth, outputHeightPercent]);
  function toggleEditorFocus() {
    if (editorFocused) {
      setSidebarCollapsed(previousLayoutRef.current.sidebarCollapsed);
      setTerminalCollapsed(previousLayoutRef.current.terminalCollapsed);
    } else {
      previousLayoutRef.current = { sidebarCollapsed, terminalCollapsed };
      setSidebarCollapsed(true);
      setTerminalCollapsed(true);
    }
    setEditorFocused((value) => !value);
  }
  function resetWorkspaceLayout() {
    setEditorFocused(false);
    setSidebarCollapsed(false);
    setTerminalCollapsed(false);
    updateProblemWidth(35);
    updateOutputHeight(34);
  }
  function navigateWorkspace(region: "problem" | "code" | "output") {
    if (region === "problem" && editorFocused) {
      setEditorFocused(false);
      setSidebarCollapsed(previousLayoutRef.current.sidebarCollapsed);
      setTerminalCollapsed(previousLayoutRef.current.terminalCollapsed);
    }
    if (region === "output") setTerminalCollapsed(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const selector =
          region === "problem"
            ? ".contest-problem-pane"
            : region === "code"
              ? ".cm-content"
              : "#contest-output-body";
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) return;
        target.scrollIntoView({ block: "start", behavior: "instant" });
        if (region !== "code") target.tabIndex = -1;
        target.focus({ preventScroll: true });
      })
    );
  }

  const handleProblemBodyClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
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
  }, []);

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
    if (supportInFlightRef.current) return;
    if (!sessionId) {
      setSupportReportError("No active session is available. Ask an invigilator for help.");
      return;
    }
    supportInFlightRef.current = true;
    setIsSendingReport(true);
    setSupportReportError(null);
    setReportSentSuccess(false);
    try {
      const response = await postJsonKeepalive(
        `${API_URL}/participant/sessions/${sessionId}/incidents`,
        {
          category: supportCategory,
          message: customIssueDetail.trim(),
          diagnostics: supportTelemetry,
          contact: "",
          contest_uid: contestId,
        },
        { headers: authHeaders() },
        { timeoutMs: 10000 }
      );
      if (!response.ok) throw new Error("Report not acknowledged");
      setSentReports((reports) =>
        [
          { sessionId, category: supportCategory, sentAt: new Date().toISOString() },
          ...reports,
        ].slice(0, 10)
      );
      setReportSentSuccess(true);
    } catch {
      setSupportReportError(
        "Could not confirm your report was sent. Your details are still here. Retry, or ask an invigilator for help."
      );
    } finally {
      supportInFlightRef.current = false;
      setIsSendingReport(false);
    }
  }

  const closeSupport = useCallback(() => {
    if (supportInFlightRef.current) return;
    setShowSupportModal(false);
    setSupportReportError(null);
    if (reportSentSuccess) {
      setReportSentSuccess(false);
      setSupportCategory("camera_not_detected");
      setCustomIssueDetail("");
    }
  }, [reportSentSuccess]);

  // stable fallback so useCountdown's effect doesn't restart on every render
  // Whether any server clock answer has arrived. Distinguishes "no deadline"
  // from "no answer yet" — both leave endsAtMs null, and conflating them
  // showed a practice contest a broken-looking clock for its whole duration.
  const [clockSynced, setClockSynced] = useState(false);

  // The clock, straight from the server. There is deliberately no fallback:
  // a fabricated deadline renders identically to a real one, and the previous
  // "one hour from page load" default was what every candidate actually got,
  // because the contest metadata came from a staff route that 403s.
  const clock: ClockSnapshot = useMemo(
    () => ({
      endsAtMs: contest?.end_at ? Date.parse(contest.end_at) : null,
      phase: contestPhase,
      // Only once the server has actually answered. Before that a null
      // deadline means "not told yet", and calling that untimed would show a
      // candidate "No time limit" on a contest that has one.
      untimed: clockSynced && !contest?.end_at,
    }),
    [contest?.end_at, contestPhase, clockSynced]
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
        allowed_languages: ["C++17", "Python3"],
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
      void redirectAfterRelease("/login");
      return;
    }

    const abortController = new AbortController();
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Server phase from the session read, so a 409 after the end is not
    // mistaken for "not started yet" and polled for nothing.
    let livePhase: string | null = null;
    // A state the candidate can wait out: show it, offer Retry, and reload on
    // a bounded backoff so the page really does let them in.
    const failRetryable = (message: string) => {
      setLoadError(message);
      setLoadRetryable(true);
      setLoading(false);
      if (autoLoadRetriesRef.current >= MAX_AUTO_LOAD_RETRIES) return;
      const delay = Math.min(2000 * 2 ** autoLoadRetriesRef.current, 15_000);
      autoLoadRetriesRef.current += 1;
      retryTimer = setTimeout(() => setLoadAttempt((n) => n + 1), delay);
    };

    // The room does not create sessions. Onboarding does, because it is the
    // only place that can attest the lockdown engaged first — a session
    // minted here would be one that never passed a check. This *adopts* what
    // onboarding wrote, and sends anyone without one back to get checked.
    let loadedObjectUrls: string[] = [];

    const stored = readStoredSession();
    if (!stored || stored.contest_id !== contestId) {
      void redirectAfterRelease(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
      return;
    }

    (async () => {
      // `getSession` validates ownership server-side — someone else's session
      // is a 404, not a 403 — and syncs the clock offset as a side effect.
      let live = await getSession(stored.id);
      if (disposed) return;
      livePhase = live.phase;

      if (live.status === "submitted" || live.status === "terminated") {
        // Finished. Re-entering needs an invigilator, and that lives on /home.
        await redirectAfterRelease("/home");
        return;
      }

      const { index, questions } = await loadContestPaper(contestId);
      if (disposed) return;
      if (live.status === "pending" && index.phase === "running") {
        // Created during verification and never activated: heartbeat does not
        // promote it, and run/submit refuse a pending session. Re-open it —
        // the same idempotent POST onboarding uses, with the server's own
        // eligibility checks — now that the server says the clock started.
        live = await startSession({ contestUid: contestId });
        if (disposed) return;
        if (live.status === "pending") throw new Error("Session is not active yet.");
      }
      // Held for the cleanup below. Blob URLs are document references the
      // browser keeps alive until revoked explicitly, not garbage-collected
      // values.
      loadedObjectUrls = questions.flatMap((question) =>
        (question.cxxprobe?.assets ?? []).map((asset) => asset.object_url).filter(Boolean)
      );

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
      // `Date.parse(null)` is NaN, which compares false against everything and
      // would have quietly meant "never rings" — right answer, no reasoning.
      // A practice contest has no end, so it has no bell, and saying so
      // explicitly is what keeps that true if the comparison ever changes.
      setClockSynced(true);
      setBellRung(
        isBell(
          { endsAtMs: index.ends_at ? Date.parse(index.ends_at) : null, phase: index.phase },
          serverNow()
        )
      );
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
      // No server drafts: work is local only. `restoreDraftWorkspace` and
      // `chooseRestore` already handle a null server copy by taking the
      // buffer, so this is the path they were written for.
      const restoredFiles: Record<string, EditorFile[]> = {};
      const restoredActiveFiles: Record<string, string> = {};
      // A first offline draft may have no server row at all. Enumerate the paper.
      for (const question of questions) {
        const buffered = readAnswerBuffer(localStorage, live.uid, question.id);
        draftRevisionsRef.current[question.id] = buffered?.revision ?? 0;
        const workspace = restoreDraftWorkspace(
          question.id,
          question.starter_filename ?? questionFileName(question, "C++23"),
          buffered,
          null
        );
        if (workspace) {
          restoredFiles[question.id] = workspace.files;
          restoredActiveFiles[question.id] = workspace.activeFileId;
          answersMap[question.id] = {
            language: workspace.language,
            content:
              workspace.files.find((file) => file.id === workspace.activeFileId)?.content ??
              workspace.files[0]?.content ??
              "",
          };
          if (workspace.recovered) restored.push(question.id);
        }
      }
      setQuestionFiles(restoredFiles);
      setQuestionActiveFile(restoredActiveFiles);
      setSavedAnswers(answersMap);
      setRestoredFromDevice(restored);
      if (restored.length) setHasUnsavedChanges(true);

      setActiveQ(0);
      setQuestions(questions);
      if (questions.length > 0) {
        loadQuestionWithAnswers(questions[0], answersMap, "C++23");
        setLoadError(null);
        autoLoadRetriesRef.current = 0;
      } else {
        failRetryable("Questions are not available yet. Please retry in a few seconds.");
      }
      setLoading(false);
    })().catch((error) => {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
      if (error instanceof ProctorApiError && error.status === 401) {
        void redirectAfterRelease("/login");
        return;
      }
      if (error instanceof SessionBindingError) {
        void redirectAfterRelease("/home");
        return;
      }
      if (error instanceof ProctorApiError && error.status === 404) {
        // The stored session is gone or was never ours. Go and get a real one.
        void redirectAfterRelease(`/session/onboarding?contestId=${encodeURIComponent(contestId)}`);
        return;
      }
      if (error instanceof ProctorApiError && error.status === 409 && livePhase === "ended") {
        setLoadError("This contest has ended.");
        setLoadRetryable(false);
        setLoading(false);
        return;
      }
      if (error instanceof ProctorApiError && error.status === 409) {
        // The paper is not open yet — the contest is inside its verification
        // window. That is a state, not a failure.
        failRetryable("The contest has not started yet. This page will let you in when it does.");
        return;
      }
      if (error instanceof ProctorApiError && error.isPermanent) {
        // Auth and other refusals: retrying will not change the answer.
        setLoadError("Unable to load contest. Return to your contest list and try again.");
        setLoadRetryable(false);
        setLoading(false);
        return;
      }
      failRetryable("Unable to load contest. Check connection and retry.");
    });

    return () => {
      disposed = true;
      abortController.abort();
      if (retryTimer) clearTimeout(retryTimer);
      // Statement images are held as blob URLs, which the browser keeps alive
      // until they are revoked explicitly — a document reference, not a
      // garbage-collected one. `releaseCandidateQuestionAssets` existed and
      // had no caller, so every diagram in every problem would have stayed
      // resident for the life of the window.
      releaseCandidateQuestionAssets(loadedObjectUrls);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId, loadAttempt]);

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
    runVisitRef.current += 1;
    setRunSourceSnapshot(null);
    setRunResult(null);
    setRunResultAttemptId(null);
    setRunError(null);
    setRunTimedOut(false);
  }

  function switchQuestion(idx: number) {
    runInFlightRef.current = false;
    setIsRunning(false);
    if (questions[activeQ] && sessionId) {
      handleSave();
    }
    setActiveQ(idx);
    if (!editorLocked) setHasUnsavedChanges(true);
    loadQuestion(questions[idx], selectedLanguage);
    resetRunPanelState();
  }

  // Stable child prop, while question switching still saves the latest draft.
  const switchQuestionRef = useRef(switchQuestion);
  switchQuestionRef.current = switchQuestion;
  const onSwitchQuestion = useCallback((idx: number) => switchQuestionRef.current(idx), []);

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
    const qId = questions[activeQ]?.id ?? "";
    const currentActiveId = questionActiveFile[qId] ?? questionFiles[qId]?.[0]?.id ?? "";
    setQuestionFiles((prev) => ({
      ...prev,
      [qId]: (prev[qId] ?? []).map((f) =>
        f.id === currentActiveId ? { ...f, content: value } : f
      ),
    }));
  }

  // `casesOverride` exists because this reads `customCases` out of the render
  // closure. A caller that has just queued a state update — "run this sample
  // as my own" does exactly that — would otherwise send the list as it was
  // before its own case was added.
  async function triggerRun(useCustomCases = false, casesOverride?: CustomCase[]) {
    if (!questions[activeQ] || !sessionId || isRunning) return;
    // In-flight guard: block a second POST while one is already pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (runInFlightRef.current) return;
    runInFlightRef.current = true;

    setRunMode(useCustomCases ? "custom" : "all");
    setIsRunning(true);
    resetRunPanelState();
    const runVisit = runVisitRef.current;
    setSubmitError(null);

    // Persist the current code before dispatching to the judge. A failed
    // device write is surfaced by the draft status; it does not block a run,
    // which sends the source to the judge directly.
    await handleSave();
    if (runVisit !== runVisitRef.current) return;

    // Dispatch the run. Unscored, judged against the samples only, and at a
    // higher priority than submissions — feedback that arrives after the
    // contest is not feedback.
    let attemptId: string;
    try {
      setRunSourceSnapshot({
        fileId: activeFileId,
        questionId: questions[activeQ].id,
        problemTitle: questions[activeQ].title,
        filename: activeFile?.name ?? "main.cpp",
        source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
        language: toLanguageId(selectedLanguage),
      });
      const created = await runAgainstSamples(sessionId, {
        problemLabel: questions[activeQ].id,
        language: toLanguageId(selectedLanguage),
        source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
        // Only when the candidate pressed Run Custom. An ordinary Run must
        // send nothing here, or the samples are never reached.
        customCases: useCustomCases ? toWire(casesOverride ?? customCases) : null,
      });
      if (runVisit !== runVisitRef.current) return;
      const resolvedId = created.uid;
      attemptId = resolvedId;
      setRunResult({ id: resolvedId, attempt_no: 0, status: "QUEUED" });
      setRunResultAttemptId(resolvedId);
    } catch (caught) {
      if (runVisit !== runVisitRef.current) return;
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
      if (runVisit === runVisitRef.current) runInFlightRef.current = false;
    }

    // Poll for the result with exponential back-off (max ~87 s total).
    //
    // The old ladder gave up after 23.1 s, which a custom run routinely
    // outlives: it compiles the submission, compiles the IO checker when any
    // case declares expected output, and starts up to MAX_CUSTOM_CASES (20)
    // sandboxes -- all behind a queue poll, under contest load. The worker is
    // allowed 300 s. So the judge finished and the answer was simply never
    // collected, which read to a candidate as "no output".
    //
    // The tail is spaced at 6 s rather than extending the fast steps: a
    // thousand candidates polling at once is load on the API, and past the
    // first few seconds another request a second buys nothing.
    await pollRun(
      sessionId,
      attemptId,
      runVisit,
      [
        600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3500, 4000, 4000, 5000, 5000, 5000,
        5000, 6000, 6000, 6000, 6000, 6000, 6000,
      ]
    );
  }

  // Polls one run by uid until it has a verdict or `delays` runs out. Out of
  // budget is not the end of the run: it stays identified by
  // runResultAttemptId, and "Check again" (recheckRun) resumes polling it.
  async function pollRun(sessionId: string, attemptId: string, runVisit: number, delays: number[]) {
    for (const ms of delays) {
      await new Promise<void>((r) => setTimeout(r, ms));
      if (runVisit !== runVisitRef.current) return;
      try {
        // The run is polled by its own uid, not by scanning the submission
        // list: the list deliberately excludes runs, so it never contained
        // the thing being waited for.
        const polled = await getRun(sessionId, attemptId);
        if (runVisit !== runVisitRef.current) return;
        const attempt = toAttemptRecords([polled])[0];
        if (attempt) {
          const normalized = normalizeAttemptForRunResult(attempt);
          setRunResult(normalized);
          if (!isPendingSubmissionStatus(normalized.status)) {
            setIsRunning(false);
            // Verdict, sample results and any compiler messages all render in the
            // run pane; a run is never a row in the attempts list below it.
            // Run records carry their own results. The submissions endpoint
            // excludes runs, so it cannot supply this attempt's sample output.
            setTestResults((prev) => ({ ...prev, [attemptId]: polled.testcases ?? [] }));
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
    // The timed-out state stays visible in the run pane — the run is never an
    // attempts row to navigate to.
  }

  // Status-only re-poll of the run that timed out. Never POSTs a new run, so a
  // congested judge isn't handed a duplicate job. A new run or a question
  // switch bumps runVisitRef, which cancels this like the original poll.
  function recheckRun() {
    const attemptId = runResultAttemptIdRef.current;
    if (!sessionId || !attemptId || isRunning) return;
    setRunTimedOut(false);
    setIsRunning(true);
    void pollRun(sessionId, attemptId, runVisitRef.current, [0, 2000, 4000]);
  }

  // Persist the current editor content locally. Storage failures (quota,
  // private mode) must never throw into the save/submit/exit paths, but they
  // are returned and recorded: this buffer is the only copy of the draft.
  //
  // Unlike before, this is *read back* — see `restoreAnswer` in the bootstrap.
  // It previously wrote a key nothing consulted, while the UI told candidates
  // their work was saved locally.
  function writeLocalAnswerBuffer(): boolean {
    if (!sessionId) return false;
    const qId = questions[activeQ]?.id;
    if (!qId) return false;
    const saved = writeAnswerBuffer(localStorage, sessionId, qId, {
      language: toLanguageId(selectedLanguage),
      // Every tab, not just the active one. Scratch tabs were persisted
      // nowhere at all — not locally and not on the server, which only ever
      // receives the active file.
      files: editorFiles,
      activeFileId,
      savedAtMs: Date.now(),
      revision: draftRevisionsRef.current[qId] ?? 0,
    });
    const previous = unsavedOnDeviceRef.current;
    if (previous.includes(qId) === saved) {
      const next = saved ? previous.filter((id) => id !== qId) : [...previous, qId];
      unsavedOnDeviceRef.current = next;
      setUnsavedOnDevice(next);
    }
    return saved;
  }

  function clearLocalAnswerBuffer(questionId: string) {
    if (!sessionId) return;
    clearAnswerBuffer(localStorage, sessionId, questionId);
  }

  // Work lives on the device only.
  //
  // Drafts used to be PUT to the server on a debounce, with a revision
  // counter, an exponential-backoff retry, and a visible failure banner. All
  // of it is gone: the local buffer is written on every change and read back
  // on restart, so a crash or reload recovers the code without the network
  // being involved at all.
  //
  // What that costs is honest: work does not follow the candidate to another
  // machine, and clearing site data loses it. What it buys is that a flaky
  // connection can no longer put "Save failed — retry before submitting" in
  // front of someone mid-contest about code that was never actually at risk.
  async function doSave(): Promise<boolean> {
    if (!questions[activeQ] || !sessionId) return false;
    const qId = questions[activeQ].id;
    // A failed write leaves the work dirty: nothing durable holds it.
    if (!writeLocalAnswerBuffer()) return false;
    setSavedAnswers((prev) => ({
      ...prev,
      [qId]: {
        language: toLanguageId(selectedLanguage),
        content: editorFiles.find((f) => f.id === activeFileId)?.content || "",
      },
    }));
    setHasUnsavedChanges(false);
    return true;
  }

  // Capture this render's immutable question/file/source closure at request time.
  // Reading a live ref only when a deferred job starts loses the outgoing
  // question if navigation happens while another save is in flight.
  const saveQueueRef = useRef<ReturnType<typeof createDraftSaveQueue> | null>(null);
  if (!saveQueueRef.current) saveQueueRef.current = createDraftSaveQueue();
  function handleSave(): Promise<boolean> {
    writeLocalAnswerBuffer();
    return saveQueueRef.current!(`${sessionId}:${questions[activeQ]?.id ?? ""}`, doSave);
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

    try {
      const qId = questions[activeQ].id;
      const submittedSource = {
        source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
        language: toLanguageId(selectedLanguage),
      };
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

      setSubmittedSources((prev) => ({ ...prev, [created.uid]: submittedSource }));
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
  async function runExitTeardown(preserveSession = false): Promise<boolean> {
    let released = true;
    try {
      // Remember which session this was before dropping it. The results
      // screen opens after this runs and has nothing else to go on.
      if (!preserveSession) {
        const finished = localStorage.getItem(ACTIVE_SESSION_KEY);
        if (finished) localStorage.setItem(STORAGE_KEYS.LAST_SESSION, finished);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {
      // ignore storage errors
    }
    // The exit frame, taken while there is still a camera to take it from:
    // everything below this releases the stream. Awaited rather than fired
    // and forgotten, because the teardown that follows removes the only
    // source it could come from -- but it cannot fail the exit, so the
    // failure path is a shrug.
    await exitPhotoRef.current();

    // The one place the camera is genuinely finished with: the exam is over
    // and the candidate is leaving the locked-down shell.
    cameraClosedRef.current = true;
    try {
      cameraSession.release();
    } catch {
      released = false;
    }
    cameraStreamRef.current = null;
    setCameraStream(null);
    try {
      const win = window.__TAURI__?.window.getCurrentWindow();
      if (win) {
        await withTimeout(win.setFullscreen(false), 5000, "Window release timed out").catch(() => {
          released = false;
        });
        await withTimeout(win.setAlwaysOnTop(false), 5000, "Window release timed out").catch(() => {
          released = false;
        });
        await withTimeout(win.setDecorations(true), 5000, "Window release timed out").catch(() => {
          released = false;
        });
      }
    } catch {
      released = false;
    }
    // Even if the native unlock fails, the window chrome above is already
    // restored. What must not happen is leaving quietly: a candidate whose
    // trackpad gestures did not come back is told which settings, and how to
    // fix them, on the screen they see next.
    let unlockFailed = false;
    try {
      if (window.__TAURI__) {
        await withTimeout(
          window.__TAURI__.core.invoke("unlock_desktop"),
          10000,
          "Device release timed out"
        );
      }
    } catch {
      unlockFailed = true;
    }
    // The network lockdown (macOS PF / firewall allowlist) is released apart
    // from the desktop, and the restore status below does not track it.
    let networkFailed = false;
    try {
      if (window.__TAURI__) {
        await withTimeout(
          window.__TAURI__.core.invoke("disable_network_lockdown"),
          10000,
          "Network release timed out"
        );
      }
    } catch {
      networkFailed = true;
    }
    const status = window.__TAURI__
      ? await withTimeout(
          window.__TAURI__.core.invoke<RestoreStatus>("get_lockdown_restore_status"),
          5000,
          "Restore status timed out"
        ).catch(() => null)
      : null;
    if (status?.pending || unlockFailed || networkFailed || (window.__TAURI__ && status === null)) {
      setRestoreStatus(status?.pending ? status : { pending: true, items: status?.items ?? [] });
      released = false;
    } else {
      setRestoreStatus(null);
    }
    return released;
  }

  // Redirects release native controls without finishing the exam or removing
  // its recovery record. Revoke upload credentials while retaining the native
  // recording binding, so teardown evidence remains with the same session.
  async function redirectAfterRelease(destination: string) {
    if (redirectInFlightRef.current || exitInFlightRef.current) return;
    redirectInFlightRef.current = true;
    setPendingRedirect(destination);
    setLoadError(null);
    if (destination === "/login") {
      logout();
      clearQueryCache();
    }
    let revoked = true;
    try {
      try {
        redirectSaveRef.current();
      } catch {
        // Storage failures must never prevent releasing native controls.
      }
      try {
        if (window.__TAURI__) {
          await withTimeout(
            window.__TAURI__.core.invoke("configure_event_stream", {
              apiUrl: "",
              sessionId: null,
              token: null,
              preserveBinding: true,
            }),
            5000,
            "Credential cleanup timed out"
          );
        }
      } catch {
        revoked = false;
      }
      const released = await runExitTeardown(true);
      if (released && revoked) {
        router.replace(destination);
      } else {
        setLoadError(
          "Device cleanup could not be confirmed. Your saved work and session recovery are kept. Retry cleanup before continuing; ask an invigilator if device controls remain restricted."
        );
      }
    } finally {
      redirectInFlightRef.current = false;
    }
  }

  // A finish acknowledgement and a draft-save acknowledgement are separate.
  // Retry is bounded; teardown still runs on failure so nobody is trapped.
  async function handleSubmitConfirmed() {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setSubmitConfirm(false);
    setShowSupportModal(false);
    setSubmitError(null);
    setSubmitWarning(null);
    setTimeUpState("submitting");
    const receipt = sessionId
      ? await requestFinish({
          save: handleSave,
          finish: () =>
            postJsonKeepalive(
              `${API_URL}/participant/sessions/${sessionId}/finish`,
              undefined,
              { headers: authHeaders() },
              { timeoutMs: 10000 }
            ),
          wait: (attempt) =>
            new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                Math.min(1500 * 2 ** attempt, 8000) + Math.round(Math.random() * 400)
              )
            ),
        })
      : { confirmed: false, draftSaved: false };
    const draftSaved = receipt.draftSaved && unsavedOnDeviceRef.current.length === 0;
    setFinalDraftSaved(draftSaved);
    if (!draftSaved)
      setSubmitWarning(
        "The latest draft could not be saved on this device. Previously acknowledged submissions are separate from draft saves."
      );
    try {
      await runExitTeardown();
    } finally {
      setTimeUpState(receipt.confirmed ? "submitted" : "error");
    }
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

  // CountdownBadge can stay memoized without capturing an outdated save handler.
  const expiryHandlerRef = useRef(handleContestExpiry);
  expiryHandlerRef.current = handleContestExpiry;
  const onContestExpiry = useCallback(() => expiryHandlerRef.current(), []);

  // Leaving the contest room by any route ends the exam's use of the camera.
  // The submit teardown releases it too, but a redirect (session already
  // finished, sign-in expired) left the camera light on.
  useEffect(() => () => cameraSession.release(), []);

  // Claim the system media controls (Now Playing, media keys) so they cannot
  // pause the camera feed.
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session) return;
    const actions: MediaSessionAction[] = ["play", "pause", "stop"];
    for (const action of actions) {
      try {
        session.setActionHandler(action, () => {});
      } catch {
        // An action this WebKit does not support.
      }
    }
    return () => {
      for (const action of actions) {
        try {
          session.setActionHandler(action, null);
        } catch {}
      }
    };
  }, []);

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
      if (cameraClosedRef.current) return;
      try {
        // Through the shared session, so the track onboarding already opened
        // is adopted rather than the device being closed and reopened across
        // the navigation. On a webcam slow to hand its handle back, that
        // second open is what surfaced as NotReadableError — a candidate
        // arriving at the contest with a dead camera that had worked a minute
        // earlier, and a message telling them to check their settings.
        const stream = await withTimeout(
          cameraSession.ensure({ audio: true }),
          8000,
          "Camera request timed out"
        );
        if (cancelled) return;

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
        if (cancelled || cameraClosedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        // `NotFound` belongs here. A camera unplugged mid-exam fails the
        // retry with NotFoundError, which was not in this list, so the one
        // scheduled attempt gave up and monitoring stayed down until the
        // candidate reloaded — behind a soft-block overlay with no button.
        // Retrying costs nothing: permission is already granted, so a failed
        // open is silent, and `cameraSession` reopens on replug anyway.
        const shouldRetry =
          attempt < 2 &&
          (msg.includes("NotReadable") ||
            msg.includes("NotFound") ||
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

    // A camera unplugged mid-exam previously produced no event at all: the
    // preview froze on its last frame and presence monitoring quietly stopped
    // seeing a face, which reads to a proctor exactly like a candidate who
    // walked away.
    const unsubscribe = cameraSession.subscribe((status) => {
      if (cancelled) return;
      if (status === "live") {
        // It came back -- replugged, or unmuted by whatever had claimed it.
        // Without this the error banner and the soft block stayed up after
        // the camera was working again, and only a reload cleared them.
        setCameraError(null);
        void acquire();
        return;
      }
      if (status !== "lost") return;
      setCameraVideoReady(false);
      setProctoringOk(false);
      setCameraError("The camera was disconnected. Reconnect it to resume monitoring.");
      retryTimer = setTimeout(() => {
        if (!cancelled) void acquire();
      }, 1500);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
      // The stream is not stopped here. It belongs to `cameraSession`, and
      // this effect re-runs on `loading` — tearing the device down on a
      // re-render is the failure this whole module exists to prevent.
      cameraStreamRef.current = null;
      setCameraVideoReady(false);
    };
  }, [loading]);

  useEffect(() => {
    if (!sessionId || !browserOnline) return;

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
        setClockSynced(true);
        if (live.ends_at) setContest((prev) => (prev ? { ...prev, end_at: live.ends_at! } : prev));
        if (
          isBell(
            { endsAtMs: live.ends_at ? Date.parse(live.ends_at) : null, phase: live.phase },
            serverNow()
          )
        ) {
          handleContestExpiry();
        } else {
          // A locally rung bell is provisional. The server, on a clock just
          // re-synced from this response, says time remains — so it does.
          setBellRung(false);
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
          void redirectAfterRelease("/login");
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
    // Recheck immediately on reconnect; ignore the previous connection's replies.
  }, [sessionId, router, browserOnline]);

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
    if (!sessionId || redirectInFlightRef.current || pendingRedirect) return;
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
  // block/grace-period signal), and since the footer stopped reporting
  // presence it drives no candidate-facing UI at all: the sample is logged
  // for the invigilation timeline and nothing else.
  useEffect(() => {
    if (!cameraStream) {
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
    keepPlaying(video);
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
            }
          }
          if (detector && !cancelled) {
            const sample = await samplePresence(video, detector, canvas);
            if (sample && !cancelled) {
              logPresence(sample.status, `presence check: ${sample.faces} face(s) detected`, {
                faces: sample.faces,
                thumbnail: sample.thumbnail,
              });
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

  /**
   * Take one identity frame and send it, swallowing every failure.
   *
   * The whole feature is evidence for a human, so a frame that does not
   * arrive costs an invigilator a cross-check -- it must never cost a
   * candidate their exam. Nothing here can throw into a caller, and nothing
   * here is shown to the candidate.
   */
  // The client's own capture counter. It is the identity of a frame on the
  // server, so a retry after a dropped connection replaces that frame
  // rather than adding a near-identical one to the strip.
  const photoSequenceRef = useRef(0);

  async function captureAndUploadIdentityPhoto(
    uid: string,
    kind: "entry" | "interval" | "exit",
    sequence: number
  ): Promise<void> {
    try {
      const frame = captureFrame(cameraVideoRef.current);
      if (!frame) return;
      await uploadIdentityPhoto(uid, kind, frame, sequence);
    } catch {
      // Deliberately silent. See above.
    }
  }

  // The entry frame: once per session, as soon as there is a live picture to
  // take it from. Keyed off the ref rather than a timer so it fires when the
  // camera is genuinely delivering -- a frame grabbed before the first
  // decode is a black rectangle, which `captureFrame` throws out anyway.
  const entryPhotoDoneRef = useRef<string | null>(null);
  // A ref rather than a captured `sessionId`, matching `redirectSaveRef`:
  // `runExitTeardown` is lifted out of this component and run in isolation
  // by candidate-auth.test.mjs, so anything it closes over has to be
  // injectable. Defaults to a no-op, so a teardown that runs before a
  // session exists does nothing rather than throwing on the way out.
  const exitPhotoRef = useRef<() => Promise<void>>(async () => {});
  exitPhotoRef.current = async () => {
    if (!sessionId) return;
    // The next number after whatever the timer reached, so the exit frame
    // sorts last in the strip however long the paper ran.
    photoSequenceRef.current += 1;
    await captureAndUploadIdentityPhoto(sessionId, "exit", photoSequenceRef.current);
  };
  useEffect(() => {
    if (!sessionId || !cameraVideoReady || !cameraStream) return;
    if (entryPhotoDoneRef.current === sessionId) return;
    // Marked before the upload, not after: a retry loop on a flaky
    // connection would otherwise photograph the candidate every few seconds
    // for the length of the contest. One attempt, and the roster shows the
    // gap if it missed.
    entryPhotoDoneRef.current = sessionId;
    photoSequenceRef.current = 0;
    void captureAndUploadIdentityPhoto(sessionId, "entry", 0);
  }, [cameraStream, cameraVideoReady, sessionId]);

  // A frame every half hour for as long as the paper is open.
  //
  // Entry and exit alone cannot show that the same person sat the whole
  // time -- a stand-in only has to be absent for the two moments that get
  // photographed. The interval is what makes the strip evidence rather
  // than two snapshots.
  //
  // Only while the paper is actually open: a candidate who has finished,
  // or is sitting in the verification window before the start, is not
  // under examination and should not be photographed.
  useEffect(() => {
    if (!sessionId || !cameraVideoReady || !cameraStream) return;
    if (bellRung || !paperIsOpen({ endsAtMs: null, phase: contestPhase })) return;
    const timer = setInterval(() => {
      photoSequenceRef.current += 1;
      void captureAndUploadIdentityPhoto(sessionId, "interval", photoSequenceRef.current);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [bellRung, cameraStream, cameraVideoReady, contestPhase, sessionId]);

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
      // The video track specifically, and delivering rather than merely live.
      //
      // `cameraStream.active` is true while *any* track survives, so a stream
      // reduced to its microphone still read as a working camera. And
      // `isVideoRendering` only asks whether a frame was ever decoded — a
      // muted track leaves the last one on screen indefinitely, so a camera
      // claimed by another application looked healthy while the picture had
      // been frozen for ten minutes. Both together said "fine" about a
      // candidate nobody could see.
      const track = cameraStream.getVideoTracks()[0];
      const cameraOk = isTrackDelivering(track) && Boolean(video && isVideoRendering(video));
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
                  message: previousDetail,
                  diagnostics: {
                    timestamp: new Date().toISOString(),
                    contest_id: contestId,
                    session_id: sessionId ?? "unregistered",
                  },
                  contact: "",
                  contest_uid: contestId,
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
                message: result.found.join(", "),
                diagnostics: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
                contact: "",
                contest_uid: contestId,
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
                message: previousDetail,
                diagnostics: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
                contact: "",
                contest_uid: contestId,
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
        (e.metaKey && isBlockedCmdShortcut(e)) ||
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
  const showRecoveryBanner =
    restoredFromDevice.includes(currentQId) && !dismissedRecoveryQuestions.includes(currentQId);

  useEffect(() => {
    if (!showRecoveryBanner) return;
    const timer = window.setTimeout(() => {
      setDismissedRecoveryQuestions((previous) =>
        previous.includes(currentQId) ? previous : [...previous, currentQId]
      );
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [currentQId, showRecoveryBanner]);

  const editorFiles = questionFiles[currentQId] ?? [];
  const activeFileId = questionActiveFile[currentQId] ?? editorFiles[0]?.id ?? "";
  const customCases = questionCustomCases[currentQId] ?? [];

  function mutateCustomCases(next: (previous: CustomCase[]) => CustomCase[]) {
    setQuestionCustomCases((previous) => ({
      ...previous,
      [currentQId]: next(previous[currentQId] ?? []),
    }));
  }

  /**
   * Run one of the problem's own sample cases as a custom case.
   *
   * The judge never returns stdout for the problem's own tests — its
   * `CaseDetail` type structurally cannot carry it, so a hidden case's output
   * cannot exist anywhere in the system. That guarantee is worth keeping, and
   * it is also why a candidate who failed sample 2 could not see what their
   * code printed.
   *
   * A sample is already public: its input and expected output are in the
   * statement on screen. Sending it back through the custom path is therefore
   * not a disclosure, and that path does return stdout.
   */
  function runSampleAsCustomCase(input: string, expected: string | null) {
    const existing = questionCustomCases[currentQId] ?? [];
    // Same input twice is the same case, not a second one: re-running after an
    // edit is the normal way to use this.
    const kept = existing.filter((c) => c.input !== input);
    const next = [...kept, { id: `sample-${Date.now()}`, input, expected }].slice(
      -MAX_CUSTOM_CASES
    );
    setQuestionCustomCases((previous) => ({ ...previous, [currentQId]: next }));
    // Passed explicitly: the state update above has not landed yet.
    void triggerRun(true, next);
  }
  const activeFile = editorFiles.find((file) => file.id === activeFileId) ?? editorFiles[0] ?? null;
  const isEditorEmpty = !activeFile?.content;
  const currentCode = activeFile?.content ?? "";
  latestActiveDraftRef.current = {
    questionId: currentQId,
    fileId: activeFileId,
    source: currentCode,
    language: toLanguageId(selectedLanguage),
  };

  // The local buffer is the only persistence. Written on every change rather
  // than debounced: a localStorage write costs nothing, and the debounce only
  // ever existed to rate-limit the network call that no longer happens.
  useEffect(() => {
    if (sessionId && currentQId) writeLocalAnswerBuffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionFiles, questionActiveFile, selectedLanguage, currentQId, sessionId]);

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
  const parsedProblemHtml = useMemo(
    () =>
      parseDescription(
        problemSections[activeProblemTab] || currentDescriptionMd,
        currentQuestion?.cxxprobe
          ? {
              statementPath: currentQuestion.cxxprobe.statement.path,
              assets: currentQuestion.cxxprobe.assets,
            }
          : undefined
      ),
    [activeProblemTab, currentDescriptionMd, currentQuestion, problemSections]
  );
  const problemBodyHtml = useMemo(
    () => enhanceSampleBlocks(parsedProblemHtml, copiedSampleKey),
    [parsedProblemHtml, copiedSampleKey]
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
  const networkDisconnected = shouldLockEditor(heartbeatState, browserOnline);
  const editorLocked =
    networkDisconnected || bellRung || Boolean(sessionEnded) || timeUpState !== "idle";

  const judgingUnavailableReason = sessionEnded
    ? sessionEnded === "terminated"
      ? "An invigilator ended this session."
      : "This session has already been submitted."
    : bellRung
      ? "The contest has ended. You can review your code and previous submissions, but not edit or submit new code."
      : !paperIsOpen({ endsAtMs: null, phase: contestPhase })
        ? "The contest has not started yet."
        : editorLocked
          ? `We can't reach the exam server. Editing is paused. ${connectionDraftAssurance(unsavedOnDevice.length === 0)}`
          : null;

  // One trustworthy, invisible-saving model (Google-Docs style): the candidate
  // never sees an alarming "unsaved" warning. Any pending or in-flight write reads
  // "Saving…"; once persisted it reads "All changes saved"; only a real failure is
  // surfaced (and the debounced autosave keeps retrying in the background).
  // Nothing is ever in flight: the write is a synchronous localStorage put.
  // It can still fail (quota, blocked storage), and then it must not say saved.
  const activeUnsavedOnDevice = unsavedOnDevice.includes(currentQId);
  const saveIndicator = deriveSaveIndicator({
    saveError: activeUnsavedOnDevice ? "Not saved on this device" : null,
    saving: false,
    hasUnsavedChanges: false,
  });
  // Submit button state = SUBMIT only (never autosave) — see submit-button.ts.
  const submitButton = deriveSubmitButton({
    isSubmitting,
    submissionError,
    hasSession: Boolean(sessionId),
    editorEmpty: isEditorEmpty,
    // No `submissionsListQId === currentQId` guard any more: the list is
    // derived from the active problem, so it cannot describe another one.
    judgingPending: submissionsList.some((s) =>
      isUiBlockingPending(s.status, s.created_at, Date.now())
    ),
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
        color: "var(--color-text-red)",
        bg: "var(--color-error-muted)",
        border: "color-mix(in srgb, var(--color-error) 28%, transparent)",
        icon: "error" as const,
      }
    : runTimedOut
      ? {
          // Verdict not back yet — the submission is still queued on the judge.
          label: "Still running…",
          color: "var(--color-text-yellow)",
          bg: "color-mix(in srgb, var(--color-text-yellow) 10%, transparent)",
          border: "color-mix(in srgb, var(--color-text-yellow) 28%, transparent)",
          icon: "pending" as const,
        }
      : runResult
        ? {
            label: runStatusLabelMap[runResult.status] ?? runResult.status,
            color: VERDICT_COLORS[runResult.status] ?? "var(--color-text-secondary)",
            bg:
              VERDICT_BG[runResult.status] ??
              "color-mix(in srgb, var(--color-text-secondary) 12%, transparent)",
            border:
              VERDICT_BORDER[runResult.status] ??
              "color-mix(in srgb, var(--color-text-secondary) 30%, transparent)",
            icon:
              runResult.status === "QUEUED" || runResult.status === "RUNNING"
                ? ("loading" as const)
                : ("dot" as const),
          }
        : null;
  const runProgressPhase = runError
    ? 2
    : !runResult
      ? isRunning
        ? 0
        : -1
      : runResult.status === "QUEUED"
        ? 0
        : runResult.status === "RUNNING"
          ? 1
          : 2;
  const runProgressSteps = ["Queued", "Judging", "Result"];
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
  const activeDraftStatus = draftStatus(!activeUnsavedOnDevice);
  const submissionSource = latestAttempt ? submittedSources[latestAttempt.id] : undefined;
  const compilerText = runResult ? runResult.compile_output : latestAttempt?.compile_output;
  const compilerDiagnostic = useMemo(
    () => (compilerText ? firstCompilerError(compilerText) : null),
    [compilerText]
  );
  const diagnosticContext = {
    questionId: currentQId,
    fileId: activeFileId,
    filename: activeFile?.name ?? "main.cpp",
    source: currentCode,
    language: toLanguageId(selectedLanguage),
  };
  // Historical submissions omit source/file identity; only a matching run can navigate safely.
  const canJumpToCompilerError = Boolean(
    !isRunning &&
    runResult &&
    compilerDiagnostic &&
    canNavigateDiagnostic(compilerDiagnostic, runSourceSnapshot, diagnosticContext)
  );
  const jumpToCompilerError = () => {
    if (
      !canJumpToCompilerError ||
      !compilerDiagnostic ||
      !canNavigateDiagnostic(compilerDiagnostic, runSourceSnapshot, diagnosticContext)
    )
      return;
    setDiagnosticNavigation((previous) => ({
      ...diagnosticContext,
      line: compilerDiagnostic.line,
      column: compilerDiagnostic.column,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  };

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
      const isActiveUnsaved =
        (q.id === currentQId && hasUnsavedChanges) || unsavedOnDevice.includes(q.id);
      if (hasAccepted) {
        map[q.id] = {
          label: "Accepted submission",
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
          bg: "color-mix(in srgb, var(--color-text-primary) 4%, transparent)",
          border: "color-mix(in srgb, var(--color-text-primary) 12%, transparent)",
        };
      }
    }
    return map;
  }, [
    currentQId,
    hasUnsavedChanges,
    questions,
    savedAnswers,
    submissionsByQuestion,
    unsavedOnDevice,
  ]);
  const attemptedQuestionCount = questions.filter(
    (q) => (submissionsByQuestion[q.id] ?? []).length > 0
  ).length;
  const acceptedQuestionCount = questions.filter((q) =>
    (submissionsByQuestion[q.id] ?? []).some((sub) => (sub.final_verdict ?? sub.status) === "AC")
  ).length;
  const remainingQuestionCount = Math.max(questions.length - attemptedQuestionCount, 0);
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
  const footerStatusDot = (color: string) => (
    <VStack
      as="span"
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "var(--spacing-1-5, var(--spacing-2))",
        height: "var(--spacing-1-5, var(--spacing-2))",
        borderRadius: "50%",
        background: color,
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
  const criticalOverlayActive =
    shouldShowFaceBlock || (lockGraceActive && lockGraceCountdown === 0);
  const networkOverlayActive =
    networkDisconnected &&
    !criticalOverlayActive &&
    !bellRung &&
    !sessionEnded &&
    timeUpState === "idle";
  const networkDialogRef = useFocusTrap<HTMLDialogElement>(networkOverlayActive);
  const lockViolationDialogRef = useFocusTrap<HTMLDivElement>(
    lockGraceActive && lockGraceCountdown === 0 && timeUpState === "idle"
  );
  const faceBlockDialogRef = useFocusTrap<HTMLDivElement>(
    shouldShowFaceBlock && timeUpState === "idle"
  );
  const mediaWarningDialogRef = useFocusTrap<HTMLDivElement>(
    showMediaToggleWarning && !networkOverlayActive && timeUpState === "idle",
    cancelMediaToggle
  );
  const supportDialogRef = useFocusTrap<HTMLDivElement>(
    showSupportModal && !criticalOverlayActive && !networkOverlayActive && timeUpState === "idle",
    closeSupport
  );
  const finishReceiptDialogRef = useFocusTrap<HTMLDivElement>(timeUpState !== "idle");
  useEffect(() => {
    if (
      criticalOverlayActive ||
      networkOverlayActive ||
      submitConfirm ||
      showSupportModal ||
      showMediaToggleWarning ||
      timeUpState !== "idle"
    )
      setThemeMenuOpen(false);
  }, [
    criticalOverlayActive,
    networkOverlayActive,
    submitConfirm,
    showSupportModal,
    showMediaToggleWarning,
    timeUpState,
  ]);

  if (pendingRedirect) {
    return loadError ? (
      <ContestLoadErrorScreen
        loadError={loadError}
        router={router}
        onRetry={() => void redirectAfterRelease(pendingRedirect)}
        hideBack
      />
    ) : (
      <BootScreen label="Releasing device controls..." />
    );
  }

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
    return (
      <ContestLoadErrorScreen
        loadError={loadError}
        router={router}
        onRetry={
          loadRetryable
            ? () => {
                autoLoadRetriesRef.current = 0;
                setLoading(true);
                setLoadAttempt((n) => n + 1);
              }
            : undefined
        }
      />
    );
  }

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      data-contest-page
      style={{
        height: "100dvh",
        background: "var(--color-background-body)",
        color: "var(--color-text-primary)",
      }}
    >
      <VStack
        gap={0}
        style={{ height: "100%", minHeight: 0, overflow: "hidden", paddingTop: topSafeInset }}
      >
        <KioskBanner />
        {lockGraceActive && lockGraceCountdown > 0 && (
          <LockGraceToast lockGraceCountdown={lockGraceCountdown} />
        )}
        {lockGraceActive && lockGraceCountdown === 0 && (
          <BlockedAppsOverlay
            lockViolationDialogRef={lockViolationDialogRef}
            blockedApps={blockedApps}
          />
        )}
        <TopBar
          markedQuestionIds={markedQuestionIds}
          workspaceControls={
            <WorkspaceControls
              suspended={
                criticalOverlayActive ||
                networkOverlayActive ||
                submitConfirm ||
                showSupportModal ||
                showMediaToggleWarning ||
                timeUpState !== "idle"
              }
              focused={editorFocused}
              onFocus={toggleEditorFocus}
              onReset={resetWorkspaceLayout}
              onNavigate={navigateWorkspace}
            />
          }
          contest={contest}
          clock={clock}
          handleContestExpiry={onContestExpiry}
          setShowSupportModal={setShowSupportModal}
          submitConfirm={submitConfirm}
          setSubmitConfirm={setSubmitConfirm}
          submitError={submitError}
          setSubmitError={setSubmitError}
          handleSubmitConfirmed={handleSubmitConfirmed}
          timeUpState={timeUpState}
          finishHistoryStatus={submissionHistoryStatus}
          finishQuestions={questions.map((q) => ({
            id: q.id,
            title: q.title,
            submissionCount: (submissionsByQuestion[q.id] ?? []).length,
            pendingCount: (submissionsByQuestion[q.id] ?? []).filter((sub) =>
              isPendingSubmissionStatus(sub.status)
            ).length,
            hasAccepted: (submissionsByQuestion[q.id] ?? []).some(
              (sub) => (sub.final_verdict ?? sub.status) === "AC"
            ),
          }))}
          finishDraftStatus={
            unsavedOnDevice.length
              ? `Not saved on this device: ${questions
                  .filter((q) => unsavedOnDevice.includes(q.id))
                  .map((q) => q.title)
                  .join(", ")}. That code exists only in the open editor.`
              : "Drafts: Saved on this device."
          }
          finishDraftNeedsAttention={unsavedOnDevice.length > 0}
          finishReviewSuspended={
            criticalOverlayActive ||
            networkOverlayActive ||
            showSupportModal ||
            showMediaToggleWarning ||
            timeUpState !== "idle"
          }
          onReviewQuestion={onSwitchQuestion}
        />
        <HStack
          gap={0}
          className="contest-body"
          data-editor-focus={editorFocused ? "true" : "false"}
          align="stretch"
          style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" }}
        >
          <QuestionRail
            markedQuestionIds={markedQuestionIds}
            questions={questions}
            activeQ={activeQ}
            switchQuestion={onSwitchQuestion}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            questionStatusMap={questionStatusMap}
            acceptedQuestionCount={acceptedQuestionCount}
            cameraPreviewAvailable={Boolean(cameraStream ?? cameraError)}
            cameraPreviewVisible={!cameraCollapsed && Boolean(cameraStream ?? cameraError)}
            onToggleCameraPreview={() => setCameraCollapsed((collapsed) => !collapsed)}
          />
          <ProblemPane
            markedQuestionIds={markedQuestionIds}
            toggleQuestionMark={toggleQuestionMark}
            problemPaneWidth={problemPaneWidth}
            availableProblemTabs={availableProblemTabs}
            activeProblemTab={activeProblemTab}
            setProblemTab={setProblemTab}
            questions={questions}
            activeQ={activeQ}
            problemBodyHtml={problemBodyHtml}
            handleProblemBodyClick={handleProblemBodyClick}
          />
          <WorkspaceResizeHandle
            className="contest-splitter"
            direction="horizontal"
            value={problemPaneWidth}
            min={28}
            max={52}
            onChange={updateProblemWidth}
            containerSelector=".contest-body"
            label="Resize problem and editor panes"
          />
          <VStack
            gap={0}
            className="contest-editor-output"
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              background: "var(--color-background-body)",
            }}
          >
            <AnimatePresence initial={false}>
              {showRecoveryBanner && (
                <RecoveryBannerRegion
                  key={`recovery-${currentQId}`}
                  gap={0}
                  initial={false}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{
                    height: { duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] },
                    opacity: { duration: reduceMotion ? 0 : 0.12 },
                  }}
                  style={{ overflow: "hidden", flexShrink: 0 }}
                >
                  <Banner
                    status="info"
                    container="section"
                    title="Draft restored from this device"
                    description={`Review the recovered code. ${activeDraftStatus.confirmed ? "It is saved on this device." : "Your latest changes are not yet saved on this device."}`}
                    isDismissable
                    onDismiss={() => setDismissedRecoveryQuestions((prev) => [...prev, currentQId])}
                  />
                </RecoveryBannerRegion>
              )}
            </AnimatePresence>
            {!networkOverlayActive && (!browserOnline || connection !== "online") && (
              <Banner
                status="warning"
                container="section"
                title="Reconnecting to the exam server"
                description={connectionDraftAssurance(unsavedOnDevice.length === 0)}
                role="status"
              />
            )}
            {activeUnsavedOnDevice && (
              <Banner
                status="error"
                container="section"
                title="Your code is not saved"
                description="This device refused to store your draft (storage full or blocked). Your code is still in the editor: do not reload or close this window. Saving is retried on every change."
              />
            )}
            <EditorPanel
              diagnosticNavigation={diagnosticNavigation}
              editorFiles={editorFiles}
              activeFileId={activeFileId}
              setQuestionActiveFile={setQuestionActiveFile}
              currentQId={currentQId}
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
              activeQ={activeQ}
              activeFile={activeFile}
              currentCode={currentCode}
              handleCodeChange={handleCodeChange}
            />
            {!terminalCollapsed && (
              <WorkspaceResizeHandle
                direction="vertical"
                reversed
                value={outputHeightPercent}
                min={18}
                max={55}
                onChange={updateOutputHeight}
                onCollapse={() => setTerminalCollapsed(true)}
                containerSelector=".contest-editor-output"
                label="Resize output panel"
              />
            )}
            <TerminalPanel
              runMode={runMode}
              customCases={customCases}
              onCustomCasesChange={mutateCustomCases}
              onRunCustom={() => void triggerRun(true)}
              onRunSampleAsCustom={runSampleAsCustomCase}
              readOnly={editorLocked}
              judgingUnavailableReason={judgingUnavailableReason}
              compilerDiagnostic={compilerDiagnostic}
              onJumpToCompilerError={canJumpToCompilerError ? jumpToCompilerError : undefined}
              outputHeightPercent={outputHeightPercent}
              runSourceChanged={Boolean(
                runSourceSnapshot &&
                (runSourceSnapshot.questionId !== currentQId ||
                  runSourceSnapshot.source !== currentCode ||
                  runSourceSnapshot.language !== toLanguageId(selectedLanguage))
              )}
              terminalCollapsed={terminalCollapsed}
              setTerminalCollapsed={setTerminalCollapsed}
              shouldShowRunProgress={shouldShowRunProgress}
              runResult={runResult}
              isRunning={isRunning}
              runTimedOut={runTimedOut}
              onCheckRunAgain={recheckRun}
              runResultAttemptId={runResultAttemptId}
              runSampleTests={runSampleTests}
              /* The worked examples the statement already shows. The judge
                 sends no input or expected output for a sample and does not
                 need to -- the candidate is reading both a few inches up. */
              sampleExamples={questions[activeQ]?.samples}
              runError={runError}
              isEditorEmpty={isEditorEmpty}
              submissionsList={submissionsList}
              problemLabel={activeQLabel}
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
          </VStack>
          <CameraTile
            cameraVideoRef={cameraVideoRef}
            cameraStream={cameraStream}
            cameraError={cameraError}
            sidebarCollapsed={sidebarCollapsed}
            cameraStatusLabel={cameraStatusLabel}
            cameraCollapsed={cameraCollapsed}
            cameraHealthy={cameraHealthy}
            cameraEnabled={cameraEnabled}
            micEnabled={micEnabled}
            handleToggleMedia={handleToggleMedia}
          />
        </HStack>
        <FooterTrustStrip
          proctoringOk={proctoringOk}
          footerStatusDot={footerStatusDot}
          cameraStatus={footerCameraStatus(cameraEnabled, cameraHealthy, cameraError)}
          online={online}
          saveIndicator={saveIndicator}
          draftStatusLabel={activeDraftStatus.label}
          draftConfirmed={activeDraftStatus.confirmed}
          activeQ={activeQ}
          questions={questions}
          attemptedQuestionCount={attemptedQuestionCount}
          acceptedQuestionCount={acceptedQuestionCount}
          remainingQuestionCount={remainingQuestionCount}
        />
      </VStack>

      <Dialog
        className="contest-network-dialog"
        ref={networkDialogRef}
        tabIndex={-1}
        isOpen={networkOverlayActive}
        onOpenChange={() => {}}
        purpose="required"
        padding={6}
        width="calc(var(--spacing-10) * 12)"
        maxHeight="calc(100dvh - var(--spacing-8))"
        aria-labelledby="network-disconnection-title"
        aria-describedby="network-disconnection-assurance"
      >
        <VStack gap={4}>
          <Heading level={2} id="network-disconnection-title">
            Reconnecting to the exam server
          </Heading>
          <Text id="network-disconnection-assurance" role="status">
            {connectionDraftAssurance(unsavedOnDevice.length === 0)}
          </Text>
          <HStack gap={3} align="center">
            <Spinner />
            <Text color="secondary">Your workspace will resume when the connection returns.</Text>
          </HStack>
          <Text color="secondary">Keep this app open. The contest timer continues to run.</Text>
        </VStack>
      </Dialog>

      {shouldShowFaceBlock && (
        <ContestOverlay labelId="face-block-title" critical alert dialogRef={faceBlockDialogRef}>
          <Heading level={2} id="face-block-title">
            {faceBlockTitle}
          </Heading>
          <Banner status="warning" title="Camera attention needed" description={faceBlockMessage} />
          <Text color="secondary">The workspace will resume when the camera check clears.</Text>
        </ContestOverlay>
      )}

      {showMediaToggleWarning && (
        <ContestOverlay labelId="media-toggle-warning-title" dialogRef={mediaWarningDialogRef}>
          <VStack gap={3}>
            <Heading level={2} id="media-toggle-warning-title">
              This action will be logged.
            </Heading>
            <Text color="secondary">
              Turning off your camera or microphone may affect proctoring validation.
            </Text>
          </VStack>
          <HStack gap={3} justify="end" wrap="wrap">
            <Button label="Cancel" variant="secondary" onClick={cancelMediaToggle} />
            <Button label="Continue" variant="primary" onClick={confirmMediaToggle} />
          </HStack>
        </ContestOverlay>
      )}

      {timeUpState !== "idle" && (
        <ContestOverlay
          labelId="contest-ended-title"
          critical
          alert
          dialogRef={finishReceiptDialogRef}
        >
          <Text type="supporting" color="secondary">
            Finish receipt
          </Text>
          {timeUpState === "submitting" && (
            <VStack gap={4}>
              <Heading level={2} id="contest-ended-title">
                Finishing your session…
              </Heading>
              <HStack gap={3} align="center">
                <Spinner />
                <Text color="secondary">
                  Waiting for the server to acknowledge your finish request.
                </Text>
              </HStack>
              <Text color="secondary">Keep this window open until the result appears.</Text>
            </VStack>
          )}
          {timeUpState === "submitted" && (
            <VStack gap={4}>
              <Heading level={2} id="contest-ended-title">
                Session finish confirmed
              </Heading>
              <Text color="secondary">
                The server acknowledged that this session is finished. Check results status for your
                scored submissions.
              </Text>
              {finalDraftSaved && (
                <Text color="secondary">
                  Your final draft is saved on this device. A local draft is not a scored
                  submission.
                </Text>
              )}
              {submitWarning && (
                <Banner
                  status="warning"
                  title="Latest draft save not confirmed"
                  description={submitWarning}
                />
              )}
              {!submitWarning && <ContestSponsor contestId={contestId} placement="completion" />}
            </VStack>
          )}
          {timeUpState === "error" && (
            <VStack gap={4}>
              <Heading level={2} id="contest-ended-title">
                Could not confirm session finish
              </Heading>
              <Banner
                status="warning"
                title="Server acknowledgement missing"
                description="The connection failed or the server did not acknowledge the finish request. This screen will not keep retrying after you leave."
              />
              <Text color="secondary">
                {finalDraftSaved
                  ? "Your final draft is saved on this device, but the server has not confirmed the session finish."
                  : "The latest draft could not be saved on this device. Keep this app open."}{" "}
                Ask an invigilator to check your session and submissions.
              </Text>
            </VStack>
          )}
          {timeUpState !== "submitting" && restoreStatus?.pending && (
            <VStack gap={2}>
              <Banner
                status="warning"
                title="Some device settings are still changed"
                description="AMS Access keeps retrying in the background. To fix one now, run its command in Terminal. Back to home opens Settings, which lists the same commands with copy buttons."
              />
              {restoreStatus.items.length > 0 && (
                <List>
                  {restoreStatus.items.map((item) => (
                    <ListItem
                      key={item.label + item.fix_command}
                      label={item.label}
                      description={item.fix_command}
                    />
                  ))}
                </List>
              )}
            </VStack>
          )}
          {timeUpState !== "submitting" && (
            <HStack gap={3} wrap="wrap">
              <Button
                label="Back to home"
                variant="secondary"
                onClick={() =>
                  router.push(restoreStatus?.pending ? "/home?restore=pending" : "/home")
                }
              />
              <Button
                label="Check results status"
                variant="ghost"
                onClick={() => router.push(`/results?contestId=${encodeURIComponent(contestId)}`)}
              />
            </HStack>
          )}
        </ContestOverlay>
      )}

      {showSupportModal && (
        <ContestOverlay labelId="support-modal-title" dialogRef={supportDialogRef} wide>
          <VStack gap={2}>
            <Heading level={2} id="support-modal-title">
              Report an incident
            </Heading>
            <Text color="secondary">
              Choose the issue you’re experiencing. Device diagnostics are included with your
              report.
            </Text>
          </VStack>
          {reportSentSuccess ? (
            <VStack gap={4}>
              <Banner
                status="success"
                title="Report sent"
                description="Your incident report has been sent. You can return to your contest."
              />
              <Button label="Back to contest" variant="primary" onClick={closeSupport} />
            </VStack>
          ) : (
            <>
              {supportReportError && (
                <Banner
                  status="error"
                  title="Report not confirmed"
                  description={supportReportError}
                  role="alert"
                />
              )}
              <RadioList
                label="Issue"
                value={supportCategory}
                onChange={setSupportCategory}
                htmlName="supportCategory"
                isDisabled={isSendingReport}
              >
                {SUPPORT_CATEGORIES.map((opt) => (
                  <RadioListItem key={opt.value} value={opt.value} label={opt.label} />
                ))}
              </RadioList>
              <TextArea
                label="What happened?"
                isOptional={supportCategory !== "other"}
                isRequired={supportCategory === "other"}
                description="Include the problem and what you were doing when the issue occurred."
                placeholder="Describe what happened…"
                value={customIssueDetail}
                onChange={setCustomIssueDetail}
                isDisabled={isSendingReport}
                hasSpellCheck={false}
                rows={3}
              />
              <HStack gap={3} wrap="wrap">
                <Button
                  label={isSendingReport ? "Sending…" : "Submit report"}
                  variant="primary"
                  onClick={handleSendSupportReport}
                  isDisabled={
                    isSendingReport || (supportCategory === "other" && !customIssueDetail.trim())
                  }
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  onClick={closeSupport}
                  isDisabled={isSendingReport}
                />
              </HStack>
            </>
          )}
          {sentReports.some((report) => report.sessionId === sessionId) && (
            <VStack
              as="section"
              gap={3}
              aria-label="Recent reports"
              style={{
                borderTop: "var(--border-width) solid var(--color-border)",
                paddingTop: "var(--spacing-4)",
              }}
            >
              <Text weight="medium">Recent reports</Text>
              <Text type="supporting" color="secondary">
                Last 10 reports confirmed during this visit. This list clears when you reload or
                leave the contest. Organizer replies are not shown here.
              </Text>
              {sentReports
                .filter((report) => report.sessionId === sessionId)
                .map((report, index) => (
                  <HStack key={`${report.sentAt}-${index}`} gap={3} justify="between" wrap="wrap">
                    <Text>
                      {SUPPORT_CATEGORIES.find((category) => category.value === report.category)
                        ?.label ?? "Other issue"}
                    </Text>
                    <Text type="supporting" color="secondary">
                      Sent{" "}
                      {new Date(report.sentAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </HStack>
                ))}
            </VStack>
          )}
          <VStack
            as="details"
            gap={3}
            style={{
              borderTop: "var(--border-width) solid var(--color-border)",
              paddingTop: "var(--spacing-4)",
            }}
          >
            <summary
              tabIndex={0}
              style={{ cursor: "pointer", fontWeight: "var(--font-weight-medium)" }}
            >
              Attached diagnostics
            </summary>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: "calc(var(--spacing-10) * 5)",
                overflowY: "auto",
                padding: "var(--spacing-4)",
                background: "var(--color-background-body)",
                borderRadius: "var(--radius-element)",
              }}
            >
              {JSON.stringify(supportTelemetry, null, 2)}
            </pre>
          </VStack>
        </ContestOverlay>
      )}
      <style>{CONTEST_STYLES}</style>
    </AppShell>
  );
}
