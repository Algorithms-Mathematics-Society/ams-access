"use client";

import { useState } from "react";
import Image from "next/image";

const STATUS_CHECKS = [
  { label: "Authentication online", ok: true },
  { label: "Secure websocket available", ok: true },
  { label: "Camera services available", ok: true },
  { label: "Monitoring services operational", ok: true },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
        fontFamily: "var(--font-inter), Inter, 'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      {/* Two-card container */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "24px",
          width: "100%",
          maxWidth: "980px",
        }}
      >
        {/* ─── LEFT: Identity Gateway ─── */}
        <div
          style={{
            background: "linear-gradient(160deg, rgba(12,24,48,0.95) 0%, rgba(7,17,36,0.98) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "18px",
            padding: "52px 48px 44px",
            boxShadow:
              "0 0 0 1px rgba(168,85,247,0.04), 0 24px 64px rgba(0,0,0,0.55), 0 0 40px rgba(168,85,247,0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "0",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Subtle card inner glow */}
          <div
            style={{
              position: "absolute",
              top: "-60px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "320px",
              height: "200px",
              background: "radial-gradient(ellipse, rgba(168,85,247,0.07) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Header */}
          <div style={{ marginBottom: "40px" }}>
            <p
              style={{
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.18em",
                color: "#a855f7",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Identity Gateway
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                letterSpacing: "0.02em",
                fontWeight: 300,
              }}
            >
              Secure Contest Environment
            </p>
          </div>

          {/* Logo */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "44px",
            }}
          >
            <Image
              src="/AMS_ACCESS.svg"
              alt="AMS Access"
              width={260}
              height={60}
              priority
              style={{
                filter: "drop-shadow(0 0 18px rgba(168,85,247,0.22))",
                objectFit: "contain",
              }}
            />
          </div>

          {/* Email input */}
          <div style={{ marginBottom: "14px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: "#64748b",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Email or Username
            </label>
            <div style={{ position: "relative" }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                placeholder="you@institution.edu"
                autoComplete="email"
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${emailFocused ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: "12px",
                  color: "#f5f7fa",
                  fontSize: "14px",
                  fontWeight: 300,
                  letterSpacing: "0.01em",
                  fontFamily: "inherit",
                  transition:
                    "border-color 280ms cubic-bezier(0.22,1,0.36,1), box-shadow 280ms cubic-bezier(0.22,1,0.36,1)",
                  boxShadow: emailFocused
                    ? "0 0 0 3px rgba(168,85,247,0.1), inset 0 1px 3px rgba(0,0,0,0.3)"
                    : "inset 0 1px 3px rgba(0,0,0,0.3)",
                  outline: "none",
                }}
              />
            </div>
          </div>

          {/* Password input */}
          <div style={{ marginBottom: "32px" }}>
            <label
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.1em",
                color: "#64748b",
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
              style={{
                width: "100%",
                padding: "14px 16px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${passwordFocused ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: "12px",
                color: "#f5f7fa",
                fontSize: "14px",
                fontWeight: 300,
                letterSpacing: "0.08em",
                fontFamily: "inherit",
                transition:
                  "border-color 280ms cubic-bezier(0.22,1,0.36,1), box-shadow 280ms cubic-bezier(0.22,1,0.36,1)",
                boxShadow: passwordFocused
                  ? "0 0 0 3px rgba(168,85,247,0.1), inset 0 1px 3px rgba(0,0,0,0.3)"
                  : "inset 0 1px 3px rgba(0,0,0,0.3)",
                outline: "none",
              }}
            />
          </div>

          {/* Continue button */}
          <ContinueButton />

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              margin: "24px 0",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.06)",
              }}
            />
            <span
              style={{
                fontSize: "11px",
                color: "#64748b",
                letterSpacing: "0.08em",
                fontWeight: 400,
              }}
            >
              or
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.06)",
              }}
            />
          </div>

          {/* SSO button */}
          <SSOButton />

          {/* Footer note */}
          <p
            style={{
              marginTop: "32px",
              fontSize: "11px",
              color: "#64748b",
              textAlign: "center",
              letterSpacing: "0.02em",
              lineHeight: 1.7,
              fontWeight: 300,
            }}
          >
            This session will be monitored for integrity verification.
          </p>
        </div>

        {/* ─── RIGHT: Testing Environment ─── */}
        <div
          style={{
            background: "linear-gradient(160deg, rgba(12,24,48,0.92) 0%, rgba(7,17,36,0.96) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "18px",
            padding: "52px 48px 44px",
            boxShadow: "0 24px 64px rgba(0,0,0,0.45), 0 0 30px rgba(168,85,247,0.04)",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Subtle inner glow bottom */}
          <div
            style={{
              position: "absolute",
              bottom: "-40px",
              right: "-40px",
              width: "280px",
              height: "200px",
              background: "radial-gradient(ellipse, rgba(168,85,247,0.05) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Header */}
          <div style={{ marginBottom: "40px" }}>
            <p
              style={{
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.18em",
                color: "#a855f7",
                textTransform: "uppercase",
                marginBottom: "6px",
              }}
            >
              Testing Environment
            </p>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                letterSpacing: "0.02em",
                fontWeight: 300,
              }}
            >
              Internal pre-production environment
            </p>
          </div>

          {/* Service status checks */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              marginBottom: "40px",
            }}
          >
            {STATUS_CHECKS.map((check) => (
              <div
                key={check.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: check.ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    border: `1px solid ${check.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: check.ok
                      ? "0 0 8px rgba(34,197,94,0.15)"
                      : "0 0 8px rgba(239,68,68,0.15)",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 5L3.8 7.5L8.5 2.5"
                      stroke={check.ok ? "#22c55e" : "#ef4444"}
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    color: "#a7b0c0",
                    fontWeight: 300,
                    letterSpacing: "0.01em",
                  }}
                >
                  {check.label}
                </span>
                <div
                  style={{
                    marginLeft: "auto",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: check.ok ? "#22c55e" : "#ef4444",
                    boxShadow: check.ok
                      ? "0 0 6px rgba(34,197,94,0.6)"
                      : "0 0 6px rgba(239,68,68,0.6)",
                    animation: check.ok ? "pulse-dot 2.4s ease-in-out infinite" : "none",
                  }}
                />
              </div>
            ))}
          </div>

          {/* Divider */}
          <div
            style={{
              height: "1px",
              background: "rgba(255,255,255,0.05)",
              marginBottom: "28px",
            }}
          />

          {/* Current Status section */}
          <div style={{ marginBottom: "auto" }}>
            <p
              style={{
                fontSize: "10px",
                fontWeight: 500,
                letterSpacing: "0.16em",
                color: "#64748b",
                textTransform: "uppercase",
                marginBottom: "16px",
              }}
            >
              Current Status
            </p>
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "12px",
                padding: "20px 20px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#f59e0b",
                  boxShadow: "0 0 8px rgba(245,158,11,0.5)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: "13px",
                  color: "#a7b0c0",
                  fontWeight: 300,
                  letterSpacing: "0.01em",
                }}
              >
                No contests available yet
              </span>
            </div>
          </div>

          {/* Build metadata */}
          <div
            style={{
              marginTop: "32px",
              marginBottom: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {[
              ["Build", "ACCESS Alpha"],
              ["Environment", "Internal Testing"],
              ["Region", "Mumbai"],
            ].map(([key, val]) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "#64748b",
                    letterSpacing: "0.08em",
                    fontWeight: 400,
                    textTransform: "uppercase",
                  }}
                >
                  {key}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    color: "#a7b0c0",
                    letterSpacing: "0.04em",
                    fontWeight: 300,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {val}
                </span>
              </div>
            ))}
          </div>

          {/* Disabled await button */}
          <button
            disabled
            style={{
              width: "100%",
              padding: "14px 20px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "12px",
              color: "#64748b",
              fontSize: "13px",
              fontWeight: 400,
              letterSpacing: "0.04em",
              fontFamily: "inherit",
              cursor: "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
            }}
          >
            <div
              style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                background: "#f59e0b",
                boxShadow: "0 0 6px rgba(245,158,11,0.4)",
              }}
            />
            Awaiting Contest Configuration
          </button>
        </div>
      </div>

      {/* Pulse animation for status dots */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </main>
  );
}

function ContinueButton() {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="submit"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        padding: "15px 20px",
        background: "linear-gradient(135deg, #7e22ce 0%, #a855f7 45%, #c084fc 100%)",
        border: "none",
        borderRadius: "12px",
        color: "#ffffff",
        fontSize: "14px",
        fontWeight: 500,
        letterSpacing: "0.06em",
        fontFamily: "inherit",
        cursor: "pointer",
        transition:
          "transform 320ms cubic-bezier(0.22,1,0.36,1), box-shadow 320ms cubic-bezier(0.22,1,0.36,1)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered
          ? "0 8px 30px rgba(168,85,247,0.35), 0 0 0 1px rgba(168,85,247,0.2)"
          : "0 4px 16px rgba(168,85,247,0.2)",
      }}
    >
      Continue
    </button>
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
        padding: "14px 20px",
        background: hovered ? "rgba(168,85,247,0.06)" : "transparent",
        border: `1px solid ${hovered ? "rgba(168,85,247,0.35)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: "12px",
        color: hovered ? "#c084fc" : "#a7b0c0",
        fontSize: "13px",
        fontWeight: 400,
        letterSpacing: "0.04em",
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "all 280ms cubic-bezier(0.22,1,0.36,1)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect
          x="1"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "#a7b0c0"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="1"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "#a7b0c0"}
          strokeWidth="1.2"
        />
        <rect
          x="1"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "#a7b0c0"}
          strokeWidth="1.2"
        />
        <rect
          x="8"
          y="8"
          width="5"
          height="5"
          rx="1"
          stroke={hovered ? "#c084fc" : "#a7b0c0"}
          strokeWidth="1.2"
        />
      </svg>
      Institution SSO
    </button>
  );
}
