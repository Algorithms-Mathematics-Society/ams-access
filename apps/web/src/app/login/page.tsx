"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";

const TEST_EMAIL = "tester@ams.local";
const TEST_PASSWORD = "access2025";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSSOModal, setShowSSOModal] = useState(false);

  useEffect(() => {
    localStorage.setItem("ams_theme", "dark");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
      return;
    }

    try {
      const apiUrl = resolveApiBase();
      const res = await fetch(`${apiUrl}/students/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setLoading(false);
        return;
      }

      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
    } catch {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        .bl-root {
          display: grid;
          grid-template-columns: 44% 1fr;
          min-height: 100vh;
          height: 100vh;
          font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
          background: #0F0F0F;
          color: #ffffff;
          overflow: hidden;
        }

        /* ── LEFT PANE ───────────────────────────────────────── */
        .bl-left {
          background: #141414;
          border-right: 1px solid rgba(255,255,255,0.05);
          display: flex;
          flex-direction: column;
          padding: 44px 52px;
          overflow: hidden;
        }

        .bl-logo {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          flex-shrink: 0;
        }

        .bl-logo-label {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .bl-logo-name {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.88);
        }

        .bl-logo-sub {
          font-size: 9px;
          letter-spacing: 0.2em;
          color: #444444;
          text-transform: uppercase;
        }

        .bl-spacer { flex: 1; }

        /* ── RIGHT PANE ──────────────────────────────────────── */
        .bl-right {
          background: #0F0F0F;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 56px;
        }

        .bl-form-wrap {
          width: 100%;
          max-width: 360px;
        }

        .bl-form-eyebrow {
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0.25em;
          color: #a855f7;
          text-transform: uppercase;
          margin-bottom: 10px;
        }

        .bl-form-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: rgba(255,255,255,0.9);
          text-transform: uppercase;
          margin-bottom: 6px;
        }

        .bl-form-sub {
          font-size: 9px;
          letter-spacing: 0.12em;
          color: #444444;
          margin-bottom: 28px;
        }

        .bl-rule {
          height: 1px;
          background: rgba(255,255,255,0.05);
          margin-bottom: 28px;
        }

        /* Fields */
        .bl-field {
          margin-bottom: 18px;
        }

        .bl-label {
          display: block;
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0.22em;
          color: #555555;
          text-transform: uppercase;
          margin-bottom: 7px;
          transition: color 0.12s;
        }

        .bl-label.focused { color: #a855f7; }

        .bl-input {
          display: block;
          width: 100%;
          background: #0A0A0A;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 0;
          color: #ffffff;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 12px;
          padding: 11px 13px;
          outline: none;
          -webkit-appearance: none;
          appearance: none;
          transition: border-color 0.12s, background 0.12s;
        }

        .bl-input::placeholder {
          color: #2a2a2a;
          font-family: inherit;
        }

        .bl-input:focus {
          border-color: rgba(168,85,247,0.45);
          background: #0D0D0D;
        }

        .bl-input:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        /* Submit */
        .bl-submit-wrap { margin-top: 24px; }

        .bl-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          background: #1F1F1F;
          color: #a855f7;
          border: 1px solid #a855f7;
          border-radius: 0;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          padding: 14px 24px;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }

        .bl-submit:hover:not(:disabled) {
          background: #a855f7;
          color: #000000;
        }

        .bl-submit:disabled {
          background: #1F1F1F;
          border-color: #3b1a6b;
          color: #3b1a6b;
          cursor: not-allowed;
        }

        /* Spinner */
        .bl-spinner {
          flex-shrink: 0;
          animation: bl-spin 0.75s linear infinite;
        }

        @keyframes bl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        /* Dev autofill */
        .bl-dev-btn {
          display: block;
          width: 100%;
          margin-top: 10px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 0;
          color: #333333;
          font-family: inherit;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          padding: 8px 16px;
          cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
          text-align: center;
        }

        .bl-dev-btn:hover {
          border-color: rgba(255,255,255,0.08);
          color: #555555;
        }

        /* SSO */
        .bl-sso-wrap {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.05);
        }

        .bl-sso-btn {
          width: 100%;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 0;
          color: #444444;
          font-family: inherit;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 10px 16px;
          cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
        }

        .bl-sso-btn:hover {
          border-color: rgba(255,255,255,0.1);
          color: #777777;
        }

        .bl-form-note {
          margin-top: 18px;
          font-size: 8.5px;
          letter-spacing: 0.06em;
          color: #A8A8A8;
          line-height: 1.8;
        }

        /* SSO Modal */
        .bl-modal-bg {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.88);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 200;
        }

        .bl-modal {
          background: #141414;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0;
          padding: 40px 44px;
          max-width: 440px;
          width: 90%;
        }

        .bl-modal-tag {
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0.22em;
          color: #ef4444;
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        .bl-modal-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #ffffff;
          text-transform: uppercase;
          margin-bottom: 16px;
        }

        .bl-modal-body {
          font-size: 10.5px;
          line-height: 1.8;
          color: #666666;
          margin-bottom: 28px;
          letter-spacing: 0.03em;
        }

        .bl-modal-close {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0;
          color: #666666;
          font-family: inherit;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          padding: 10px 20px;
          cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
        }

        .bl-modal-close:hover {
          border-color: rgba(255,255,255,0.2);
          color: #aaaaaa;
        }
      `}</style>

      <div className="bl-root">
        {/* ══════════════════ LEFT PANE ══════════════════ */}
        <div className="bl-left">
          {/* Logo */}
          <div className="bl-logo">
            <svg
              width="20"
              height="20"
              viewBox="0 0 172 162"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.00043 162L87.0004 2L172 162"
                stroke="#a855f7"
                strokeWidth="6"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
            <div className="bl-logo-label">
              <span className="bl-logo-name">AMS Access</span>
              <span className="bl-logo-sub">Derive Examination System</span>
            </div>
          </div>
        </div>

        {/* ══════════════════ RIGHT PANE ══════════════════ */}
        <div className="bl-right">
          <div className="bl-form-wrap">
            <div className="bl-form-title">Authentication Required</div>
            <div className="bl-form-sub">AMS Derive · Session will be fully proctored</div>
            <div className="bl-rule" />

            <form onSubmit={handleSubmit}>
              <div className="bl-field">
                <label
                  htmlFor="login-email"
                  className={`bl-label${emailFocused ? " focused" : ""}`}
                >
                  Email
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
                  disabled={loading}
                  className="bl-input"
                />
              </div>

              <div className="bl-field">
                <label
                  htmlFor="login-password"
                  className={`bl-label${passFocused ? " focused" : ""}`}
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPassFocused(true)}
                  onBlur={() => setPassFocused(false)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  className="bl-input"
                />
              </div>

              <div className="bl-submit-wrap">
                <button type="submit" disabled={loading} className="bl-submit">
                  {loading ? (
                    <>
                      <svg
                        className="bl-spinner"
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                      >
                        <circle
                          cx="6"
                          cy="6"
                          r="4.5"
                          stroke="rgba(168,85,247,0.25)"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M6 1.5A4.5 4.5 0 0 1 10.5 6"
                          stroke="#a855f7"
                          strokeWidth="1.5"
                          strokeLinecap="butt"
                        />
                      </svg>
                      Verifying...
                    </>
                  ) : (
                    "Authenticate"
                  )}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  className="bl-dev-btn"
                  onClick={() => {
                    setEmail(TEST_EMAIL);
                    setPassword(TEST_PASSWORD);
                  }}
                >
                  [ dev: autofill test credentials ]
                </button>
              </div>
            </form>

            <div className="bl-sso-wrap">
              <button type="button" onClick={() => setShowSSOModal(true)} className="bl-sso-btn">
                [ Institution_SSO ] →
              </button>
            </div>

            <p className="bl-form-note">
              This is a strictly proctored environment. System verification and optical telemetry
              will initialize after authentication.
            </p>
          </div>
        </div>
      </div>

      {/* ══════════════════ SSO Modal ══════════════════ */}
      {showSSOModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="sso-title" className="bl-modal-bg">
          <div className="bl-modal">
            <div className="bl-modal-tag">[ Status: Unavailable ]</div>
            <h3 id="sso-title" className="bl-modal-title">
              Institution SSO Portal
            </h3>
            <p className="bl-modal-body">
              Institution Single Sign-On is currently unavailable for this version of the
              application. Contact your institution&#39;s administrator to register your device, or
              use your designated secure email credentials to sign in directly.
            </p>
            <button type="button" onClick={() => setShowSSOModal(false)} className="bl-modal-close">
              [ Acknowledge &amp; Close ]
            </button>
          </div>
        </div>
      )}
    </>
  );
}
