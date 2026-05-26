"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const TEST_EMAIL = "tester@ams.local";
const TEST_PASSWORD = "access2025";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isTyping) return;
    setError("");

    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      setLoading(true);
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 850);
    } else {
      setError("AUTHENTICATION_FAILED: Verify secure credentials and retry.");
    }
  }

  const handleAutoFill = () => {
    if (isTyping || loading) return;
    setError("");
    setIsTyping(true);

    // Dynamic physical typing simulation
    let currentEmail = "";
    let currentPass = "";
    let emailIdx = 0;
    let passIdx = 0;

    const emailInterval = setInterval(() => {
      if (emailIdx < TEST_EMAIL.length) {
        currentEmail += TEST_EMAIL[emailIdx];
        setEmail(currentEmail);
        emailIdx++;
      } else {
        clearInterval(emailInterval);

        // Brief pause between fields to simulate human typing cadence
        setTimeout(() => {
          const passInterval = setInterval(() => {
            if (passIdx < TEST_PASSWORD.length) {
              currentPass += TEST_PASSWORD[passIdx];
              setPassword(currentPass);
              passIdx++;
            } else {
              clearInterval(passInterval);
              setIsTyping(false);
            }
          }, 35);
        }, 150);
      }
    }, 25);
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
          linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px)
        `,
        backgroundSize: "28px 28px",
        backgroundColor: "#030408",
        position: "relative",
      }}
    >
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
          background: "rgba(9, 9, 12, 0.95)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "12px",
          padding: "44px 40px 36px",
          boxShadow:
            "0 0 0 1px rgba(168, 85, 247, 0.03), 0 24px 64px rgba(0, 0, 0, 0.85), 0 0 48px rgba(168, 85, 247, 0.04)",
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
            style={{
              fontSize: "14px",
              fontWeight: 500,
              color: "#f8fafc",
              letterSpacing: "0.15em",
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
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: "9.5px",
                fontWeight: 600,
                letterSpacing: "0.14em",
                color: emailFocused ? "#c084fc" : "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
                marginBottom: "8px",
                transition: "color 200ms",
              }}
            >
              Email Address
              {emailFocused && (
                <span
                  style={{
                    color: "#c084fc",
                    animation: "blink-cursor 0.9s step-end infinite",
                    marginLeft: "5px",
                    fontWeight: "bold",
                  }}
                >
                  ▎
                </span>
              )}
            </label>
            <input
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
                background: "rgba(0, 0, 0, 0.45)",
                border: `1px solid ${emailFocused ? "#a855f7" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "6px",
                color: "#f8fafc",
                fontSize: "13px",
                fontWeight: 400,
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                transition: "all 250ms var(--ease-cinematic)",
                boxShadow: emailFocused
                  ? "0 0 0 1px #a855f7, 0 0 16px rgba(168, 85, 247, 0.1), inset 0 1px 3px rgba(0,0,0,0.6)"
                  : "inset 0 1px 3px rgba(0,0,0,0.6)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                fontSize: "9.5px",
                fontWeight: 600,
                letterSpacing: "0.14em",
                color: passwordFocused ? "#c084fc" : "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
                marginBottom: "8px",
                transition: "color 200ms",
              }}
            >
              Password
              {passwordFocused && (
                <span
                  style={{
                    color: "#c084fc",
                    animation: "blink-cursor 0.9s step-end infinite",
                    marginLeft: "5px",
                    fontWeight: "bold",
                  }}
                >
                  ▎
                </span>
              )}
            </label>
            <input
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
                background: "rgba(0, 0, 0, 0.45)",
                border: `1px solid ${passwordFocused ? "#a855f7" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "6px",
                color: "#f8fafc",
                fontSize: "13px",
                fontWeight: 400,
                letterSpacing: "0.08em",
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
                transition: "all 250ms var(--ease-cinematic)",
                boxShadow: passwordFocused
                  ? "0 0 0 1px #a855f7, 0 0 16px rgba(168, 85, 247, 0.1), inset 0 1px 3px rgba(0,0,0,0.6)"
                  : "inset 0 1px 3px rgba(0,0,0,0.6)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                background: "rgba(239,68,68,0.05)",
                border: "1px solid rgba(239,68,68,0.22)",
                borderRadius: "6px",
                padding: "10px 14px",
                marginTop: "16px",
                marginBottom: "4px",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              <span style={{ color: "#f87171", fontSize: "11px", fontWeight: "bold" }}>[!]</span>
              <p
                style={{
                  fontSize: "10.5px",
                  color: "#fca5a5",
                  letterSpacing: "0.01em",
                  fontWeight: 400,
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </p>
            </div>
          )}

          {/* Continue button */}
          <div style={{ marginTop: "24px" }}>
            <ContinueButton loading={loading} isTyping={isTyping} />
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
                background: "rgba(255,255,255,0.05)",
              }}
            />
            <span
              style={{
                fontSize: "9px",
                color: "rgba(255,255,255,0.28)",
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
                background: "rgba(255,255,255,0.05)",
              }}
            />
          </div>

          <SSOButton />
        </form>

        {/* Footer */}
        <p
          style={{
            marginTop: "28px",
            fontSize: "10.5px",
            color: "rgba(255,255,255,0.22)",
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
      <div
        onClick={handleAutoFill}
        style={{
          marginTop: "20px",
          padding: "14px 20px",
          background: "rgba(139, 92, 246, 0.05)",
          border: "1px solid rgba(139, 92, 246, 0.16)",
          borderRadius: "8px",
          maxWidth: "420px",
          width: "100%",
          cursor: isTyping || loading ? "not-allowed" : "pointer",
          transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          position: "relative",
          overflow: "hidden",
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
            style={{
              fontSize: "9.5px",
              color: "#c084fc",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            [ SECURE ACCESS TOKEN (AUTO-FILL) ]
          </p>
          <span
            style={{
              fontSize: "8.5px",
              color: "#a855f7",
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
            color: "rgba(255,255,255,0.5)",
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
      </div>

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
    </main>
  );
}

function ContinueButton({ loading, isTyping }: { loading: boolean; isTyping: boolean }) {
  const [hovered, setHovered] = useState(false);
  const disabled = loading || isTyping;

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
        color: disabled ? "rgba(255,255,255,0.35)" : "#ffffff",
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

function SSOButton() {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        padding: "12px 20px",
        background: hovered ? "rgba(168, 85, 247, 0.04)" : "transparent",
        border: `1px solid ${hovered ? "rgba(168, 85, 247, 0.35)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: "6px",
        color: hovered ? "#c084fc" : "rgba(255,255,255,0.45)",
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
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.45)"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.45)"}
          strokeWidth="1.2"
        />
        <rect
          x="1"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.45)"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.45)"}
          strokeWidth="1.2"
        />
      </svg>
      Institution Single Sign-On
    </button>
  );
}
