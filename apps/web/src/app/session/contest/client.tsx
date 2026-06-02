"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo, type UIEvent } from "react";
import dynamic from "next/dynamic";
import { marked, type MarkedExtension } from "marked";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { fetchJson, postJsonKeepalive, sendJsonBeacon } from "@/lib/api-client";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const API_URL = resolveApiBase();
const ACTIVE_SESSION_KEY = STORAGE_KEYS.ACTIVE_SESSION;

// Configure marked once at module level — pays cost on first import, never again.
const mathInlineExt: MarkedExtension = {
  extensions: [
    {
      name: "mathInline",
      level: "inline" as const,
      start: (src: string) => src.indexOf("$"),
      tokenizer(src: string) {
        const m = /^\$([^$\n]+?)\$/.exec(src);
        if (m) return { type: "mathInline", raw: m[0], text: m[1].trim() };
      },
      renderer(token) {
        return `<var class="pb-math">${(token as unknown as { text: string }).text}</var>`;
      },
    },
  ],
};
marked.use(mathInlineExt, { breaks: true, gfm: true });

function parseDescription(md: string): string {
  const tex = md
    .replace(/\\leq?\b/g, "≤").replace(/\\geq?\b/g, "≥")
    .replace(/\\neq\b/g, "≠").replace(/\\times\b/g, "×")
    .replace(/\\cdot\b/g, "·").replace(/\\infty\b/g, "∞")
    .replace(/\\ldots\b|\\dots\b/g, "…").replace(/\\pm\b/g, "±")
    .replace(/\\\\/g, "\n");
  return marked.parse(tex) as string;
}

const EditorPane = dynamic(() => import("./editor-pane"), {
  ssr: false,
  loading: () => (
    <div style={{ flex: 1, background: "#0F0F0F", borderTop: "1px solid #1F1F1F" }} />
  ),
});

type Question = {
  id: string;
  title: string;
  description: string | null;
  starter_code: string | null;
  order_index: number;
};

type EditorFile = {
  id: string;
  name: string;
  content: string;
};

type ContestMeta = {
  id: string;
  title: string;
  start_at?: string;
  end_at: string;
  status: string;
};

type QuestionPayload = Partial<Question> & {
  problem_id?: string;
  name?: string;
  statement?: string | null;
  prompt?: string | null;
  body?: string | null;
  code?: string | null;
  cpp?: string | null;
  starter_code?: string | null;
  cpp_starter?: string | null;
  html?: string | null;
  css?: string | null;
  js?: string | null;
  html_starter?: string | null;
  css_starter?: string | null;
  js_starter?: string | null;
  starter_html?: string | null;
  starter_css?: string | null;
  starter_js?: string | null;
  starter?: {
    code?: string | null;
    cpp?: string | null;
    html?: string | null;
    css?: string | null;
    js?: string | null;
  } | null;
  order?: number;
  position?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function looksLikeCpp(code: string | null | undefined): code is string {
  if (!code) return false;
  return /#include\s*<|using\s+namespace\s+std|int\s+main\s*\(/.test(code);
}

function defaultCppStarter(): string {
  return [
    "#include <bits/stdc++.h>",
    "using namespace std;",
    "",
    "int main() {",
    "  ios::sync_with_stdio(false);",
    "  cin.tie(nullptr);",
    "",
    "  return 0;",
    "}",
  ].join("\n");
}

function sanitizeCppFileName(title: string, fallback: string): string {
  const letterMatch = /^([A-Z])(?:[.)\]:-]|\s+-|\s)/i.exec(title.trim());
  if (letterMatch) return `${letterMatch[1].toUpperCase()}.cpp`;

  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || fallback}.cpp`;
}

function questionFileName(question: Question): string {
  const fallbackLetter = String.fromCharCode(65 + Math.max(0, question.order_index));
  return sanitizeCppFileName(question.title, fallbackLetter);
}

function unwrapQuestionList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.questions,
    payload.problems,
    payload.items,
    payload.data,
    payload.results,
    isRecord(payload.contest) ? payload.contest.questions : null,
    isRecord(payload.contest) ? payload.contest.problems : null,
    isRecord(payload.bundle) ? payload.bundle.questions : null,
    isRecord(payload.bundle) ? payload.bundle.problems : null,
  ];

  for (const candidate of candidates) {
    const nested = unwrapQuestionList(candidate);
    if (nested.length > 0) return nested;
  }

  return [];
}

function normalizeQuestion(value: unknown, index: number): Question | null {
  if (!isRecord(value)) return null;
  const payload = value as QuestionPayload;
  const starter = isRecord(payload.starter) ? payload.starter : null;
  const id = pickString(payload.id, payload.problem_id);
  const title = pickString(payload.title, payload.name);
  const orderIndex = pickNumber(payload.order_index, payload.order, payload.position) ?? index;

  return {
    id: id ?? `question-${orderIndex + 1}`,
    title: title ?? `Question ${orderIndex + 1}`,
    description: pickString(payload.description, payload.statement, payload.prompt, payload.body),
    starter_code:
      pickString(payload.starter_code, payload.cpp_starter, payload.code, payload.cpp, starter?.code, starter?.cpp) ??
      (looksLikeCpp(payload.html_starter) ? payload.html_starter : null) ??
      (looksLikeCpp(payload.starter_html) ? payload.starter_html : null) ??
      (looksLikeCpp(starter?.html) ? starter.html : null) ??
      (looksLikeCpp(payload.html) ? payload.html : null),
    order_index: orderIndex,
  };
}

function normalizeQuestions(payload: unknown): Question[] {
  return unwrapQuestionList(payload)
    .map((item, index) => normalizeQuestion(item, index))
    .filter((item): item is Question => item !== null)
    .sort((a, b) => a.order_index - b.order_index);
}

async function fetchJsonOrNull(url: string): Promise<unknown | null> {
  try {
    return await fetchJson<unknown>(url, {}, { dedupeKey: url, retries: 2 });
  } catch {
    return null;
  }
}

async function fetchContestQuestions(contestId: string): Promise<Question[]> {
  const paths = [
    `/contests/${contestId}/questions`,
    `/contests/${contestId}/problems`,
    `/contests/${contestId}/bundle`,
  ];

  for (const path of paths) {
    const questions = normalizeQuestions(await fetchJsonOrNull(`${API_URL}${path}`));
    if (questions.length > 0) return questions;
  }

  return [];
}

async function createContestSession(contestId: string, contestTitle?: string) {
  const email = localStorage.getItem(STORAGE_KEYS.USER_EMAIL) ?? "candidate@ams.local";
  const response = await fetchJson<{ id?: string }>(
    `${API_URL}/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contest_id: contestId,
        candidate_email: email,
        candidate_name: email.split("@")[0],
      }),
    },
    { dedupeKey: `session:create:${contestId}:${email}`, retries: 2 }
  );

  if (response.id) {
    localStorage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({
        id: response.id,
        contest_id: contestId,
        contest_title: contestTitle,
        updated_at: new Date().toISOString(),
      })
    );
  }

  return response;
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

