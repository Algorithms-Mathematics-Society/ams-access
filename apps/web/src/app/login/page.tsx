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
  const [error, setError] = useState<string | null>(null);
  const [showSSOModal, setShowSSOModal] = useState(false);

  useEffect(() => {
    localStorage.setItem("ams_theme", "dark");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
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

      if (res.status === 401 || res.status === 403) {
        setError("Email or password did not match.");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError("Sign-in failed. Please try again.");
        setLoading(false);
        return;
      }

      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
    } catch {
      setError("Cannot reach AMS Access. Check your internet connection and try again.");
      setLoading(false);
    }
  }

  function handleDevSignIn() {
    if (loading) return;
    setError(null);
    setEmail(TEST_EMAIL);
    setPassword(TEST_PASSWORD);
    setLoading(true);
    localStorage.setItem("ams_user_email", TEST_EMAIL);
    setTimeout(() => router.push("/home"), 250);
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

        .bl-form-title {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0;
          color: rgba(255,255,255,0.9);
          margin-bottom: 6px;
        }

        .bl-form-sub {
          font-size: 11px;
          letter-spacing: 0;
          color: #666666;
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
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #666666;
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
          border-radius: 8px;
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

        .bl-input:focus-visible {
          outline: 2px solid rgba(168,85,247,0.5);
          outline-offset: 2px;
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
          border-radius: 8px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          min-height: 40px;
          padding: 0 24px;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }

        .bl-submit:hover:not(:disabled) {
          background: #a855f7;
          color: #000000;
        }

        .bl-submit:focus-visible {
          outline: 2px solid rgba(168,85,247,0.6);
          outline-offset: 2px;
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

        /* Inline error */
        .bl-error {
          margin-top: 12px;
          padding: 10px 12px;
          border: 1px solid rgba(239,68,68,0.25);
          background: rgba(239,68,68,0.06);
          font-size: 12px;
          font-family: 'Inter', system-ui, sans-serif;
          color: #fca5a5;
          line-height: 1.5;
          letter-spacing: 0;
        }

        /* Dev autofill */
        .bl-dev-btn {
          display: block;
          width: 100%;
          margin-top: 10px;
          background: transparent;
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 8px;
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
          border-radius: 8px;
          color: #777777;
          font-family: inherit;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0;
          padding: 0 16px;
          min-height: 38px;
          cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
        }

        .bl-sso-btn:hover {
          border-color: rgba(255,255,255,0.1);
          color: #888888;
        }

        .bl-sso-btn:focus-visible {
          outline: 2px solid rgba(168,85,247,0.5);
          outline-offset: 2px;
        }

        .bl-form-note {
          margin-top: 18px;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 11px;
          letter-spacing: 0;
          color: #555555;
          line-height: 1.6;
        }

        .bl-form-support {
          margin-top: 10px;
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 11px;
          color: #666666;
          line-height: 1.6;
        }

        .bl-form-support a {
          color: rgba(168,85,247,0.8);
          text-decoration: none;
        }

        .bl-form-support a:hover {
          color: #a855f7;
          text-decoration: underline;
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
          border-radius: 10px;
          padding: 32px 36px;
          max-width: 440px;
          width: 90%;
        }

        .bl-modal-tag {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: #fbbf24;
          text-transform: uppercase;
          margin-bottom: 12px;
        }

        .bl-modal-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0;
          color: #ffffff;
          margin-bottom: 16px;
        }

        .bl-modal-body {
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.65;
          color: #888888;
          margin-bottom: 28px;
          letter-spacing: 0;
        }

        .bl-modal-close {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          color: #d8b4fe;
          font-family: inherit;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0;
          padding: 0 18px;
          min-height: 38px;
          cursor: pointer;
          transition: border-color 0.12s, color 0.12s;
        }

        .bl-modal-close:hover {
          border-color: rgba(255,255,255,0.2);
          color: #aaaaaa;
        }

        .bl-modal-close:focus-visible {
          outline: 2px solid rgba(168,85,247,0.5);
          outline-offset: 2px;
        }

        /* ── Responsive: collapse to single column on narrow windows ── */
        @media (max-width: 720px) {
          .bl-root {
            grid-template-columns: 1fr;
          }
          .bl-left {
            display: none;
          }
          .bl-right {
            padding: 32px 24px;
          }
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
            <div className="bl-form-title">Sign in</div>
            <div className="bl-form-sub">AMS Derive &middot; This session will be proctored</div>
            <div className="bl-rule" />

            <form onSubmit={handleSubmit} noValidate>
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
                  onChange={(e) => { setError(null); setEmail(e.target.value); }}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="you@institution.edu"
                  autoComplete="email"
                  required
                  disabled={loading}
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={error ? "true" : undefined}
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
                  onChange={(e) => { setError(null); setPassword(e.target.value); }}
                  onFocus={() => setPassFocused(true)}
                  onBlur={() => setPassFocused(false)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={error ? "true" : undefined}
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
                        aria-hidden="true"
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
                    "Sign in"
                  )}
                </button>

                {error && (
                  <p id="login-error" role="alert" className="bl-error">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  disabled={loading}
                  className="bl-dev-btn"
                  onClick={handleDevSignIn}
                >
                  Dev sign in
                </button>
              </div>
            </form>

            <div className="bl-sso-wrap">
              <button type="button" onClick={() => setShowSSOModal(true)} className="bl-sso-btn">
                Institution SSO
              </button>
            </div>

            <p className="bl-form-note">
              This is a proctored session. Your device will be verified after you sign in.
            </p>
            <p className="bl-form-support">
              Need help signing in? Contact your contest organizer.
            </p>
          </div>
        </div>
      </div>

      {/* ══════════════════ SSO Modal ══════════════════ */}
      {showSSOModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="sso-title" className="bl-modal-bg">
          <div className="bl-modal">
            <div className="bl-modal-tag">Limited availability</div>
            <h3 id="sso-title" className="bl-modal-title">
              Institution SSO is not enabled
            </h3>
            <p className="bl-modal-body">
              Institution Single Sign-On is not available for this contest. Use the email and
              password assigned to you by your contest organizer to sign in.
            </p>
            <button type="button" onClick={() => setShowSSOModal(false)} className="bl-modal-close">
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
