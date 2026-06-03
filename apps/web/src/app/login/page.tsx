"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { resolveApiBase } from "@/lib/api-base";

// ─── Constants ────────────────────────────────────────────────
const TEST_EMAIL = "tester@ams.local";
const TEST_PASSWORD = "access2025";

// ─── Log entry shape ──────────────────────────────────────────
type LogLevel = "ERR" | "INF" | "OK";
interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
}

function nowTs() {
  return new Date().toISOString().slice(11, 23);
}

// ─── SYSTEM_LOGS pane ─────────────────────────────────────────
function SyslogPane({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="syslog-pane" aria-live="polite" aria-label="System log">
      <div className="syslog-header">▶ SYSTEM_LOGS</div>
      {entries.slice(-4).map((e, i) => (
        <div key={i} className="syslog-entry">
          <span className="syslog-ts">{e.ts}</span>
          <span
            className={
              e.level === "ERR"
                ? "syslog-level-err"
                : e.level === "OK"
                  ? "syslog-level-ok"
                  : "syslog-level-info"
            }
          >
            [{e.level}]
          </span>
          <span className="syslog-msg">{e.msg}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [showSSOModal, setShowSSOModal] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((level: LogLevel, msg: string) => {
    setLogs((prev) => [...prev, { ts: nowTs(), level, msg }]);
  }, []);

  useEffect(() => {
    localStorage.setItem("ams_theme", "dark");
    addLog("INF", "SESSION_INIT  secure_shell=true  theme=OBSIDIAN_DARK");
  }, [addLog]);

  // Cancel autofill on any real keypress
  useEffect(() => {
    if (!isTyping) return;
    const abort = () => {
      setIsTyping(false);
      setEmail(TEST_EMAIL);
      setPassword(TEST_PASSWORD);
    };
    window.addEventListener("keydown", abort);
    return () => window.removeEventListener("keydown", abort);
  }, [isTyping]);

  // Typewriter — rAF chain at 55 ms/char (≈18 chars/s).
  // Zero setInterval; React re-renders once per character but at a
  // human-readable pace, not 125 times per second.
  const handleAutoFill = useCallback(() => {
    if (isTyping || loading) return;
    setIsTyping(true);
    addLog("INF", "AUTOFILL_INIT  injecting secure access token...");

    const CHAR_MS = 55;
    let lastTime = 0;
    let emailIdx = 0;
    let passIdx = 0;
    let phase: "email" | "pass" = "email";

    const tick = (now: number) => {
      if (now - lastTime < CHAR_MS) {
        requestAnimationFrame(tick);
        return;
      }
      lastTime = now;

      if (phase === "email") {
        emailIdx++;
        setEmail(TEST_EMAIL.slice(0, emailIdx));
        if (emailIdx < TEST_EMAIL.length) {
          requestAnimationFrame(tick);
        } else {
          phase = "pass";
          requestAnimationFrame(tick);
        }
      } else {
        passIdx++;
        setPassword(TEST_PASSWORD.slice(0, passIdx));
        if (passIdx < TEST_PASSWORD.length) {
          requestAnimationFrame(tick);
        } else {
          setIsTyping(false);
          addLog("OK", "AUTOFILL_DONE  credentials_injected");
        }
      }
    };

    requestAnimationFrame(tick);
  }, [isTyping, loading, addLog]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isTyping || loading) return;

    setLoading(true);
    // 1. Dev Bypass Option
    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      addLog("OK", "AUTH_SUCCESS  (DEV_BYPASS) routing_to=/home");
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
      return;
    }

    // 2. Real Candidate Authentication against Firebase via Go API
    addLog("INF", `AUTH_ATTEMPT  email=${email || "<empty>"}`);
    try {
      const apiUrl = resolveApiBase();
      const res = await fetch(`${apiUrl}/students/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        let errData: any = {};
        try {
          errData = await res.json();
        } catch {}
        addLog("ERR", `INVALID_CREDENTIALS  reason=${errData.error || "Authentication failed."}`);
        setLoading(false);
        return;
      }

      addLog("OK", "AUTH_SUCCESS  routing_to=/home");
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
    } catch (err) {
      addLog("ERR", `API_UNREACHABLE  error=${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }

  return (
    <>
      <main className="login-root">
        {/* ── Status bar ─────────────────────────────────── */}
        <div className="login-status-bar">
          <span className="login-status-dot" />
          <span className="login-status-label">OBSIDIAN_DARK // SECURE_SHELL</span>
        </div>

        {/* ── Login card ─────────────────────────────────── */}
        <div className="login-card">
          <div className="login-logo-wrap">
            <Image
              src="/AMS_ACCESS.svg"
              alt="AMS Access"
              width={210}
              height={48}
              priority
              className="login-logo"
            />
          </div>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div className="login-field">
              <label
                htmlFor="login-email"
                className={`login-label text-micro-label${emailFocused ? " is-focused" : ""}`}
              >
                Email Address
                {emailFocused && (
                  <span className="login-label-cursor" style={{ left: "120px" }}>
                    ▎
                  </span>
                )}
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="you@institution.edu"
                autoComplete="email"
                required
                disabled={isTyping || loading}
                className="login-input"
              />
            </div>

            {/* Password */}
            <div className="login-field-last">
              <label
                htmlFor="login-password"
                className={`login-label text-micro-label${passwordFocused ? " is-focused" : ""}`}
              >
                Password
                {passwordFocused && (
                  <span className="login-label-cursor" style={{ left: "85px" }}>
                    ▎
                  </span>
                )}
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
                disabled={isTyping || loading}
                className="login-input login-input--password"
              />
            </div>

            {/* Continue */}
            <div className="login-btn-wrap">
              <ContinueButton loading={loading} isTyping={isTyping} />
            </div>

            {/* Divider */}
            <div className="login-divider">
              <div className="login-divider-line" />
              <span className="login-divider-label">security gate</span>
              <div className="login-divider-line" />
            </div>

            <SSOButton onUnavailable={() => setShowSSOModal(true)} />
          </form>

          <p className="login-footer">
            Session is proctored. Complete system lock and video checks are required.
          </p>
        </div>

        {/* ── Autofill keycard ───────────────────────────── */}
        <button
          type="button"
          onClick={handleAutoFill}
          disabled={isTyping || loading}
          className="secure-keycard"
        >
          <div className="keycard-header">
            <p className="keycard-title text-micro-label">[ SECURE ACCESS TOKEN (AUTO-FILL) ]</p>
            <span className="keycard-badge">{isTyping ? "INJECTING..." : "CLICK TO SYNC"}</span>
          </div>
          <div className="keycard-credentials">
            <span>EMAIL: {TEST_EMAIL}</span>
            <span>PASS: {TEST_PASSWORD}</span>
          </div>
        </button>

        {/* ── SSO Modal ──────────────────────────────────── */}
        {showSSOModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sso-modal-title"
            className="sso-modal-overlay"
          >
            <div className="sso-modal">
              <div className="sso-modal-icon-wrap">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 id="sso-modal-title" className="sso-modal-title text-subsection-title">
                Institution SSO Portal
              </h3>
              <p className="sso-modal-body text-body-copy">
                Institution Single Sign-On is currently unavailable for this version of the app.
                Please contact your institution&#39;s administrator to register your device or use
                your designated secure email credentials to sign in directly.
              </p>
              <button
                type="button"
                onClick={() => setShowSSOModal(false)}
                className="sso-modal-close"
              >
                Acknowledge &amp; Close
              </button>
            </div>
          </div>
        )}
      </main>

      {/* SYSTEM_LOGS — fixed to viewport bottom, never occludes card */}
      <SyslogPane entries={logs} />
    </>
  );
}

// ─── Continue button — hover via CSS :hover, no JS state ─────
function ContinueButton({ loading, isTyping }: { loading: boolean; isTyping: boolean }) {
  return (
    <button type="submit" disabled={loading || isTyping} className="continue-btn">
      {loading ? (
        <>
          <Spinner />
          Verifying secure link...
        </>
      ) : isTyping ? (
        "Syncing credentials..."
      ) : (
        "Continue"
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="login-spinner">
      <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── SSO button — hover via CSS :hover, no JS state ──────────
function SSOButton({ onUnavailable }: { onUnavailable: () => void }) {
  return (
    <button type="button" onClick={onUnavailable} className="sso-btn">
      [ INSTITUTION SINGLE SIGN-ON ]
    </button>
  );
}
