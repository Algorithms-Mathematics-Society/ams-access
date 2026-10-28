"use client";

import { registerAllowedClipboard, resetAllowedClipboard } from "./clipboard-provenance";

import { formatSource } from "./format-code";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { HelpRequestModal } from "@/components/HelpRequestModal";
import { ContestSponsor } from "@/components/ContestSponsor";
import { AppShell } from "@astryxdesign/core/AppShell";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text, Heading } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Dialog } from "@astryxdesign/core/Dialog";
import { AccessDialog } from "@/components/AccessDialog";
import { releaseDeviceControls, releaseRestoreStatus } from "@/lib/release-device-controls";
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
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke, listen, type RestoreStatus } from "@ams/api-client";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { clearQueryCache, fetchJson, postJsonKeepalive } from "@/lib/api-client";
import { authHeaders, participantToken } from "@/lib/candidate-auth";
import { cameraSession, isTrackDelivering } from "@/lib/camera-session";
import { INTERVAL_MS, captureFrame, jitterOffset } from "@/lib/identity-photo";
import { drawForObjects, loadObjectDetector, sampleObjects } from "@/lib/object-watch";
import { isGatingRelaxed } from "@/lib/gating";
import {
  loadPresenceDetector,
  samplePresence,
  ANOMALY_STREAK,
  PRESENCE_SAMPLE_MS,
  type Framing,
  type PresenceStatus,
  type PresenceDetector,
} from "@/lib/presence-monitor";
import { STORAGE_KEYS } from "@/constants/storage-keys";
import {
  CONTEST_EDITOR_THEMES,
  resolveLanguageBundle,
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
import { BootScreen, ContestLoadErrorScreen, entryWaitPhase } from "./components/GateScreens";
import { LockGraceToast, BlockedAppsOverlay } from "./components/BlockedOverlay";
import { KioskBanner } from "./components/KioskBanner";
import { FooterTrustStrip } from "./components/FooterTrustStrip";
import { footerCameraStatus } from "./camera-status";
import { nextPresenceEvidenceDelay, presenceUnavailableEvent } from "./presence-evidence";
import { TopBar } from "./components/TopBar";
import { startDisconnectGrace } from "./disconnect-grace";
import { QuestionRail } from "./components/QuestionRail";
import { ReferencePanel } from "./components/ReferencePanel";
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
import {
  DRAFT_BACKUP_MS,
  createDraftSaveQueue,
  draftBackup,
  restoreDraftWorkspace,
  stopsDraftBackup,
} from "./draft-workspace";
import { readReferenceSheet } from "./reference-sheet";
import { loadContestPaper } from "./load-contest-problems";
import {
  type Announcement,
  nextToShow,
  readAnnouncements,
  rememberAck,
  shouldFetch,
} from "./announcements";
import { AnnouncementOverlay } from "./components/AnnouncementOverlay";
import { releaseCandidateQuestionAssets } from "./candidate-question-projection";
import { mergeAttemptTestResults, toAttemptRecords } from "./attempt-adapter";
import {
  enqueue as enqueueViolation,
  flush as flushViolationQueue,
  flushBeforeExit as flushViolationsBeforeExit,
  report as reportViolation,
  setActiveSession as setViolationSession,
} from "@/lib/violation-queue";
import {
  activeContent,
  clear as clearAnswerBuffer,
  read as readAnswerBuffer,
  write as writeAnswerBuffer,
} from "./answer-buffer";
import { AUTH_RECHECK_MS, onUnauthorized } from "./auth-loss";
import { attemptLimitError, runCooldownMessage } from "./attempt-limits";
import { isBell, paperIsOpen, type ClockPhase, type ClockSnapshot } from "./session-clock";
import {
  connectionLevel,
  initialHeartbeatState,
  onFailure as onHeartbeatFailure,
  onSuccess as onHeartbeatSuccess,
} from "@/lib/heartbeat-policy";
import {
  ProctorApiError,
  acknowledgeAnnouncement,
  getPublishedReferenceSheet,
  getRun,
  getSession,
  heartbeat,
  listAnnouncements,
  listDrafts,
  listMySubmissions,
  logout,
  saveDraft,
  type Draft,
  run as runAgainstSamples,
  serverNow,
  newIdempotencyKey,
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
          close: () => Promise<void>;
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
  const activeContestIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    activeContestIdRef.current = contest?.id ?? null;
  }, [contest?.id]);
  // The server's own view of where we are in the contest window. Outranks any
  // deadline arithmetic done here — see `isBell`.
  const [contestPhase, setContestPhase] = useState<ClockPhase>("running");
  // True once the contest is over. The editor goes read-only and Run/Submit
  // stop; nothing is auto-submitted.
  const [bellRung, setBellRung] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQ, setActiveQ] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
  const runQuestionKey = `${sessionId ?? ""}:${questions[activeQ]?.id ?? ""}`;
  type RunSourceSnapshot = SourceSnapshot & {
    questionId: string;
    fileId: string;
    filename: string;
    problemTitle?: string;
  };
  const [runSources, setRunSources] = useState<
    Record<string, Partial<Record<"all" | "custom", RunSourceSnapshot | null>>>
  >({});
  const setRunSourceSnapshot = (snapshot: RunSourceSnapshot | null, mode: "all" | "custom") =>
    setRunSources((previous) => ({
      ...previous,
      [runQuestionKey]: { ...previous[runQuestionKey], [mode]: snapshot },
    }));
  const [problemTab, setProblemTab] = useState<ProblemSectionKey>("statement");
  const [copiedSampleKey, setCopiedSampleKey] = useState<string | null>(null);
  // A sample run and a custom run are two different questions, so they keep
  // two different answers. They used to share one set of slots with `runMode`
  // saying who wrote last, which meant running custom cases destroyed the
  // sample results sitting in the other tab, and vice versa -- the two tabs
  // were a single value drawn twice.
  //
  // `isRunning` stays shared on purpose: the API enforces
  // RUN_COOLDOWN_SECONDS, so letting both start at once only earns a 429.
  type RunSlice = {
    result: RunAttempt | null;
    attemptId: string | null;
    error: string | null;
    timedOut: boolean;
  };
  const EMPTY_RUN: RunSlice = { result: null, attemptId: null, error: null, timedOut: false };
  type RunSlices = Record<"all" | "custom", RunSlice>;
  const [questionRuns, setQuestionRuns] = useState<Record<string, RunSlices>>({});
  const runSlices = questionRuns[runQuestionKey] ?? { all: EMPTY_RUN, custom: EMPTY_RUN };
  const setRunSlices = (update: (previous: RunSlices) => RunSlices) =>
    setQuestionRuns((previous) => ({
      ...previous,
      [runQuestionKey]: update(previous[runQuestionKey] ?? { all: EMPTY_RUN, custom: EMPTY_RUN }),
    }));
  const patchRun = useCallback(
    (mode: "all" | "custom", patch: Partial<RunSlice>) => {
      setRunSlices((prev) => ({ ...prev, [mode]: { ...prev[mode], ...patch } }));
    },
    [runQuestionKey]
  );
  const [isRunning, setIsRunning] = useState(false);
  const [runningQuestionKey, setRunningQuestionKey] = useState<string | null>(null);
  const [questionRunModes, setQuestionRunModes] = useState<Record<string, "all" | "custom">>({});
  const runMode = questionRunModes[runQuestionKey] ?? "all";
  const runSourceSnapshot = runSources[runQuestionKey]?.[runMode] ?? null;
  const setRunMode = (mode: "all" | "custom") => {
    setRunningQuestionKey(runQuestionKey);
    setQuestionRunModes((previous) => ({ ...previous, [runQuestionKey]: mode }));
  };
  // What the lifecycle code means by "the run": whichever kind started last.
  // Display picks its own slice by tab -- see TerminalPanel.
  const runResult = runSlices[runMode].result;
  const runResultAttemptId = runSlices[runMode].attemptId;
  const runError = runSlices[runMode].error;
  const runTimedOut = runSlices[runMode].timedOut;
  // Set when the judge hasn't returned a verdict within the polling window — the
  // submission is still queued (distinct from a hard connection error).
  // The candidate's own cases, per question. Local only, exactly like the
  // code itself -- there is no server copy of a draft any more, and a test
  // case someone typed is no more worth persisting than the code it tests.
  const [questionCustomCases, setQuestionCustomCases] = useState<Record<string, CustomCase[]>>({});
  const [loading, setLoading] = useState(true);
  // What the organizers have told this contest, and which of it this
  // candidate has not yet read. `seenRevision` is the integer the heartbeat
  // carries; the text is fetched only when it moves.
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ackBusy, setAckBusy] = useState(false);
  const seenRevisionRef = useRef(0);
  const announcementFetchInFlightRef = useRef(false);
  // How long entry has been waiting, so the boot screen can say something
  // true about it. Ticks only while `loading` holds, and stops the moment
  // the workspace mounts -- a timer left running behind the contest would
  // re-render the editor every second for nothing.
  const [bootWaitedMs, setBootWaitedMs] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setBootWaitedMs(Date.now() - startedAt), 1_000);
    return () => clearInterval(timer);
  }, [loading]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped to re-run the load effect: by the backoff timer, or by Retry.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadRetryable, setLoadRetryable] = useState(false);
  const autoLoadRetriesRef = useRef(0);
  // When an unconfirmed 401 arrived; see `auth-loss.ts`. Shared by the loader
  // and the heartbeat so either can confirm what the other first saw.
  const unauthorizedAtRef = useRef<number | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const latestActiveDraftRef = useRef<{
    sessionId: string | null;
    questionId: string;
    fileId: string;
    source: string;
    language: string;
    files: EditorFile[];
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
  // What the server's backup copy holds per problem (see `draftBackup`), and
  // whether backing up has been given up for this session.
  const serverDraftRef = useRef<Record<string, string>>({});
  const draftBackupOffRef = useRef(false);
  const draftBackupFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  // Retain an unacknowledged request only for retries of its exact payload.
  const submitKeyRef = useRef<{
    sessionId: string;
    problemLabel: string;
    language: string;
    source: string;
    idempotencyKey: string;
  } | null>(null);
  const acknowledgedSubmitKeysRef = useRef<Record<string, string>>({});
  // Guards finish/teardown against duplicate clicks and submissions during exit.
  // Failed acknowledgements reset it so the candidate can explicitly retry.
  const exitInFlightRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Non-blocking warning surfaced after the candidate has been unlocked/exited but
  // we could NOT confirm the final save/submit landed (their work is buffered
  // locally). The exit teardown still runs — they are never trapped.
  const [submitWarning, setSubmitWarning] = useState<string | null>(null);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaveDraftSaved, setLeaveDraftSaved] = useState(false);
  const leavingWorkspaceRef = useRef(false);
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
  // Set by the heartbeat effect so the offline dialog can ask for one
  // immediately instead of waiting out the poll interval. Useful exactly
  // when the browser thinks it is online and the server is still
  // unreachable -- a captive portal, or a network joined seconds ago.
  const retryBeatRef = useRef<() => void>(() => {});
  const referenceRevisionRef = useRef(0);
  const referenceFetchInFlightRef = useRef(false);
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
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showSupportChat, setShowSupportChat] = useState(false);
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
  // The offline C++ reference, shown over the workspace rather than in place
  // of it: swapping it in would unmount the editor, and an unmounted
  // CodeMirror is unsaved code waiting to be lost.
  const [referenceOpen, setReferenceOpen] = useState(false);
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
  // Read by the presence loop, which must not restart when the session id
  // arrives -- reloading BlazeFace mid-exam to learn a string it could have
  // been handed is a cost nobody gets anything for.
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  // Detectors that sit far from this component -- the paste handler inside
  // CodeMirror, the window focus listener -- report against this rather than
  // having a session id threaded down to them.
  useEffect(() => {
    resetAllowedClipboard();
    setViolationSession(sessionId);
    return () => {
      resetAllowedClipboard();
      setViolationSession(null);
    };
  }, [sessionId]);
  // Advice to the candidate about how they are sitting, never sent anywhere.
  const [framingHint, setFramingHint] = useState<Framing>("ok");
  // The watched object currently in frame, or null. Drives the banner only;
  // the flag itself goes to the invigilation timeline.
  const [objectHint, setObjectHint] = useState<string | null>(null);
  // Screens the exam can see. 1 is the only acceptable answer during a paper.
  const [monitorCount, setMonitorCount] = useState(1);
  // What the detector last saw. Drives the tile border, nothing else.
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>("presence_ok");
  // Bumped when the candidate picks a different camera, to re-run the
  // acquisition effect below against the new preference.
  const [cameraPickKey, setCameraPickKey] = useState(0);

  /**
   * Switch camera without leaving the exam.
   *
   * The wrong camera is not always obvious until the contest is running: a
   * laptop that opened its infrared sensor shows a black tile, and until now
   * the candidate's only options were to sit with it or abandon the sitting.
   * The preference is shared with onboarding and Settings, so the choice
   * sticks for the rest of the paper and the next one.
   */
  async function handlePickCamera(deviceId: string) {
    try {
      await cameraSession.setPreferredVideoDevice(deviceId || null);
      if (cameraClosedRef.current) return;
      setCameraPickKey((key) => key + 1);
    } catch (error) {
      if (cameraClosedRef.current) return;
      setCameraError("The selected camera is unavailable. Reconnect it or choose another camera.");
    }
  }
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
  // Leaving the session cancels any run poll still waiting on the judge.
  useEffect(() => {
    runInFlightRef.current = false;
    setIsRunning(false);
    return () => {
      runVisitRef.current += 1;
    };
  }, [sessionId]);
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
  const [submissionErrors, setSubmissionErrors] = useState<Record<string, string | null>>({});
  const submissionError = submissionErrors[runQuestionKey] ?? null;
  // Async Submit handlers retain their original session/question key.
  const setSubmissionError = (error: string | null) =>
    setSubmissionErrors((previous) => ({ ...previous, [runQuestionKey]: error }));
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
  const [resultSelections, setResultSelections] = useState<
    Record<string, { source: "run" | "submission" }>
  >({});
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
        if (cancelled || leavingWorkspaceRef.current) return;
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
        if (!cancelled && !leavingWorkspaceRef.current) setLockGate("ok");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDryRun, contestId, router]);

  const submissionRefreshRef = useRef<{
    sessionId: string | null;
    active: boolean;
    pending: Promise<void> | null;
    queued: Promise<void> | null;
    accepted: Map<string, SubmissionAttemptRecord>;
  } | null>(null);

  useEffect(() => {
    const owner = {
      sessionId,
      active: true,
      pending: null,
      queued: null,
      accepted: new Map<string, SubmissionAttemptRecord>(),
    };
    submissionRefreshRef.current = owner;
    return () => {
      owner.active = false;
    };
  }, [sessionId]);

  const fetchSubmissions = useCallback((): Promise<void> => {
    const owner = submissionRefreshRef.current;
    if (!sessionId || !questions[activeQ] || !owner?.active || owner.sessionId !== sessionId) {
      return Promise.resolve();
    }
    const isCurrent = () => owner.active && submissionRefreshRef.current === owner;
    const refresh = (): Promise<void> => {
      if (!isCurrent()) return Promise.resolve();
      setLoadingSubmissions(true);
      // Defer execution so ownership is installed even if the API call throws.
      owner.pending = Promise.resolve().then(async () => {
        try {
          if (!isCurrent()) return;
          // This session-wide list excludes Runs. Keep their separate polling
          // and results intact; the active problem's history is derived below.
          const attempts = toAttemptRecords(await listMySubmissions(sessionId));
          if (!isCurrent()) return;
          for (const attempt of attempts) owner.accepted.delete(attempt.id);
          // A GET started before acceptance may not contain the new attempt.
          // Retain the POST receipt until a fresh history response includes it.
          setAllSubmissionsList([...attempts, ...owner.accepted.values()]);
          setTestResults((previous) => mergeAttemptTestResults(previous, attempts));
          setSubmissionHistoryStatus("available");
        } catch (err) {
          if (!isCurrent()) return;
          setSubmissionHistoryStatus((prev) =>
            prev === "available" || prev === "stale" ? "stale" : "unavailable"
          );
          console.error("Failed to fetch submissions:", err);
        } finally {
          owner.pending = null;
          if (isCurrent() && !owner.queued) setLoadingSubmissions(false);
        }
      });
      return owner.pending;
    };
    if (owner.queued) return owner.queued;
    if (owner.pending) {
      // A submission accepted during a GET needs a subsequent GET. Share that
      // follow-up across question switches/poll ticks, and await only that GET
      // so later poll ticks cannot keep the Submit action waiting indefinitely.
      owner.queued ??= owner.pending.then(() => {
        owner.queued = null;
        return refresh();
      });
      return owner.queued;
    }
    return refresh();
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
      // The sampling loop stops while the camera is off, so the last status
      // would otherwise stay on screen for the rest of the paper.
      if (!value) setPresenceStatus("presence_ok");
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
      const live = await getSession(stored.id);
      if (disposed || leavingWorkspaceRef.current) return;
      unauthorizedAtRef.current = null;
      livePhase = live.phase;

      if (live.status === "submitted" || live.status === "terminated") {
        // Finished. Re-entering needs an invigilator, and that lives on /home.
        await redirectAfterRelease("/home");
        return;
      }

      // The API's get-session path activates pending sessions using its own
      // clock and current roster. Never recreate/reopen at the bell: doing so
      // would put every pre-created session back into the same POST burst.
      if (live.status === "pending") {
        failRetryable(
          "Waiting for the server to open your session. This page will retry automatically."
        );
        return;
      }

      const { index, questions } = await loadContestPaper(contestId);
      if (disposed || leavingWorkspaceRef.current) return;
      // Held for the cleanup below. Blob URLs are document references the
      // browser keeps alive until revoked explicitly, not garbage-collected
      // values.
      loadedObjectUrls = questions.flatMap((question) =>
        (question.cxxprobe?.assets ?? []).map((asset) => asset.object_url).filter(Boolean)
      );

      const initialReferenceSheet = readReferenceSheet(index.reference_sheet);
      referenceRevisionRef.current = initialReferenceSheet?.revision ?? 0;
      setContest({
        id: index.uid,
        reference_sheet: initialReferenceSheet,
        title: index.title,
        start_at: index.starts_at,
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
      // The device buffer is primary. The server's backup copy only matters
      // when it is newer or the buffer is gone (a spare machine), which
      // `chooseRestore` decides; failing to fetch it must not stop the room.
      const serverDrafts = await listDrafts(live.uid).catch(() => [] as Draft[]);
      if (disposed) return;
      const restoredFiles: Record<string, EditorFile[]> = {};
      const restoredActiveFiles: Record<string, string> = {};
      // A first offline draft may have no server row at all. Enumerate the paper.
      for (const question of questions) {
        const buffered = readAnswerBuffer(localStorage, live.uid, question.id);
        const server = serverDrafts.find((draft) => draft.problem_label === question.id) ?? null;
        draftRevisionsRef.current[question.id] = Math.max(
          buffered?.revision ?? 0,
          server?.client_revision ?? 0
        );
        if (server) serverDraftRef.current[question.id] = `${server.language}\n${server.source}`;
        const workspace = restoreDraftWorkspace(
          question.id,
          question.starter_filename ?? questionFileName(question, "C++23"),
          buffered,
          server
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
        const step = onUnauthorized(unauthorizedAtRef.current, Date.now());
        unauthorizedAtRef.current = step.firstAt;
        if (step.signedOut) {
          void redirectAfterRelease("/login");
          return;
        }
        setLoadError("Checking your sign-in. This page will retry in a few seconds.");
        setLoadRetryable(true);
        setLoading(false);
        retryTimer = setTimeout(() => setLoadAttempt((n) => n + 1), AUTH_RECHECK_MS);
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
      // Indent the starter on the way in, so a skeleton always opens tidy
      // whatever the setter pasted. Only on this branch: a saved draft is
      // the candidate's own work, and reformatting it under them on every
      // question switch would be both a surprise and a diff they did not
      // ask for.
      content = formatSource(
        q.starter_code ?? defaultStarterFor(lang),
        resolveLanguageBundle(lang)
      );
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

  // Starting another Run replaces only that question's selected output kind.
  // Navigation retains its attempt and lets the existing bounded poll finish.
  function resetRunPanelState(mode?: "all" | "custom") {
    runVisitRef.current += 1;
    setRunSourceSnapshot(null, mode ?? runMode);
    setRunSlices((prev) =>
      mode ? { ...prev, [mode]: EMPTY_RUN } : { all: EMPTY_RUN, custom: EMPTY_RUN }
    );
  }

  function switchQuestion(idx: number) {
    if (questions[activeQ] && sessionId) {
      handleSave();
    }
    setActiveQ(idx);
    if (!editorLocked) setHasUnsavedChanges(true);
    loadQuestion(questions[idx], selectedLanguage);
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
    const changeFiles = (files: EditorFile[]) =>
      files.map((f) => {
        if (!f.id.endsWith(":main")) return f;
        return {
          ...f,
          name: questionFileName(q, normalizedLanguage),
          content: isPristineStarter(f.content) ? defaultStarterFor(normalizedLanguage) : f.content,
        };
      });
    const latest = latestActiveDraftRef.current;
    const files = changeFiles(
      latest?.sessionId === sessionId && latest.questionId === q.id ? latest.files : editorFiles
    );
    latestActiveDraftRef.current = {
      sessionId,
      questionId: q.id,
      fileId: activeFileId,
      source: files.find((f) => f.id === activeFileId)?.content ?? "",
      language: toLanguageId(normalizedLanguage),
      files,
    };
    writeLocalAnswerBuffer();
    setQuestionFiles((prev) => (prev[q.id] ? { ...prev, [q.id]: changeFiles(prev[q.id]) } : prev));
  }

  function handleResetCode() {
    const question = questions[activeQ];
    if (editorLocked || !question || !activeFileId.endsWith(":main")) return;
    handleCodeChange(
      formatSource(
        (selectedLanguage.startsWith("C++") ? question.starter_code : null) ??
          defaultStarterFor(selectedLanguage),
        resolveLanguageBundle(selectedLanguage)
      )
    );
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
    const latest = latestActiveDraftRef.current;
    const files = (
      latest?.sessionId === sessionId && latest.questionId === qId ? latest.files : editorFiles
    ).map((f) => (f.id === currentActiveId ? { ...f, content: value } : f));
    latestActiveDraftRef.current = {
      sessionId,
      questionId: qId,
      fileId: currentActiveId,
      source: value,
      language:
        latest?.sessionId === sessionId && latest.questionId === qId
          ? latest.language
          : toLanguageId(selectedLanguage),
      files,
    };
    writeLocalAnswerBuffer();
    setQuestionFiles((prev) => ({
      ...prev,
      [qId]: (prev[qId] ?? []).map((f) =>
        f.id === currentActiveId ? { ...f, content: value } : f
      ),
    }));
  }

  function activeDraftSnapshot() {
    const latest = latestActiveDraftRef.current;
    if (latest?.sessionId === sessionId && latest.questionId === questions[activeQ]?.id)
      return latest;
    return {
      files: editorFiles,
      fileId: activeFileId,
      source: editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
      language: toLanguageId(selectedLanguage),
    };
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

    const mode: "all" | "custom" = useCustomCases ? "custom" : "all";
    setResultSelections((previous) => ({
      ...previous,
      [questions[activeQ].id]: { source: "run" },
    }));
    const limitError = attemptLimitError(
      editorFiles.find((f) => f.id === activeFileId)?.content ?? "",
      useCustomCases ? toWire(casesOverride ?? customCases) : null
    );
    if (limitError) {
      setRunMode(mode);
      resetRunPanelState(mode);
      patchRun(mode, { error: limitError });
      return;
    }
    runInFlightRef.current = true;
    setRunMode(mode);
    setIsRunning(true);
    resetRunPanelState(mode);
    const runVisit = runVisitRef.current;
    setSubmitError(null);

    // Persist the current code before dispatching to the judge. A failed
    // device write is surfaced by the draft status; it does not block a run,
    // which sends the source to the judge directly.
    const runDraft = activeDraftSnapshot();
    await handleSave();
    if (runVisit !== runVisitRef.current) return;

    // Dispatch the run. Unscored, judged against the samples only, and at a
    // higher priority than submissions — feedback that arrives after the
    // contest is not feedback.
    let attemptId: string | null = null;
    try {
      setRunSourceSnapshot(
        {
          fileId: runDraft.fileId,
          questionId: questions[activeQ].id,
          problemTitle: questions[activeQ].title,
          filename: runDraft.files.find((f) => f.id === runDraft.fileId)?.name ?? "main.cpp",
          source: runDraft.source,
          language: runDraft.language,
        },
        mode
      );
      const created = await runAgainstSamples(sessionId, {
        problemLabel: questions[activeQ].id,
        language: runDraft.language,
        source: runDraft.source,
        // Only when the candidate pressed Run Custom. An ordinary Run must
        // send nothing here, or the samples are never reached.
        customCases: useCustomCases ? toWire(casesOverride ?? customCases) : null,
      });
      if (runVisit !== runVisitRef.current) return;
      const resolvedId = created.uid;
      attemptId = resolvedId;
      patchRun(mode, {
        result: { id: resolvedId, attempt_no: 0, status: "QUEUED" },
        attemptId: resolvedId,
      });
    } catch (caught) {
      if (runVisit !== runVisitRef.current) return;
      setIsRunning(false);
      if (caught instanceof ProctorApiError && caught.status === 429) {
        // A live countdown: "Please wait ~300s" was a number to do sums with.
        // Stops when the candidate runs again or switches problem.
        const until = Date.now() + (caught.retryAfterSeconds || 5) * 1000;
        const code = caught.code;
        const tick = () => {
          const left = (until - Date.now()) / 1000;
          if (runVisit !== runVisitRef.current) return clearInterval(timer);
          if (left <= 0) {
            clearInterval(timer);
            patchRun(mode, { error: null });
            return;
          }
          patchRun(mode, { error: runCooldownMessage(code, left) });
        };
        const timer = setInterval(tick, 1000);
        tick();
      } else if (caught instanceof ProctorApiError && caught.status === 503) {
        patchRun(mode, { error: "The judge is temporarily unavailable. Try Run again shortly." });
      } else if (caught instanceof ProctorApiError && caught.status >= 400) {
        // The server said why (a closed session, a validation error, a server
        // fault with its reference). "Could not reach the judge" was untrue.
        patchRun(mode, { error: caught.message });
      } else {
        patchRun(mode, {
          error: "Could not reach the judge. Check your connection and retry.",
        });
      }
      return;
    } finally {
      if (!attemptId && runVisit === runVisitRef.current) runInFlightRef.current = false;
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
      mode,
      sessionId,
      attemptId,
      runVisit,
      [
        600, 1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000, 3500, 4000, 4000, 5000, 5000, 5000,
        5000, 6000, 6000, 6000, 6000, 6000, 6000,
      ]
    ).finally(() => {
      if (runVisit === runVisitRef.current) runInFlightRef.current = false;
    });
  }

  // Polls one run by uid until it has a verdict or `delays` runs out. Out of
  // budget is not the end of the run: it stays identified by
  // runResultAttemptId, and "Check again" (recheckRun) resumes polling it.
  async function pollRun(
    mode: "all" | "custom",
    sessionId: string,
    attemptId: string,
    runVisit: number,
    delays: number[]
  ) {
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
          patchRun(mode, { result: normalized });
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
    if (runVisit !== runVisitRef.current) return;
    setIsRunning(false);
    patchRun(mode, { error: null, timedOut: true });
    // The timed-out state stays visible in the run pane — the run is never an
    // attempts row to navigate to.
  }

  // Recheck the pane the candidate selected, never POST a duplicate job.
  function recheckRun(mode: "all" | "custom") {
    const attemptId = runSlices[mode].attemptId;
    if (!sessionId || !attemptId || isRunning || runInFlightRef.current) return;
    runVisitRef.current += 1;
    const runVisit = runVisitRef.current;
    runInFlightRef.current = true;
    setRunMode(mode);
    patchRun(mode, { timedOut: false });
    setIsRunning(true);
    void pollRun(mode, sessionId, attemptId, runVisit, [0, 2000, 4000]).finally(() => {
      if (runVisitRef.current === runVisit) runInFlightRef.current = false;
    });
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
    const draft = activeDraftSnapshot();
    const saved = writeAnswerBuffer(localStorage, sessionId, qId, {
      language: draft.language,
      // Every tab, not just the active one. Scratch tabs were persisted
      // nowhere at all — not locally and not on the server, which only ever
      // receives the active file.
      files: draft.files,
      activeFileId: draft.fileId,
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
  // What it buys is that a flaky connection can no longer put "Save failed —
  // retry before submitting" in front of someone mid-contest about code that
  // was never actually at risk. So work can still follow the candidate to a
  // spare machine, a silent background backup (below) copies the buffer to
  // the server when it changes; this save never waits on it.
  async function doSave(): Promise<boolean> {
    if (!questions[activeQ] || !sessionId) return false;
    const qId = questions[activeQ].id;
    // A failed write leaves the work dirty: nothing durable holds it.
    if (!writeLocalAnswerBuffer()) return false;
    const draft = activeDraftSnapshot();
    setSavedAnswers((prev) => ({
      ...prev,
      [qId]: {
        language: draft.language,
        content: draft.source,
      },
    }));
    setHasUnsavedChanges(false);
    return true;
  }

  function handleSave(): Promise<boolean> {
    return doSave();
  }

  async function handleSubmitSolution() {
    if (!questions[activeQ] || !sessionId) {
      setSubmissionError("No active session is available.");
      return;
    }
    // In-flight guard: block a second POST while one is pending so rapid
    // double-clicks / retries can't enqueue duplicate attempts.
    if (submitInFlightRef.current || exitInFlightRef.current) return;
    const limitError = attemptLimitError(
      editorFiles.find((f) => f.id === activeFileId)?.content ?? ""
    );
    if (limitError) {
      setSubmissionError(limitError);
      return;
    }
    submitInFlightRef.current = true;
    const submissionOwner = submissionRefreshRef.current;

    setIsSubmitting(true);
    setSubmissionError(null);
    setResultSelections((previous) => ({
      ...previous,
      [questions[activeQ].id]: { source: "submission" },
    }));

    try {
      const qId = questions[activeQ].id;
      const draft = activeDraftSnapshot();
      const submittedSource = {
        source: draft.source,
        language: draft.language,
      };
      const retryKey = `ams_pending_submission:${sessionId}:${qId}`;
      let previousRequest = submitKeyRef.current;
      let storedRaw: string | null;
      try {
        storedRaw = localStorage.getItem(retryKey);
      } catch {
        setSubmissionError(
          "Could not read the submission retry record on this device. Ask an invigilator before submitting."
        );
        return;
      }
      let recoveredRetry = false;
      try {
        const stored = JSON.parse(storedRaw ?? "null");
        if (
          stored &&
          stored.sessionId === sessionId &&
          stored.problemLabel === qId &&
          typeof stored.language === "string" &&
          typeof stored.source === "string" &&
          typeof stored.idempotencyKey === "string" &&
          stored.idempotencyKey.length > 0 &&
          stored.idempotencyKey.length <= 64 &&
          stored.idempotencyKey !== acknowledgedSubmitKeysRef.current[retryKey]
        ) {
          previousRequest = stored;
          recoveredRetry =
            stored.language === submittedSource.language &&
            stored.source === submittedSource.source;
        }
      } catch {
        // Malformed stored data has no usable retry identity.
      }
      if (
        !previousRequest ||
        previousRequest.sessionId !== sessionId ||
        previousRequest.problemLabel !== qId ||
        previousRequest.language !== submittedSource.language ||
        previousRequest.source !== submittedSource.source
      ) {
        previousRequest = {
          sessionId,
          problemLabel: qId,
          ...submittedSource,
          idempotencyKey: newIdempotencyKey(),
        };
      }
      // The key must survive a crash after server acceptance but before its
      // response arrives. Refuse the POST if this device cannot retain it.
      try {
        localStorage.setItem(retryKey, JSON.stringify(previousRequest));
      } catch {
        setSubmissionError(
          "Could not save the submission retry record on this device. Free storage or ask an invigilator before submitting."
        );
        return;
      }
      submitKeyRef.current = previousRequest;
      // A lost response must not make changed code (or another problem) reuse
      // the original attempt. Send the same snapshot used to select the key.
      const request = previousRequest;
      let created;
      try {
        created = await submitSolution(request.sessionId, {
          problemLabel: request.problemLabel,
          language: request.language,
          source: request.source,
          idempotencyKey: request.idempotencyKey,
        });
      } catch (caught) {
        if (caught instanceof ProctorApiError && caught.status === 503) {
          // ams-api answers 503 here only after committing the submission row
          // and failing to queue it, so the attempt exists. The key is kept,
          // so pressing Submit again replays this attempt, not a new one.
          setSubmissionError("Judging is temporarily unavailable; your attempt was recorded.");
          return;
        }
        if (caught instanceof ProctorApiError) {
          // 409 is a closed session, 429 a rate limit; both already carry a
          // sentence written for a candidate, so pass it through rather than
          // mapping it to a worse one here.
          setSubmissionError(caught.message);
          return;
        }
        throw caught;
      }

      // Accepted, so this click is finished with. The next one is a new
      // attempt and must not be deduplicated against this.
      submitKeyRef.current = null;
      acknowledgedSubmitKeysRef.current[retryKey] = request.idempotencyKey;
      let cleanupFailed = false;
      try {
        localStorage.removeItem(retryKey);
      } catch {
        try {
          // A small tombstone lets a restarted app distinguish an acknowledged
          // attempt from one whose response was lost.
          localStorage.setItem(retryKey, JSON.stringify({ acknowledged: true }));
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed)
        setSubmissionError(
          "Submission accepted, but this device could not clear its retry record. A retry after restart may return this attempt; ask an invigilator if you need another."
        );
      else if (recoveredRetry)
        setSubmissionError(
          "Confirmed an earlier submission request. Check the attempt list before submitting again."
        );
      setSubmittedSources((prev) => ({ ...prev, [created.uid]: submittedSource }));
      if (
        submissionOwner?.active &&
        submissionOwner === submissionRefreshRef.current &&
        submissionOwner.sessionId === sessionId
      ) {
        const receipt = toAttemptRecords([created])[0];
        receipt.attempt_no =
          Math.max(
            0,
            ...allSubmissionsList
              .filter((entry) => entry.problem_id === receipt.problem_id)
              .map((entry) => entry.attempt_no)
          ) + 1;
        submissionOwner.accepted.set(receipt.id, receipt);
        setAllSubmissionsList((previous) => {
          if (previous.some((attempt) => attempt.id === receipt.id)) return previous;
          return [receipt, ...previous];
        });
        setTestResults((previous) => ({ ...previous, [receipt.id]: receipt.testcases }));
      }
    } catch (err: any) {
      setSubmissionError(err.message || "An unexpected error occurred.");
      return;
    } finally {
      setIsSubmitting(false);
      submitInFlightRef.current = false;
    }
    // Acceptance is complete; history refresh must not block Finish or hold
    // the POST guard, and its completion must not clear a newer request.
    await fetchSubmissions();
  }

  // Exit teardown: release every OS-level lock and stop proctoring. This MUST run
  // on every exit path — confirmed or not — so a network failure can never trap a
  // candidate inside the locked-down shell. Every step is failure-tolerant.
  async function runExitTeardown(
    preserveSession = false,
    startedExitPhoto?: Promise<void>
  ): Promise<boolean> {
    let released = true;
    try {
      // Remember which session this was before dropping it. The results
      // screen opens after this runs and has nothing else to go on.
      if (!preserveSession && readStoredSession()?.id === sessionId) {
        const finished = localStorage.getItem(ACTIVE_SESSION_KEY);
        if (finished) localStorage.setItem(STORAGE_KEYS.LAST_SESSION, finished);
        localStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {
      // ignore storage errors
    }
    // Capture reads the bearer synchronously before upload starts. An already
    // started photo is reused after sign-out; upload never gates local recovery.
    void (startedExitPhoto ?? exitPhotoRef.current()).catch(() => {});
    cameraClosedRef.current = true;
    try {
      cameraSession.release();
    } catch {
      released = false;
    }
    cameraStreamRef.current = null;
    setCameraStream(null);
    const release = await releaseDeviceControls();
    const pending = releaseRestoreStatus(release);
    setRestoreStatus(
      released
        ? pending
        : {
            pending: true,
            items: [
              ...(pending?.items ?? []),
              { label: "Camera release could not be confirmed", fix_command: "" },
            ],
          }
    );
    released = released && (release.outcome === "confirmed" || release.outcome === "browser");
    return released;
  }

  // Redirects release native controls without finishing the exam or removing
  // its recovery record. Revoke upload credentials while retaining the native
  // recording binding, so teardown evidence remains with the same session.
  function requestLeave() {
    // Refresh local persistence before describing it in the confirmation.
    let saved = false;
    try {
      saved = redirectSaveRef.current() && unsavedOnDeviceRef.current.length === 0;
    } catch {
      /* Save state remains unverified. */
    }
    setLeaveDraftSaved(saved);
    setSubmitConfirm(false);
    setLeaveConfirm(true);
  }

  async function redirectAfterRelease(destination: string, allowPendingFinish = false) {
    if (
      redirectInFlightRef.current ||
      (exitInFlightRef.current && !allowPendingFinish && !leavingWorkspaceRef.current)
    )
      return;
    leavingWorkspaceRef.current = true;
    setLeaveConfirm(false);
    redirectInFlightRef.current = true;
    setPendingRedirect(destination);
    setLoadError(null);
    let signedOut = false;
    const signOut = () => {
      if (destination === "/login" && !signedOut) {
        logout();
        clearQueryCache();
        signedOut = true;
      }
    };
    let revoked = true;
    let exitPhoto: Promise<void> | undefined;
    try {
      try {
        redirectSaveRef.current();
      } catch {
        // Storage failures must never prevent releasing native controls.
      }
      if (destination === "/login") {
        // Start the evidence request while its bearer still exists, then revoke
        // credentials immediately. Do not wait for optional evidence delivery.
        exitPhoto = exitPhotoRef.current().catch(() => {});
        signOut();
      }
      // Start local restoration before credential cleanup. A stalled event
      // stream must not delay restoring fullscreen, input or network controls.
      const releaseWork = runExitTeardown(true, exitPhoto);
      const revokeWork = (async () => {
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
      })();
      const [released] = await Promise.all([releaseWork, revokeWork]);
      if (released && revoked) {
        router.replace(destination);
      } else {
        setLoadError(
          "Device cleanup could not be confirmed. Session recovery is kept, but a local draft is not a submitted solution. Retry restoration; ask an invigilator if device controls remain restricted."
        );
      }
    } finally {
      signOut();
      redirectInFlightRef.current = false;
    }
  }

  // A finish acknowledgement and a draft-save acknowledgement are separate.
  // Retry is bounded; teardown still runs on failure so nobody is trapped.
  async function handleSubmitConfirmed() {
    if (exitInFlightRef.current || leavingWorkspaceRef.current) return;
    // Check the ref as well as disabling the button: React may not have rendered
    // the submitting state yet when a second action arrives. Judging can continue
    // after acceptance; only the outstanding submission request blocks finish.
    if (submitInFlightRef.current) {
      setSubmitError(
        "Wait for your solution submission to finish before finishing the attempt. You can still leave the workspace."
      );
      return;
    }
    exitInFlightRef.current = true;
    setSubmitConfirm(false);
    setShowSupportModal(false);
    setSubmitError(null);
    setSubmitWarning(null);
    setTimeUpState("submitting");
    const receipt = sessionId
      ? await requestFinish({
          save: handleSave,
          isCancelled: () => leavingWorkspaceRef.current,
          finish: async () => {
            if (leavingWorkspaceRef.current) throw new Error("Workspace left");
            const controller = new AbortController();
            try {
              return await withTimeout(
                (async () => {
                  const response = await postJsonKeepalive(
                    `${API_URL}/participant/sessions/${sessionId}/finish`,
                    undefined,
                    { headers: authHeaders(), signal: controller.signal }
                  );
                  const errorBody = response.ok ? null : await response.json().catch(() => null);
                  return { ok: response.ok, json: async () => errorBody };
                })(),
                10000,
                "Finish response timed out"
              );
            } finally {
              controller.abort();
            }
          },
          wait: (attempt) =>
            new Promise<void>((resolve) =>
              setTimeout(
                resolve,
                Math.min(1500 * 2 ** attempt, 8000) + Math.round(Math.random() * 400)
              )
            ),
        })
      : { confirmed: false, draftSaved: false };
    // Leaving retains recovery for normal server reconciliation. A late finish
    // reply must not clear another session or navigate back into this workspace.
    if (leavingWorkspaceRef.current) return;
    const draftSaved = receipt.draftSaved && unsavedOnDeviceRef.current.length === 0;
    setFinalDraftSaved(draftSaved);
    if (!draftSaved)
      setSubmitWarning(
        "The latest draft could not be saved on this device. Previously acknowledged submissions are separate from draft saves."
      );
    try {
      await runExitTeardown(!receipt.confirmed);
    } finally {
      // Keep the workspace locked, but allow an explicit bounded finish retry.
      // An unconfirmed request must retain Home's Resume recovery record.
      if (!receipt.confirmed) exitInFlightRef.current = false;
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
    setRunSlices((prev) => ({
      all: { ...prev.all, error: null },
      custom: { ...prev.custom, error: null },
    }));
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

  // Ten minutes after the bell, leave as if Submit & Exit had been pressed.
  // A candidate who walked away otherwise leaves a lab Mac locked until
  // someone finds it; the paper is closed, so nothing can be lost. A ref, so
  // the timer runs the current handler and its in-flight guards.
  const finishHandlerRef = useRef(handleSubmitConfirmed);
  finishHandlerRef.current = handleSubmitConfirmed;
  useEffect(() => {
    if (!bellRung) return;
    const id = setTimeout(() => void finishHandlerRef.current(), 10 * 60_000);
    return () => clearTimeout(id);
  }, [bellRung]);

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
    let acquiring = false;
    let bindingGeneration = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = (callback: () => void, delay: number) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!cancelled) callback();
      }, delay);
    };

    const stopStream = (stream: MediaStream | null) => {
      if (stream) cameraSession.releaseVideo(stream, { preserveRecovery: true });
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
      const binding = ++bindingGeneration;
      const video = cameraVideoRef.current;
      if (!video) {
        if (attempt < 3) {
          scheduleRetry(() => {
            if (!cancelled) void bindStream(stream, attempt + 1);
          }, 150);
        }
        return;
      }

      const ready = await attachVideoStream(video, stream);
      if (cancelled || binding !== bindingGeneration || cameraStreamRef.current !== stream) return;

      setCameraVideoReady(ready);
      if (!ready) setProctoringOk(false);
      if (!ready && attempt < 2) {
        stopStream(stream);
        scheduleRetry(() => {
          if (!cancelled) void acquire(attempt + 1);
        }, 700);
      } else if (!ready) {
        setCameraError(
          "Camera opened, but no video frames were received. Close other camera apps and try again."
        );
      }
    }

    async function acquire(attempt = 0) {
      if (cameraClosedRef.current || cancelled || acquiring) return;
      acquiring = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
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
          scheduleRetry(() => {
            if (!cancelled) void acquire(attempt + 1);
          }, 900);
          return;
        }

        setCameraVideoReady(false);
        setProctoringOk(false);
        setFaceStatus("away");
        setCameraError(displayCameraError(err));
      } finally {
        acquiring = false;
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
      // Keep the audio handle reachable by the microphone toggle while the
      // video is lost. Hide the camera stream and invalidate old preview work.
      bindingGeneration += 1;
      setCameraStream(null);
      setCameraVideoReady(false);
      setProctoringOk(false);
      if (retryTimer) clearTimeout(retryTimer);
      setCameraError("The camera was disconnected. Reconnect it to resume monitoring.");
      scheduleRetry(() => {
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
  }, [loading, cameraPickKey]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;
    let latestRequest = 0;
    let acceptedSuccess = 0;
    let authExpired = false;
    let terminal = false;
    let requestedReferenceRevision = 0;
    let referenceTimer: ReturnType<typeof setTimeout> | null = null;
    let announcementTimer: ReturnType<typeof setTimeout> | null = null;
    let requestedAnnouncementRevision = seenRevisionRef.current;

    // Same shape as refreshReference below, for the same reasons: guarded
    // against overlap, staggered so a thousand clients do not arrive at
    // once, and leaving the revision unseen on failure so the next
    // heartbeat retries rather than losing a postponement to one bad
    // request.
    const refreshAnnouncements = async () => {
      announcementTimer = null;
      if (
        cancelled ||
        authExpired ||
        activeContestIdRef.current !== contestId ||
        announcementFetchInFlightRef.current
      )
        return;
      if (requestedAnnouncementRevision <= seenRevisionRef.current) return;
      announcementFetchInFlightRef.current = true;
      const expectedRevision = requestedAnnouncementRevision;
      try {
        const payload = await listAnnouncements(contestId);
        if (cancelled || authExpired || activeContestIdRef.current !== contestId) return;
        seenRevisionRef.current = expectedRevision;
        setAnnouncements(readAnnouncements(payload));
      } catch (caught) {
        if (cancelled || authExpired) return;
        if (caught instanceof ProctorApiError && caught.status === 401) unauthorized();
        // Revision deliberately not advanced: retried on the next heartbeat.
      } finally {
        announcementFetchInFlightRef.current = false;
      }
    };

    const refreshReference = async () => {
      referenceTimer = null;
      if (
        cancelled ||
        authExpired ||
        terminal ||
        activeContestIdRef.current !== contestId ||
        referenceFetchInFlightRef.current
      )
        return;
      if (requestedReferenceRevision === referenceRevisionRef.current) return;
      referenceFetchInFlightRef.current = true;
      const requestAtFetch = latestRequest;
      const expectedRevision = requestedReferenceRevision;
      try {
        const latest = await getPublishedReferenceSheet(contestId);
        if (
          cancelled ||
          authExpired ||
          terminal ||
          activeContestIdRef.current !== contestId ||
          latest.revision !== expectedRevision ||
          expectedRevision !== requestedReferenceRevision
        )
          return;
        const sheet = readReferenceSheet(latest.reference_sheet);
        if ((sheet?.revision ?? 0) !== latest.revision) return;
        referenceRevisionRef.current = latest.revision;
        setContest((prev) => (prev?.id === contestId ? { ...prev, reference_sheet: sheet } : prev));
      } catch (caught) {
        if (
          cancelled ||
          authExpired ||
          terminal ||
          activeContestIdRef.current !== contestId ||
          requestAtFetch < acceptedSuccess
        )
          return;
        if (caught instanceof ProctorApiError && caught.status === 401) unauthorized();
        // Keep the last published sheet offline; retry a changed revision on the next heartbeat.
      } finally {
        referenceFetchInFlightRef.current = false;
      }
    };

    // AUTH-1: one 401 is provisional; it signs out only if it repeats after a
    // recheck (see `auth-loss.ts`). Every 401 path here goes through this.
    const unauthorized = () => {
      const step = onUnauthorized(unauthorizedAtRef.current, Date.now());
      unauthorizedAtRef.current = step.firstAt;
      if (step.signedOut) {
        authExpired = true;
        // The token expired mid-exam. Keep `ams_active_session` so the
        // resume path still has something to resume.
        void redirectAfterRelease("/login");
        return;
      }
      // Provisional: recheck soon rather than at the next minute's beat.
      if (recheckTimer === null) {
        recheckTimer = setTimeout(() => {
          recheckTimer = null;
          void beat();
        }, AUTH_RECHECK_MS);
      }
    };

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
      const request = ++latestRequest;
      try {
        const live = await heartbeat(sessionId);
        if (cancelled || authExpired || request !== latestRequest) return;
        acceptedSuccess = request;

        unauthorizedAtRef.current = null;
        // A server reply is stronger evidence than navigator.onLine's hint.
        setBrowserOnline(true);
        setHeartbeatState((prev) => onHeartbeatSuccess(prev, Date.now()));

        // The server's word on where we are, once a minute. This corrects any
        // drift and is authoritative over local deadline arithmetic.
        setContestPhase(live.phase);
        setClockSynced(true);

        // An announcement is waiting. Staggered like the reference refresh
        // below: a thousand clients learning of the same publish within the
        // same minute must not all fetch on the same tick.
        if (shouldFetch(seenRevisionRef.current, live.announcement_revision)) {
          requestedAnnouncementRevision = live.announcement_revision!;
          if (announcementTimer === null && !announcementFetchInFlightRef.current) {
            announcementTimer = setTimeout(
              () => void refreshAnnouncements(),
              Math.floor(Math.random() * 10_001)
            );
          }
        }
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
          terminal = true;
          setSessionEnded("terminated");
        } else if (live.status === "submitted") {
          terminal = true;
          setSessionEnded("submitted");
        }
        if (
          activeContestIdRef.current === contestId &&
          live.ends_at === null &&
          live.status === "active"
        ) {
          // Older API deployments omit the revision. Keep the entry preload until the API is upgraded.
          if (Number.isSafeInteger(live.reference_revision) && live.reference_revision! >= 0) {
            requestedReferenceRevision = live.reference_revision!;
            if (requestedReferenceRevision !== referenceRevisionRef.current) {
              if (referenceTimer === null && !referenceFetchInFlightRef.current) {
                referenceTimer = setTimeout(
                  () => void refreshReference(),
                  Math.floor(Math.random() * 10_001)
                );
              }
            } else if (referenceTimer !== null) {
              clearTimeout(referenceTimer);
              referenceTimer = null;
            }
          }
        } else if (referenceTimer !== null) {
          clearTimeout(referenceTimer);
          referenceTimer = null;
        }
      } catch (caught) {
        if (cancelled || authExpired) return;
        if (caught instanceof ProctorApiError && caught.status === 401) {
          // A newer transport failure cannot invalidate an earlier auth rejection.
          // A newer accepted server reply can: it proved the session is still valid.
          if (request <= acceptedSuccess) return;
          unauthorized();
          return;
        }
        if (request !== latestRequest) return;
        setHeartbeatState(onHeartbeatFailure);
      }
    };

    // `beat` is defined above; expose it now that it exists.
    let manualRetry: Promise<void> | null = null;
    const retry = () => {
      if (cancelled || authExpired || manualRetry) return;
      // Repeated clicks/online events share this attempt. The periodic heartbeat
      // and auth recheck retain their independent recovery/ordering guarantees.
      const pending = beat();
      manualRetry = pending;
      void pending.finally(() => {
        if (manualRetry === pending) manualRetry = null;
      });
    };
    retryBeatRef.current = retry;
    // A browser "offline" hint suppresses only the immediate request. The
    // minute poll still checks for recovery if an online event never arrives.
    if (browserOnline) void beat();
    const id = setInterval(() => void beat(), 60_000);
    return () => {
      cancelled = true;
      if (referenceTimer !== null) clearTimeout(referenceTimer);
      if (announcementTimer !== null) clearTimeout(announcementTimer);
      if (retryBeatRef.current === retry) retryBeatRef.current = () => {};
      clearInterval(id);
      if (recheckTimer) clearTimeout(recheckTimer);
    };
    // Recheck immediately on reconnect; ignore the previous connection's replies.
  }, [sessionId, contestId, contest?.id, router, browserOnline]);

  // Background backup of the device buffer to the server, only for problems
  // whose answer changed since the server last accepted one. It never blocks
  // and never shows an error; a failure that will not clear by itself (no
  // route to the server, or drafts closed) stops it for this session.
  useEffect(() => {
    if (!sessionId || questions.length === 0) return;
    let cancelled = false;
    const backup = async () => {
      if (cancelled || draftBackupFlightRef.current) return;
      draftBackupFlightRef.current = true;
      try {
        for (const question of questions) {
          if (cancelled || draftBackupOffRef.current) return;
          const next = draftBackup(
            readAnswerBuffer(localStorage, sessionId, question.id),
            serverDraftRef.current[question.id]
          );
          if (!next) continue;
          try {
            const saved = await saveDraft(sessionId, question.id, {
              source: next.source,
              language: next.language,
              clientRevision: (draftRevisionsRef.current[question.id] ?? 0) + 1,
            });
            if (cancelled) return;
            // The server answers with what it holds, which is another device's
            // copy when ours was stale; the next tick then supersedes it.
            draftRevisionsRef.current[question.id] = Math.max(
              draftRevisionsRef.current[question.id] ?? 0,
              saved.client_revision
            );
            serverDraftRef.current[question.id] = `${saved.language}\n${saved.source}`;
          } catch (caught) {
            if (
              !cancelled &&
              caught instanceof ProctorApiError &&
              stopsDraftBackup(caught.status)
            ) {
              draftBackupOffRef.current = true;
            }
            return;
          }
        }
      } finally {
        draftBackupFlightRef.current = false;
      }
    };
    const id = setInterval(() => void backup(), DRAFT_BACKUP_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, questions]);

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

  // Screens, every ten seconds.
  //
  // The readiness probe counted them once, at the door. Plugging a monitor in
  // afterwards was invisible for the rest of the paper, and the exam being
  // pinned to one screen is no help at all when there is a second one next to
  // it. Reported once per run of a change, so a candidate sitting with a
  // second screen for two hours is one flag rather than seven hundred.
  const extraScreensReportedRef = useRef(false);
  useEffect(() => {
    if (!window.__TAURI__ || bellRung) return;
    let cancelled = false;
    const look = async () => {
      try {
        const count = (await window.__TAURI__?.core.invoke("count_monitors")) as number;
        if (cancelled || typeof count !== "number") return;
        setMonitorCount(count);
        if (count > 1) {
          if (!extraScreensReportedRef.current) {
            extraScreensReportedRef.current = true;
            reportViolation({
              kind: "extra_display",
              severity: "critical",
              detail: `${count} screens connected during the exam`,
              evidence: { monitors: count, contest_id: contestId },
            });
          }
        } else {
          extraScreensReportedRef.current = false;
        }
      } catch {
        // A probe that fails is not the candidate's problem.
      }
    };
    void look();
    const id = setInterval(() => void look(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bellRung, contestId]);

  // A steady flush, because reconnecting was the only thing that sent one.
  //
  // The queue persists to localStorage and batches, which is exactly right
  // for a candidate who drops off the network -- but the only caller was the
  // recovery path above, so a candidate whose connection never faltered
  // reached the end of the paper with every flag still sitting in their own
  // browser. Thirty seconds keeps the invigilation page close to live
  // without making a request per sample.
  useEffect(() => {
    if (!sessionId || bellRung) return;
    const id = setInterval(() => {
      void flushViolationQueue(sessionId);
    }, 30_000);
    return () => clearInterval(id);
  }, [sessionId, bellRung]);
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
  // POST /participant/sessions/:id/events with retry/backoff once it knows the session.
  useEffect(() => {
    if (!sessionId || redirectInFlightRef.current || pendingRedirect) return;
    void window.__TAURI__?.core
      .invoke("configure_event_stream", { apiUrl: API_URL, sessionId, token: participantToken() })
      .catch(() => {});
  }, [sessionId]);

  // The Mac slept mid-exam (lid closed, power key, Apple menu). Raised as an
  // incident, like a media toggle, so it reaches the organizer's incident
  // list. Sent on wake: at sleep the network is already going. Wi-Fi takes a
  // few seconds to rejoin after wake, so retry until it lands.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const unlisten = listen<{ kind: string; detail: string; payload?: { slept_secs?: number } }>(
      "lockdown-event",
      (event) => {
        if (cancelled || event?.kind !== "system_woke") return;
        // performance.now() can pause during Mac sleep. Refresh the server
        // anchor immediately through the existing single-flight heartbeat.
        retryBeatRef.current?.();
        const sleptSecs = event.payload?.slept_secs ?? 0;
        const body = {
          category: "system_sleep",
          message: `Mac went to sleep during the exam (lid closed or sleep) and was asleep for ${sleptSecs}s`,
          diagnostics: {
            timestamp: new Date().toISOString(),
            contest_id: contestId,
            session_id: sessionId,
            slept_secs: sleptSecs,
          },
          contact: "",
          contest_uid: contestId,
        };
        void (async () => {
          for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
            const sent = await postJsonKeepalive(
              `${API_URL}/participant/sessions/${sessionId}/incidents`,
              body,
              { headers: authHeaders() }
            )
              .then((response) => response.ok)
              .catch(() => false);
            if (sent) return;
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        })();
      }
    );
    return () => {
      cancelled = true;
      void unlisten.then((stop) => stop());
    };
  }, [sessionId, contestId]);

  // A camera-less advisory entry must leave evidence rather than creating a
  // silent hole in the invigilation timeline. This loop only records that a
  // sample was unavailable; camera acquisition remains owned by the bounded
  // acquisition effect above, and detector loading remains in the stream path.
  useEffect(() => {
    if (cameraStream || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      const event = presenceUnavailableEvent(contestId);
      void window.__TAURI__?.core
        .invoke("log_proctoring_event", { ...event, timestamp: Date.now() })
        .catch(() => {});
      timer = setTimeout(tick, nextPresenceEvidenceDelay(Math.random()));
    };

    // Give the bounded acquisition owner a full sampling interval before
    // recording absence; a transient null while it starts is not evidence.
    timer = setTimeout(tick, nextPresenceEvidenceDelay(Math.random()));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraStream, contestId, sessionId]);

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
    let objectDetector: Awaited<ReturnType<typeof loadObjectDetector>> | null = null;
    let objectDetectorFailed = false;
    // Consecutive bad samples, and whether this run of them has been sent.
    // Reported once per run: a candidate who steps away for two minutes is
    // one event, not twenty-four.
    let anomalyStreak = 0;
    let anomalyReported = false;
    const canvas = document.createElement("canvas");
    // Separate from the presence canvas on purpose: that one is 128x128 for
    // BlazeFace, and the object detector needs a great deal more than that
    // to see a phone at all.
    const objectCanvas = document.createElement("canvas");

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    keepPlaying(video);
    video.srcObject = cameraStream;
    void video.play().catch(() => {});

    // A small JPEG for an invigilator to look at, matching the one a
    // presence anomaly attaches. Returns null rather than throwing on a
    // frame the browser will not encode.
    const thumbnailOf = (source: HTMLVideoElement): string | null => {
      try {
        if (!source.videoWidth || !source.videoHeight) return null;
        const thumb = document.createElement("canvas");
        thumb.width = 160;
        thumb.height = Math.max(1, Math.round((160 * source.videoHeight) / source.videoWidth));
        thumb.getContext("2d")?.drawImage(source, 0, 0, thumb.width, thumb.height);
        return thumb.toDataURL("image/jpeg", 0.5);
      } catch {
        return null;
      }
    };

    // Whether a run of camera-off / phone-in-frame samples has already been
    // reported. Same contract as `anomalyReported`: a candidate who leaves a
    // phone on the desk for ten minutes is one flag, not a hundred and
    // twenty.
    let cameraOffReported = false;
    let objectReported = false;

    /**
     * Record one proctoring event.
     *
     * `severity` is what decides whether it also reaches the server. Local
     * recording is free; a row in `proctor.violations` is a claim about
     * somebody's exam, and the five-second presence sample is far too noisy
     * to make one of every tick. Only confirmed anomalies are uploaded, and
     * each is reported once per run rather than once per sample.
     */
    const logPresence = (
      kind: string,
      detail: string,
      payload: Record<string, unknown>,
      severity?: "info" | "warning" | "critical"
    ) => {
      // Browser-hosted dev has no Tauri bridge, so every one of these calls
      // is a no-op there -- which is how phone detection could be debugged
      // for an hour with the one event that explains it going nowhere.
      // The console is the timeline when there isn't one.
      if (!window.__TAURI__) {
        console.info(`[proctor] ${kind}: ${detail}`, payload);
        return;
      }
      void window.__TAURI__.core
        .invoke("log_proctoring_event", {
          kind,
          detail,
          timestamp: Date.now(),
          payload: { ...payload, contest_id: contestId },
        })
        .catch(() => {});

      // The upload half, which never existed. `enqueue` had no callers at
      // all: the queue, its batching, its offline persistence and its tests
      // were all complete, and nothing ever put an event in it. Every
      // proctoring event ever recorded stayed on the candidate's own
      // machine, so `proctor.violations` had no rows and the invigilation
      // page had nothing to draw.
      const session = sessionIdRef.current;
      if (severity && session) {
        enqueueViolation(session, {
          kind,
          severity,
          detail,
          evidence: { ...payload, contest_id: contestId },
        });
      }
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
            {},
            // Once per run. The camera being off is worth a flag; it is not
            // worth one every five seconds for as long as it stays off.
            cameraOffReported ? undefined : "warning"
          );
          cameraOffReported = true;
          // No frame, so no claim either way. Leaving a stale phone banner
          // up behind a disabled camera would be unanswerable.
          setObjectHint(null);
        } else {
          cameraOffReported = false;
          if (!detector && !detectorFailed) {
            try {
              detector = await loadPresenceDetector();
            } catch {
              detectorFailed = true;
              logPresence(
                "presence_monitor_unavailable",
                "face detector failed to initialise; periodic presence checks disabled",
                {},
                "info"
              );
            }
          }
          if (detector && !cancelled) {
            const sample = await samplePresence(video, detector, canvas);
            if (sample && !cancelled) {
              // Shown on the tile immediately, every sample. The border is
              // feedback for the candidate -- "the camera cannot see you" is
              // something they can act on in a second, and most of the time
              // acting on it is all that was needed.
              setPresenceStatus(sample.status);

              // Recorded only once it persists. At a five-second cadence a
              // glance at the keyboard or a blink caught mid-frame makes one
              // bad sample, which is noise; ANOMALY_STREAK of them in a row
              // is fifteen seconds, which is not.
              if (sample.status === "presence_ok") {
                anomalyStreak = 0;
                anomalyReported = false;
              } else {
                anomalyStreak += 1;
                if (anomalyStreak >= ANOMALY_STREAK && !anomalyReported) {
                  anomalyReported = true;
                  logPresence(
                    sample.status,
                    `presence check: ${sample.faces} face(s) over ${anomalyStreak} samples`,
                    {
                      faces: sample.faces,
                      samples: anomalyStreak,
                      // A readable frame, not the 96px indicator thumbnail:
                      // this is the one an invigilator opens.
                      thumbnail: thumbnailOf(video) ?? sample.thumbnail,
                      framing: sample.framing,
                    },
                    "warning"
                  );
                }
              }

              // Advice, not a flag. Most face_missing samples are someone who
              // has drifted out of shot while thinking, so saying so removes
              // the false reading at source. Cleared as soon as they are back.
              setFramingHint(sample.status === "presence_ok" ? sample.framing : "ok");
            }

            // Phone detection shares this tick deliberately: the frame is
            // already drawn and the models never run on the same pass, which
            // is what keeps the cost off an old laptop's main thread.
            if (!objectDetectorFailed && !cancelled) {
              if (!objectDetector) {
                try {
                  objectDetector = await loadObjectDetector();
                } catch {
                  // One attempt. A machine that cannot load this must not
                  // retry every minute for two hours.
                  objectDetectorFailed = true;
                  // Said out loud, which it was not before. The presence
                  // detector logs `presence_monitor_unavailable` when it
                  // cannot start; this latch was silent, so a bundle that
                  // shipped without the wasm runtime looked exactly like a
                  // room with no phones in it.
                  logPresence(
                    "object_monitor_unavailable",
                    "object detector failed to initialise; phone detection disabled",
                    {},
                    "info"
                  );
                }
              }
              if (objectDetector && !cancelled) {
                try {
                  // Drawn fresh at the detector's own resolution rather than
                  // reusing the 128px presence canvas, which is what kept
                  // this from ever detecting anything.
                  const drawn = drawForObjects(video, objectCanvas);
                  const frame = drawn ? sampleObjects(objectCanvas, objectDetector) : null;
                  const seen = frame?.found ?? null;
                  // Every frame, in dev only: the whole candidate list with
                  // scores. This is the difference between "the detector is
                  // dead" and "the phone scored 0.31", which look identical
                  // from the outside and want opposite fixes.
                  if (frame && process.env.NODE_ENV !== "production") {
                    console.debug(
                      "[proctor] objects:",
                      frame.candidates.length
                        ? frame.candidates.map((c) => `${c.label} ${c.score.toFixed(2)}`).join(", ")
                        : "(nothing above the detector threshold)"
                    );
                  }
                  if (!cancelled) {
                    // Told to the candidate as well as logged. Cleared as
                    // soon as a later sample is clean, the same way the
                    // presence border is: the banner tracks the frame, so
                    // moving the phone off the desk takes it away.
                    setObjectHint(seen ? (seen.label ?? null) : null);
                  }
                  if (seen && !cancelled) {
                    // Advisory, with a thumbnail, for a human to look at. At
                    // webcam resolution a dark rectangle is a phone, a wallet
                    // or a calculator case, so this decides nothing.
                    logPresence(
                      "object_suspected",
                      `possible ${seen.label} in frame`,
                      {
                        label: seen.label,
                        score: Number(seen.score.toFixed(3)),
                        thumbnail: thumbnailOf(video),
                      },
                      objectReported ? undefined : "warning"
                    );
                    objectReported = true;
                  } else if (!cancelled) {
                    // Clean frame: re-arm, so a phone put away and brought
                    // back out is two flags rather than one.
                    objectReported = false;
                  }
                } catch {
                  // A detector that throws mid-exam is not the candidate's
                  // problem either.
                }
              }
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
      // Five seconds, fixed.
      //
      // It was 30-90s jittered, which is a sampling rate for "was anyone
      // here" and far too coarse for "is the right person here now": a
      // substitution, or a second face leaning in, fits comfortably between
      // two samples. BlazeFace runs at 128x128 in about 7ms, so this costs a
      // fraction of a percent of one core.
      //
      // Unjittered on purpose. The jitter existed to spread uploads, and
      // this loop no longer uploads on every sample -- only a *confirmed*
      // anomaly sends anything, which is rare and already spread by being
      // driven by the candidate's own behaviour.
      timer = setTimeout(() => void tick(), PRESENCE_SAMPLE_MS);
    }
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      video.srcObject = null;
      detector?.dispose?.();
      detector = null;
      objectDetector?.close?.();
      objectDetector = null;
      setObjectHint(null);
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
  const photoInFlightRef = useRef(false);

  async function captureAndUploadIdentityPhoto(
    uid: string,
    kind: "entry" | "interval" | "exit",
    sequence: number
  ): Promise<void> {
    // A camera the candidate has switched off still delivers frames --
    // applyMediaToggle only sets track.enabled = false -- and a black 640x480
    // JPEG clears MIN_PLAUSIBLE_BYTES comfortably. At half-hourly cadence
    // that put six black rectangles in the strip; at two minutes it would be
    // sixty. The presence loop already refuses to sample in this state.
    if (!cameraEnabledRef.current) return;
    // setInterval has no idea whether the last upload finished. At two
    // minutes against a 20 s timeout they cannot overlap today, but the
    // guard is what keeps that true if either number moves.
    if (photoInFlightRef.current) return;
    photoInFlightRef.current = true;
    try {
      const frame = captureFrame(cameraVideoRef.current, undefined, kind);
      if (!frame) return;
      await uploadIdentityPhoto(uid, kind, frame, sequence);
    } catch {
      // Deliberately silent. See above.
    } finally {
      photoInFlightRef.current = false;
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
    // Unsent violation events leave with the exit frame, the last evidence
    // this session sends. Bounded: whatever is left stays queued under this
    // session's key and must never hold the candidate in the locked room.
    await withTimeout(flushViolationsBeforeExit(sessionId), 3000, "Event flush timed out").catch(
      () => {}
    );
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
    // Jittered, not on the tick: every machine in the hall starts within a
    // few minutes of the others, so an exact interval has a thousand
    // clients posting a photo at the same instant, over and over, for the
    // length of the paper. The offset is drawn once and held, so this
    // candidate's own cadence stays even.
    const offset = jitterOffset();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      photoSequenceRef.current += 1;
      void captureAndUploadIdentityPhoto(sessionId, "interval", photoSequenceRef.current);
      timer = setTimeout(tick, INTERVAL_MS);
    };
    timer = setTimeout(tick, Math.max(1_000, INTERVAL_MS + offset));
    return () => clearTimeout(timer);
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
      // Uploaded as well as recorded locally. Leaving the exam window is the
      // least ambiguous signal this app produces -- there is no innocent
      // reading of it that a reviewer needs a model's opinion about -- and it
      // went no further than the candidate's own machine.
      reportViolation({
        kind: "focus_loss",
        severity: "warning",
        detail,
        evidence: { source: detail, contest_id: contestId },
      });
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
        reportViolation({
          kind: "clipboard_copy",
          severity: "warning",
          detail: `Statement ${verb}`,
          evidence: {
            source: "statement",
            length: String(selection).length,
            contest_id: contestId,
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
  // Event handlers persist immediately; a committed render then becomes the
  // source for later saves, before the passive persistence effect runs.
  useLayoutEffect(() => {
    latestActiveDraftRef.current = {
      sessionId,
      questionId: currentQId,
      fileId: activeFileId,
      source: currentCode,
      language: toLanguageId(selectedLanguage),
      files: editorFiles,
    };
  }, [questionFiles, questionActiveFile, selectedLanguage, currentQId, sessionId]);

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
  // Connectivity is reported, never enforced: see `shouldLockEditor`. The
  // editor locks for reasons that are actually about the sitting -- the bell,
  // a session an invigilator ended, a submission already made -- and not
  // because a heartbeat was slow.
  const networkDisconnected = connectionLevel(heartbeatState) === "offline" || !browserOnline;
  const connectionInterrupted = !browserOnline || heartbeatState.consecutiveFailures > 0;
  const [disconnectGraceExpired, setDisconnectGraceExpired] = useState(false);
  useEffect(
    () => startDisconnectGrace(connectionInterrupted, setDisconnectGraceExpired),
    [connectionInterrupted]
  );
  const editorLocked = bellRung || Boolean(sessionEnded) || timeUpState !== "idle";

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
  // The same derivation, per kind of run, so each tab reads its own results
  // instead of both reading whichever ran last.
  const testsFor = (slice: RunSlice): any[] | null =>
    slice.attemptId && slice.result && !isPendingSubmissionStatus(slice.result.status)
      ? (testResults[slice.attemptId] ?? null)
      : null;
  const runStatusFor = (slice: RunSlice) =>
    slice.error
      ? {
          // The run never reached a verdict; the message below says why (empty
          // code, cooldown, offline), so the label must not claim it was the network.
          label: "Run didn’t start",
          color: "var(--color-text-red)",
          bg: "var(--color-error-muted)",
          border: "color-mix(in srgb, var(--color-error) 28%, transparent)",
          icon: "error" as const,
        }
      : slice.timedOut
        ? {
            // Verdict not back yet — the submission is still queued on the judge.
            label: "Still running…",
            color: "var(--color-text-yellow)",
            bg: "color-mix(in srgb, var(--color-text-yellow) 10%, transparent)",
            border: "color-mix(in srgb, var(--color-text-yellow) 28%, transparent)",
            icon: "pending" as const,
          }
        : slice.result
          ? {
              label: runStatusLabelMap[slice.result.status] ?? slice.result.status,
              color: VERDICT_COLORS[slice.result.status] ?? "var(--color-text-secondary)",
              bg:
                VERDICT_BG[slice.result.status] ??
                "color-mix(in srgb, var(--color-text-secondary) 12%, transparent)",
              border:
                VERDICT_BORDER[slice.result.status] ??
                "color-mix(in srgb, var(--color-text-secondary) 30%, transparent)",
              icon:
                slice.result.status === "QUEUED" || slice.result.status === "RUNNING"
                  ? ("loading" as const)
                  : ("dot" as const),
            }
          : null;
  const runStatus = runStatusFor(runSlices[runMode]);
  // One view per kind of run. The terminal picks by tab, so the two panes
  // never read each other's results.
  function runSourceChanged(mode: "all" | "custom") {
    const snapshot = runSources[runQuestionKey]?.[mode];
    return Boolean(
      snapshot &&
      (snapshot.questionId !== currentQId ||
        snapshot.fileId !== activeFileId ||
        snapshot.filename !== (activeFile?.name ?? "main.cpp") ||
        snapshot.source !== currentCode ||
        snapshot.language !== toLanguageId(selectedLanguage))
    );
  }
  const runViews = {
    all: {
      ...runSlices.all,
      tests: testsFor(runSlices.all),
      status: runStatusFor(runSlices.all),
      sourceChanged: runSourceChanged("all"),
    },
    custom: {
      ...runSlices.custom,
      tests: testsFor(runSlices.custom),
      status: runStatusFor(runSlices.custom),
      sourceChanged: runSourceChanged("custom"),
    },
  };
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
  const activeQuestionRunning = isRunning && runningQuestionKey === runQuestionKey;
  const shouldShowRunProgress = Boolean(
    activeQuestionRunning || runResult || runError || runTimedOut
  );
  // Per-sample results for the most recent "Run on Judge". Pulled from the same
  // `testResults` cache the Attempts expansion uses, keyed by the run's attempt
  // id. Only populated once the run reaches a terminal (non-CE) verdict.
  const runSampleTests: any[] | null = testsFor(runSlices[runMode]);
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
      (grouped[qId] ??= []).push(sub);
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
  // Driven by the five-second BlazeFace sample, not only by the older
  // faceStatus path -- that one needs its own detector to report "away" and
  // then a five-second grace on top, which is why an empty chair sat there
  // with nothing on screen.
  //
  // Warned on the first bad sample, logged only after three. The warning is
  // free and the candidate can act on it in a second; the record is a claim
  // about their sitting and deserves fifteen seconds of evidence.
  const presenceWarning = cameraEnabled && presenceStatus !== "presence_ok";
  // Framing shares the same banner. It lived inside the camera tile, where
  // it overlapped the buttons and truncated mid-word -- a thumbnail in the
  // corner is not somewhere a sentence can be read. One place for anything
  // the camera needs to say.
  // Ranked above framing and below presence. "Nobody is in the chair" is
  // more urgent; "sit a little more centrally" is less consequential than
  // being told something on the desk is about to be flagged.
  // Above everything else the banner says. A second screen is not a framing
  // nudge: nothing else on this list lets someone read a different document
  // for the whole paper, and it is the one a candidate can fix in seconds by
  // unplugging it.
  const displayWarning = monitorCount > 1;
  const objectWarning = cameraEnabled && !presenceWarning && !displayWarning && objectHint !== null;
  const framingWarning =
    cameraEnabled && !presenceWarning && !displayWarning && !objectWarning && framingHint !== "ok";
  const shouldShowFaceBlock =
    displayWarning ||
    presenceWarning ||
    objectWarning ||
    framingWarning ||
    (softBlockActive && faceStatus !== "ok");
  // Says what to do, in the fewest words that still say it. Nothing about
  // pausing or resuming: nothing is paused any more.
  const FRAMING_TITLE: Record<string, string> = {
    off_centre: "Move back into the centre of the frame",
    too_close: "Move back a little",
    too_far: "Move a bit closer",
  };
  // "Phone detected" rather than the raw COCO label: the class is
  // `cell phone`, which reads as machine output in the middle of an exam.
  const OBJECT_TITLE: Record<string, string> = {
    "cell phone": "Phone detected - this will be flagged",
  };
  const faceBlockTitle = displayWarning
    ? `${monitorCount} screens detected - disconnect the extra one`
    : !cameraHealthy
      ? "Camera not responding"
      : presenceStatus === "multiple_faces"
        ? "More than one person in frame"
        : presenceWarning
          ? "Come back into frame"
          : objectWarning
            ? (OBJECT_TITLE[objectHint ?? ""] ?? "Something on your desk will be flagged")
            : (FRAMING_TITLE[framingHint] ?? "Adjust your position");
  const faceBlockMessage = displayWarning
    ? "Only one screen is allowed during the exam. This has been flagged."
    : !cameraHealthy
      ? cameraError || "Waiting for a live camera frame."
      : presenceStatus === "multiple_faces"
        ? "Make sure nobody else is visible behind you."
        : presenceWarning
          ? "Face the camera so it can see you."
          : objectWarning
            ? "Move it out of view of the camera. An invigilator will review the frame."
            : "The camera can see you, but not clearly enough to check.";
  // The camera warning is not critical and never was. It paused the
  // workspace behind a modal for a candidate who had looked down at their
  // keyboard, and the only button on it was Exit contest -- so a two-second
  // inconvenience offered abandoning the paper as its remedy. It is a toast
  // now: it says what to do and goes away when they do it.
  // The oldest announcement this candidate has not acknowledged, if any.
  // Oldest first so a burst reads in the order it was issued.
  const pendingAnnouncement = sessionId ? nextToShow(announcements, localStorage, sessionId) : null;

  const acknowledgeCurrent = useCallback(() => {
    if (!pendingAnnouncement || !sessionId) return;
    setAckBusy(true);
    // Recorded locally first. The server is the authority, but a candidate
    // who acknowledged must not be shown the same postponement again while
    // the request is still in flight or if it fails outright.
    rememberAck(localStorage, sessionId, pendingAnnouncement.uid);
    const uid = pendingAnnouncement.uid;
    void acknowledgeAnnouncement(contestId, uid).finally(() => {
      setAckBusy(false);
      setAnnouncements((prev) =>
        prev.map((row) => (row.uid === uid ? { ...row, acknowledged: true } : row))
      );
    });
  }, [pendingAnnouncement, sessionId, contestId]);

  // Ranks with the lock violation: both are mandatory, and an announcement
  // that a lower-priority dialog could cover is an announcement missed.
  const announcementActive = pendingAnnouncement !== null;
  const criticalOverlayActive = (lockGraceActive && lockGraceCountdown === 0) || announcementActive;
  const networkOverlayActive =
    connectionInterrupted &&
    disconnectGraceExpired &&
    !criticalOverlayActive &&
    !bellRung &&
    !sessionEnded &&
    timeUpState === "idle";
  const networkDialogRef = useFocusTrap<HTMLDialogElement>(networkOverlayActive && !leaveConfirm);

  const lockViolationDialogRef = useFocusTrap<HTMLDivElement>(
    lockGraceActive && lockGraceCountdown === 0 && timeUpState === "idle" && !leaveConfirm
  );
  // No focus trap: the candidate is still typing, and this must not take
  // the keyboard away to tell them to look up.
  const mediaWarningDialogRef = useFocusTrap<HTMLDivElement>(
    showMediaToggleWarning && !leaveConfirm && !networkOverlayActive && timeUpState === "idle",
    cancelMediaToggle
  );
  const supportChatActive =
    showSupportChat &&
    !criticalOverlayActive &&
    !networkOverlayActive &&
    !showMediaToggleWarning &&
    !showSupportModal &&
    timeUpState === "idle";
  const closeSupportChat = useCallback(() => setShowSupportChat(false), []);
  const supportChatDialogRef = useFocusTrap<HTMLDivElement>(supportChatActive, closeSupportChat);
  const supportDialogRef = useFocusTrap<HTMLDivElement>(
    showSupportModal &&
      !leaveConfirm &&
      !criticalOverlayActive &&
      !networkOverlayActive &&
      timeUpState === "idle",
    closeSupport
  );
  const finishReceiptDialogRef = useFocusTrap<HTMLDivElement>(
    timeUpState !== "idle" && !leaveConfirm
  );
  // No dismissal callback: Escape must not close an announcement. The only
  // way out is the acknowledgement, which is the record staff rely on.
  const announcementDialogRef = useFocusTrap<HTMLDivElement>(
    announcementActive && timeUpState === "idle"
  );
  useEffect(() => {
    if (
      criticalOverlayActive ||
      networkOverlayActive ||
      submitConfirm ||
      showSupportModal ||
      showSupportChat ||
      showMediaToggleWarning ||
      timeUpState !== "idle"
    )
      setThemeMenuOpen(false);
  }, [
    criticalOverlayActive,
    networkOverlayActive,
    submitConfirm,
    showSupportModal,
    showSupportChat,
    showMediaToggleWarning,
    timeUpState,
  ]);

  if (pendingRedirect) {
    return loadError ? (
      <ContestLoadErrorScreen
        loadError={loadError}
        router={router}
        onRetry={() => void redirectAfterRelease(pendingRedirect)}
        exitTo={pendingRedirect}
      />
    ) : (
      <BootScreen label="Releasing device controls..." />
    );
  }

  // SECURITY: while the lockdown probe is pending — or while bouncing an
  // unlocked direct-entry back to onboarding — render a neutral securing screen.
  // Never flash the contest UI before lockdown is confirmed engaged.
  if (lockGate !== "ok") {
    return (
      <BootScreen label="Securing session…" onExit={() => void redirectAfterRelease("/home")} />
    );
  }

  if (loading) {
    const phase = entryWaitPhase(bootWaitedMs);
    return (
      <BootScreen
        label={phase.label}
        detail={phase.detail}
        onExit={() => void redirectAfterRelease("/home")}
      />
    );
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
            onExit={requestLeave}
          />
        )}
        <TopBar
          online={!networkDisconnected}
          markedQuestionIds={markedQuestionIds}
          workspaceControls={
            <WorkspaceControls
              suspended={
                leaveConfirm ||
                criticalOverlayActive ||
                networkOverlayActive ||
                submitConfirm ||
                showSupportModal ||
                showSupportChat ||
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
          setShowSupportModal={setShowSupportChat}
          submitConfirm={submitConfirm}
          setSubmitConfirm={setSubmitConfirm}
          submitError={submitError}
          setSubmitError={setSubmitError}
          handleSubmitConfirmed={handleSubmitConfirmed}
          submissionPending={isSubmitting}
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
            leaveConfirm ||
            criticalOverlayActive ||
            networkOverlayActive ||
            showSupportModal ||
            showSupportChat ||
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
            referenceOpen={referenceOpen}
            onToggleReference={() => setReferenceOpen((open) => !open)}
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
              handleResetCode={handleResetCode}
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
              resultSelection={resultSelections[currentQId]}
              submissionPending={
                isSubmitting &&
                submitKeyRef.current?.sessionId === sessionId &&
                submitKeyRef.current?.problemLabel === currentQId
              }
              runBusy={isRunning}
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
              terminalCollapsed={terminalCollapsed}
              setTerminalCollapsed={setTerminalCollapsed}
              shouldShowRunProgress={shouldShowRunProgress}
              runResult={runResult}
              runViews={runViews}
              isRunning={activeQuestionRunning}
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
            presenceStatus={presenceStatus}
            onPickCamera={handlePickCamera}
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
          {referenceOpen && (
            <VStack
              gap={0}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 6,
                background: "var(--color-background-body)",
                minHeight: 0,
                minWidth: 0,
              }}
            >
              <ReferencePanel onClose={() => setReferenceOpen(false)} />
            </VStack>
          )}
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
        isOpen={networkOverlayActive && !leaveConfirm}
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
            <Text color="secondary">We will check your session when the connection returns.</Text>
          </HStack>
          <Text color="secondary">
            The contest timer continues to run while disconnected or away.
          </Text>
          <Text color="secondary">
            Exit Contest to connect using your computer’s network settings, then reopen AMS Access
            and resume. Returning depends on the contest’s current entry rules.
          </Text>
          <HStack gap={3} justify="end" wrap="wrap">
            <Button
              label="Check Again"
              variant="secondary"
              onClick={() => retryBeatRef.current()}
            />
            <Button label="Exit Contest" variant="secondary" onClick={requestLeave} />
          </HStack>
        </VStack>
      </Dialog>

      {leaveConfirm && (
        <AccessDialog
          open
          onClose={() => setLeaveConfirm(false)}
          title="Leave this workspace?"
          width="calc(var(--spacing-10) * 12)"
          labelId="leave-contest-title"
        >
          <VStack gap={4}>
            <Text>
              Leaving restores device controls. It does not submit your solutions or confirm that
              your attempt has finished. The contest timer does not pause.
            </Text>
            <Text color="secondary">
              {!leaveDraftSaved
                ? "The latest draft save could not be confirmed. Leaving may lose unsaved edits."
                : "Your drafts are saved on this device. Drafts are not submitted solutions."}{" "}
              Returning depends on the contest’s current entry rules.
            </Text>
            {(isSubmitting || timeUpState === "submitting") && (
              <Text color="secondary">
                A server request is still pending. Leaving cannot confirm or cancel its outcome.
              </Text>
            )}
            <HStack gap={3} wrap="wrap" justify="end">
              <Button
                label="Stay here"
                variant="secondary"
                onClick={() => setLeaveConfirm(false)}
              />
              <Button
                label="Leave workspace"
                variant="primary"
                onClick={() => void redirectAfterRelease("/home", true)}
              />
            </HStack>
          </VStack>
        </AccessDialog>
      )}

      {shouldShowFaceBlock && (
        /* The same toast the kiosk banner uses when the window comes back:
           same position, same width, same Banner. A candidate who has seen
           "You left the exam window" recognises this instantly as the app
           telling them something, not asking them for a decision.

           It warns and nothing else -- no buttons, no focus trap, nothing
           dimmed, the editor still typeable underneath. It was a modal whose
           only control was Exit contest, which offered abandoning the paper
           as the remedy for looking down at a keyboard. */
        <VStack
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: "calc(var(--spacing-10) * 2)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            width: "min(calc(100% - var(--spacing-8)), calc(var(--spacing-10) * 12))",
            pointerEvents: "none",
            // An opaque surface under the Banner.
            //
            // Banner fills warning and error with a translucent colour, which
            // is fine inline on a page background and looks washed out
            // floating over an editor -- the code shows straight through the
            // red. Info happens to be solid, which is why only that one
            // looked right. This gives all three something to sit on.
            borderRadius: "var(--radius-container)",
            overflow: "hidden",
            background: "var(--color-background-card)",
            boxShadow: "var(--shadow-high)",
          }}
        >
          <Banner
            status={
              displayWarning
                ? "error"
                : framingWarning
                  ? "info"
                  : objectWarning || presenceStatus === "multiple_faces"
                    ? "warning"
                    : "error"
            }
            title={faceBlockTitle}
            description={faceBlockMessage}
          />
        </VStack>
      )}

      {/* Above the rest: whatever else is on screen, a postponement is the
          thing the candidate most needs to read. Suppressed only once the
          paper is over, when the finish receipt owns the screen. */}
      {pendingAnnouncement && timeUpState === "idle" && (
        <AnnouncementOverlay
          announcement={pendingAnnouncement}
          onAcknowledge={acknowledgeCurrent}
          busy={ackBusy}
          dialogRef={announcementDialogRef}
        />
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
              <Text color="secondary">
                You can restore device controls without waiting. Completion is not yet confirmed;
                session recovery will be kept if you leave.
              </Text>
              <Button label="Restore device controls" variant="secondary" onClick={requestLeave} />
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
                description="The connection failed or the server did not acknowledge the finish request. You can retry now. Session recovery is kept if you return home; this screen will not keep retrying after you leave."
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
                description="Restoration is incomplete or could not be verified. Retry restoration, or return home to review recovery guidance in Settings."
              />
              <Button
                label="Retry restoration"
                variant="secondary"
                onClick={() => void runExitTeardown(timeUpState !== "submitted")}
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
              {timeUpState === "error" && (
                <Button label="Retry finish" variant="primary" onClick={handleSubmitConfirmed} />
              )}
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

      <HelpRequestModal
        open={supportChatActive}
        contestId={contestId}
        onClose={closeSupportChat}
        kind="OTHER"
        summary="I need help during my assessment."
        secondaryAction={
          <Button
            type="button"
            label="Report a device incident with diagnostics"
            variant="secondary"
            style={{
              marginInlineEnd: "auto",
              maxWidth: "100%",
              flexShrink: 0,
              height: "auto",
              whiteSpace: "normal",
              border: "var(--border-width) solid var(--color-border-emphasized)",
            }}
            onClick={() => {
              setShowSupportChat(false);
              setShowSupportModal(true);
            }}
          />
        }
        renderDialog={(content) => (
          <ContestOverlay labelId="support-chat-title" dialogRef={supportChatDialogRef} wide>
            <Heading level={2} id="support-chat-title">
              Talk to your organizer
            </Heading>
            {content}
          </ContestOverlay>
        )}
      />

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
          <Button label="Leave contest" variant="ghost" onClick={requestLeave} />
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
