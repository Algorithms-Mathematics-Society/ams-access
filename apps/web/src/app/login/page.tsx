"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { isGatingRelaxed, warnGatingRelaxed } from "@/lib/gating";
import { HelpRequestModal } from "@/components/HelpRequestModal";
import { STORAGE_KEYS } from "@/constants/storage-keys";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");

  // Passwordless email-code sign-in (primary). Password path stays as secondary.
  const [mode, setMode] = useState<"password" | "otp">("otp");
  const [otpStep, setOtpStep] = useState<"email" | "code">("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpState, setOtpState] = useState<"idle" | "sending" | "verifying">("idle");

  async function handleSendOtp() {
    if (otpState === "sending") return;
    if (!email.trim()) {
      setError("Enter your email to receive a code.");
      return;
    }
    setError(null);
    setOtpState("sending");
    try {
      await fetch(`${resolveApiBase()}/students/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // request-otp always responds 200; ignore transport errors for neutral UX.
    }
    setOtpState("idle");
    setOtpStep("code");
  }

  async function handleVerifyOtp() {
    if (otpState === "verifying") return;
    if (otpCode.trim().length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setError(null);
    setOtpState("verifying");
    try {
      const res = await fetch(`${resolveApiBase()}/students/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: otpCode.trim() }),
      });
      if (!res.ok) {
        setOtpState("idle");
        setError("That code didn't match — request a new one.");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { email?: string };
      localStorage.setItem(STORAGE_KEYS.USER_EMAIL, data.email ?? email.trim());
      setTimeout(() => router.push("/home"), 400);
    } catch {
      setOtpState("idle");
      setError("Couldn't verify the code. Check your connection and try again.");
    }
  }

  async function handlePasswordReset() {
    if (resetState === "sending") return;
    if (!email.trim()) {
      setError("Enter your email above first, then tap “Forgot password?”.");
      return;
    }
    setResetState("sending");
    try {
      await fetch(`${resolveApiBase()}/students/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Endpoint always responds 200; ignore transport errors for the neutral UX.
    }
    setResetState("sent");
  }

  useEffect(() => {
    localStorage.setItem("ams_theme", "dark");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    if (isGatingRelaxed() && email === TEST_EMAIL && password === TEST_PASSWORD) {
      warnGatingRelaxed("login test-account backdoor used");
      localStorage.setItem(STORAGE_KEYS.USER_EMAIL, email);
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

      localStorage.setItem(STORAGE_KEYS.USER_EMAIL, email);
      setTimeout(() => router.push("/home"), 850);
    } catch {
      setError("Cannot reach AMS Access. Check your internet connection and try again.");
      setLoading(false);
    }
  }

  function handleDevSignIn() {
    if (!isGatingRelaxed()) return;
    if (loading) return;
    warnGatingRelaxed("login test-account backdoor used");
    setError(null);
    setEmail(TEST_EMAIL);
    setPassword(TEST_PASSWORD);
    localStorage.setItem(STORAGE_KEYS.USER_EMAIL, TEST_EMAIL);
    setTimeout(() => router.push("/home"), 250);
  }

  return (
    <div className="login-root">
      {/* ══════════════════ LEFT PANE ══════════════════ */}
      <div className="login-left">
        <div className="login-logo">
          <svg
            width="20"
            height="20"
            viewBox="0 0 172 162"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2.00043 162L87.0004 2L172 162"
              stroke="var(--color-accent-base)"
              strokeWidth="6"
              strokeLinecap="square"
              strokeLinejoin="miter"
            />
          </svg>
          <div className="login-logo-label">
            <span className="login-logo-name">AMS Access</span>
            <span className="login-logo-sub">Exam workspace</span>
          </div>
        </div>

        <div className="login-brand">
          <div className="login-brand-mark">
            <svg
              width="56"
              height="53"
              viewBox="0 0 172 162"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M2.00043 162L87.0004 2L172 162"
                stroke="var(--color-accent-base)"
                strokeWidth="6"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
              <path
                d="M32 162L87 52L142 162"
                stroke="rgb(var(--accent-rgb) / 0.25)"
                strokeWidth="4"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
          </div>

          <h2 className="login-brand-headline">
            Your contest.
            <br />
            <em>Made fair.</em>
          </h2>
          <p className="login-brand-sub">
            A calm, fair space for your coding contest — so your work is the only thing that counts.
          </p>

          <div className="login-brand-features">
            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-accent-base)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Distraction-free</span>
                <span className="login-brand-feature-desc">
                  Other apps and shortcuts pause during the exam, so everyone competes on equal
                  footing.
                </span>
              </div>
            </div>

            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-accent-base)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="8" r="4" />
                  <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Fair for everyone</span>
                <span className="login-brand-feature-desc">
                  A quick camera check confirms you&rsquo;re present during the exam.
                </span>
              </div>
            </div>

            <div className="login-brand-feature">
              <div className="login-brand-feature-icon">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-accent-base)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <div className="login-brand-feature-text">
                <span className="login-brand-feature-label">Instant feedback</span>
                <span className="login-brand-feature-desc">
                  Your code is checked the moment you submit.
                </span>
              </div>
            </div>
          </div>

          <div className="login-brand-footer">AMS Access · Fair, secure exams</div>
        </div>
      </div>

      {/* ══════════════════ RIGHT PANE ══════════════════ */}
      <div className="login-right">
        <div className="login-form-wrap">
          <div className="login-form-title">Sign in</div>
          <div className="login-form-sub">AMS Access &middot; A calm, proctored exam space</div>
          <div className="login-rule" />

          {mode === "otp" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (otpStep === "email") void handleSendOtp();
                else void handleVerifyOtp();
              }}
              noValidate
            >
              <div className="login-field">
                <label
                  htmlFor="login-email-otp"
                  className={`login-label${emailFocused ? " login-label--focused" : ""}`}
                >
                  Email
                </label>
                <input
                  id="login-email-otp"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setError(null);
                    setEmail(e.target.value);
                  }}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  placeholder="you@institution.edu"
                  autoComplete="email"
                  required
                  disabled={otpStep === "code" || otpState !== "idle"}
                  aria-describedby={error ? "login-error" : undefined}
                  aria-invalid={error ? "true" : undefined}
                  className="login-input"
                />
              </div>

              {otpStep === "code" && (
                <div className="login-field">
                  <label htmlFor="login-otp-code" className="login-label">
                    6-digit code
                  </label>
                  <input
                    id="login-otp-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => {
                      setError(null);
                      setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    }}
                    placeholder="••••••"
                    autoComplete="one-time-code"
                    aria-describedby={error ? "login-error" : undefined}
                    aria-invalid={error ? "true" : undefined}
                    className="login-input"
                    style={{ letterSpacing: "0.3em" }}
                  />
                  <p className="login-form-note" style={{ marginTop: 8 }}>
                    We emailed a code to {email.trim() || "your inbox"}. It expires in 10 minutes.
                  </p>
                </div>
              )}

              <div className="login-submit-wrap">
                <button type="submit" disabled={otpState !== "idle"} className="login-submit">
                  {otpState === "sending"
                    ? "Sending code..."
                    : otpState === "verifying"
                      ? "Verifying..."
                      : otpStep === "email"
                        ? "Send code"
                        : "Verify & sign in"}
                </button>

                {error && (
                  <p id="login-error" role="alert" className="login-error">
                    {error}
                  </p>
                )}

                {otpStep === "code" && (
                  <button
                    type="button"
                    className="login-dev-btn"
                    disabled={otpState !== "idle"}
                    onClick={() => {
                      setOtpStep("email");
                      setOtpCode("");
                      setError(null);
                    }}
                  >
                    Use a different email
                  </button>
                )}
              </div>
            </form>
          ) : (
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
                  onChange={(e) => {
                    setError(null);
                    setEmail(e.target.value);
                  }}
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
                  onChange={(e) => {
                    setError(null);
                    setPassword(e.target.value);
                  }}
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
                        <circle
                          cx="6"
                          cy="6"
                          r="4.5"
                          stroke="rgb(var(--accent-rgb) / 0.25)"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M6 1.5A4.5 4.5 0 0 1 10.5 6"
                          stroke="var(--color-accent-base)"
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
                  <p id="login-error" role="alert" className="login-error">
                    {error}
                  </p>
                )}

                {isGatingRelaxed() && (
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
          )}

          <div
            className="login-sso-wrap"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "otp" ? "password" : "otp"));
                setError(null);
                setOtpStep("email");
                setOtpCode("");
                setOtpState("idle");
                setLoading(false);
              }}
              className="login-sso-btn"
            >
              {mode === "otp" ? "Sign in with password instead" : "Use an email code instead"}
            </button>
            <button type="button" onClick={() => setShowSSOModal(true)} className="login-sso-btn">
              Institution SSO
            </button>
          </div>

          <p className="login-form-note">
            This exam is proctored to keep it fair. After you sign in, we&rsquo;ll set up your
            camera and check your device.
          </p>
          <div
            className="login-form-support"
            style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
          >
            {resetState === "sent" ? (
              <span>
                If that email is registered, we&apos;ve sent reset instructions. Check your inbox
                and spam.
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handlePasswordReset()}
                disabled={resetState === "sending"}
                className="login-textlink"
              >
                {resetState === "sending" ? "Sending…" : "Forgot password?"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="login-textlink login-textlink--quiet"
            >
              Can&apos;t sign in? Get help
            </button>
          </div>
        </div>
      </div>

      <HelpRequestModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        kind="LOGIN"
        summary="I can't sign in to AMS Access."
        defaultEmail={email.trim()}
        details={{ source: "login", attempted_email: email.trim() || undefined, last_error: error }}
      />

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
            <button
              type="button"
              onClick={() => setShowSSOModal(false)}
              className="login-modal-close"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
