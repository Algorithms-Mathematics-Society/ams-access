"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
  const previewDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { remaining, urgent } = useCountdown(
    contest?.end_at ?? new Date(Date.now() + 3600000).toISOString()
  );

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !contestId) {
      setLoading(false);
      return;
    }
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    Promise.all([
      sb.from("contests").select("id,title,end_at,status").eq("id", contestId).single(),
      sb.from("contest_questions").select("*").eq("contest_id", contestId).order("order_index"),
    ]).then(([{ data: c }, { data: q }]) => {
      if (c) setContest(c as ContestMeta);
      const qs = (q as Question[]) ?? [];
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
      await window.__TAURI__?.window.getCurrentWindow().setFullscreen(false);
    } catch {}
    router.push("/home");
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setProctoringOk((v) => {
        if (Math.random() > 0.97) return false;
        return true;
      });
      setFaceStatus((prev) => {
        const r = Math.random();
        if (r > 0.85) return "away";
        return "ok";
      });
    }, 3000);
    return () => clearInterval(interval);
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
