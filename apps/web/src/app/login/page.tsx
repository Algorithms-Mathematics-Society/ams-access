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
    <div className="login-root">
      {/* ══════════════════ LEFT PANE ══════════════════ */}
      <div className="login-left">
        <div className="login-logo">
          <svg width="20" height="20" viewBox="0 0 172 162" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.00043 162L87.0004 2L172 162" stroke="#a855f7" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
          <div className="login-logo-label">
            <span className="login-logo-name">AMS Access</span>
            <span className="login-logo-sub">Derive Examination System</span>
          </div>
        </div>

        <div className="login-brand">
          <div className="login-brand-mark">
            <svg width="56" height="53" viewBox="0 0 172 162" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2.00043 162L87.0004 2L172 162" stroke="#a855f7" strokeWidth="6" strokeLinecap="square" strokeLinejoin="miter" />
              <path d="M32 162L87 52L142 162" stroke="rgba(168,85,247,0.25)" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
            </svg>
          </div>

          <h2 className="login-brand-headline">
            Your contest.<br /><em>Verified.</em>
          </h2>
          <p className="login-brand-sub">
            A secure, proctored environment for high-stakes competitive programming.
          </p>

          <div className="login-brand-features">
            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Native lockdown</span>
                <span className="login-brand-feature-desc">OS-level keyboard intercept and process isolation</span>
              </div>
            </div>

            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Continuous proctoring</span>
                <span className="login-brand-feature-desc">Face presence verified throughout your session</span>
              </div>
            </div>

            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Live judging</span>
                <span className="login-brand-feature-desc">Submissions evaluated in seconds, results in real time</span>
              </div>
            </div>
          </div>

          <div className="login-brand-footer">AMS Derive · Secure Exam Platform</div>
        </div>
      </div>

      {/* ══════════════════ RIGHT PANE ══════════════════ */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-form-title">Sign in</div>
          <div className="login-form-sub">AMS Derive &middot; This session will be proctored</div>
          <div className="login-rule" />

          <form onSubmit={handleSubmit} noValidate>
            <div className="login-field">
              <label
                htmlFor="login-email"
                className={`login-label${emailFocused ? " login-label--focused" : ""}`}
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
                className="login-input"
              />
            </div>

            <div className="login-field">
              <label
                htmlFor="login-password"
                className={`login-label${passFocused ? " login-label--focused" : ""}`}
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
                className="login-input"
              />
            </div>

            <div className="login-submit-wrap">
              <button type="submit" disabled={loading} className="login-submit">
                {loading ? (
                  <>
                    <svg
                      className="login-spinner"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle cx="6" cy="6" r="4.5" stroke="rgba(168,85,247,0.25)" strokeWidth="1.5" />
                      <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="butt" />
                    </svg>
                    Verifying...
                  </>
                ) : (
                  "Sign in"
                )}
              </button>

              {error && (
                <p id="login-error" role="alert" className="login-error">
                  {error}
                </p>
              )}

              {process.env.NODE_ENV === "development" && (
                <button
                  type="button"
                  disabled={loading}
                  className="login-dev-btn"
                  onClick={handleDevSignIn}
                >
                  Dev sign in
                </button>
              )}
            </div>
          </form>

          <div className="login-sso-wrap">
            <button type="button" onClick={() => setShowSSOModal(true)} className="login-sso-btn">
              Institution SSO
            </button>
          </div>

          <p className="login-form-note">
            This is a proctored session. Your device will be verified after you sign in.
          </p>
          <p className="login-form-support">
            Need help signing in? Contact your contest organizer.
          </p>
        </div>
      </div>

      {/* ══════════════════ SSO Modal ══════════════════ */}
      {showSSOModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="sso-title" className="login-modal-bg">
          <div className="login-modal">
            <div className="login-modal-tag">Limited availability</div>
            <h3 id="sso-title" className="login-modal-title">
              Institution SSO is not enabled
            </h3>
            <p className="login-modal-body">
              Institution Single Sign-On is not available for this contest. Use the email and
              password assigned to you by your contest organizer to sign in.
            </p>
            <button type="button" onClick={() => setShowSSOModal(false)} className="login-modal-close">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
