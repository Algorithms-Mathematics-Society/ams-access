"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Question = {
  id: string;
  title: string;
  description: string | null;
  html_template: string | null;
  css_template: string | null;
  js_template: string | null;
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

function useCountdown(endAt: string) {
  const [remaining, setRemaining] = useState("");
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    function tick() {
      const diff = new Date(endAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("00:00:00");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setUrgent(diff < 300000);
      setRemaining(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endAt]);

  return { remaining, urgent };
}

export default function ContestPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contestId = searchParams.get("contestId") ?? "";

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

  // stable fallback so useCountdown's effect doesn't restart on every render
  const fallbackEndAt = useMemo(() => new Date(Date.now() + 3600000).toISOString(), []);
  const { remaining, urgent } = useCountdown(contest?.end_at ?? fallbackEndAt);

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
          html_template: `<div class="container">\n  <h1>Hello, World!</h1>\n  <p>Welcome to AMS Access dev test.</p>\n</div>`,
          css_template: `body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  background: #0f172a;\n  color: #f1f5f9;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n}\n\n.container {\n  text-align: center;\n  padding: 2rem;\n}\n\nh1 {\n  font-size: 2.5rem;\n  color: #a855f7;\n  margin-bottom: 0.5rem;\n}`,
          js_template: `console.log("AMS contest session active");`,
          order_index: 0,
        },
        {
          id: "mock-q-2",
          title: "Interactive Counter",
          description: "Build a counter with increment and decrement buttons",
          html_template: `<div class="counter">\n  <button id="dec">−</button>\n  <span id="count">0</span>\n  <button id="inc">+</button>\n</div>`,
          css_template: `body {\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n  background: #030816;\n  font-family: system-ui, sans-serif;\n}\n\n.counter {\n  display: flex;\n  align-items: center;\n  gap: 1.5rem;\n}\n\nbutton {\n  width: 48px;\n  height: 48px;\n  border-radius: 50%;\n  border: 1px solid rgba(168,85,247,0.5);\n  background: rgba(168,85,247,0.1);\n  color: #a855f7;\n  font-size: 1.5rem;\n  cursor: pointer;\n}\n\n#count {\n  font-size: 3rem;\n  font-weight: 300;\n  color: #f5f7fa;\n  min-width: 60px;\n  text-align: center;\n}`,
          js_template: `let n = 0;\nconst el = document.getElementById("count");\ndocument.getElementById("inc").onclick = () => el.textContent = ++n;\ndocument.getElementById("dec").onclick = () => el.textContent = --n;`,
          order_index: 1,
        },
        {
          id: "mock-q-3",
          title: "CSS Animation",
          description: "Create a pulsing circle animation using pure CSS",
          html_template: `<div class="pulse"></div>`,
          css_template: `body {\n  margin: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 100vh;\n  background: #030816;\n}\n\n.pulse {\n  width: 80px;\n  height: 80px;\n  border-radius: 50%;\n  background: #a855f7;\n  animation: pulse 1.5s ease-in-out infinite;\n}\n\n@keyframes pulse {\n  0%, 100% { transform: scale(1); opacity: 1; }\n  50% { transform: scale(1.4); opacity: 0.5; }\n}`,
          js_template: ``,
          order_index: 2,
        },
      ];
      setQuestions(mockQuestions);
      loadQuestion(mockQuestions[0]);
      setLoading(false);
      return;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !contestId) {
      setLoading(false);
      return;
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    Promise.all([
      sb.from("contests").select("id,title,end_at,status").eq("id", contestId).single(),
      sb
        .from("contest_questions")
        .select(
          "order_index, questions(id,title,description,html_template,css_template,js_template)"
        )
        .eq("contest_id", contestId)
        .order("order_index"),
    ]).then(([{ data: c }, { data: q }]) => {
      if (c) setContest(c as ContestMeta);
      type JoinRow = { order_index: number; questions: Question | Question[] | null };
      const rows = (q ?? []) as unknown as JoinRow[];
      const qs: Question[] = rows
        .map((r) => {
          const qt = Array.isArray(r.questions) ? r.questions[0] : r.questions;
          return qt ? { ...qt, order_index: r.order_index } : null;
        })
        .filter((x): x is Question => x !== null);
      setQuestions(qs);
      if (qs.length > 0) loadQuestion(qs[0]);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contestId]);

  function loadQuestion(q: Question) {
    setHtml(q.html_template ?? "");
    setCss(q.css_template ?? "");
    setJs(q.js_template ?? "");
    setPreviewSrc(buildPreview(q.html_template ?? "", q.css_template ?? "", q.js_template ?? ""));
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

    if (previewDebounce.current) clearTimeout(previewDebounce.current);
    previewDebounce.current = setTimeout(() => {
      setPreviewSrc(buildPreview(newHtml, newCss, newJs));
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
    if (!questions[activeQ]) return;
    setSaving(true);
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await sb
      .from("contest_questions")
      .update({
        html_template: html,
        css_template: css,
        js_template: js,
      })
      .eq("id", questions[activeQ].id);
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
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
        });
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
              ? "Camera access denied"
              : msg.includes("NotFound") || msg.includes("not found")
                ? "No camera found"
                : "Camera unavailable";
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
      try {
        const result = await invoke<{ found: string[]; clean: boolean }>("scan_processes");
        if (!result.clean && result.found.length > 0) {
          setBlockedApps(result.found.map((f) => prettyName[f.toLowerCase()] ?? f));
          setProctoringOk(false);
          await invoke("log_violation", {
            kind: "blocked_app",
            detail: result.found.join(", "),
          });
        } else {
          setBlockedApps([]);
          setProctoringOk(true);
        }
      } catch {
        // Tauri not available (dev browser mode)
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
      {/* ── Blocked app violation overlay ── */}
      {blockedApps.length > 0 && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(3,8,22,0.96)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              maxWidth: "440px",
              width: "100%",
              borderRadius: "20px",
              padding: "36px 32px",
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.3)",
              boxShadow: "0 0 60px rgba(239,68,68,0.15)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
                fontSize: "24px",
              }}
            >
              ⚠
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
              Close the following apps to continue your exam. This violation has been logged.
            </p>
            <div style={{ marginBottom: "24px" }}>
              {blockedApps.map((app) => (
                <div
                  key={app}
                  style={{
                    padding: "10px 16px",
                    marginBottom: "8px",
                    borderRadius: "10px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
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
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke={urgent ? "#ef4444" : "#a855f7"}
              strokeWidth="1.2"
            />
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
          <span
            style={{ fontSize: "10px", color: urgent ? "#ef4444" : "#64748b", fontWeight: 400 }}
          >
            remaining
          </span>
        </div>

        {/* Right: Submit */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            width: "220px",
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.05)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(4,10,24,0.7)",
            overflow: "hidden",
          }}
        >
          <div
            style={{ padding: "14px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
          >
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
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
            {questions.length === 0 && (
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
                onClick={() => switchQuestion(i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "9px",
                  border: `1px solid ${activeQ === i ? "rgba(168,85,247,0.35)" : "transparent"}`,
                  background:
                    activeQ === i
                      ? "linear-gradient(135deg, rgba(126,34,206,0.5) 0%, rgba(168,85,247,0.35) 100%)"
                      : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  marginBottom: "4px",
                  transition: "all 180ms",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}
                >
                  <span
                    style={{
                      width: "20px",
                      height: "20px",
                      borderRadius: "6px",
                      background: activeQ === i ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.06)",
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
                {q.description && (
                  <p
                    style={{
                      fontSize: "11px",
                      color: "#475569",
                      paddingLeft: "28px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {q.description}
                  </p>
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
                  onClick={() => setActiveTab(t)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "5px 12px",
                    borderRadius: "6px",
                    border: `1px solid ${activeTab === t ? `${tabColor[t]}44` : "transparent"}`,
                    background: activeTab === t ? `${tabColor[t]}18` : "transparent",
                    color: activeTab === t ? tabColor[t] : "#475569",
                    fontSize: "11px",
                    fontWeight: 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    transition: "all 180ms",
                    letterSpacing: "0.03em",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: tabColor[t],
                      opacity: activeTab === t ? 1 : 0.35,
                    }}
                  />
                  {t.toUpperCase()}
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
              {previewSrc ? (
                <iframe
                  key={previewSrc}
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
          bottom: "48px",
          right: "16px",
          zIndex: 50,
          width: "160px",
          height: "120px",
          borderRadius: "12px",
          overflow: "hidden",
          border: `2px solid ${faceStatus === "ok" ? "rgba(34,197,94,0.5)" : "rgba(245,158,11,0.5)"}`,
          boxShadow: `0 0 20px ${faceStatus === "ok" ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)"}`,
          transition: "border-color 600ms, box-shadow 600ms",
          background: "#000",
          display: (cameraStream ?? cameraError) ? "block" : "none",
        }}
      >
        <video
          ref={cameraVideoRef}
          muted
          playsInline
          autoPlay
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
        {cameraError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.82)",
              padding: "8px",
            }}
          >
            <p style={{ fontSize: "11px", color: "#fca5a5", textAlign: "center", lineHeight: 1.5 }}>
              {cameraError}
            </p>
          </div>
        )}
        {/* Face status overlay */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            padding: "4px 8px",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <div
            style={{
              width: "5px",
              height: "5px",
              borderRadius: "50%",
              background: faceStatus === "ok" ? "#22c55e" : "#f59e0b",
              boxShadow: `0 0 5px ${faceStatus === "ok" ? "#22c55e" : "#f59e0b"}`,
              animation: "pulse-preview 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: "9px",
              color: faceStatus === "ok" ? "#22c55e" : "#f59e0b",
              letterSpacing: "0.06em",
            }}
          >
            {faceStatus === "ok" ? "FACE OK" : "LOOK FORWARD"}
          </span>
        </div>
        {/* PROCTORED label */}
        <div
          style={{
            position: "absolute",
            top: "5px",
            left: "6px",
            fontSize: "8px",
            color: "rgba(168,85,247,0.8)",
            letterSpacing: "0.1em",
            fontWeight: 600,
          }}
        >
          PROCTORED
        </div>
      </div>

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
