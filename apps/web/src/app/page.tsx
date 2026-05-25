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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (email === TEST_EMAIL && password === TEST_PASSWORD) {
      setLoading(true);
      localStorage.setItem("ams_user_email", email);
      setTimeout(() => router.push("/home"), 800);
    } else {
      setError("Incorrect email or password. Try the test credentials below.");
    }
  }

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
      }}
    >
      {/* Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "#09090b",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "48px 44px 40px",
          boxShadow:
            "0 0 0 1px rgba(139,92,246,0.04), 0 32px 80px rgba(0,0,0,0.8), 0 0 40px rgba(139,92,246,0.06)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Inner top glow */}
        <div
          style={{
            position: "absolute",
            top: "-80px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "360px",
            height: "220px",
            background: "radial-gradient(ellipse, rgba(139,92,246,0.09) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        {/* Logo */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "36px",
          }}
        >
          <Image
            src="/AMS_ACCESS.svg"
            alt="AMS Access"
            width={240}
            height={56}
            priority
            style={{
              filter: "drop-shadow(0 0 20px rgba(139,92,246,0.25))",
              objectFit: "contain",
            }}
          />
        </div>

        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: "36px" }}>
          <h1
            style={{
              fontSize: "18px",
              fontWeight: 500,
              color: "#ffffff",
              letterSpacing: "0.01em",
            }}
          >
            Sign in
          </h1>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Email */}
          <div style={{ marginBottom: "16px" }}>
            <label
              style={{
                display: "block",
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Email Address
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
              style={{
                width: "100%",
                padding: "13px 16px",
                background: "rgba(0, 0, 0, 0.4)",
                border: `1px solid ${emailFocused ? "#a855f7" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "8px",
                color: "#f8fafc",
                fontSize: "13.5px",
                fontWeight: 400,
                fontFamily: "inherit",
                transition: "all 300ms var(--ease-cinematic)",
                boxShadow: emailFocused
                  ? "0 0 0 1px #a855f7, 0 0 0 4px rgba(168, 85, 247, 0.15), inset 0 1px 3px rgba(0,0,0,0.5)"
                  : "inset 0 1px 3px rgba(0,0,0,0.5)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.4)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Password
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
              style={{
                width: "100%",
                padding: "13px 16px",
                background: "rgba(0, 0, 0, 0.4)",
                border: `1px solid ${passwordFocused ? "#a855f7" : "rgba(255,255,255,0.08)"}`,
                borderRadius: "8px",
                color: "#f8fafc",
                fontSize: "13.5px",
                fontWeight: 400,
                letterSpacing: "0.08em",
                fontFamily: "inherit",
                transition: "all 300ms var(--ease-cinematic)",
                boxShadow: passwordFocused
                  ? "0 0 0 1px #a855f7, 0 0 0 4px rgba(168, 85, 247, 0.15), inset 0 1px 3px rgba(0,0,0,0.5)"
                  : "inset 0 1px 3px rgba(0,0,0,0.5)",
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
                alignItems: "center",
                gap: "8px",
                background: "rgba(239,68,68,0.05)",
                border: "1px solid rgba(239,68,68,0.15)",
                borderRadius: "8px",
                padding: "10px 14px",
                marginTop: "12px",
                marginBottom: "8px",
              }}
            >
              <span style={{ color: "#ef4444", fontSize: "14px", fontWeight: "bold" }}>⚠</span>
              <p
                style={{
                  fontSize: "12px",
                  color: "#fca5a5",
                  letterSpacing: "0.01em",
                  fontWeight: 400,
                  margin: 0,
                }}
              >
                {error}
              </p>
            </div>
          )}

          {/* Continue button */}
          <div style={{ marginTop: "24px" }}>
            <ContinueButton loading={loading} />
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "14px",
              margin: "24px 0",
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
                fontSize: "10px",
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 500,
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
            fontSize: "11px",
            color: "rgba(255,255,255,0.25)",
            textAlign: "center",
            letterSpacing: "0.01em",
            lineHeight: 1.7,
            fontWeight: 300,
          }}
        >
          Session may be recorded for academic integrity.
        </p>
      </div>

      {/* Test credentials hint */}
      <div
        style={{
          marginTop: "20px",
          padding: "14px 20px",
          background: "rgba(139,92,246,0.06)",
          border: "1px solid rgba(139,92,246,0.15)",
          borderRadius: "12px",
          maxWidth: "420px",
          width: "100%",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            color: "#8b5cf6",
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "6px",
          }}
        >
          Test build — use these credentials
        </p>
        <p
          style={{
            fontSize: "12px",
            color: "rgba(255,255,255,0.6)",
            fontWeight: 300,
            lineHeight: 1.9,
            fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
          }}
        >
          {TEST_EMAIL}
          <br />
          {TEST_PASSWORD}
        </p>
      </div>
    </main>
  );
}

function ContinueButton({ loading }: { loading: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="submit"
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        padding: "13px 20px",
        background: loading
          ? "rgba(168, 85, 247, 0.25)"
          : "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #c084fc 100%)",
        border: "none",
        borderRadius: "8px",
        color: loading ? "rgba(255,255,255,0.4)" : "#ffffff",
        fontSize: "13.5px",
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 300ms var(--ease-cinematic)",
        transform: hovered && !loading ? "translateY(-1.5px)" : "translateY(0)",
        boxShadow:
          hovered && !loading
            ? "0 8px 24px rgba(168, 85, 247, 0.3), 0 0 0 1px rgba(168, 85, 247, 0.2)"
            : "0 2px 8px rgba(168, 85, 247, 0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
      }}
    >
      {loading ? (
        <>
          <Spinner />
          Verifying...
        </>
      ) : (
        "Continue"
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
        borderRadius: "8px",
        color: hovered ? "#c084fc" : "rgba(255,255,255,0.5)",
        fontSize: "12.5px",
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
        boxShadow: hovered ? "0 4px 12px rgba(168, 85, 247, 0.05)" : "none",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect
          x="1"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.5)"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.5)"}
          strokeWidth="1.2"
        />
        <rect
          x="1"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.5)"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "rgba(255,255,255,0.5)"}
          strokeWidth="1.2"
        />
      </svg>
      Institution Single Sign-On
    </button>
  );
}
