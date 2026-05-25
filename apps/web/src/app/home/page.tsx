"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

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

    fetch(`${API_URL}/contests/invited?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: InvitedContest[]) => {
        setContests(data ?? []);
        setContestsLoading(false);
      })
      .catch(() => setContestsLoading(false));
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
        fontFamily: "'Geist', 'Inter', system-ui, sans-serif",
        background: "#000000",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: "224px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          background: "rgb(9 9 11)",
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
                <stop stopColor="#7C3AED" />
                <stop offset="0.5" stopColor="#8B5CF6" />
                <stop offset="1" stopColor="#A78BFA" />
              </linearGradient>
            </defs>
          </svg>
          <p
            style={{
              marginTop: "10px",
              fontSize: "11px",
              fontWeight: 400,
              letterSpacing: "0.38em",
              color: "rgba(255,255,255,0.7)",
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
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "13px",
                  fontWeight: active ? 500 : 400,
                  letterSpacing: "0.01em",
                  color: active ? "#ffffff" : "rgba(255,255,255,0.4)",
                  background: active ? "rgba(139,92,246,0.15)" : "transparent",
                  transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span
                  style={{ color: active ? "#8b5cf6" : "rgba(255,255,255,0.3)", flexShrink: 0 }}
                >
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div style={{ padding: "16px 12px 20px" }}>
          {/* User info */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "9px",
              padding: "9px 12px",
              borderRadius: "8px",
              marginBottom: "4px",
            }}
          >
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "12px",
                fontWeight: 600,
                color: "white",
              }}
            >
              {userEmail[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.8)",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userEmail}
              </p>
            </div>
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
            padding: "32px 40px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            flexShrink: 0,
          }}
        >
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 600,
              color: "#ffffff",
              letterSpacing: "-0.01em",
            }}
          >
            Overview
          </h1>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", marginTop: "4px" }}>
            {userEmail}
          </p>
        </header>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
          <ContestsPanel contests={contests} loading={contestsLoading} />
        </div>
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
        borderRadius: "8px",
        border: "none",
        background: hovered ? "rgba(239,68,68,0.08)" : "transparent",
        color: hovered ? "#ef4444" : "rgba(255,255,255,0.35)",
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

function useStartsIn(startAt: string) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() {
      const diff = new Date(startAt).getTime() - Date.now();
      if (diff <= 0) {
        setLabel("Starting now");
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(m > 0 ? `${m}m ${s}s` : `${s}s`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startAt]);
  return label;
}

function ScheduledContestCard({ c, onJoin }: { c: InvitedContest; onJoin: () => void }) {
  const startsIn = useStartsIn(c.start_at);
  return (
    <div
      style={{
        background: "#09090b",
        border: "1px solid rgba(139,92,246,0.2)",
        borderRadius: "10px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "#ffffff",
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
                borderRadius: "4px",
                background: "rgba(139,92,246,0.1)",
                border: "1px solid rgba(139,92,246,0.25)",
                color: "#8b5cf6",
                letterSpacing: "0.04em",
              }}
            >
              SCHEDULED
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginBottom: "6px" }}>
            {c.org_name}
          </p>
          {c.description && (
            <p
              style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.5)",
                marginBottom: "6px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {c.description}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: "16px",
              fontSize: "11px",
              color: "rgba(255,255,255,0.3)",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            <span>
              {new Date(c.start_at).toLocaleDateString()} —{" "}
              {new Date(c.end_at).toLocaleDateString()}
            </span>
            <span>{c.question_count}Q</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#8b5cf6",
              boxShadow: "0 0 8px rgba(139,92,246,0.6)",
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: "11px",
              color: "#8b5cf6",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {startsIn}
          </span>
          <button
            onClick={onJoin}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(139,92,246,0.4)",
              background: "rgba(139,92,246,0.15)",
              color: "#a78bfa",
              fontSize: "12px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
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
            Join session
          </button>
        </div>
      </div>
    </div>
  );
}

function ContestsPanel({ contests, loading }: { contests: InvitedContest[]; loading: boolean }) {
  const router = useRouter();

  function statusColor(s: string) {
    if (s === "ACTIVE")
      return { dot: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" };
    if (s === "SCHEDULED")
      return { dot: "#8b5cf6", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.2)" };
    if (s === "ENDED")
      return {
        dot: "rgba(255,255,255,0.25)",
        bg: "rgba(255,255,255,0.04)",
        border: "rgba(255,255,255,0.1)",
      };
    return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" };
  }

  if (loading) {
    return (
      <div>
        <p
          style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.3)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontWeight: 500,
          }}
        >
          Contests
        </p>
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: "72px",
              borderRadius: "10px",
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
          border: "1px dashed rgba(255,255,255,0.08)",
          borderRadius: "10px",
          padding: "60px 40px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: "rgba(139,92,246,0.08)",
            border: "1px solid rgba(139,92,246,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "20px",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="7" width="24" height="21" rx="3" stroke="#8b5cf6" strokeWidth="1.8" />
            <path d="M10 7V4M22 7V4" stroke="#8b5cf6" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M4 13h24" stroke="#8b5cf6" strokeWidth="1.8" />
          </svg>
        </div>
        <h2
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            marginBottom: "6px",
          }}
        >
          No contests scheduled
        </h2>
        <p
          style={{
            fontSize: "13px",
            color: "rgba(255,255,255,0.3)",
            fontWeight: 300,
            lineHeight: 1.6,
            maxWidth: "300px",
          }}
        >
          Check back closer to your event.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: "11px",
          color: "rgba(255,255,255,0.3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
          fontWeight: 500,
        }}
      >
        Contests ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {contests.map((c) => {
          if (c.status === "SCHEDULED") {
            return (
              <ScheduledContestCard
                key={c.id}
                c={c}
                onJoin={() => router.push(`/session/onboarding?contestId=${c.id}`)}
              />
            );
          }
          const col = statusColor(c.status);
          const canEnter = c.status === "ACTIVE";
          return (
            <div
              key={c.id}
              style={{
                background: "#09090b",
                border: `1px solid ${canEnter ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: "10px",
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
                        color: "#ffffff",
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
                        fontSize: "10px",
                        fontWeight: 500,
                        padding: "2px 7px",
                        borderRadius: "4px",
                        background: col.bg,
                        border: `1px solid ${col.border}`,
                        color: col.dot,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "rgba(255,255,255,0.35)",
                      marginBottom: "6px",
                    }}
                  >
                    {c.org_name}
                  </p>
                  {c.description && (
                    <p
                      style={{
                        fontSize: "12px",
                        color: "rgba(255,255,255,0.5)",
                        marginBottom: "6px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.description}
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: "16px",
                      fontSize: "11px",
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    }}
                  >
                    <span>
                      {new Date(c.start_at).toLocaleDateString()} —{" "}
                      {new Date(c.end_at).toLocaleDateString()}
                    </span>
                    <span>{c.question_count}Q</span>
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
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: col.dot,
                      boxShadow: `0 0 6px ${col.dot}`,
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
                        borderRadius: "8px",
                        border: "1px solid rgba(139,92,246,0.4)",
                        background: "rgba(139,92,246,0.15)",
                        color: "#a78bfa",
                        fontSize: "12px",
                        fontWeight: 500,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                        whiteSpace: "nowrap",
                        transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
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
                      Enter session
                    </button>
                  )}
                  {c.status === "SCHEDULED" && (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#8b5cf6",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
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
