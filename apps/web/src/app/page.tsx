"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const TEST_EMAIL = "tester@ams.local";
const TEST_PASSWORD = "access2025";

function getLoginThemeColors(theme: "dark" | "light") {
  const isLight = theme === "light";
  return {
    bg: isLight ? "#f7f4ee" : "#030408",
    grid: isLight ? "rgba(68, 52, 94, 0.07)" : "rgba(255, 255, 255, 0.015)",
    card: isLight ? "rgba(255, 255, 255, 0.94)" : "rgba(9, 9, 12, 0.95)",
    cardBorder: isLight ? "rgba(124, 58, 237, 0.14)" : "rgba(255, 255, 255, 0.08)",
    input: isLight ? "rgba(255, 255, 255, 0.86)" : "rgba(0, 0, 0, 0.45)",
    inputBorder: isLight ? "rgba(124, 58, 237, 0.14)" : "rgba(255,255,255,0.08)",
    inputShadow: isLight
      ? "inset 0 1px 2px rgba(80, 70, 55, 0.08)"
      : "inset 0 1px 3px rgba(0,0,0,0.6)",
    text: isLight ? "#302a3b" : "#f8fafc",
    muted: isLight ? "rgba(48, 42, 59, 0.54)" : "rgba(255,255,255,0.45)",
    faint: isLight ? "rgba(48, 42, 59, 0.34)" : "rgba(255,255,255,0.28)",
    accent: isLight ? "#7c3aed" : "#a855f7",
    accentText: isLight ? "#6d28d9" : "#c084fc",
    keycardBg: isLight ? "rgba(124, 58, 237, 0.06)" : "rgba(139, 92, 246, 0.05)",
    keycardBorder: isLight ? "rgba(124, 58, 237, 0.18)" : "rgba(139, 92, 246, 0.16)",
    shadow: isLight
      ? "0 24px 64px rgba(80, 70, 55, 0.14), 0 0 0 1px rgba(124, 58, 237, 0.04)"
      : "0 0 0 1px rgba(168, 85, 247, 0.03), 0 24px 64px rgba(0, 0, 0, 0.85), 0 0 48px rgba(168, 85, 247, 0.04)",
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showSSOModal, setShowSSOModal] = useState(false);
  const emailIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const c = getLoginThemeColors(theme);

  // Interrupt simulated typing on any keypress
  useEffect(() => {
    if (!isTyping) return;
    const handleKeyDown = () => {
      if (emailIntervalRef.current) clearInterval(emailIntervalRef.current);
      if (passIntervalRef.current) clearInterval(passIntervalRef.current);
      setIsTyping(false);
      setEmail(TEST_EMAIL);
      setPassword(TEST_PASSWORD);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTyping]);

  useEffect(() => {
    const saved = localStorage.getItem("ams_theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
    } else {
      localStorage.setItem("ams_theme", "light");
    }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("ams_theme", next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isTyping) return;
    setError("");

    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      setLoading(true);
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
    } else {
      setError("Invalid email or password. Please verify your credentials and try again.");
    }
  }

  const handleAutoFill = () => {
    if (isTyping || loading) return;
    setError("");
    setIsTyping(true);

    let currentEmail = "";
    let currentPass = "";
    let emailIdx = 0;
    let passIdx = 0;

    emailIntervalRef.current = setInterval(() => {
      if (emailIdx < TEST_EMAIL.length) {
        currentEmail += TEST_EMAIL[emailIdx];
        setEmail(currentEmail);
        emailIdx++;
      } else {
        if (emailIntervalRef.current) clearInterval(emailIntervalRef.current);

        setTimeout(() => {
          passIntervalRef.current = setInterval(() => {
            if (passIdx < TEST_PASSWORD.length) {
              currentPass += TEST_PASSWORD[passIdx];
              setPassword(currentPass);
              passIdx++;
            } else {
              if (passIntervalRef.current) clearInterval(passIntervalRef.current);
              setIsTyping(false);
            }
          }, 8);
        }, 50);
      }
    }, 8);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "var(--font-geist), 'Geist', 'Inter', system-ui, sans-serif",
        backgroundImage: `
          linear-gradient(${c.grid} 1px, transparent 1px),
          linear-gradient(90deg, ${c.grid} 1px, transparent 1px)
        `,
        backgroundSize: "56px 56px",
        backgroundColor: c.bg,
        position: "relative",
        transition: "background-color 260ms var(--ease-cinematic)",
      }}
    >
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
        style={{
          position: "absolute",
          top: "24px",
          right: "24px",
          zIndex: 2,
          width: "42px",
          height: "42px",
          borderRadius: "8px",
          border: `1px solid ${c.cardBorder}`,
          background: c.card,
          color: c.accentText,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            theme === "light" ? "0 8px 24px rgba(80, 70, 55, 0.08)" : "0 8px 24px rgba(0,0,0,0.24)",
          transition: "all 220ms var(--ease-cinematic)",
        }}
      >
        {theme === "light" ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path
              d="M14.5 10.4A5.8 5.8 0 0 1 7.6 3.5a6 6 0 1 0 6.9 6.9Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </button>

      {/* ── Background centered ambient spotlights ── */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "600px",
          background: "radial-gradient(circle, rgba(124, 58, 237, 0.04) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* ── Main Secure Card container ── */}
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: c.card,
          border: `1px solid ${c.cardBorder}`,
          borderRadius: "12px",
          padding: "44px 40px 36px",
          boxShadow: c.shadow,
          position: "relative",
          overflow: "hidden",
          backdropFilter: "blur(12px)",
          zIndex: 1,
        }}
      >
        {/* ── Immersive Absolute Corner Decals (L-Shapes) ── */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            width: 8,
            height: 8,
            borderTop: "1.5px solid rgba(168, 85, 247, 0.5)",
            borderLeft: "1.5px solid rgba(168, 85, 247, 0.5)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 8,
            height: 8,
            borderTop: "1.5px solid rgba(168, 85, 247, 0.5)",
            borderRight: "1.5px solid rgba(168, 85, 247, 0.5)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            width: 8,
            height: 8,
            borderBottom: "1.5px solid rgba(168, 85, 247, 0.5)",
            borderLeft: "1.5px solid rgba(168, 85, 247, 0.5)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            width: 8,
            height: 8,
            borderBottom: "1.5px solid rgba(168, 85, 247, 0.5)",
            borderRight: "1.5px solid rgba(168, 85, 247, 0.5)",
            pointerEvents: "none",
          }}
        />

        {/* Inner top glow radial */}
        <div
          style={{
            position: "absolute",
            top: "-90px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "320px",
            height: "180px",
            background: "radial-gradient(ellipse, rgba(168, 85, 247, 0.12) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "28px",
          }}
        >
          <Image
            src="/AMS_ACCESS.svg"
            alt="AMS Access"
            width={210}
            height={48}
            priority
            style={{
              filter: "drop-shadow(0 0 16px rgba(168, 85, 247, 0.2))",
              objectFit: "contain",
            }}
          />
        </div>

        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <h1
            className="text-subsection-title"
            style={{
              color: c.text,
              textTransform: "uppercase",
            }}
          >
            Sign in
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Email */}
          <div style={{ marginBottom: "18px" }}>
            <label
              htmlFor="login-email"
              className="text-micro-label"
              style={{
                display: "flex",
                alignItems: "center",
                color: emailFocused ? c.accentText : c.muted,
                marginBottom: "8px",
                transition: "color 200ms",
                position: "relative",
              }}
            >
              Email Address
              {emailFocused && (
                <span
                  style={{
                    position: "absolute",
                    left: "105px",
                    color: c.accentText,
                    animation: "blink-cursor 0.9s step-end infinite",
                    fontWeight: "bold",
                  }}
                >
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
              disabled={isTyping}
              style={{
                width: "100%",
                padding: "13px 16px",
                background: c.input,
                border: `1px solid ${emailFocused ? c.accent : c.inputBorder}`,
                borderRadius: "6px",
                color: c.text,
                fontSize: "13px",
                fontWeight: 400,
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                transition: "all 250ms var(--ease-cinematic)",
                boxShadow: emailFocused
                  ? `0 0 0 1px ${c.accent}, 0 0 16px rgba(168, 85, 247, 0.1), ${c.inputShadow}`
                  : c.inputShadow,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "12px" }}>
            <label
              htmlFor="login-password"
              className="text-micro-label"
              style={{
                display: "flex",
                alignItems: "center",
                color: passwordFocused ? c.accentText : c.muted,
                marginBottom: "8px",
                transition: "color 200ms",
                position: "relative",
              }}
            >
              Password
              {passwordFocused && (
                <span
                  style={{
                    position: "absolute",
                    left: "75px",
                    color: c.accentText,
                    animation: "blink-cursor 0.9s step-end infinite",
                    fontWeight: "bold",
                  }}
                >
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
              disabled={isTyping}
              style={{
                width: "100%",
                padding: "13px 16px",
                background: c.input,
                border: `1px solid ${passwordFocused ? c.accent : c.inputBorder}`,
                borderRadius: "6px",
                color: c.text,
                fontSize: "13px",
                fontWeight: 400,
                letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                transition: "all 250ms var(--ease-cinematic)",
                boxShadow: passwordFocused
                  ? `0 0 0 1px ${c.accent}, 0 0 16px rgba(168, 85, 247, 0.1), ${c.inputShadow}`
                  : c.inputShadow,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Removed old inline error container to avoid form layout shifts */}

          {/* Continue button */}
          <div style={{ marginTop: "24px" }}>
            <ContinueButton loading={loading} isTyping={isTyping} theme={theme} />
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              margin: "24px 0 20px 0",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "1px",
                background: theme === "light" ? "rgba(48,42,59,0.08)" : "rgba(255,255,255,0.05)",
              }}
            />
            <span
              style={{
                fontSize: "9px",
                color: c.faint,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 500,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              security gate
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: theme === "light" ? "rgba(48,42,59,0.08)" : "rgba(255,255,255,0.05)",
              }}
            />
          </div>

          <SSOButton theme={theme} onUnavailable={() => setShowSSOModal(true)} />
        </form>

        {/* Footer */}
        <p
          style={{
            marginTop: "28px",
            fontSize: "10.5px",
            color: c.faint,
            textAlign: "center",
            letterSpacing: "0.02em",
            lineHeight: 1.6,
            fontWeight: 300,
          }}
        >
          Session is proctored. Complete system lock and video checks are required.
        </p>
      </div>

      {/* ── Test credentials hint (Secure Auto-Fill Keycard) ── */}
      <button
        type="button"
        onClick={handleAutoFill}
        disabled={isTyping || loading}
        style={{
          marginTop: "20px",
          padding: "14px 20px",
          background: c.keycardBg,
          border: `1px solid ${c.keycardBorder}`,
          borderRadius: "8px",
          maxWidth: "420px",
          width: "100%",
          cursor: isTyping || loading ? "not-allowed" : "pointer",
          textAlign: "left",
          transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          position: "relative",
          overflow: "hidden",
          font: "inherit",
        }}
        className="secure-keycard"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "6px",
          }}
        >
          <p
            className="text-micro-label"
            style={{
              color: c.accentText,
              margin: 0,
            }}
          >
            [ SECURE ACCESS TOKEN (AUTO-FILL) ]
          </p>
          <span
            style={{
              fontSize: "8.5px",
              color: c.accent,
              fontFamily: "'JetBrains Mono', monospace",
              background: "rgba(168, 85, 247, 0.12)",
              padding: "2px 6px",
              borderRadius: "4px",
              fontWeight: 500,
            }}
          >
            {isTyping ? "INJECTING..." : "CLICK TO SYNC"}
          </span>
        </div>
        <div
          style={{
            fontSize: "11.5px",
            color: c.muted,
            fontWeight: 300,
            lineHeight: 1.8,
            fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>EMAIL: {TEST_EMAIL}</span>
          <span>PASS: {TEST_PASSWORD}</span>
        </div>
      </button>

      {/* Global CSS Styles Injection */}
      <style>{`
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.9); }
        }
        .continue-btn {
          position: relative;
          overflow: hidden;
        }
        .continue-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: -150%;
          width: 50%;
          height: 100%;
          background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.22), transparent);
          transform: skewX(-25deg);
          transition: 0.75s;
        }
        .continue-btn:hover::after {
          left: 150%;
        }
        .secure-keycard:hover {
          background: rgba(139, 92, 246, 0.08) !important;
          border-color: rgba(168, 85, 247, 0.35) !important;
          transform: translateY(-2px);
          boxShadow: 0 8px 24px rgba(168, 85, 247, 0.06), 0 4px 16px rgba(0,0,0,0.3) !important;
        }
      `}</style>

      {/* ── Error Toast Notification ── */}
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            width: "100%",
            maxWidth: "420px",
            padding: "14px 18px",
            borderRadius: "10px",
            background: "rgba(220, 38, 38, 0.95)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(248, 113, 113, 0.4)",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            animation: "fadeIn 250ms var(--ease-cinematic) forwards",
          }}
        >
          <span style={{ color: "#ffffff", fontSize: "14px", fontWeight: "bold" }}>[!]</span>
          <p
            className="text-mono-console"
            style={{
              color: "#ffffff",
              margin: 0,
              lineHeight: 1.4,
              flex: 1,
            }}
          >
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="Dismiss error message"
            style={{
              background: "none",
              border: "none",
              color: "#ffffff",
              opacity: 0.7,
              cursor: "pointer",
              fontSize: "14px",
              padding: "4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── SSO Info Modal ── */}
      {showSSOModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sso-modal-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(3,8,22,0.6)",
            backdropFilter: "blur(16px)",
            animation: "fadeIn 280ms var(--ease-cinematic) forwards",
          }}
        >
          <div
            style={{
              maxWidth: "460px",
              width: "100%",
              borderRadius: "16px",
              padding: "36px 32px",
              background: theme === "light" ? "#ffffff" : "rgba(15, 23, 42, 0.95)",
              border: `1px solid ${c.cardBorder}`,
              boxShadow: "0 24px 64px rgba(0, 0, 0, 0.35)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                background: theme === "light" ? "rgba(48,42,59,0.06)" : "rgba(255,255,255,0.05)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke={c.text}
                strokeWidth="1.8"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3
              id="sso-modal-title"
              className="text-subsection-title"
              style={{ color: c.text, marginBottom: "12px" }}
            >
              Institution SSO Portal
            </h3>
            <p
              className="text-body-copy"
              style={{ color: c.muted, lineHeight: 1.6, marginBottom: "28px" }}
            >
              Institution Single Sign-On is currently unavailable for this version of the app.
              Please contact your institution's administrator to register your device or use your
              designated secure email credentials to sign in directly.
            </p>
            <button
              type="button"
              onClick={() => setShowSSOModal(false)}
              style={{
                width: "100%",
                padding: "12px",
                background: theme === "light" ? "#302a3b" : "#ffffff",
                color: theme === "light" ? "#ffffff" : "#0f172a",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                transition: "opacity 200ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function ContinueButton({
  loading,
  isTyping,
  theme,
}: {
  loading: boolean;
  isTyping: boolean;
  theme: "dark" | "light";
}) {
  const [hovered, setHovered] = useState(false);
  const disabled = loading || isTyping;
  const c = getLoginThemeColors(theme);

  return (
    <button
      type="submit"
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="continue-btn"
      style={{
        width: "100%",
        padding: "13px 20px",
        background: disabled
          ? "rgba(168, 85, 247, 0.2)"
          : "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)",
        border: "none",
        borderRadius: "6px",
        color: disabled ? c.faint : "#ffffff",
        fontSize: "12.5px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 300ms var(--ease-cinematic)",
        transform: hovered && !disabled ? "translateY(-1.5px)" : "translateY(0)",
        boxShadow:
          hovered && !disabled
            ? "0 6px 20px rgba(168, 85, 247, 0.28), 0 0 0 1px rgba(168, 85, 247, 0.15)"
            : "0 2px 8px rgba(168, 85, 247, 0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
      }}
    >
      {loading ? (
        <>
          <Spinner />
          Verifying secure link...
        </>
      ) : isTyping ? (
        "Syncing credentials..."
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span>Continue</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: hovered ? "translateX(2px)" : "translateX(0)",
              transition: "transform 250ms ease",
            }}
          >
            <path
              d="M3.5 2L7.5 6L3.5 10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
      <path
        d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
        stroke="#a855f7"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function SSOButton({
  theme,
  onUnavailable,
}: {
  theme: "dark" | "light";
  onUnavailable: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const c = getLoginThemeColors(theme);

  return (
    <button
      type="button"
      onClick={onUnavailable}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        padding: "12px 20px",
        background: hovered ? "rgba(168, 85, 247, 0.06)" : "transparent",
        border: `1px solid ${hovered ? "rgba(168, 85, 247, 0.35)" : c.inputBorder}`,
        borderRadius: "6px",
        color: hovered ? c.accentText : c.muted,
        fontSize: "12px",
        fontWeight: 400,
        letterSpacing: "0.04em",
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "all 300ms var(--ease-cinematic)",
        transform: hovered ? "translateY(-1px)" : "translateY(0)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        boxShadow: hovered ? "0 4px 12px rgba(168, 85, 247, 0.04)" : "none",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect
          x="1"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? c.accentText : c.muted}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? c.accentText : c.muted}
          strokeWidth="1.2"
        />
        <rect
          x="1"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? c.accentText : c.muted}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? c.accentText : c.muted}
          strokeWidth="1.2"
        />
      </svg>
      Institution Single Sign-On
    </button>
  );
}
