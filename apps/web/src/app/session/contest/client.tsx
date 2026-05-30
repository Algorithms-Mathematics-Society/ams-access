"use client";

import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const ACTIVE_SESSION_KEY = "ams_active_session";

type Question = {
  id: string;
  title: string;
  description: string | null;
  html_starter: string | null;
  css_starter: string | null;
  js_starter: string | null;
  order_index: number;
};

type ContestMeta = {
  id: string;
  title: string;
  end_at: string;
  status: string;
};

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

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>/* CSS injected */</style>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`;

function buildPreview(html: string, css: string, js: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>${css}</style>
</head>
<body>
${html}
<script>
try { ${js} } catch(e) { console.error(e); }
</script>
</body>
</html>`;
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 16px",
        borderRadius: "8px",
        background: urgent ? "rgba(239,68,68,0.1)" : "rgba(168,85,247,0.08)",
        border: `1px solid ${urgent ? "rgba(239,68,68,0.3)" : "rgba(168,85,247,0.25)"}`,
        transition: "all 600ms",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke={urgent ? "#ef4444" : "#a855f7"} strokeWidth="1.2" />
        <path
          d="M6 3.5V6l1.5 1.5"
          stroke={urgent ? "#ef4444" : "#a855f7"}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontSize: "13px",
          fontWeight: 600,
          color: urgent ? "#ef4444" : "#a855f7",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.05em",
        }}
      >
        {remaining}
      </span>
      <span style={{ fontSize: "10px", color: urgent ? "#ef4444" : "#64748b", fontWeight: 400 }}>
        remaining
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
  const [activeTab, setActiveTab] = useState<"html" | "css" | "js">("html");
  const [html, setHtml] = useState("");
  const [css, setCss] = useState("");
  const [js, setJs] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [proctoringOk, setProctoringOk] = useState(true);
  const [faceStatus, setFaceStatus] = useState<"ok" | "away" | "unknown">("unknown");
  const [blockedApps, setBlockedApps] = useState<string[]>([]);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processScanInFlightRef = useRef(false);
  const lastViolationDetailRef = useRef("");
  const lastViolationAtRef = useRef(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportCategory, setSupportCategory] = useState("camera_not_detected");
  const [customIssueDetail, setCustomIssueDetail] = useState("");
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportSentSuccess, setReportSentSuccess] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewUpdating, setPreviewUpdating] = useState(false);
  const [lockGraceActive, setLockGraceActive] = useState(false);
  const [lockGraceCountdown, setLockGraceCountdown] = useState(3);
  const [cameraCollapsed, setCameraCollapsed] = useState(false);
  const [faceGraceCountdown, setFaceGraceCountdown] = useState(5);
  const [faceGraceActive, setFaceGraceActive] = useState(false);
  const [softBlockActive, setSoftBlockActive] = useState(false);

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
      await fetch(`${API_URL}/sessions/${sessionId ?? "unregistered"}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: supportCategory,
          detail: supportCategory === "other" ? customIssueDetail : "",
          telemetry: supportTelemetry,
        }),
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
          title: "Hello World Page",
          description: "Build a simple Hello World HTML page with styled heading",
          html_starter: `<div class="container">\n  <h1>Hello, World!</h1>\n  <p>Welcome to AMS Access dev test.</p>\n</div>`,
          css_starter: `body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  background: #0f172a;\n  color: #f1f5f9;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n}\n\n.container {\n  text-align: center;\n  padding: 2rem;\n}\n\nh1 {\n  font-size: 2.5rem;\n  color: #a855f7;\n  margin-bottom: 0.5rem;\n}`,
          js_starter: `console.log("AMS contest session active");`,
          order_index: 0,
        },
        {
          id: "mock-q-2",
          title: "Interactive Counter",
          description: "Build a counter with increment and decrement buttons",
          html_starter: `<div class="counter">\n  <button id="dec">−</button>\n  <span id="count">0</span>\n  <button id="inc">+</button>\n</div>`,
          css_starter: `body {\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n  background: #030816;\n  font-family: system-ui, sans-serif;\n}\n\n.counter {\n  display: flex;\n  align-items: center;\n  gap: 1.5rem;\n}\n\nbutton {\n  width: 48px;\n  height: 48px;\n  border-radius: 50%;\n  border: 1px solid rgba(168,85,247,0.5);\n  background: rgba(168,85,247,0.1);\n  color: #a855f7;\n  font-size: 1.5rem;\n  cursor: pointer;\n}\n\n#count {\n  font-size: 3rem;\n  font-weight: 300;\n  color: #f5f7fa;\n  min-width: 60px;\n  text-align: center;\n}`,
          js_starter: `let n = 0;\nconst el = document.getElementById("count");\ndocument.getElementById("inc").onclick = () => el.textContent = ++n;\ndocument.getElementById("dec").onclick = () => el.textContent = --n;`,
          order_index: 1,
        },
        {
          id: "mock-q-3",
          title: "CSS Animation",
          description: "Create a pulsing circle animation using pure CSS",
          html_starter: `<div class="pulse"></div>`,
          css_starter: `body {\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n  background: #030816;\n}\n\n.pulse {\n  width: 80px;\n  height: 80px;\n  border-radius: 50%;\n  background: #a855f7;\n  animation: pulse 1.5s ease-in-out infinite;\n}\n\n@keyframes pulse {\n  0%, 100% { transform: scale(1); opacity: 1; }\n  50% { transform: scale(1.4); opacity: 0.5; }\n}`,
          js_starter: ``,
          order_index: 2,
        },
      ];
      setQuestions(mockQuestions);
      loadQuestion(mockQuestions[0]);
      setLoading(false);
      return;
    }

    Promise.all([
      fetch(`${API_URL}/contests/${contestId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_URL}/contests/${contestId}/questions`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(async ([c, qs]) => {
        if (c) setContest(c as ContestMeta);
        const questions = (qs ?? []) as Question[];
        setQuestions(questions);
        if (questions.length > 0) loadQuestion(questions[0]);

        // Create session for this contest
        const email = localStorage.getItem("ams_user_email") ?? "candidate@ams.local";
        try {
          const res = await fetch(`${API_URL}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contest_id: contestId,
              candidate_email: email,
              candidate_name: email.split("@")[0],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            setSessionId(data.id);
            localStorage.setItem(
              ACTIVE_SESSION_KEY,
              JSON.stringify({
                id: data.id,
                contest_id: contestId,
                contest_title: c?.title,
                updated_at: new Date().toISOString(),
              })
            );
          }
        } catch {}

        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function loadQuestion(q: Question) {
    setHtml(q.html_starter ?? "");
    setCss(q.css_starter ?? "");
    setJs(q.js_starter ?? "");
    setPreviewSrc(buildPreview(q.html_starter ?? "", q.css_starter ?? "", q.js_starter ?? ""));
  }

  function switchQuestion(idx: number) {
    setActiveQ(idx);
    loadQuestion(questions[idx]);
    setActiveTab("html");
  }

  function handleCodeChange(value: string) {
    if (activeTab === "html") setHtml(value);
    else if (activeTab === "css") setCss(value);
    else setJs(value);

    const newHtml = activeTab === "html" ? value : html;
    const newCss = activeTab === "css" ? value : css;
    const newJs = activeTab === "js" ? value : js;

    setPreviewUpdating(true);

    if (previewDebounce.current) clearTimeout(previewDebounce.current);
    previewDebounce.current = setTimeout(() => {
      setPreviewSrc(buildPreview(newHtml, newCss, newJs));
      setPreviewUpdating(false);
    }, 600);
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [activeTab, html, css, js]
  );

  async function handleSave() {
    if (!questions[activeQ] || !sessionId) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questions[activeQ].id,
          answer_text: JSON.stringify({ html, css, js }),
        }),
      });
    } catch {}
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSubmit() {
    if (!submitConfirm) {
      setSubmitConfirm(true);
      return;
    }
    await handleSave();
    if (sessionId) {
      try {
        await fetch(`${API_URL}/sessions/${sessionId}/submit`, { method: "POST" });
      } catch {}
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
    if (!navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;

    async function acquire(isRetry = false) {
      try {
        const s = await withTimeout(
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
          }),
          3500,
          "Camera request timed out"
        );
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        cameraStreamRef.current = s;
        setCameraStream(s);
        setCameraError(null);
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = s;
          cameraVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        // NotReadableError / AbortError = device still releasing from onboarding;
        // retry once after a short delay before surfacing an error.
        const isRaceError =
          !isRetry &&
          (msg.includes("NotReadable") || msg.includes("Abort") || msg.includes("busy"));
        if (isRaceError) {
          setTimeout(() => {
            if (!cancelled) void acquire(true);
          }, 600);
        } else {
          const displayMsg =
            msg.includes("NotAllowed") ||
            msg.includes("not allowed") ||
            msg.includes("denied") ||
            msg.includes("Permission")
              ? "Camera access was denied. Please check your system settings to grant camera permission."
              : msg.includes("NotFound") || msg.includes("not found")
                ? "No camera was found. Please ensure your camera is connected securely."
                : "Camera is currently unavailable. Please check your camera settings and try again.";
          setCameraError(displayMsg);
        }
      }
    }

    void acquire();
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => {
      fetch(`${API_URL}/sessions/${sessionId}/heartbeat`, { method: "POST" }).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [sessionId]);

  useEffect(() => {
    if (cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
      cameraVideoRef.current.play().catch(() => {});
    }
  }, [cameraStream]);

  useEffect(() => {
    if (!cameraStream || !cameraVideoRef.current) return;
    // Simulate face detection toggle based on whether stream is active
    const interval = setInterval(() => {
      setFaceStatus(cameraStream.active ? "ok" : "away");
      setProctoringOk(true);
    }, 2000);
    return () => clearInterval(interval);
  }, [cameraStream]);

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
          const now = Date.now();
          if (
            detail !== lastViolationDetailRef.current ||
            now - lastViolationAtRef.current > 30000
          ) {
            lastViolationDetailRef.current = detail;
            lastViolationAtRef.current = now;
            await invoke("log_violation", {
              kind: "blocked_app",
              detail: result.found.join(", "),
            });
          }
        } else {
          lastViolationDetailRef.current = "";
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
  }, []);

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

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "#030816",
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

  const currentCode = activeTab === "html" ? html : activeTab === "css" ? css : js;
  const tabColor = { html: "#f97316", css: "#38bdf8", js: "#facc15" };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#030816",
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
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(4,10,24,0.95)",
          flexShrink: 0,
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
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(245,158,11,0.35)",
              background: "rgba(245,158,11,0.08)",
              color: "#f59e0b",
              fontSize: "12px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 220ms",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 1v6M8 11.5h.01"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Report Issue
          </button>

          {submitConfirm && (
            <span style={{ fontSize: "12px", color: "#f59e0b" }}>
              Confirm? Click again to submit.
            </span>
          )}
          <button
            onClick={handleSubmit}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(239,68,68,0.4)",
              background: submitConfirm ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.08)",
              color: "#ef4444",
              fontSize: "12px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 220ms",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M1.5 9L4.5 6M4.5 6L1.5 3M4.5 6H10.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {submitConfirm ? "Confirm Submit" : "Submit & Exit"}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Question list sidebar */}
        <aside
          style={{
            width: sidebarCollapsed ? "52px" : "220px",
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(4,10,24,0.7)",
            overflow: "hidden",
            transition: "width 250ms var(--ease-cinematic)",
          }}
        >
          <div
            style={{
              padding: sidebarCollapsed ? "14px 0" : "14px 14px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex",
              alignItems: "center",
              justifyContent: sidebarCollapsed ? "center" : "space-between",
            }}
          >
            {!sidebarCollapsed && (
              <p
                style={{
                  fontSize: "10px",
                  color: "#475569",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  fontWeight: 500,
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
                transition: "color 150ms",
              }}
              title={sidebarCollapsed ? "Expand questions list" : "Collapse questions list"}
            >
              {sidebarCollapsed ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M6 12l4-4-4-4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10 12L6 8l4-4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
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
              <p
                style={{
                  fontSize: "12px",
                  color: "#475569",
                  textAlign: "center",
                  marginTop: "24px",
                }}
              >
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
                  borderRadius: "9px",
                  border: `1px solid ${activeQ === i ? "rgba(168,85,247,0.35)" : "transparent"}`,
                  background:
                    activeQ === i
                      ? "linear-gradient(135deg, rgba(126,34,206,0.5) 0%, rgba(168,85,247,0.35) 100%)"
                      : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all 180ms",
                  height: sidebarCollapsed ? "36px" : "auto",
                }}
                title={sidebarCollapsed ? q.title : undefined}
              >
                {sidebarCollapsed ? (
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: activeQ === i ? "#e9d5ff" : "#64748b",
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "6px",
                        background:
                          activeQ === i ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 600,
                        color: activeQ === i ? "#e9d5ff" : "#64748b",
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 500,
                        color: activeQ === i ? "#f5f7fa" : "#94a3b8",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {q.title}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Editor + Preview */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Code editor panel */}
          <div
            style={{
              width: "50%",
              display: "flex",
              flexDirection: "column",
              borderRight: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {/* Tab bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(4,10,24,0.8)",
                padding: "0 12px",
                gap: "4px",
                flexShrink: 0,
                height: "38px",
              }}
            >
              {(["html", "css", "js"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setActiveTab(t)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "0 16px",
                    border: "none",
                    background: activeTab === t ? "rgba(255,255,255,0.02)" : "transparent",
                    color: activeTab === t ? "#ffffff" : "#475569",
                    fontSize: "11px",
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    transition: "all 150ms var(--ease-cinematic)",
                    letterSpacing: "0.05em",
                    height: "100%",
                    borderRadius: "0px",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: tabColor[t],
                      opacity: activeTab === t ? 1 : 0.45,
                    }}
                  />
                  {t.toUpperCase()}
                  {activeTab === t && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: "2px",
                        background: tabColor[t],
                        boxShadow: `0 0 8px ${tabColor[t]}`,
                      }}
                    />
                  )}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 500,
                  fontFamily: "inherit",
                  border: `1px solid ${saved ? "rgba(34,197,94,0.4)" : "rgba(168,85,247,0.3)"}`,
                  background: saved ? "rgba(34,197,94,0.1)" : "rgba(168,85,247,0.08)",
                  color: saved ? "#22c55e" : "#a855f7",
                  cursor: saving ? "not-allowed" : "pointer",
                  transition: "all 200ms",
                }}
              >
                {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
              </button>
            </div>

            {/* Textarea */}
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <textarea
                aria-label="Answer editor"
                key={`${activeQ}-${activeTab}`}
                value={currentCode}
                onChange={(e) => handleCodeChange(e.target.value)}
                onKeyDown={handleTabKey}
                spellCheck={false}
                style={{
                  width: "100%",
                  height: "100%",
                  resize: "none",
                  border: "none",
                  outline: "none",
                  background: "#050d1e",
                  color: "#e2e8f0",
                  fontFamily:
                    "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  padding: "16px 20px",
                  boxSizing: "border-box",
                  caretColor: tabColor[activeTab],
                  tabSize: 2,
                }}
              />
            </div>
          </div>

          {/* Preview panel */}
          <div style={{ width: "50%", display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                background: "rgba(4,10,24,0.8)",
                padding: "0 16px",
                flexShrink: 0,
                height: "38px",
              }}
            >
              <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                {["#ef4444", "#f59e0b", "#22c55e"].map((c) => (
                  <div
                    key={c}
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: c,
                      opacity: 0.6,
                    }}
                  />
                ))}
              </div>
              <span
                style={{
                  marginLeft: "12px",
                  fontSize: "11px",
                  color: "#475569",
                  letterSpacing: "0.06em",
                }}
              >
                PREVIEW
              </span>
              <div style={{ flex: 1 }} />
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#22c55e",
                  boxShadow: "0 0 6px rgba(34,197,94,0.5)",
                  animation: "pulse-preview 2s ease-in-out infinite",
                }}
              />
            </div>
            <div style={{ flex: 1, position: "relative", background: "#fff" }}>
              {previewUpdating && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: "2px",
                    background: "linear-gradient(90deg, #a855f7 0%, #d8b4fe 50%, #a855f7 100%)",
                    backgroundSize: "200% 100%",
                    animation: "preview-loading-bar 1.5s linear infinite",
                    zIndex: 10,
                  }}
                />
              )}
              {previewSrc ? (
                <iframe
                  srcDoc={previewSrc}
                  sandbox="allow-scripts"
                  style={{ width: "100%", height: "100%", border: "none" }}
                  title="preview"
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#0a1428",
                  }}
                >
                  <p style={{ color: "#475569", fontSize: "12px" }}>No preview yet</p>
                </div>
              )}
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
          background: "rgba(3,8,22,0.98)",
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

      {/* ── Camera PiP ── video always in DOM so ref is available when stream arrives */}
      <div
        style={{
          position: "fixed",
          bottom: "56px",
          right: "20px",
          zIndex: 50,
          width: cameraCollapsed ? "170px" : "210px",
          height: cameraCollapsed ? "34px" : "158px",
          borderRadius: "8px",
          overflow: "hidden",
          border: `1px solid ${
            cameraCollapsed
              ? "rgba(34,197,94,0.3)"
              : faceStatus === "ok"
                ? "rgba(34,197,94,0.35)"
                : "rgba(245,158,11,0.35)"
          }`,
          boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px ${
            faceStatus === "ok" ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.06)"
          }`,
          transition: "all 300ms var(--ease-cinematic)",
          background: "#02040a",
          display: (cameraStream ?? cameraError) ? "block" : "none",
        }}
      >
        {/* Toggle Collapse Button */}
        <button
          type="button"
          onClick={() => setCameraCollapsed(!cameraCollapsed)}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            zIndex: 60,
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "4px",
            width: "20px",
            height: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#ffffff",
            fontSize: "10px",
            lineHeight: 1,
            transition: "all 200ms",
          }}
          title={cameraCollapsed ? "Expand Feed" : "Collapse Feed"}
        >
          {cameraCollapsed ? "＋" : "－"}
        </button>

        {cameraCollapsed ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              paddingLeft: "10px",
              gap: "6px",
              background: "rgba(4,10,24,0.95)",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#22c55e",
                boxShadow: "0 0 8px #22c55e",
                animation: "pulse-preview 1.8s ease-in-out infinite",
              }}
            />
            <span
              style={{
                fontSize: "9px",
                color: "#22c55e",
                fontWeight: 600,
                letterSpacing: "0.06em",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              PROCTORING ACTIVE
            </span>
          </div>
        ) : (
          <>
            <video
              ref={cameraVideoRef}
              muted
              playsInline
              autoPlay
              style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
            />

            {/* HUD Corner Alignment Brackets */}
            {(() => {
              const bracketColor =
                faceStatus === "ok" ? "rgba(34,197,94,0.65)" : "rgba(245,158,11,0.65)";
              return (
                <>
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      left: "10px",
                      width: "8px",
                      height: "8px",
                      borderTop: `1.5px solid ${bracketColor}`,
                      borderLeft: `1.5px solid ${bracketColor}`,
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "10px",
                      right: "10px",
                      width: "8px",
                      height: "8px",
                      borderTop: `1.5px solid ${bracketColor}`,
                      borderRight: `1.5px solid ${bracketColor}`,
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "10px",
                      left: "10px",
                      width: "8px",
                      height: "8px",
                      borderBottom: `1.5px solid ${bracketColor}`,
                      borderLeft: `1.5px solid ${bracketColor}`,
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: "10px",
                      right: "10px",
                      width: "8px",
                      height: "8px",
                      borderBottom: `1.5px solid ${bracketColor}`,
                      borderRight: `1.5px solid ${bracketColor}`,
                      pointerEvents: "none",
                    }}
                  />
                </>
              );
            })()}

            {cameraError && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(2,4,10,0.85)",
                  padding: "12px",
                }}
              >
                <p
                  style={{
                    fontSize: "11px",
                    color: "#fca5a5",
                    textAlign: "center",
                    lineHeight: 1.5,
                    fontFamily: "inherit",
                  }}
                >
                  {cameraError}
                </p>
              </div>
            )}

            {/* PROCTORED Active Banner Top Overlay */}
            <div
              style={{
                position: "absolute",
                top: "8px",
                left: "8px",
                background: "rgba(0,0,0,0.65)",
                backdropFilter: "blur(4px)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  width: "4px",
                  height: "4px",
                  borderRadius: "50%",
                  background: "#ef4444",
                  boxShadow: "0 0 6px #ef4444",
                  animation: "pulse-preview 1.5s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  fontSize: "8.5px",
                  color: "rgba(255,255,255,0.8)",
                  letterSpacing: "0.1em",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                LIVE FEED
              </span>
            </div>

            {/* Face status HUD Bottom overlay */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                padding: "6px 10px",
                background: "rgba(2,4,10,0.75)",
                backdropFilter: "blur(4px)",
                borderTop: "1px solid rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: faceStatus === "ok" ? "#22c55e" : "#f59e0b",
                  boxShadow: `0 0 8px ${faceStatus === "ok" ? "#22c55e" : "#f59e0b"}`,
                  animation: "pulse-preview 2s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  fontSize: "9px",
                  color: faceStatus === "ok" ? "#22c55e" : "#f59e0b",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {faceStatus === "ok" ? "ALIGNMENT SECURE" : "LOOK FORWARD"}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Face proctoring soft-block overlay ── */}
      {softBlockActive && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(3,8,22,0.7)",
            backdropFilter: "blur(12px)",
            animation: "fadeIn 280ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            style={{
              maxWidth: "400px",
              width: "100%",
              borderRadius: "16px",
              padding: "32px 28px",
              background: "rgba(15, 23, 42, 0.95)",
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
            <h4 className="text-subsection-title" style={{ color: "#f8fafc", marginBottom: "8px" }}>
              Integrity Check Paused
            </h4>
            <p className="text-body-copy" style={{ color: "#94a3b8", lineHeight: 1.5, margin: 0 }}>
              Please look back at the camera to resume your exam.
            </p>
          </div>
        </div>
      )}

      {/* ── Support Incident Modal Overlay ── */}
      {showSupportModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(3,8,22,0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "800px",
              background: "#080b11",
              border: "1px solid rgba(168,85,247,0.2)",
              borderRadius: "16px",
              padding: "32px",
              boxShadow: "0 24px 64px rgba(168, 85, 247, 0.08)",
              position: "relative",
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: "32px",
            }}
          >
            {/* L-Shape Decals */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "12px",
                height: "12px",
                borderTop: "2px solid #a855f7",
                borderLeft: "2px solid #a855f7",
                opacity: 0.6,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: "12px",
                height: "12px",
                borderTop: "2px solid #a855f7",
                borderRight: "2px solid #a855f7",
                opacity: 0.6,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                width: "12px",
                height: "12px",
                borderBottom: "2px solid #a855f7",
                borderLeft: "2px solid #a855f7",
                opacity: 0.6,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                right: 0,
                width: "12px",
                height: "12px",
                borderBottom: "2px solid #a855f7",
                borderRight: "2px solid #a855f7",
                opacity: 0.6,
              }}
            />

            {/* Left Column: Form & Categories */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <h3
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
                        background: "#02040a",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        fontSize: "12px",
                        color: "#e2e8f0",
                        fontFamily: "inherit",
                        outline: "none",
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
                        color: "#080b11",
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
                  background: "#02040a",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: "8px",
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
        textarea::-webkit-scrollbar { width: 6px; }
        textarea::-webkit-scrollbar-track { background: transparent; }
        textarea::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.2); border-radius: 3px; }
      `}</style>
    </div>
  );
}
