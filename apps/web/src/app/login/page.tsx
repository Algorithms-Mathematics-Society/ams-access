"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveApiBase } from "@/lib/api-base";
import { HelpRequestModal } from "@/components/HelpRequestModal";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetState, setResetState] = useState<"idle" | "sending" | "sent">("idle");

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
              stroke="#a855f7"
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
                stroke="#a855f7"
                strokeWidth="6"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
              <path
                d="M32 162L87 52L142 162"
                stroke="rgba(168,85,247,0.25)"
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
                  stroke="#a855f7"
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
                  stroke="#a855f7"
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
                  stroke="#a855f7"
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
                <p id="login-error" role="alert" className="login-error">
                  {error}
                </p>
              )}
            </div>
          </form>

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
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#a855f7",
                  cursor: "pointer",
                  font: "inherit",
                  textDecoration: "underline",
                }}
              >
                {resetState === "sending" ? "Sending…" : "Forgot password?"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "#a855f7",
                cursor: "pointer",
                font: "inherit",
                textDecoration: "underline",
              }}
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
    </div>
  );
}