function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const rootEl = ref.current;
    if (!rootEl) return;
    const trappedRoot: T = rootEl;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

      const currentFocusable = Array.from(trappedRoot.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
      );
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

function useCountdown(endAt: string) {
  const [state, setState] = useState({ remaining: "", urgent: false });

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    function tick() {
      const diff = new Date(endAt).getTime() - Date.now();
      if (diff <= 0) {
        setState((prev) =>
          prev.remaining === "00:00:00" && !prev.urgent
            ? prev
            : { remaining: "00:00:00", urgent: false }
        );
        if (id) clearInterval(id);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const remaining = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      const urgent = diff < 300000;
      setState((prev) =>
        prev.remaining === remaining && prev.urgent === urgent ? prev : { remaining, urgent }
      );
    }
    tick();
    id = setInterval(tick, 1000);
    return () => {
      if (id) clearInterval(id);
    };
  }, [endAt]);

  return state;
}

const CountdownBadge = memo(function CountdownBadge({ endAt }: { endAt: string }) {
  const { remaining, urgent } = useCountdown(endAt);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: urgent ? "#ef4444" : "#a855f7",
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.05em",
        }}
      >
        T-MINUS: {remaining}
      </span>
    </div>
  );
});

export default function ContestPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams?.get("contestId") ?? "";

  const [contest, setContest] = useState<ContestMeta | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeQ, setActiveQ] = useState(0);
  const [editorFiles, setEditorFiles] = useState<EditorFile[]>([]);
  const [activeFileId, setActiveFileId] = useState("");
  const [compileNote, setCompileNote] = useState(
    "C++ runner is not configured for this build. Save or submit to send code for judging."
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [proctoringOk, setProctoringOk] = useState(true);
  const [faceStatus, setFaceStatus] = useState<"ok" | "away" | "unknown">("unknown");
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const lineNumberGutterRef = useRef<HTMLDivElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraVideoReady, setCameraVideoReady] = useState(false);
  const processScanInFlightRef = useRef(false);
  const activeViolationDetailRef = useRef("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportCategory, setSupportCategory] = useState("camera_not_detected");
  const [customIssueDetail, setCustomIssueDetail] = useState("");
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportSentSuccess, setReportSentSuccess] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lockGraceActive, setLockGraceActive] = useState(false);
  const [lockGraceCountdown, setLockGraceCountdown] = useState(3);
  const [cameraCollapsed, setCameraCollapsed] = useState(false);
  const [faceGraceCountdown, setFaceGraceCountdown] = useState(5);
  const [faceGraceActive, setFaceGraceActive] = useState(false);

  const [softBlockActive, setSoftBlockActive] = useState(false);
  const prevCameraStatusRef = useRef<{ cameraOk: boolean; blockedCount: number } | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [hasToggledMedia, setHasToggledMedia] = useState(false);
  const [showMediaToggleWarning, setShowMediaToggleWarning] = useState(false);
  const [pendingMediaToggle, setPendingMediaToggle] = useState<{type: 'camera' | 'mic', value: boolean} | null>(null);

  function applyMediaToggle(type: 'camera' | 'mic', value: boolean) {
    if (type === 'camera') {
      setCameraEnabled(value);
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = value));
      }
    } else {
      setMicEnabled(value);
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = value));
      }
    }
  }

  function handleToggleMedia(type: 'camera' | 'mic', value: boolean) {
    if (!hasToggledMedia) {
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
      await postJsonKeepalive(`${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`, {
        category: supportCategory,
        detail: supportCategory === "other" ? customIssueDetail : "",
        telemetry: supportTelemetry,
      }).catch(() => {});
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
  const fallbackEndAt = useMemo(() => new Date(Date.now() + 3600000).toISOString(), []);

  useEffect(() => {
    if (!contestId) {
      setLoadError("Missing contest ID. Please relaunch from your contest list.");
      setLoading(false);
      return;
    }

    if (contestId === "mock-contest-dev" || contestId === "mock-contest-scheduled") {
      const mockEnd = new Date(Date.now() + 5400000).toISOString();
      const titles: Record<string, string> = {
        "mock-contest-dev": "AMS Internal — Dev Test",
        "mock-contest-scheduled": "AMS Internal — Scheduled Test",
      };
      setContest({ id: contestId, title: titles[contestId], end_at: mockEnd, status: "ACTIVE" });
      const mockQuestions: Question[] = [
        {
          id: "mock-q-1",
          title: "A. Binary Search",
          description:
            "You are given a non-decreasing array $A$ of $N$ integers and $Q$ query values. For each query $x$, print the 1-based index of the first element $A[i]$ such that $A[i] >= x$. If no such element exists, print $-1$.",
          starter_code: defaultCppStarter(),
          order_index: 0,
        },
        {
          id: "mock-q-2",
          title: "B. Alice and Bob",
          description:
            "Given two integers $a$ and $b$, determine the winner under the rules in the statement. Read input from stdin and print the required answer for each test case.",
          starter_code: defaultCppStarter(),
          order_index: 1,
        },
      ];
      setQuestions(mockQuestions);
      loadQuestion(mockQuestions[0]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const contestRequest = fetchJsonOrNull(`${API_URL}/contests/${contestId}`);
    const questionsRequest = fetchContestQuestions(contestId);
    const sessionRequest = createContestSession(contestId).catch(() => null);

    Promise.all([contestRequest, questionsRequest, sessionRequest])
      .then(([c, questions, session]) => {
        const contestMeta = c ? (c as ContestMeta) : null;
        if (contestMeta) setContest(contestMeta);
        setActiveQ(0);
        setQuestions(questions);
        if (questions.length > 0) {
          loadQuestion(questions[0]);
          setLoadError(null);
        } else {
          setLoadError("Questions are not available yet. Please retry in a few seconds.");
        }

        if (session?.id) {
          setSessionId(session.id);
          localStorage.setItem(
            ACTIVE_SESSION_KEY,
            JSON.stringify({
              id: session.id,
              contest_id: contestId,
              contest_title: contestMeta?.title,
              updated_at: new Date().toISOString(),
            })
          );
        }

        setLoading(false);
      })
      .catch(() => {
        setLoadError("Unable to load contest. Check connection and retry.");
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function loadQuestion(q: Question) {
    const file: EditorFile = {
      id: `${q.id}:main`,
      name: questionFileName(q),
      content: q.starter_code ?? defaultCppStarter(),
    };
    setEditorFiles([file]);
    setActiveFileId(file.id);
    setCompileNote("C++ runner is not configured for this build. Save or submit to send code for judging.");
  }

  function switchQuestion(idx: number) {
    setActiveQ(idx);
    loadQuestion(questions[idx]);
  }

  function handleCodeChange(value: string) {
    setEditorFiles((files) =>
      files.map((file) => (file.id === activeFileId ? { ...file, content: value } : file))
    );
  }

  function addEditorFile() {
    setEditorFiles((files) => {
      const nextIndex = files.length + 1;
      const file: EditorFile = {
        id: `${questions[activeQ]?.id ?? "question"}:scratch-${Date.now()}`,
        name: `scratch${nextIndex}.cpp`,
        content: defaultCppStarter(),
      };
      setActiveFileId(file.id);
      return [...files, file];
    });
  }

  function triggerRun() {
    setCompileNote(
      "Local C++ compilation is not enabled in this build. The editor saves C++17 source files for the judge/submission pipeline."
    );
  }

  const handleTabKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const newVal = val.substring(0, start) + "  " + val.substring(end);
        ta.value = newVal;
        ta.selectionStart = ta.selectionEnd = start + 2;
        handleCodeChange(newVal);
      }
    },
    [activeFileId]
  );

  const syncEditorScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumberGutterRef.current) {
      lineNumberGutterRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  }, []);

  async function handleSave(): Promise<boolean> {
    if (!questions[activeQ] || !sessionId) {
      setSaveError("No active session is available. Reopen the contest and try again.");
      return false;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const response = await postJsonKeepalive(`${API_URL}/sessions/${sessionId}/answers`, {
        question_id: questions[activeQ].id,
        answer_text: JSON.stringify({
          language: "cpp17",
          files: editorFiles,
          active_file_id: activeFileId,
        }),
      });
      if (!response.ok) throw new Error(`Save failed with HTTP ${response.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch {
      setSaved(false);
      setSaveError("Save failed. Check your connection and retry before submitting.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitConfirmed() {
    setSubmitError(null);
    const savedOk = await handleSave();
    if (!savedOk) {
      setSubmitError("Final save failed. Resolve this before submitting.");
      return;
    }
    if (sessionId) {
      try {
        const response = await postJsonKeepalive(`${API_URL}/sessions/${sessionId}/submit`);
        if (!response.ok) throw new Error("submit failed");
      } catch {
        setSubmitError("Submit failed. Your answer was saved; retry submit when connected.");
        return;
      }
    }
    localStorage.removeItem(ACTIVE_SESSION_KEY);
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
    } catch {}
    router.push("/home");
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
        setCameraStream(stream);
        setCameraVideoReady(false);
        setCameraError(null);
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
    const sendHeartbeat = () => {
      fetch(`${API_URL}/sessions/${sessionId}/heartbeat`, { method: "POST", keepalive: true }).catch(() => {});
    };
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, 60_000);
    return () => clearInterval(id);
  }, [sessionId]);

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
              sendJsonBeacon(`${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`, {
                category: "blocked_app_resolved",
                detail: previousDetail,
                telemetry: {
                  timestamp: new Date().toISOString(),
                  contest_id: contestId,
                  session_id: sessionId ?? "unregistered",
                },
              });
              await invoke("log_violation", {
                kind: "blocked_app_resolved",
                detail: previousDetail,
              });
            }

            activeViolationDetailRef.current = detail;
            sendJsonBeacon(`${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`, {
              category: "blocked_app_started",
              detail: result.found.join(", "),
              telemetry: {
                timestamp: new Date().toISOString(),
                contest_id: contestId,
                session_id: sessionId ?? "unregistered",
              },
            });
            await invoke("log_violation", {
              kind: "blocked_app_started",
              detail: result.found.join(", "),
            });
          }
        } else {
          const previousDetail = activeViolationDetailRef.current;
          if (previousDetail) {
            activeViolationDetailRef.current = "";
            sendJsonBeacon(`${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`, {
              category: "blocked_app_resolved",
              detail: previousDetail,
              telemetry: {
                timestamp: new Date().toISOString(),
                contest_id: contestId,
                session_id: sessionId ?? "unregistered",
              },
            });
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

  const activeFile = editorFiles.find((file) => file.id === activeFileId) ?? editorFiles[0] ?? null;
  const isEditorEmpty = !activeFile?.content;
  const currentCode = activeFile?.content ?? "";
  const lineNumbers = useMemo(
    () => currentCode.split("\n").map((_, index) => index + 1),
    [currentCode]
  );
  const cameraHealthy = Boolean(cameraStream && cameraVideoReady && !cameraError);
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

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#0F0F0F",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "2px solid rgba(168,85,247,0.3)",
              borderTopColor: "#a855f7",
              borderRadius: "50%",
              animation: "spin 0.9s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p
            style={{
              fontSize: "13px",
              color: "#64748b",
              fontFamily: "Inter, system-ui, sans-serif",
            }}
          >
            Loading contest...
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#030816",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "560px",
            borderRadius: "16px",
            border: "1px solid rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.06)",
            padding: "20px",
            color: "#fecaca",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <p style={{ fontSize: "15px", fontWeight: 600, marginBottom: "8px" }}>
            Contest Load Error
          </p>
          <p style={{ fontSize: "13px", color: "#fca5a5", marginBottom: "14px" }}>{loadError}</p>
          <button
            onClick={() => router.push("/home")}
            style={{
              border: "1px solid rgba(239,68,68,0.35)",
              background: "rgba(239,68,68,0.14)",
              color: "#fecaca",
              padding: "8px 12px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "12px",
            }}
          >
            Back to contests
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#0F0F0F",
        fontFamily: "Inter, 'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {/* Floating warning toast during grace period */}
      {lockGraceActive && lockGraceCountdown > 0 && (
        <div
          style={{
            position: "fixed",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            width: "100%",
            maxWidth: "460px",
            padding: "16px 20px",
            borderRadius: "12px",
            background: "rgba(30, 9, 9, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(239, 68, 68, 0.4)",
            boxShadow: "0 10px 40px rgba(239, 68, 68, 0.15)",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            animation: "fadeIn 250ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
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
              stroke="#fca5a5"
              strokeWidth="1.8"
            >
              <path
                d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <h4
              style={{ fontSize: "13px", fontWeight: 600, color: "#fca5a5", marginBottom: "2px" }}
            >
              Restricted Application Detected
            </h4>
            <p style={{ fontSize: "11px", color: "#fca5a5", opacity: 0.8, lineHeight: 1.4 }}>
              Workspace locking in{" "}
              <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: "12px" }}>
                {lockGraceCountdown}s
              </span>
              . Please save your work immediately.
            </p>
          </div>
        </div>
      )}

      {/* ── Blocked app violation overlay ── */}
      {lockGraceActive && lockGraceCountdown === 0 && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-live="assertive"
          aria-labelledby="blocked-app-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2,4,10,0.9)",
            backdropFilter: "blur(16px)",
          }}
        >
          <div
            ref={lockViolationDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "440px",
              width: "100%",
              borderRadius: "20px",
              padding: "36px 32px",
              background: "rgba(30,9,9,0.4)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              boxShadow: "0 0 60px rgba(239, 68, 68, 0.12)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f87171"
                strokeWidth="1.8"
              >
                <path
                  d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p
              id="blocked-app-title"
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "#fca5a5",
                marginBottom: "8px",
                letterSpacing: "-0.01em",
              }}
            >
              Restricted Application Detected
            </p>
            <p
              style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "24px", lineHeight: 1.6 }}
            >
              To maintain exam security, please close the applications listed below.
            </p>
            <div style={{ marginBottom: "24px" }}>
              {blockedApps.map((app) => (
                <div
                  key={app}
                  style={{
                    padding: "10px 16px",
                    marginBottom: "8px",
                    borderRadius: "10px",
                    background: "rgba(239, 68, 68, 0.06)",
                    border: "1px solid rgba(239, 68, 68, 0.15)",
                    fontSize: "14px",
                    color: "#f87171",
                    fontWeight: 500,
                  }}
                >
                  {app}
                </div>
              ))}
            </div>
            <p style={{ fontSize: "12px", color: "#475569" }}>
              This dialog will dismiss automatically once the app is closed.
            </p>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          height: "48px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          background: "#0F0F0F",
          flexShrink: 0,
          boxShadow: "none",
          gap: "16px",
        }}
      >
        {/* Left: Logo + contest title */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
          <svg width="28" height="24" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#tg)"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient
                id="tg"
                x1="2"
                y1="82"
                x2="172"
                y2="82"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#7B00FF" />
                <stop offset="0.5" stopColor="#C649F0" />
                <stop offset="1" stopColor="#E365FF" />
              </linearGradient>
            </defs>
          </svg>
          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)" }} />
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "#e2e8f0",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "260px",
            }}
          >
            {contest?.title ?? "Contest"}
          </span>
        </div>

        {/* Center: Timer */}
        <CountdownBadge endAt={contest?.end_at ?? fallbackEndAt} />

        {/* Right: Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={() => setShowSupportModal(true)}
            style={{
              padding: "6px 12px",
              border: "1px solid #f59e0b",
              background: "#0F0F0F",
              color: "#f59e0b",
              fontSize: "11px",
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: "pointer",
            }}
          >
            [ REQUEST SUPPORT ]
          </button>

          <div style={{ position: "relative" }}>
            <button
              onClick={() => setSubmitConfirm(true)}
              style={{
                padding: "6px 12px",
                border: "1px solid #ef4444",
                background: "#0F0F0F",
                color: "#ef4444",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              [ SUBMIT & EXIT ]
            </button>
            {submitConfirm && (
              <div
                role="dialog"
                aria-modal="false"
                aria-label="Confirm contest submission"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  zIndex: 12000,
                  width: "260px",
                  padding: "12px",
                  border: "1px solid rgba(239,68,68,0.45)",
                  background: "#160b0b",
                  boxShadow: "0 18px 44px rgba(0,0,0,0.35)",
                }}
              >
                <p style={{ margin: "0 0 10px", color: "#fecaca", fontSize: "12px", lineHeight: 1.45 }}>
                  Submit final answers and exit the contest? This cannot be undone.
                </p>
                {submitError && (
                  <p style={{ margin: "0 0 10px", color: "#fca5a5", fontSize: "11px", lineHeight: 1.35 }}>
                    {submitError}
                  </p>
                )}
                <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSubmitConfirm(false);
                      setSubmitError(null);
                    }}
                    style={{ padding: "6px 10px", border: "1px solid #334155", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: "11px" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitConfirmed}
                    disabled={saving}
                    style={{ padding: "6px 10px", border: "1px solid #ef4444", background: "rgba(239,68,68,0.16)", color: "#fecaca", cursor: saving ? "not-allowed" : "pointer", fontSize: "11px", fontWeight: 700 }}
                  >
                    {saving ? "Saving..." : "Confirm"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", background: "#0F0F0F" }}>
        {/* Question list sidebar */}
        <aside
          style={{
            width: sidebarCollapsed ? "52px" : "220px",
            flexShrink: 0,
            borderRight: "1px solid rgba(255, 255, 255, 0.05)",
            display: "flex",
            flexDirection: "column",
            background: "#0F0F0F",
            boxShadow: "none",
            overflow: "hidden",
            transition: "width 250ms",
          }}
        >
          <div
            style={{
              padding: sidebarCollapsed ? "14px 0" : "14px 14px 8px",
              borderBottom: "1px solid #1F1F1F",
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
            }}
          >
            {!sidebarCollapsed && (
              <p
                style={{
                  fontSize: "10px",
                  color: "#64748b",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Questions ({questions.length})
              </p>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: "2px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
            >
              {sidebarCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M6 12l4-4-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {questions.length === 0 && !sidebarCollapsed && (
              <p style={{ fontSize: "12px", color: "#475569", textAlign: "center", marginTop: "24px", fontFamily: "'JetBrains Mono', monospace" }}>
                No questions
              </p>
            )}
            {questions.map((q, i) => (
              <button
                key={q.id}
                type="button"
                onClick={() => switchQuestion(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  width: "100%",
                  padding: sidebarCollapsed ? "8px 0" : "10px 12px",
                  borderRadius: "2px",
                  border: `1px solid ${activeQ === i ? "#1F1F1F" : "transparent"}`,
                  background: activeQ === i ? "#1F1F1F" : "transparent",
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: "all 150ms",
                  height: sidebarCollapsed ? "36px" : "auto",
                }}
                title={sidebarCollapsed ? q.title : undefined}
              >
                {sidebarCollapsed ? (
                  <span style={{ fontSize: "12px", fontWeight: 600, color: activeQ === i ? "#ffffff" : "#64748b" }}>
                    {i + 1}
                  </span>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <span style={{ fontSize: "10px", fontWeight: 600, color: activeQ === i ? "#ffffff" : "#64748b", flexShrink: 0 }}>
                      [{i + 1}]
                    </span>
                    <span style={{ fontSize: "12px", fontWeight: 500, color: activeQ === i ? "#f5f7fa" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {q.title}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
          
          {/* Docked Camera feed */}
          <div
            style={{
              borderTop: "1px solid #1F1F1F",
              background: "#0F0F0F",
              position: "relative",
              flexShrink: 0,
              display: (cameraStream ?? cameraError) ? "flex" : "none",
              flexDirection: "column",
            }}
          >
            {!sidebarCollapsed && (
              <div style={{ display: "flex", alignItems: "center", padding: "6px", gap: "6px", borderBottom: "1px solid #1F1F1F" }}>
                <button
                  type="button"
                  onClick={() => handleToggleMedia('camera', !cameraEnabled)}
                  style={{ flex: 1, padding: "4px", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", border: `1px solid ${cameraEnabled ? '#1F1F1F' : '#ef4444'}`, background: cameraEnabled ? '#1F1F1F' : 'rgba(239,68,68,0.1)', color: cameraEnabled ? '#e2e8f0' : '#ef4444', cursor: "pointer" }}
                >
                  {cameraEnabled ? "CAM ON" : "CAM OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleMedia('mic', !micEnabled)}
                  style={{ flex: 1, padding: "4px", fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", border: `1px solid ${micEnabled ? '#1F1F1F' : '#ef4444'}`, background: micEnabled ? '#1F1F1F' : 'rgba(239,68,68,0.1)', color: micEnabled ? '#e2e8f0' : '#ef4444', cursor: "pointer" }}
                >
                  {micEnabled ? "MIC ON" : "MIC OFF"}
                </button>
              </div>
            )}
            <div style={{ width: "100%", height: sidebarCollapsed ? "52px" : "150px", border: "1px solid #1F1F1F", boxSizing: "border-box", position: "relative" }}>
              <video
                ref={cameraVideoRef}
                muted
                playsInline
                autoPlay
                style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: sidebarCollapsed ? "none" : "block", borderRadius: "0" }}
              />
              {sidebarCollapsed && (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                   <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: faceStatus === "ok" ? "#22c55e" : "#ef4444" }} />
                </div>
              )}
            </div>
            
            {!sidebarCollapsed && (
              <div style={{ position: "absolute", bottom: "8px", left: "8px", padding: "2px 4px", background: "#0F0F0F", border: "1px solid #1F1F1F", fontSize: "9px", color: faceStatus === "ok" ? "#22c55e" : "#ef4444", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                 {faceStatus === "ok" ? "OPTICAL: SECURE" : "OPTICAL: ALERT"}
              </div>
            )}
          </div>
        </aside>

        {/* Middle pane: Problem Description */}
        <div
          style={{
            width: "35%",
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid rgba(255, 255, 255, 0.05)",
            background: "#0F0F0F",
            boxShadow: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              borderBottom: "1px solid #1F1F1F",
              background: "#0F0F0F",
              padding: "0 16px",
              flexShrink: 0,
              height: "38px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "#64748b",
                letterSpacing: "0.06em",
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
              }}
            >
              [ PROBLEM DESCRIPTION ]
            </span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", color: "#e2e8f0", fontSize: "14px", lineHeight: 1.6, fontFamily: "system-ui, sans-serif" }}>
            <h2 style={{ marginTop: 0, marginBottom: "16px", fontSize: "20px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{questions[activeQ]?.title}</h2>
            <div
              className="pb-body"
              dangerouslySetInnerHTML={{
                __html: parseDescription(questions[activeQ]?.description ?? "*No description provided.*"),
              }}
            />
          </div>
        </div>

        {/* Right panel: Editor (Top) + Terminal (Bottom) */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#0F0F0F", minWidth: 0 }}>
          {/* Top Right: Code Editor */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", boxShadow: "none" }}>
            {/* Editor Tabs & Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #1F1F1F",
                background: "#0F0F0F",
                padding: "0 12px",
                gap: "4px",
                flexShrink: 0,
                height: "38px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  color: "#64748b",
                  letterSpacing: "0.06em",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                  marginRight: "12px",
                }}
              >
                [ EDITOR ]
              </span>
              {editorFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setActiveFileId(file.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 16px",
                    border: "1px solid",
                    borderColor: activeFileId === file.id ? "#1F1F1F" : "transparent",
                    borderBottom: "none",
                    background: activeFileId === file.id ? "#1F1F1F" : "transparent",
                    color: activeFileId === file.id ? "#ffffff" : "#475569",
                    fontSize: "11px",
                    fontWeight: 600,
                    fontFamily: "'JetBrains Mono', monospace",
                    cursor: "pointer",
                    height: "100%",
                    borderRadius: "2px 2px 0 0",
                    maxWidth: "180px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={file.name}
                >
                  {file.name}
                </button>
              ))}
              <button
                type="button"
                onClick={addEditorFile}
                aria-label="Create new C++ file tab"
                title="Create new C++ file tab"
                style={{
                  width: "28px",
                  height: "28px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid #1F1F1F",
                  background: "#0F0F0F",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "16px",
                  lineHeight: 1,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                +
              </button>
              <div style={{ flex: 1 }} />
            </div>

            {/* Execution control strip */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                gap: "6px",
                height: "32px",
                background: "#0a0a0a",
                borderBottom: "1px solid #1F1F1F",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#475569",
                  letterSpacing: "0.06em",
                  marginRight: "4px",
                }}
              >
                ENV:
              </span>
              <span
                style={{
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  color: "#475569",
                  letterSpacing: "0.04em",
                }}
              >
                [ C++17 ]
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={triggerRun}
                style={{
                  padding: "2px 10px",
                  border: "1px solid #1F1F1F",
                  background: "#0F0F0F",
                  color: "#94a3b8",
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.08em",
                  cursor: "pointer",
                }}
              >
                [ COMPILE &amp; RUN ]
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  padding: "2px 10px",
                  border: "1px solid rgba(168,85,247,0.35)",
                  background: "transparent",
                  color: saveError ? "#ef4444" : saved ? "#22c55e" : "#c084fc",
                  fontSize: "10px",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.08em",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "SAVING..." : saveError ? "[ SAVE FAILED ]" : saved ? "[ SAVED ]" : "[ SUBMIT SOLUTION ]"}
              </button>
            </div>

            {saveError && (
              <div
                role="status"
                style={{
                  padding: "6px 12px",
                  borderBottom: "1px solid rgba(239,68,68,0.2)",
                  color: "#fca5a5",
                  background: "rgba(239,68,68,0.06)",
                  fontSize: "11px",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {saveError}
              </div>
            )}

            {/* Editor Textarea */}
            <EditorPane
              activeQ={activeQ}
              activeTab={activeFile?.name ?? "main.cpp"}
              currentCode={currentCode}
              lineNumbers={lineNumbers}
              lineNumberGutterRef={lineNumberGutterRef}
              onCodeChange={handleCodeChange}
              onEditorScroll={syncEditorScroll}
              onEditorTabKey={handleTabKey}
            />
          </div>

          {/* Bottom Right: Terminal */}
          <div style={{ height: "30%", minHeight: "200px", display: "flex", flexDirection: "column", background: "#0F0F0F" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #1F1F1F",
                background: "#0F0F0F",
                padding: "0 16px",
                flexShrink: 0,
                height: "38px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  color: "#64748b",
                  letterSpacing: "0.06em",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 600,
                }}
              >
                [ STDOUT // COMPILE LOGS ]
              </span>
            </div>
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 0.42fr)",
                minHeight: 0,
                color: "#a8b2d1",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "12px",
                lineHeight: 1.6,
              }}
            >
              <div style={{ padding: "12px 16px", overflowY: "auto" }}>
                <div style={{ color: "#64748b", fontSize: "10px", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  [ STDOUT ]
                </div>
                <div style={{ color: isEditorEmpty ? "#334155" : "#94a3b8", whiteSpace: "pre-wrap" }}>
                  {isEditorEmpty
                    ? "Write C++ code to prepare a submission."
                    : "No local stdout yet. Compile/run is pending a sandboxed judge runner."}
                </div>
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  overflowY: "auto",
                  borderLeft: "1px solid #1F1F1F",
                  background: "#0a0a0a",
                }}
              >
                <div style={{ color: "#64748b", fontSize: "10px", letterSpacing: "0.08em", marginBottom: "8px" }}>
                  [ COMPILE LOGS ]
                </div>
                <div style={{ color: "#94a3b8", whiteSpace: "pre-wrap" }}>{compileNote}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Proctoring footer ── */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          padding: "0 20px",
          height: "36px",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          background: "#0F0F0F",
          flexShrink: 0,
        }}
      >
        {/* Secure session indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: proctoringOk ? "#22c55e" : "#ef4444",
              boxShadow: `0 0 6px ${proctoringOk ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
              animation: "pulse-preview 2s ease-in-out infinite",
            }}
          />
          <span
            role="status"
            aria-live="polite"
            style={{
              fontSize: "10px",
              color: proctoringOk ? "#22c55e" : "#ef4444",
              fontWeight: 500,
              letterSpacing: "0.06em",
            }}
          >
            {proctoringOk ? "SESSION SECURE" : "SESSION ALERT"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Face detection */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <circle
              cx="6"
              cy="4.5"
              r="2"
              stroke={
                faceStatus === "ok" ? "#22c55e" : faceStatus === "away" ? "#f59e0b" : "#475569"
              }
              strokeWidth="1.1"
            />
            <path
              d="M1.5 11c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"
              stroke={
                faceStatus === "ok" ? "#22c55e" : faceStatus === "away" ? "#f59e0b" : "#475569"
              }
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </svg>
          <span
            style={{
              fontSize: "10px",
              color:
                faceStatus === "ok" ? "#22c55e" : faceStatus === "away" ? "#f59e0b" : "#475569",
              letterSpacing: "0.06em",
            }}
          >
            {faceStatus === "ok"
              ? "FACE DETECTED"
              : faceStatus === "away"
                ? "LOOK FORWARD"
                : "CAMERA INIT"}
          </span>
        </div>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* Keyboard intercept */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="2.5" width="10" height="7" rx="1.5" stroke="#22c55e" strokeWidth="1.1" />
            <path
              d="M3 5.5h1M5 5.5h1M7 5.5h1M3 7.5h6"
              stroke="#22c55e"
              strokeWidth="0.9"
              strokeLinecap="round"
            />
          </svg>
          <span style={{ fontSize: "10px", color: "#22c55e", letterSpacing: "0.06em" }}>
            KEYS INTERCEPTED
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Contest + question info */}
        <span style={{ fontSize: "10px", color: "#475569" }}>
          Q{activeQ + 1}/{questions.length} · {contest?.title ?? "—"}
        </span>

        <div style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.07)" }} />

        {/* AMS badge */}
        <span style={{ fontSize: "10px", color: "#64748b", letterSpacing: "0.08em" }}>
          AMS ACCESS · PROCTORED
        </span>
      </footer>

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
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(2,4,10,0.92)",
            backdropFilter: "blur(32px) brightness(0.3)",
            animation: "fadeIn 280ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            ref={faceBlockDialogRef}
            tabIndex={-1}
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "2px",
              padding: "32px 28px",
              background: "#1F1F1F",
              border: "1px solid rgba(168, 85, 247, 0.2)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: "rgba(168, 85, 247, 0.1)",
                border: "1px solid rgba(168, 85, 247, 0.3)",
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
                stroke="#c084fc"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12a4 4 0 008 0" />
                <path d="M9 9h.01M15 9h.01" strokeLinecap="round" strokeWidth="2.5" />
              </svg>
            </div>
            <h4 id="face-block-title" className="text-subsection-title" style={{ color: "#f8fafc", marginBottom: "8px" }}>
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
            zIndex: 9999,
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
              borderRadius: "2px",
              padding: "24px",
              background: "#1F1F1F",
              border: "1px solid rgba(239,68,68,0.3)",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.3)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <h4 id="media-toggle-warning-title" style={{ color: "#ef4444", margin: "0 0 16px 0", fontSize: "14px" }}>
              [ LOGGING NOTICE ]
            </h4>
            <p style={{ color: "#a8b2d1", fontSize: "12px", lineHeight: 1.6, margin: "0 0 24px 0" }}>
              Please note: Disabling your camera or microphone will be permanently logged in our system with the exact timestamp. This may affect proctoring validation.
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
                CANCEL
              </button>
              <button
                onClick={confirmMediaToggle}
                style={{
                  padding: "8px 16px",
                  border: "1px solid #ef4444",
                  background: "rgba(239,68,68,0.1)",
                  color: "#ef4444",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                ACKNOWLEDGE
              </button>
            </div>
          </div>
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
            zIndex: 9999,
            background: "rgba(15,15,15,0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
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
              border: "1px solid rgba(168,85,247,0.2)",
              borderRadius: "2px",
              padding: "32px",
              boxShadow: "0 24px 64px rgba(168, 85, 247, 0.08)",
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
                              ? "rgba(168,85,247,0.08)"
                              : "rgba(255,255,255,0.01)",
                          border: `1px solid ${supportCategory === opt.value ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.05)"}`,
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
                            accentColor: "#a855f7",
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
                        borderRadius: "2px",
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
                      {isSendingReport ? "TRANSMITTING..." : "SUBMIT REPORT"}
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
                      CANCEL
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
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.05em",
                  }}
                >
                  AUTO-ATTACHED DIAGNOSTICS
                </span>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#0F0F0F",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "2px",
                  padding: "16px",
                  overflowY: "auto",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "10.5px",
                  color: "rgba(168, 85, 247, 0.8)",
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
        @keyframes pulse-preview {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 1px solid rgba(168,85,247,0.3); outline-offset: 0; }
        textarea::-webkit-scrollbar { width: 6px; }
        textarea::-webkit-scrollbar-track { background: transparent; }
        textarea::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.2); border-radius: 3px; }

        /* Problem description markdown */
        .pb-body { color: #cbd5e1; font-size: 14px; line-height: 1.7; }
        .pb-body p { margin: 0 0 12px; }
        .pb-body h1,.pb-body h2,.pb-body h3,.pb-body h4 { color: #f1f5f9; font-family: 'JetBrains Mono', monospace; font-weight: 600; margin: 20px 0 8px; line-height: 1.3; }
        .pb-body h1 { font-size: 18px; } .pb-body h2 { font-size: 16px; } .pb-body h3 { font-size: 14px; }
        .pb-body strong { color: #f1f5f9; font-weight: 600; }
        .pb-body em { color: #a5b4fc; font-style: italic; }
        .pb-body code { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; background: rgba(168,85,247,0.1); color: #c4b5fd; padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(168,85,247,0.2); }
        .pb-body pre { background: #071124; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
        .pb-body pre code { background: none; border: none; padding: 0; color: #94a3b8; font-size: 12.5px; }
        .pb-body ul,.pb-body ol { padding-left: 20px; margin: 0 0 12px; }
        .pb-body li { margin-bottom: 4px; color: #cbd5e1; }
        .pb-body a { color: #a855f7; text-decoration: underline; text-decoration-color: rgba(168,85,247,0.4); }
        .pb-body a:hover { color: #c084fc; }
        .pb-body img { max-width: 100%; border-radius: 8px; margin: 8px 0; border: 1px solid rgba(255,255,255,0.06); }
        .pb-body blockquote { border-left: 3px solid rgba(168,85,247,0.4); margin: 12px 0; padding: 4px 0 4px 14px; color: #94a3b8; }
        .pb-body hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 16px 0; }
        .pb-body table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
        .pb-body th,.pb-body td { border: 1px solid rgba(255,255,255,0.06); padding: 6px 10px; text-align: left; }
        .pb-body th { background: rgba(168,85,247,0.08); color: #e2e8f0; font-weight: 600; }
        .pb-body var.pb-math { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 12.5px; background: rgba(56,189,248,0.1); color: #7dd3fc; padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(56,189,248,0.2); }

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
          outline: none; border: none; cursor: pointer; margin: 10px 0; display: block;
        }
        .pb-body input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 10px; height: 10px;
          background: #a855f7; border-radius: 0; cursor: pointer;
        }
        .pb-body input[type="range"]::-moz-range-thumb {
          width: 10px; height: 10px;
          background: #a855f7; border-radius: 0; border: none; cursor: pointer;
        }
        .pb-body input[type="range"]::-webkit-slider-runnable-track { background: rgba(255,255,255,0.08); height: 2px; }
        /* Nested output spans inside widgets */
        .pb-body code > div span { color: #64748b; }
        .pb-body code > div span[id] { color: #c4b5fd; }
      `}</style>
    </div>
  );
}
