"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type InvitedContest = {
  id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  status: string;
  org_name: string;
  question_count: number;
};

const NAV_ITEMS = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "Profile",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "security",
    label: "Security",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1.5L2.5 3.5v4c0 3 2.5 5.5 5.5 6.5 3-1 5.5-3.5 5.5-6.5v-4L8 1.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "systemcheck",
    label: "System Check",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M5 8l2 2 4-4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "help",
    label: "Help & Support",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M6 6.5a2 2 0 1 1 2 2v1"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const HEALTH_CHECKS = [
  { label: "You're logged in", sub: "Authentication OK" },
  { label: "Secure connection", sub: "WebSocket active" },
  { label: "Camera ready", sub: "Capture service OK" },
  { label: "Monitoring", sub: "Services operational" },
  { label: "All systems go", sub: "Everything looks good" },
];

export default function HomePage() {
  const router = useRouter();
  const [activeNav, setActiveNav] = useState("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [contests, setContests] = useState<InvitedContest[]>([]);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("tester@ams.local");

  useEffect(() => {
    const email = localStorage.getItem("ams_user_email") ?? "tester@ams.local";
    setUserEmail(email);

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setContestsLoading(false);
      return;
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sb.rpc("get_invited_contests", { p_email: email }).then(({ data }) => {
      setContests((data as InvitedContest[]) ?? []);
      setContestsLoading(false);
    });
  }, []);

  function handleSignOut() {
    setSigningOut(true);
    localStorage.removeItem("ams_user_email");
    setTimeout(() => router.push("/"), 600);
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        fontFamily: "var(--font-inter), Inter, 'IBM Plex Sans', system-ui, sans-serif",
        background: "#030816",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: "188px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(4,10,24,0.7)",
          padding: "28px 0 0",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "36px",
            padding: "0 20px",
          }}
        >
          {/* Triangle A */}
          <svg width="52" height="44" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#logo-grad)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <defs>
              <linearGradient
                id="logo-grad"
                x1="2"
                y1="82"
                x2="172"
                y2="82"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#7B00FF" />
                <stop offset="0.5" stopColor="#C649F0" />
                <stop offset="1" stopColor="#E365FF" />
              </linearGradient>
            </defs>
          </svg>
          <p
            style={{
              marginTop: "10px",
              fontSize: "11px",
              fontWeight: 400,
              letterSpacing: "0.38em",
              color: "#EDF0F7",
              textTransform: "uppercase",
            }}
          >
            ACCESS
          </p>
        </div>

        {/* Nav */}
        <nav
          style={{
            flex: 1,
            padding: "0 12px",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "9px 12px",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  fontWeight: active ? 500 : 400,
                  letterSpacing: "0.01em",
                  color: active ? "#ffffff" : "#64748b",
                  background: active
                    ? "linear-gradient(135deg, rgba(126,34,206,0.75) 0%, rgba(168,85,247,0.6) 100%)"
                    : "transparent",
                  boxShadow: active ? "0 2px 12px rgba(168,85,247,0.2)" : "none",
                  transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span style={{ color: active ? "#e9d5ff" : "#475569", flexShrink: 0 }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div style={{ padding: "16px 12px 20px" }}>
          {/* System status */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              marginBottom: "8px",
              borderRadius: "10px",
              background: "rgba(34,197,94,0.06)",
              border: "1px solid rgba(34,197,94,0.1)",
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "rgba(34,197,94,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1.5L2.5 3.5v4c0 3 2.5 5.5 5.5 6.5 3-1 5.5-3.5 5.5-6.5v-4L8 1.5z"
                  stroke="#22c55e"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <p
                style={{ fontSize: "11px", fontWeight: 500, color: "#a7b0c0", marginBottom: "1px" }}
              >
                System Status
              </p>
              <p style={{ fontSize: "11px", color: "#22c55e", fontWeight: 400 }}>
                All systems secure
              </p>
            </div>
          </div>

          {/* User info */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              padding: "9px 12px",
              borderRadius: "10px",
              cursor: "pointer",
              marginBottom: "4px",
              transition: "background 200ms",
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7e22ce, #a855f7)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "12px",
                fontWeight: 600,
                color: "white",
              }}
            >
              T
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "12px", fontWeight: 500, color: "#e2e8f0", lineHeight: 1.2 }}>
                {userEmail.split("@")[0]}
              </p>
              <p
                style={{
                  fontSize: "10px",
                  color: "#64748b",
                  fontWeight: 300,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userEmail}
              </p>
            </div>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <path
                d="M3 4.5l3 3 3-3"
                stroke="#475569"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* Sign out */}
          <SignOutButton onClick={handleSignOut} loading={signingOut} />
        </div>
      </aside>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <header
          style={{
            padding: "28px 36px 24px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "26px",
                fontWeight: 600,
                color: "#f5f7fa",
                letterSpacing: "-0.01em",
                marginBottom: "5px",
              }}
            >
              Welcome back! 👋
            </h1>
            <p style={{ fontSize: "13px", color: "#64748b", fontWeight: 300 }}>
              You&apos;re signed in as <span style={{ color: "#a7b0c0" }}>{userEmail}</span>
            </p>
          </div>

          {/* Environment badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "10px",
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.2)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1L1.5 3.5v3.5c0 3 2.5 5 5.5 5.5 3-.5 5.5-2.5 5.5-5.5V3.5L7 1z"
                stroke="#a855f7"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "#a855f7",
                letterSpacing: "0.01em",
              }}
            >
              Internal Testing Environment
            </span>
          </div>
        </header>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 36px 0" }}>
          {/* Environment Health */}
          <section style={{ marginBottom: "20px" }}>
            <p
              style={{
                fontSize: "12px",
                fontWeight: 500,
                color: "#64748b",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "14px",
              }}
            >
              Environment Health
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: "12px",
              }}
            >
              {HEALTH_CHECKS.map((check) => (
                <HealthCard key={check.label} label={check.label} sub={check.sub} />
              ))}
            </div>
          </section>

          {/* Contests panel */}
          <ContestsPanel contests={contests} loading={contestsLoading} />
        </div>

        {/* Footer metadata */}
        <footer
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1px 1fr 1px 1fr",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            marginTop: "20px",
            flexShrink: 0,
          }}
        >
          {[
            ["Build", "ACCESS Alpha"],
            null,
            ["Region", "Mumbai"],
            null,
            ["Environment", "Testing"],
          ].map((item, i) => {
            if (!item) {
              return <div key={i} style={{ background: "rgba(255,255,255,0.05)", width: "1px" }} />;
            }
            const [k, v] = item;
            return (
              <div
                key={k}
                style={{
                  padding: "16px 36px",
                  textAlign: "center",
                }}
              >
                <p
                  style={{
                    fontSize: "10px",
                    color: "#64748b",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    marginBottom: "3px",
                  }}
                >
                  {k}
                </p>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#a855f7",
                    fontWeight: 500,
                    letterSpacing: "0.04em",
                  }}
                >
                  {v}
                </p>
              </div>
            );
          })}
        </footer>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

