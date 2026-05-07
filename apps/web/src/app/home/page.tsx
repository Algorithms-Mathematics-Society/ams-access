"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const SYSTEM_CHECKS = [
  { label: "You're logged in", ok: true },
  { label: "Secure connection active", ok: true },
  { label: "Camera ready", ok: true },
  { label: "All systems go", ok: true },
];

export default function HomePage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  function handleSignOut() {
    setSigningOut(true);
    setTimeout(() => router.push("/"), 600);
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
        fontFamily: "var(--font-inter), Inter, 'IBM Plex Sans', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Top bar — logo + sign out */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "4px",
          }}
        >
          <Image
            src="/AMS_ACCESS.svg"
            alt="AMS Access"
            width={160}
            height={38}
            style={{
              filter: "drop-shadow(0 0 12px rgba(168,85,247,0.2))",
              objectFit: "contain",
            }}
          />
          <SignOutButton onClick={handleSignOut} loading={signingOut} />
        </div>

        {/* Welcome card */}
        <div
          style={{
            background: "linear-gradient(160deg, rgba(12,24,48,0.97) 0%, rgba(7,17,36,0.99) 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "18px",
            padding: "36px 40px",
            boxShadow:
              "0 0 0 1px rgba(168,85,247,0.04), 0 24px 60px rgba(0,0,0,0.55), 0 0 40px rgba(168,85,247,0.06)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "-60px",
              right: "-40px",
              width: "280px",
              height: "200px",
              background: "radial-gradient(ellipse, rgba(168,85,247,0.07) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Greeting */}
          <div style={{ marginBottom: "28px" }}>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 500,
                color: "#f5f7fa",
                letterSpacing: "0.01em",
                marginBottom: "6px",
              }}
            >
              Welcome back 👋
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                fontWeight: 300,
                lineHeight: 1.6,
              }}
            >
              You&apos;re signed in as <span style={{ color: "#a7b0c0" }}>tester@ams.local</span>
            </p>
          </div>

          {/* System checks */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {SYSTEM_CHECKS.map((check) => (
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
                    background: "rgba(34,197,94,0.1)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: "0 0 8px rgba(34,197,94,0.12)",
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path
                      d="M1.5 5L3.8 7.5L8.5 2.5"
                      stroke="#22c55e"
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
                    background: "#22c55e",
                    boxShadow: "0 0 6px rgba(34,197,94,0.6)",
                    animation: "pulse-dot 2.4s ease-in-out infinite",
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* No contests card */}
        <div
          style={{
            background: "linear-gradient(160deg, rgba(12,24,48,0.95) 0%, rgba(7,17,36,0.97) 100%)",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: "18px",
            padding: "36px 40px",
            boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Ambient bottom glow */}
          <div
            style={{
              position: "absolute",
              bottom: "-50px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "300px",
              height: "160px",
              background: "radial-gradient(ellipse, rgba(168,85,247,0.05) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Icon */}
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "14px",
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="5" width="16" height="14" rx="2" stroke="#a855f7" strokeWidth="1.4" />
              <path d="M7 5V3M15 5V3" stroke="#a855f7" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M3 9h16" stroke="#a855f7" strokeWidth="1.4" />
              <path
                d="M8 13h6M8 16h4"
                stroke="#a855f7"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.5"
              />
            </svg>
          </div>

          <h2
            style={{
              fontSize: "16px",
              fontWeight: 500,
              color: "#f5f7fa",
              letterSpacing: "0.01em",
              marginBottom: "8px",
            }}
          >
            No contests scheduled yet
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: "#64748b",
              fontWeight: 300,
              lineHeight: 1.65,
              maxWidth: "320px",
              margin: "0 auto 28px",
            }}
          >
            Your organiser hasn&apos;t set up a contest yet. Check back closer to your event — this
            page will update automatically.
          </p>

          {/* Disabled button */}
          <button
            disabled
            style={{
              padding: "12px 28px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "10px",
              color: "#64748b",
              fontSize: "13px",
              fontWeight: 400,
              letterSpacing: "0.03em",
              fontFamily: "inherit",
              cursor: "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#f59e0b",
                boxShadow: "0 0 6px rgba(245,158,11,0.4)",
              }}
            />
            Waiting for contest
          </button>
        </div>

        {/* Footer metadata */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            paddingTop: "4px",
          }}
        >
          {[
            ["Build", "ACCESS Alpha"],
            ["Region", "Mumbai"],
            ["Environment", "Testing"],
          ].map(([k, v]) => (
            <span
              key={k}
              style={{
                fontSize: "11px",
                color: "#64748b",
                letterSpacing: "0.04em",
                fontWeight: 300,
              }}
            >
              {k}: <span style={{ color: "#a7b0c0" }}>{v}</span>
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </main>
  );
}

function SignOutButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "8px 16px",
        background: hovered ? "rgba(239,68,68,0.08)" : "transparent",
        border: `1px solid ${hovered ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: "8px",
        color: hovered ? "#ef4444" : "#64748b",
        fontSize: "12px",
        fontWeight: 400,
        letterSpacing: "0.04em",
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 240ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      Sign out
    </button>
  );
}