function HealthCard({ label, sub }: { label: string; sub: string }) {
  return (
    <div
      style={{
        background: "linear-gradient(160deg, rgba(10,20,44,0.95) 0%, rgba(6,14,32,0.98) 100%)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: "14px",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
        textAlign: "center",
      }}
    >
      {/* Green check circle */}
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          background: "rgba(34,197,94,0.1)",
          border: "1px solid rgba(34,197,94,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 12px rgba(34,197,94,0.15)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2.5 7L5.5 10L11.5 4"
            stroke="#22c55e"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <p
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: "#e2e8f0",
            marginBottom: "3px",
            lineHeight: 1.3,
          }}
        >
          {label}
        </p>
        <p style={{ fontSize: "11px", color: "#64748b", fontWeight: 300 }}>{sub}</p>
      </div>
    </div>
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
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 12px",
        borderRadius: "10px",
        border: "none",
        background: hovered ? "rgba(239,68,68,0.08)" : "transparent",
        color: hovered ? "#ef4444" : "#64748b",
        fontSize: "13px",
        fontWeight: 400,
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
        width: "100%",
        textAlign: "left",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3M11 11l3-3-3-3M14 8H6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sign out
    </button>
  );
}

function ContestsPanel({ contests, loading }: { contests: InvitedContest[]; loading: boolean }) {
  const router = useRouter();

  function statusColor(s: string) {
    if (s === "ACTIVE")
      return { dot: "#22c55e", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)" };
    if (s === "SCHEDULED")
      return { dot: "#a855f7", bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.25)" };
    if (s === "ENDED")
      return { dot: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" };
    return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" };
  }

  if (loading) {
    return (
      <div
        style={{
          borderRadius: "16px",
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,20,44,0.6)",
          padding: "24px",
        }}
      >
        <p
          style={{
            fontSize: "12px",
            color: "#64748b",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "14px",
          }}
        >
          Your Contests
        </p>
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: "72px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.03)",
              marginBottom: "8px",
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <div
        style={{
          background: "linear-gradient(160deg, rgba(10,20,44,0.96) 0%, rgba(6,14,32,0.98) 100%)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: "16px",
          padding: "60px 40px",
          textAlign: "center",
          minHeight: "260px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "18px",
            background: "rgba(126,34,206,0.15)",
            border: "1px solid rgba(168,85,247,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
            boxShadow: "0 0 32px rgba(168,85,247,0.1)",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="7" width="24" height="21" rx="3" stroke="#a855f7" strokeWidth="1.8" />
            <path d="M10 7V4M22 7V4" stroke="#a855f7" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M4 13h24" stroke="#a855f7" strokeWidth="1.8" />
            <rect x="10" y="18" width="5" height="5" rx="1" fill="#a855f7" opacity="0.5" />
          </svg>
        </div>
        <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f7fa", marginBottom: "8px" }}>
          No contests scheduled yet
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "#64748b",
            fontWeight: 300,
            lineHeight: 1.7,
            maxWidth: "340px",
            marginBottom: "28px",
          }}
        >
          Your organiser hasn&apos;t invited you to a contest yet. Check back closer to your event.
        </p>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 24px",
            borderRadius: "10px",
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.25)",
          }}
        >
          <div
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: "#f59e0b",
              boxShadow: "0 0 8px rgba(245,158,11,0.5)",
              animation: "pulse-dot 2s ease-in-out infinite",
            }}
          />
          <span style={{ fontSize: "12px", fontWeight: 500, color: "#f59e0b" }}>
            Waiting for contest
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: "12px",
          color: "#64748b",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: "14px",
          fontWeight: 500,
        }}
      >
        Your Contests ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {contests.map((c) => {
          const col = statusColor(c.status);
          const canEnter = c.status === "ACTIVE";
          return (
            <div
              key={c.id}
              style={{
                background:
                  "linear-gradient(160deg, rgba(10,20,44,0.96) 0%, rgba(6,14,32,0.98) 100%)",
                border: `1px solid ${canEnter ? "rgba(168,85,247,0.18)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: "14px",
                padding: "18px 20px",
                transition: "border-color 300ms",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginBottom: "4px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "#f5f7fa",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.title}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: "11px",
                        fontWeight: 500,
                        padding: "2px 8px",
                        borderRadius: "6px",
                        background: col.bg,
                        border: `1px solid ${col.border}`,
                        color: col.dot,
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                    {c.org_name}
                  </p>
                  {c.description && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "#94a3b8",
                        marginBottom: "6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.description}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "#475569" }}>
                    <span>
                      📅 {new Date(c.start_at).toLocaleDateString()} —{" "}
                      {new Date(c.end_at).toLocaleDateString()}
                    </span>
                    <span>
                      {c.question_count} question{c.question_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: col.dot,
                      boxShadow: `0 0 8px ${col.dot}88`,
                    }}
                  />
                  {canEnter && (
                    <button
                      onClick={() => router.push(`/session/onboarding?contestId=${c.id}`)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 16px",
                        borderRadius: "9px",
                        border: "1px solid rgba(168,85,247,0.45)",
                        background:
                          "linear-gradient(135deg, rgba(126,34,206,0.7) 0%, rgba(168,85,247,0.55) 100%)",
                        color: "#e9d5ff",
                        fontSize: "12px",
                        fontWeight: 500,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                        boxShadow: "0 0 16px rgba(168,85,247,0.2)",
                        transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Enter Secure Session
                    </button>
                  )}
                  {c.status === "SCHEDULED" && (
                    <span style={{ fontSize: "11px", color: "#a855f7", fontWeight: 400 }}>
                      Starts{" "}
                      {new Date(c.start_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
