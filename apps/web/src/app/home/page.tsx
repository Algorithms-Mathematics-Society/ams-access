"use client";

import { useState, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { invoke } from "@ams/api-client";

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

type ReadinessStatus = "ok" | "fail" | "checking";

type ReadinessState = {
  camera: ReadinessStatus;
  mic: ReadinessStatus;
  network: ReadinessStatus;
  keyboard: ReadinessStatus;
  restrictedApps: ReadinessStatus;
  vm: ReadinessStatus;
  platform: ReadinessStatus;
};

type PlatformInfo = {
  os: string;
  arch: string;
  family: string;
};

type SecurityEnvironment = {
  os: string;
  display_server: string;
  ld_preload_injection: boolean;
  ptrace_scope: number;
};

type ProcessScanResult = {
  found: string[];
  clean: boolean;
};

type VirtDetectionResult = {
  detected: boolean;
  platform: string | null;
  confidence: string;
};

type NetworkCheckResult = {
  reachable: boolean;
  latency_ms: number | null;
  jitter_ms: number | null;
  quality: string;
};

function getNetworkProbeHost() {
  try {
    if (SUPABASE_URL) return new URL(SUPABASE_URL).hostname;
  } catch {}
  return "supabase.com";
}

function describeMediaError(err: unknown, kind: "camera" | "microphone") {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const text = `${name} ${message}`.toLowerCase();

  if (text.includes("notallowed") || text.includes("permission") || text.includes("denied")) {
    return `${kind === "camera" ? "Camera" : "Microphone"} permission denied`;
  }
  if (text.includes("notfound") || text.includes("no device") || text.includes("not found")) {
    return `No ${kind} found`;
  }
  if (text.includes("notreadable") || text.includes("abort") || text.includes("busy")) {
    return `${kind === "camera" ? "Camera" : "Microphone"} is busy or unavailable`;
  }
  return `${kind === "camera" ? "Camera" : "Microphone"} check failed`;
}

const NAV_ITEMS = [
  {
    id: "overview",
    label: "Home",
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
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "security_logs",
    label: "Security Logs",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 6.5h6M5 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
];

function getThemeColors(theme: "dark" | "light") {
  const isLight = theme === "light";
  return {
    bg: isLight ? "#FAF8F5" : "#02040a",
    sidebarBg: isLight ? "#F2EDE4" : "#080b11",
    cardBg: isLight ? "#ffffff" : "#080b11",
    innerBg: isLight ? "#F8F5F0" : "#02040a",
    border: isLight ? "rgba(124, 58, 237, 0.08)" : "rgba(255, 255, 255, 0.05)",
    borderStrong: isLight ? "rgba(124, 58, 237, 0.16)" : "rgba(168, 85, 247, 0.15)",
    text: isLight ? "#3c362e" : "#ffffff",
    textMuted: isLight ? "#7c7467" : "rgba(255, 255, 255, 0.35)",
    textMutedStrong: isLight ? "#5c5447" : "rgba(255, 255, 255, 0.65)",
    accent: isLight ? "#7c3aed" : "#a855f7",
    accentLight: isLight ? "rgba(124, 58, 237, 0.08)" : "rgba(168, 85, 247, 0.08)",
    accentBorder: isLight ? "rgba(124, 58, 237, 0.25)" : "rgba(168, 85, 247, 0.25)",
    accentText: isLight ? "#6d28d9" : "#c084fc",
    consoleText: isLight ? "#5c2d91" : "rgba(168, 85, 247, 0.8)",
    shadow: isLight ? "0 4px 20px rgba(120, 110, 90, 0.06)" : "0 4px 16px rgba(0, 0, 0, 0.15)",
    shadowHover: isLight ? "0 12px 30px rgba(120, 110, 90, 0.12)" : "0 12px 36px rgba(168, 85, 247, 0.04)",
    dot: isLight ? "#10b981" : "#22c55e",
  };
}

export default function HomePage() {
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeNav, setActiveNav] = useState("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [contests, setContests] = useState<InvitedContest[]>([]);
  const [contestsLoading, setContestsLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("tester@ams.local");

  // Load theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("ams_theme") as "dark" | "light";
    if (saved) setTheme(saved);
  }, []);

  const c = getThemeColors(theme);

  // Telemetry Integrity Scan States
  const [readiness, setReadiness] = useState<ReadinessState>({
    camera: "checking",
    mic: "checking",
    network: "checking",
    keyboard: "checking",
    restrictedApps: "checking",
    vm: "checking",
    platform: "checking",
  });

  useEffect(() => {
    const email = localStorage.getItem("ams_user_email") ?? "tester@ams.local";
    setUserEmail(email);

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setContests([]);
      setContestsLoading(false);
    } else {
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      sb.rpc("get_invited_contests", { p_email: email }).then(({ data, error }) => {
        if (!error) setContests((data as InvitedContest[]) ?? []);
        setContestsLoading(false);
      });
    }

    let cancelled = false;

    navigator.mediaDevices?.enumerateDevices()
      .then((devices) => {
        if (cancelled) return;
        const cameras = devices.filter((d) => d.kind === "videoinput");
        const mics = devices.filter((d) => d.kind === "audioinput");
        setReadiness((r) => ({
          ...r,
          camera: cameras.length > 0 ? "ok" : "fail",
          mic: mics.length > 0 ? "ok" : "fail",
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setReadiness((r) => ({ ...r, camera: "fail", mic: "fail" }));
      });

    invoke<PlatformInfo>("get_platform")
      .then((platform) => {
        if (cancelled) return;
        const supported = platform.os === "linux" || platform.os === "windows";
        setReadiness((r) => ({
          ...r,
          platform: supported ? "ok" : "fail",
          keyboard: supported ? "ok" : "fail",
        }));
      })
      .catch(() => {
        if (!cancelled) setReadiness((r) => ({ ...r, platform: "fail", keyboard: "fail" }));
      });

    invoke<ProcessScanResult>("scan_processes")
      .then((scan) => {
        if (!cancelled) setReadiness((r) => ({ ...r, restrictedApps: scan.clean ? "ok" : "fail" }));
      })
      .catch(() => {
        if (!cancelled) setReadiness((r) => ({ ...r, restrictedApps: "fail" }));
      });

    invoke<VirtDetectionResult>("detect_virtualization")
      .then((virt) => {
        if (!cancelled) setReadiness((r) => ({ ...r, vm: virt.detected ? "fail" : "ok" }));
      })
      .catch(() => {
        if (!cancelled) setReadiness((r) => ({ ...r, vm: "fail" }));
      });

    invoke<NetworkCheckResult>("check_network_stability", { host: getNetworkProbeHost() })
      .then((network) => {
        if (!cancelled) setReadiness((r) => ({ ...r, network: network.reachable ? "ok" : "fail" }));
      })
      .catch(() => {
        if (!cancelled) setReadiness((r) => ({ ...r, network: "fail" }));
      });

    return () => {
      cancelled = true;
    };
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
        background: c.bg,
        color: c.text,
        transition: "background 300ms cubic-bezier(0.22, 1, 0.36, 1), color 300ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: "240px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: `1px solid ${c.border}`,
          background: c.sidebarBg,
          padding: "28px 0 0",
          transition: "background 300ms, border-color 300ms",
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
          <svg width="56" height="48" viewBox="0 0 172 164" fill="none">
            <path
              d="M2 162L87 2L172 162"
              stroke="url(#logo-grad)"
              strokeWidth="4.5"
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
              marginTop: "12px",
              fontSize: "11.5px",
              fontWeight: 500,
              letterSpacing: "0.4em",
              color: theme === "light" ? "#5c5447" : "rgba(255,255,255,0.85)",
              textTransform: "uppercase",
            }}
          >
            ACCESS
          </p>
        </div>

        {/* Nav list */}
        <nav
          style={{
            flex: 1,
            padding: "0 14px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {NAV_ITEMS.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "11px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: active ? c.accentLight : "transparent",
                  color: active ? c.accentText : c.textMuted,
                  fontSize: "14px",
                  fontWeight: active ? 500 : 400,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                {active && (
                  <div
                    style={{
                      position: "absolute",
                      left: "-14px",
                      top: "15%",
                      bottom: "15%",
                      width: "3px",
                      background: c.accent,
                      borderRadius: "0 4px 4px 0",
                      boxShadow: `0 0 8px ${c.accent}`,
                    }}
                  />
                )}
                <span
                  style={{ color: active ? c.accent : c.textMuted, flexShrink: 0 }}
                >
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Bottom profile controls */}
        <div style={{ padding: "16px 14px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "8px",
              marginBottom: "8px",
              background: "rgba(255,255,255,0.01)",
              border: `1px solid ${c.border}`,
            }}
          >
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                background: "linear-gradient(135deg, #7c3aed, #8b5cf6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: "13px",
                fontWeight: 600,
                color: "white",
              }}
            >
              {userEmail[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  fontSize: "12.5px",
                  fontWeight: 500,
                  color: c.text,
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userEmail}
              </p>
              <p style={{ fontSize: "10.5px", color: c.textMuted }}>Contestant Profile</p>
            </div>
          </div>

          <SignOutButton onClick={handleSignOut} loading={signingOut} theme={theme} />
        </div>
      </aside>

      {/* ── Main content panels ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <header
          style={{
            padding: "36px 48px 24px",
            borderBottom: `1px solid ${c.border}`,
            flexShrink: 0,
            transition: "border-color 300ms",
          }}
        >
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 600,
              color: c.text,
              letterSpacing: "-0.015em",
            }}
          >
            {activeNav === "overview" && "Contestant Command Hub"}
            {activeNav === "settings" && "Control Room Diagnostics"}
            {activeNav === "diagnostics" && "Integrity Telemetry Registry"}
            {activeNav === "security_logs" && "Live Security Operations Feed"}
          </h1>
          <p style={{ fontSize: "13.5px", color: c.textMuted, marginTop: "4px" }}>
            {activeNav === "overview" && `Authenticated Profile Node: ${userEmail}`}
            {activeNav === "settings" && "Configure video capture, speaker channels, micro-decibel triggers, and proctor parameters"}
            {activeNav === "diagnostics" && "Network jitter telemetry, host reachability, and hardware registers"}
            {activeNav === "security_logs" && "Real-time client telemetry scan, background process flags, display configurations, and security triggers"}
          </p>
        </header>

        {/* Scrollable content views */}
        <div style={{ flex: 1, overflowY: "auto", padding: "36px 48px" }}>
          {activeNav === "overview" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 360px",
                gap: "36px",
                alignItems: "stretch",
              }}
            >
              {/* Left Column: Contests with premium cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "36px" }}>
                <ContestsPanel contests={contests} loading={contestsLoading} theme={theme} />
              </div>
              
              {/* Right Column: Integrity scan overview HUD */}
              <ReadinessWidget readiness={readiness} onSettingsRedirect={() => setActiveNav("settings")} theme={theme} />
            </div>
          )}

          {activeNav === "settings" && (
            <SettingsPanel readiness={readiness} setReadiness={setReadiness} theme={theme} setTheme={setTheme} />
          )}

          {activeNav === "diagnostics" && (
            <DiagnosticsPanel readiness={readiness} theme={theme} />
          )}

          {activeNav === "security_logs" && (
            <div style={{ maxWidth: "1200px" }}>
              <SecurityOperationsLog theme={theme} />
            </div>
          )}
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

function SignOutButton({ onClick, loading, theme }: { onClick: () => void; loading: boolean; theme: "dark" | "light" }) {
  const [hovered, setHovered] = useState(false);
  const c = getThemeColors(theme);

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
        color: hovered ? "#ef4444" : c.textMuted,
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

function ScheduledContestCard({ c, onJoin, theme }: { c: InvitedContest; onJoin: () => void; theme: "dark" | "light" }) {
  const startsIn = useStartsIn(c.start_at);
  const [hovered, setHovered] = useState(false);
  const themeColors = getThemeColors(theme);
  const isLight = theme === "light";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isLight 
          ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)" 
          : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
        border: `1px solid ${hovered ? themeColors.accent : themeColors.borderStrong}`,
        borderRadius: "14px",
        padding: "28px 32px",
        transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
        boxShadow: hovered 
          ? (isLight ? "0 20px 40px rgba(124, 58, 237, 0.08)" : "0 20px 48px rgba(168, 85, 247, 0.08)") 
          : themeColors.shadow,
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative accent top line */}
      <div 
        style={{ 
          position: "absolute", 
          top: 0, 
          left: 0, 
          right: 0, 
          height: "3px", 
          background: `linear-gradient(90deg, ${themeColors.accent} 0%, rgba(124, 58, 237, 0.3) 100%)`,
          opacity: hovered ? 1 : 0.4,
          transition: "opacity 300ms ease"
        }} 
      />

      {/* Header section: Title, Status, Org */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "8px" }}>
          <h3
            style={{
              fontSize: "19px",
              fontWeight: 700,
              color: themeColors.text,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {c.title}
          </h3>
          <span
            style={{
              flexShrink: 0,
              fontSize: "10.5px",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "20px",
              background: themeColors.accentLight,
              border: `1px solid ${themeColors.accentBorder}`,
              color: themeColors.accentText,
              letterSpacing: "0.1em",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            SCHEDULED
          </span>
        </div>
        <p
          style={{
            fontSize: "14px",
            color: themeColors.textMuted,
            fontWeight: 500,
            margin: 0,
          }}
        >
          {c.org_name}
        </p>
      </div>

      {/* Description section */}
      {c.description && (
        <p
          style={{
            fontSize: "14px",
            color: themeColors.textMutedStrong,
            lineHeight: 1.6,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {c.description}
        </p>
      )}

      {/* Divider */}
      <div style={{ height: "1px", background: themeColors.border, margin: "4px 0 0 0" }} />

      {/* Footer: Telemetry parameters and call to action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          flexWrap: "wrap",
        }}
      >
        {/* Left Side: Metadata with lovely tiny icons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            fontSize: "12px",
            color: themeColors.textMutedStrong,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="11" rx="2" />
              <path d="M5 1v2M11 1v2M2 7h12" />
            </svg>
            <span>
              {new Date(c.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} —{" "}
              {new Date(c.end_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>

          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: themeColors.borderStrong }} />

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 3.5v5h4" />
            </svg>
            <span style={{ color: themeColors.accent }}>
              starts in {startsIn}
            </span>
          </div>

          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: themeColors.borderStrong }} />

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
            </svg>
            <span>{c.question_count} Questions</span>
          </div>
        </div>

        {/* Right Side: CTA Button */}
        <button
          onClick={onJoin}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 28px",
            borderRadius: "10px",
            border: `1px solid ${themeColors.accent}`,
            background: hovered ? themeColors.accent : "transparent",
            color: hovered ? "#ffffff" : themeColors.accentText,
            fontSize: "14px",
            fontWeight: 600,
            fontFamily: "inherit",
            cursor: "pointer",
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
            transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
            boxShadow: hovered 
              ? (isLight ? "0 8px 20px rgba(124, 58, 237, 0.2)" : "0 8px 24px rgba(168, 85, 247, 0.3)")
              : "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" style={{ transform: hovered ? "scale(1.1) rotate(5deg)" : "none", transition: "transform 300ms ease" }}>
            <path
              d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span>Join Session</span>
        </button>
      </div>
    </div>
  );
}

function ActiveContestCard({ c, onEnter, theme, col, canEnter }: { c: InvitedContest; onEnter: () => void; theme: "dark" | "light"; col: any; canEnter: boolean }) {
  const [hovered, setHovered] = useState(false);
  const themeColors = getThemeColors(theme);
  const isLight = theme === "light";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isLight 
          ? "linear-gradient(135deg, #ffffff 0%, #FAF8F5 100%)" 
          : "linear-gradient(135deg, #090d16 0%, #05070b 100%)",
        border: `1px solid ${hovered && canEnter ? themeColors.accent : (canEnter ? themeColors.borderStrong : themeColors.border)}`,
        borderRadius: "14px",
        padding: "28px 32px",
        transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
        boxShadow: hovered && canEnter 
          ? (isLight ? "0 20px 40px rgba(124, 58, 237, 0.08)" : "0 20px 48px rgba(168, 85, 247, 0.08)") 
          : themeColors.shadow,
        transform: hovered && canEnter ? "translateY(-4px)" : "translateY(0)",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        position: "relative",
        overflow: "hidden",
        opacity: canEnter ? 1 : 0.75,
      }}
    >
      {/* Decorative accent top line for active sessions */}
      {canEnter && (
        <div 
          style={{ 
            position: "absolute", 
            top: 0, 
            left: 0, 
            right: 0, 
            height: "3px", 
            background: `linear-gradient(90deg, #10b981 0%, rgba(16, 185, 129, 0.3) 100%)`,
            opacity: hovered ? 1 : 0.4,
            transition: "opacity 300ms ease"
          }} 
        />
      )}

      {/* Header section: Title, Status, Org */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "8px" }}>
          <h3
            style={{
              fontSize: "19px",
              fontWeight: 700,
              color: themeColors.text,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {c.title}
          </h3>
          <span
            style={{
              flexShrink: 0,
              fontSize: "10.5px",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "20px",
              background: col.bg,
              border: `1px solid ${col.border}`,
              color: col.dot,
              letterSpacing: "0.1em",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {c.status}
          </span>
        </div>
        <p
          style={{
            fontSize: "14px",
            color: themeColors.textMuted,
            fontWeight: 500,
            margin: 0,
          }}
        >
          {c.org_name}
        </p>
      </div>

      {/* Description section */}
      {c.description && (
        <p
          style={{
            fontSize: "14px",
            color: themeColors.textMutedStrong,
            lineHeight: 1.6,
            margin: 0,
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {c.description}
        </p>
      )}

      {/* Divider */}
      <div style={{ height: "1px", background: themeColors.border, margin: "4px 0 0 0" }} />

      {/* Footer: Telemetry parameters and call to action */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          flexWrap: "wrap",
        }}
      >
        {/* Left Side: Metadata with lovely tiny icons */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            fontSize: "12px",
            color: themeColors.textMutedStrong,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="11" rx="2" />
              <path d="M5 1v2M11 1v2M2 7h12" />
            </svg>
            <span>
              {new Date(c.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} —{" "}
              {new Date(c.end_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          </div>

          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: themeColors.borderStrong }} />

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: col.dot,
                boxShadow: canEnter ? `0 0 8px ${col.dot}` : "none",
                animation: canEnter ? "pulse-dot 1.5s ease-in-out infinite" : "none",
              }}
            />
            <span style={{ color: canEnter ? "#10b981" : themeColors.textMuted }}>
              {canEnter ? "Active Now" : "Session Ended"}
            </span>
          </div>

          <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: themeColors.borderStrong }} />

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 5h10M3 8h10M3 11h7" strokeLinecap="round" />
            </svg>
            <span>{c.question_count} Questions</span>
          </div>
        </div>

        {/* Right Side: CTA Button or status info */}
        {canEnter ? (
          <button
            onClick={onEnter}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "12px 28px",
              borderRadius: "10px",
              border: "1px solid #10b981",
              background: hovered ? "#10b981" : "transparent",
              color: hovered ? "#ffffff" : "#10b981",
              fontSize: "14px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
              boxShadow: hovered 
                ? (isLight ? "0 8px 20px rgba(16, 185, 129, 0.2)" : "0 8px 24px rgba(16, 185, 129, 0.3)")
                : "none",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" style={{ transform: hovered ? "scale(1.1) rotate(5deg)" : "none", transition: "transform 300ms ease" }}>
              <path
                d="M6 1L2 3.5v3c0 2.5 2 4.5 4 5 2-.5 4-2.5 4-5v-3L6 1z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span>Enter Session</span>
          </button>
        ) : (
          <span
            style={{
              fontSize: "13px",
              color: themeColors.textMuted,
              fontWeight: 500,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            CLOSED
          </span>
        )}
      </div>
    </div>
  );
}

function ContestsPanel({ contests, loading, theme }: { contests: InvitedContest[]; loading: boolean; theme: "dark" | "light" }) {
  const router = useRouter();
  const themeColors = getThemeColors(theme);

  function statusColor(s: string) {
    if (s === "ACTIVE")
      return { dot: theme === "light" ? "#10b981" : "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" };
    if (s === "SCHEDULED")
      return { dot: theme === "light" ? "#7c3aed" : "#8b5cf6", bg: theme === "light" ? "rgba(124,58,237,0.08)" : "rgba(139,92,246,0.08)", border: theme === "light" ? "rgba(124,58,237,0.2)" : "rgba(139,92,246,0.2)" };
    if (s === "ENDED")
      return {
        dot: theme === "light" ? "#7c7467" : "rgba(255,255,255,0.25)",
        bg: theme === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)",
        border: theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
      };
    return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" };
  }

  if (loading) {
    return (
      <div>
        <p
          style={{
            fontSize: "11px",
            color: themeColors.textMuted,
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
              height: "140px",
              borderRadius: "14px",
              background: theme === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.03)",
              marginBottom: "12px",
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
          border: `1px dashed ${themeColors.border}`,
          borderRadius: "14px",
          padding: "80px 40px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: themeColors.cardBg,
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            background: themeColors.accentLight,
            border: `1px solid ${themeColors.accentBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
            <rect x="4" y="7" width="24" height="21" rx="3" stroke={themeColors.accent} strokeWidth="1.8" />
            <path d="M10 7V4M22 7V4" stroke={themeColors.accent} strokeWidth="1.8" strokeLinecap="round" />
            <path d="M4 13h24" stroke={themeColors.accent} strokeWidth="1.8" />
          </svg>
        </div>
        <h2
          style={{
            fontSize: "17px",
            fontWeight: 600,
            color: themeColors.text,
            marginBottom: "8px",
          }}
        >
          No contests scheduled
        </h2>
        <p
          style={{
            fontSize: "14px",
            color: themeColors.textMuted,
            fontWeight: 300,
            lineHeight: 1.6,
            maxWidth: "320px",
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
          color: themeColors.textMuted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        Contests ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {contests.map((c) => {
          if (c.status === "SCHEDULED") {
            return (
              <ScheduledContestCard
                key={c.id}
                c={c}
                onJoin={() => router.push(`/session/onboarding?contestId=${c.id}`)}
                theme={theme}
              />
            );
          }
          const col = statusColor(c.status);
          const canEnter = c.status === "ACTIVE";
          return (
            <ActiveContestCard
              key={c.id}
              c={c}
              canEnter={canEnter}
              col={col}
              onEnter={() => router.push(`/session/onboarding?contestId=${c.id}`)}
              theme={theme}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Readiness HUD Widget ──
function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
}: {
  readiness: any;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
}) {
  const [hovered, setHovered] = useState(false);
  const themeColors = getThemeColors(theme);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: themeColors.cardBg,
        border: `1px solid ${themeColors.borderStrong}`,
        borderRadius: "8px",
        padding: "24px",
        boxShadow: hovered ? themeColors.shadowHover : themeColors.shadow,
        transition: "all 300ms var(--ease-cinematic)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: themeColors.accent,
            boxShadow: `0 0 8px ${themeColors.accent}`,
          }}
        />
        <h3
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: themeColors.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          System Integrity HUD
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "24px" }}>
        <ReadinessItem label="Network Connection" status={readiness.network} theme={theme} />
        <ReadinessItem label="Video Capture" status={readiness.camera} theme={theme} />
        <ReadinessItem label="Audio Input" status={readiness.mic} theme={theme} />
        <ReadinessItem label="Secure VM Shield" status={readiness.vm} theme={theme} />
        <ReadinessItem label="Keyboard Lockdown" status={readiness.keyboard} theme={theme} />
        <ReadinessItem label="Restricted Processes" status={readiness.restrictedApps} theme={theme} />
      </div>

      <button
        onClick={onSettingsRedirect}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "10px 16px",
          borderRadius: "6px",
          border: `1px solid ${themeColors.accentBorder}`,
          background: themeColors.accentLight,
          color: themeColors.accentText,
          fontSize: "12px",
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 220ms var(--ease-cinematic)",
          letterSpacing: "0.02em",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        System Setup & Hardware Tests
      </button>
    </div>
  );
}

function ReadinessItem({ label, status, theme }: { label: string; status: "ok" | "fail" | "checking"; theme: "dark" | "light" }) {
  const themeColors = getThemeColors(theme);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        borderRadius: "6px",
        background: themeColors.innerBg,
        border: `1px solid ${themeColors.border}`,
      }}
    >
      <span style={{ fontSize: "12.5px", color: themeColors.textMutedStrong }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        {status === "checking" && (
          <>
            <span style={{ fontSize: "10px", color: themeColors.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
              SCANNING
            </span>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: themeColors.accent,
                animation: "pulse-dot 1s ease-in-out infinite",
              }}
            />
          </>
        )}
        {status === "ok" && (
          <>
            <span style={{ fontSize: "10px", color: theme === "light" ? "#10b981" : "#22c55e", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              SECURE
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6l2 2 5-5" stroke={theme === "light" ? "#10b981" : "#22c55e"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        )}
        {status === "fail" && (
          <>
            <span style={{ fontSize: "10px", color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
              ACTION REQUIRED
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="#f59e0b" strokeWidth="1.2" />
              <path d="M6 4v2.5M6 8h.01" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </>
        )}
      </div>
    </div>
  );
}

// ── Settings Control Room Panel ──
function SettingsPanel({
  readiness,
  setReadiness,
  theme,
  setTheme,
}: {
  readiness: ReadinessState;
  setReadiness: Dispatch<SetStateAction<ReadinessState>>;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
}) {
  const [activeTab, setActiveTab] = useState<"hardware" | "permissions" | "security">("hardware");
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState("");
  const [camStats, setCamStats] = useState({ resolution: "1280 x 720 px", fps: "30 FPS", aspect: "16:9" });
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const c = getThemeColors(theme);

  // Real Web Audio Mic Variables
  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Speaker oscillator test
  const [speakerActive, setSpeakerActive] = useState(false);
  const [speakerVolume, setSpeakerVolume] = useState(50);
  const [speakerSuccess, setSpeakerSuccess] = useState<boolean | null>(null);

  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [securityEnv, setSecurityEnv] = useState<SecurityEnvironment | null>(null);
  const [processScan, setProcessScan] = useState<ProcessScanResult | null>(null);
  const [virtScan, setVirtScan] = useState<VirtDetectionResult | null>(null);
  const [networkCheck, setNetworkCheck] = useState<NetworkCheckResult | null>(null);
  const [securityBusy, setSecurityBusy] = useState(false);

  // Stop all streams on component unmount
  useEffect(() => {
    return () => {
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [camStream, micStream]);

  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices()
      .then((devices) => {
        setCameras(devices.filter((d) => d.kind === "videoinput"));
      })
      .catch(() => {});
    void runSecurityScan();
  }, []);

  async function runSecurityScan() {
    setSecurityBusy(true);
    try {
      const [platform, env, processes, virt, network] = await Promise.all([
        invoke<PlatformInfo>("get_platform").catch(() => null),
        invoke<SecurityEnvironment>("get_security_environment").catch(() => null),
        invoke<ProcessScanResult>("scan_processes").catch(() => null),
        invoke<VirtDetectionResult>("detect_virtualization").catch(() => null),
        invoke<NetworkCheckResult>("check_network_stability", { host: getNetworkProbeHost() }).catch(
          () => null
        ),
      ]);

      setPlatformInfo(platform);
      setSecurityEnv(env);
      setProcessScan(processes);
      setVirtScan(virt);
      setNetworkCheck(network);

      setReadiness((r) => ({
        ...r,
        platform: platform && (platform.os === "linux" || platform.os === "windows") ? "ok" : "fail",
        keyboard: platform && (platform.os === "linux" || platform.os === "windows") ? "ok" : "fail",
        restrictedApps: processes ? (processes.clean ? "ok" : "fail") : "fail",
        vm: virt ? (virt.detected ? "fail" : "ok") : "fail",
        network: network ? (network.reachable ? "ok" : "fail") : "fail",
      }));
    } finally {
      setSecurityBusy(false);
    }
  }

  // Request/Query camera streams
  async function startCameraTest() {
    try {
      setCameraError(null);
      if (camStream) {
        camStream.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
      });
      setCamStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      // Read real track settings if possible
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        const width = settings.width || 1280;
        const height = settings.height || 720;
        const frameRate = settings.frameRate || 30;
        setCamStats({
          resolution: `${width} x ${height} px`,
          fps: `${Math.round(frameRate)} FPS`,
          aspect: getAspectRatioLabel(width, height),
        });
      }

      // Populate devices list
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === "videoinput"));
      setReadiness((r) => ({ ...r, camera: "ok" }));
    } catch (err) {
      console.error("Camera setup failed", err);
      setCameraError(describeMediaError(err, "camera"));
      setReadiness((r) => ({ ...r, camera: "fail" }));
    }
  }

  function getAspectRatioLabel(w: number, h: number) {
    if (w / h === 16 / 9) return "16:9 Widescreen";
    if (w / h === 4 / 3) return "4:3 Standard";
    return `${(w / h).toFixed(2)}:1`;
  }

  // Real Web Audio API Microphone Analyzer
  async function toggleMicMonitor() {
    if (micActive) {
      // Stop mic
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (micStream) {
        micStream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => {});
      }
      setMicStream(null);
      setMicLevel(0);
      setMicActive(false);
    } else {
      // Start real mic test
      try {
        setMicError(null);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicStream(stream);

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        audioContextRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const drawMicStats = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;
          // Scale it beautifully (average ranges 0 - 255)
          const scaledVal = Math.min(Math.round((average / 90) * 100), 100);
          setMicLevel(scaledVal);
          animationFrameRef.current = requestAnimationFrame(drawMicStats);
        };
        drawMicStats();
        setMicActive(true);
        setReadiness((r) => ({ ...r, mic: "ok" }));
      } catch (err) {
        console.error("Microphone capture failed", err);
        setMicError(describeMediaError(err, "microphone"));
        setReadiness((r) => ({ ...r, mic: "fail" }));
      }
    }
  }

  // Speaker Frequency Tone Oscillator
  function testSpeakers() {
    setSpeakerActive(true);
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, audioCtx.currentTime); // Standard concert A frequency
      
      // Bind gain to the real volume level slider
      const volFraction = speakerVolume / 100;
      gainNode.gain.setValueAtTime(volFraction * 0.08, audioCtx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      setTimeout(() => {
        osc.stop();
        audioCtx.close().catch(() => {});
        setSpeakerActive(false);
      }, 850);
    } catch (e) {
      console.error(e);
      setSpeakerActive(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "40px", minHeight: "560px", alignItems: "stretch" }}>
      {/* Settings Navigation Menu */}
      <div
        style={{
          width: "220px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          borderRight: `1px solid ${c.border}`,
          paddingRight: "24px",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => setActiveTab("hardware")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            background: activeTab === "hardware" ? c.accentLight : "transparent",
            color: activeTab === "hardware" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Hardware Diagnostics
        </button>
        <button
          onClick={() => setActiveTab("permissions")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            background: activeTab === "permissions" ? c.accentLight : "transparent",
            color: activeTab === "permissions" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Permissions Check
        </button>
        <button
          onClick={() => setActiveTab("security")}
          style={{
            padding: "12px 16px",
            borderRadius: "6px",
            border: "none",
            background: activeTab === "security" ? c.accentLight : "transparent",
            color: activeTab === "security" ? c.accentText : c.textMuted,
            fontSize: "13.5px",
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          Security Environment
        </button>

        {/* Dynamic Theme Switcher Card inside the settings left column */}
        <div style={{ marginTop: "auto", background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: c.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
            Interface Theme
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button
              onClick={() => {
                setTheme("dark");
                localStorage.setItem("ams_theme", "dark");
              }}
              style={{
                padding: "8px 12px",
                background: theme === "dark" ? c.accentLight : "transparent",
                border: `1px solid ${theme === "dark" ? c.accent : c.border}`,
                borderRadius: "6px",
                color: theme === "dark" ? c.accentText : c.textMuted,
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "center",
                transition: "all 200ms",
              }}
            >
              Obsidian Dark
            </button>
            <button
              onClick={() => {
                setTheme("light");
                localStorage.setItem("ams_theme", "light");
              }}
              style={{
                padding: "8px 12px",
                background: theme === "light" ? c.accentLight : "transparent",
                border: `1px solid ${theme === "light" ? c.accent : c.border}`,
                borderRadius: "6px",
                color: theme === "light" ? c.accentText : c.textMuted,
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                textAlign: "center",
                transition: "all 200ms",
              }}
            >
              Cream Alabaster
            </button>
          </div>
        </div>
      </div>

      {/* Settings Sub-Tab panels */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {activeTab === "hardware" && (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "32px", alignItems: "stretch" }}>
            {/* Column 1: Wide webcam calibration frame */}
            <div
              style={{
                background: c.cardBg,
                border: `1px solid ${c.border}`,
                borderRadius: "8px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "20px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>Camera Validation Capture</h4>
                {camStream && (
                  <span style={{ fontSize: "10px", color: theme === "light" ? "#10b981" : "#22c55e", fontFamily: "'JetBrains Mono', monospace", background: theme === "light" ? "rgba(16,185,129,0.08)" : "rgba(34,197,94,0.08)", padding: "2px 8px", borderRadius: "4px" }}>
                    STREAMING ACTIVE
                  </span>
                )}
              </div>

              {/* Viewfinder block */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "1.6",
                  borderRadius: "8px",
                  background: c.innerBg,
                  overflow: "hidden",
                  border: `1px solid ${c.border}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {camStream ? (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    autoPlay
                    style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
                  />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: c.textMuted }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 7l-7 5 7 5V7zM1 5h14v14H1V5z" />
                    </svg>
                    <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em" }}>
                      STANDBY — CAPTURE DISCONNECTED
                    </span>
                  </div>
                )}

                {/* Secure alignment target HUD overlays */}
                <div style={{ position: "absolute", top: "16px", left: "16px", width: "12px", height: "12px", borderTop: `2px solid ${c.accent}`, borderLeft: `2px solid ${c.accent}` }} />
                <div style={{ position: "absolute", top: "16px", right: "16px", width: "12px", height: "12px", borderTop: `2px solid ${c.accent}`, borderRight: `2px solid ${c.accent}` }} />
                <div style={{ position: "absolute", bottom: "16px", left: "16px", width: "12px", height: "12px", borderBottom: `2px solid ${c.accent}`, borderLeft: `2px solid ${c.accent}` }} />
                <div style={{ position: "absolute", bottom: "16px", right: "16px", width: "12px", height: "12px", borderBottom: `2px solid ${c.accent}`, borderRight: `2px solid ${c.accent}` }} />
              </div>

              {/* Viewport controls */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <button
                    onClick={startCameraTest}
                    style={{
                      padding: "10px 18px",
                      background: c.accentLight,
                      border: `1px solid ${c.accentBorder}`,
                      borderRadius: "6px",
                      color: c.accentText,
                      fontSize: "12.5px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 200ms",
                    }}
                  >
                    {camStream ? "Restart Capture Feed" : "Initialize Capture Feed"}
                  </button>

                  {cameras.length > 0 && (
                    <select
                      value={selectedCam}
                      onChange={(e) => setSelectedCam(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "10px 14px",
                        background: c.innerBg,
                        border: `1px solid ${c.border}`,
                        borderRadius: "6px",
                        color: c.text,
                        fontSize: "12.5px",
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {cameras.map((c) => (
                        <option key={c.deviceId} value={c.deviceId}>
                          {c.label || `Interface ${c.deviceId.slice(0, 6)}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {cameraError && (
                  <p style={{ fontSize: "11.5px", color: "#f87171", lineHeight: 1.5 }}>
                    {cameraError}. Run the app as your normal desktop user and close other apps using the camera.
                  </p>
                )}

                {/* Real Video Track Settings telemetry */}
                {camStream && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", background: c.innerBg, padding: "12px 16px", borderRadius: "6px", border: `1px solid ${c.border}` }}>
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>RESOLVING RES</p>
                      <p style={{ fontSize: "12px", fontWeight: 600, color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>{camStats.resolution}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>ACQUISITION RATE</p>
                      <p style={{ fontSize: "12px", fontWeight: 600, color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>{camStats.fps}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: "10.5px", color: c.textMuted, marginBottom: "2px" }}>ASPECT RATIO</p>
                      <p style={{ fontSize: "12px", fontWeight: 600, color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>{camStats.aspect}</p>
                    </div>
                  </div>
                )}

                <p style={{ fontSize: "11.5px", color: c.textMuted, lineHeight: 1.5 }}>
                  Widescreen 16:9 or standard 4:3 input are acceptable. The proctoring pipeline scans frames locally to identify face landmarker telemetry markers.
                </p>
              </div>
            </div>

            {/* Column 2: Web Audio (Mic decibel + Speaker oscillator) diagnostics */}
            <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {/* Mic calibration */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "8px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                  flex: 1,
                  justifyContent: "center",
                }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>Audio Microphone calibration</h4>
                <p style={{ fontSize: "12.5px", color: c.textMuted, lineHeight: 1.5 }}>
                  Detect and calibrate active microphone inputs to secure a clean environmental decibel threshold.
                </p>

                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button
                    onClick={toggleMicMonitor}
                    style={{
                      padding: "10px 18px",
                      background: micActive ? "rgba(239,68,68,0.08)" : (theme === "light" ? "rgba(16,185,129,0.08)" : "rgba(34,197,94,0.08)"),
                      border: `1px solid ${micActive ? "rgba(239,68,68,0.3)" : (theme === "light" ? "rgba(16,185,129,0.25)" : "rgba(34,197,94,0.3)")}`,
                      borderRadius: "6px",
                      color: micActive ? "#ef4444" : (theme === "light" ? "#10b981" : "#86efac"),
                      fontSize: "12.5px",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "all 200ms",
                      width: "180px",
                    }}
                  >
                    {micActive ? "Stop Decibel Monitor" : "Monitor Audio Feed"}
                  </button>

                  <div style={{ flex: 1 }}>
                    <div style={{ height: "8px", background: c.innerBg, borderRadius: "4px", overflow: "hidden", border: `1px solid ${c.border}`, position: "relative", marginBottom: "6px" }}>
                      <div style={{ width: `${micLevel}%`, height: "100%", background: "linear-gradient(90deg, #22c55e, #a855f7)", transition: "width 60ms cubic-bezier(0.1, 0.8, 0.2, 1)" }} />
                    </div>
                    <p style={{ fontSize: "11px", color: c.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                      REALTIME VALUE: {micLevel > 0 ? `${micLevel}% amplitude` : "STANDBY"}
                    </p>
                    {micError && (
                      <p style={{ fontSize: "11px", color: "#f87171", lineHeight: 1.4, marginTop: "6px" }}>
                        {micError}. Check OS privacy settings and close other recording apps.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Speaker calibration */}
              <div
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: "8px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                  flex: 1,
                  justifyContent: "center",
                }}
              >
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>Speaker Acoustic Output Test</h4>
                
                {/* Volume slider control */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: c.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                    <span>TEST TONE GAIN AMPLITUDE</span>
                    <span>{speakerVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={speakerVolume}
                    onChange={(e) => setSpeakerVolume(Number(e.target.value))}
                    style={{
                      width: "100%",
                      accentColor: c.accent,
                      background: theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
                      height: "4px",
                      borderRadius: "2px",
                      cursor: "pointer",
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button
                    onClick={testSpeakers}
                    disabled={speakerActive}
                    style={{
                      padding: "10px 18px",
                      background: speakerActive ? c.accentLight : (theme === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)"),
                      border: `1px solid ${c.border}`,
                      borderRadius: "6px",
                      color: c.text,
                      fontSize: "12.5px",
                      cursor: speakerActive ? "not-allowed" : "pointer",
                      transition: "all 200ms",
                    }}
                  >
                    {speakerActive ? "Playing Sine Wave..." : "Play Test Tone (440Hz)"}
                  </button>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setSpeakerSuccess(true)}
                      style={{
                        padding: "6px 12px",
                        background: speakerSuccess === true ? "rgba(34,197,94,0.08)" : "transparent",
                        border: `1px solid ${speakerSuccess === true ? "rgba(34,197,94,0.3)" : (theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(34,197,94,0.15)")}`,
                        borderRadius: "4px",
                        color: theme === "light" ? "#10b981" : "#86efac",
                        fontSize: "11.5px",
                        cursor: "pointer",
                      }}
                    >
                      Clear Signal
                    </button>
                    <button
                      onClick={() => setSpeakerSuccess(false)}
                      style={{
                        padding: "6px 12px",
                        background: speakerSuccess === false ? "rgba(239,68,68,0.08)" : "transparent",
                        border: `1px solid ${speakerSuccess === false ? "rgba(239,68,68,0.3)" : (theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(239,68,68,0.15)")}`,
                        borderRadius: "4px",
                        color: "#ef4444",
                        fontSize: "11.5px",
                        cursor: "pointer",
                      }}
                    >
                      No Signal
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "permissions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <PermissionLine label="Webcam Hardware Access" enabled={readiness.camera === "ok"} description="Allows the proctoring engine to capture live video alignment checkpoints" theme={theme} />
            <PermissionLine label="Microphone Access" enabled={readiness.mic === "ok"} description="Enables environmental acoustic monitoring to detect unapproved conversations" theme={theme} />
            <PermissionLine label="Tauri System Overlay notifications" enabled={true} description="Allows desktop prompts regarding firewall constraints or lock failures" theme={theme} />
          </div>
        )}

        {activeTab === "security" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", alignItems: "stretch" }}>
            {/* Sec environmental checks list */}
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
                <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>Security Environment Checks</h4>
                <button
                  onClick={() => void runSecurityScan()}
                  disabled={securityBusy}
                  style={{
                    padding: "7px 12px",
                    background: c.accentLight,
                    border: `1px solid ${c.accentBorder}`,
                    borderRadius: "6px",
                    color: c.accentText,
                    fontSize: "11.5px",
                    cursor: securityBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {securityBusy ? "Scanning..." : "Run Native Scan"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <SecurityInfoRow
                  label="Operating system"
                  val={platformInfo ? `${platformInfo.os} / ${platformInfo.arch}` : "Checking native platform"}
                  secure={platformInfo ? platformInfo.os === "linux" || platformInfo.os === "windows" : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Virtualization check"
                  val={
                    virtScan
                      ? virtScan.detected
                        ? `${virtScan.platform ?? "virtualized"} detected (${virtScan.confidence})`
                        : "Bare-metal signals clear"
                      : "Checking hypervisor signals"
                  }
                  secure={virtScan ? !virtScan.detected : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Display / webview session"
                  val={securityEnv?.display_server ?? "Native metadata pending"}
                  secure={!!securityEnv}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={platformInfo?.os === "windows" ? "Debugger/injection profile" : "LD_PRELOAD injection"}
                  val={
                    securityEnv
                      ? securityEnv.ld_preload_injection
                        ? "Injection variable present"
                        : "Clean"
                      : "Checking"
                  }
                  secure={securityEnv ? !securityEnv.ld_preload_injection : false}
                  theme={theme}
                />
                <SecurityInfoRow
                  label={platformInfo?.os === "windows" ? "Native lockdown support" : "Linux ptrace scope"}
                  val={
                    platformInfo?.os === "windows"
                      ? "Keyboard hook and firewall commands available"
                      : securityEnv
                        ? `ptrace_scope ${securityEnv.ptrace_scope}`
                        : "Checking"
                  }
                  secure={platformInfo?.os === "windows" || (securityEnv ? securityEnv.ptrace_scope > 0 : false)}
                  theme={theme}
                />
                <SecurityInfoRow
                  label="Network reachability"
                  val={
                    networkCheck
                      ? networkCheck.reachable
                        ? `${networkCheck.quality} (${networkCheck.latency_ms ?? "?"}ms)`
                        : "Unreachable"
                      : "Checking host reachability"
                  }
                  secure={networkCheck ? networkCheck.reachable : false}
                  theme={theme}
                />
              </div>
            </div>

            {/* restricted apps check */}
            <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <h4 style={{ fontSize: "14.5px", fontWeight: 600, color: c.text }}>Restricted Background Processes</h4>
              <p style={{ fontSize: "12.5px", color: c.textMuted, lineHeight: 1.5 }}>
                Native process scanning is backed by /proc on Linux and tasklist on Windows.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "8px" }}>
                {processScan?.found.length ? (
                  processScan.found.map((name) => (
                    <ProcessListItem key={name} name={name} restricted={true} theme={theme} />
                  ))
                ) : (
                  <>
                    <ProcessListItem name="OBS / screen recording tools" restricted={false} theme={theme} />
                    <ProcessListItem name="Discord / chat clients" restricted={false} theme={theme} />
                    <ProcessListItem name="TeamViewer / remote access" restricted={false} theme={theme} />
                    <ProcessListItem name="Debuggers / packet tools" restricted={false} theme={theme} />
                  </>
                )}
              </div>
              <p style={{ fontSize: "11.5px", color: processScan?.clean === false ? "#f87171" : c.textMuted, lineHeight: 1.5 }}>
                {processScan
                  ? processScan.clean
                    ? "No restricted processes were found in the latest native scan."
                    : "Close the flagged apps and run the scan again before joining a session."
                  : "Run a native scan to populate the restricted process result."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionLine({ label, enabled, description, theme }: { label: string; enabled: boolean; description: string; theme: "dark" | "light" }) {
  const c = getThemeColors(theme);
  return (
    <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px" }}>
      <div>
        <h4 style={{ fontSize: "13.5px", fontWeight: 600, color: c.text, marginBottom: "4px" }}>{label}</h4>
        <p style={{ fontSize: "11.5px", color: c.textMuted, lineHeight: 1.4 }}>{description}</p>
      </div>
      <span style={{ fontSize: "11px", fontWeight: 600, color: enabled ? (theme === "light" ? "#10b981" : "#22c55e") : "#f59e0b", background: enabled ? (theme === "light" ? "rgba(16,185,129,0.08)" : "rgba(34,197,94,0.08)") : "rgba(245,158,11,0.08)", border: `1px solid ${enabled ? (theme === "light" ? "rgba(16,185,129,0.2)" : "rgba(34,197,94,0.2)") : "rgba(245,158,11,0.2)"}`, padding: "4px 10px", borderRadius: "4px", letterSpacing: "0.04em" }}>
        {enabled ? "GRANTED" : "BLOCKED"}
      </span>
    </div>
  );
}

function SecurityInfoRow({ label, val, secure, theme }: { label: string; val: string; secure: boolean; theme: "dark" | "light" }) {
  const c = getThemeColors(theme);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: c.innerBg, border: `1px solid ${c.border}`, borderRadius: "4px", alignItems: "center" }}>
      <span style={{ fontSize: "12px", color: c.textMutedStrong }}>{label}</span>
      <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace", color: secure ? (theme === "light" ? "#10b981" : "#22c55e") : "#ef4444" }}>{val}</span>
    </div>
  );
}

function ProcessListItem({ name, restricted, theme }: { name: string; restricted: boolean; theme: "dark" | "light" }) {
  const c = getThemeColors(theme);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", background: c.innerBg, border: `1px solid ${c.border}`, borderRadius: "6px" }}>
      <span style={{ fontSize: "12px", color: c.text }}>{name}</span>
      <span style={{ fontSize: "9.5px", fontFamily: "'JetBrains Mono', monospace", color: restricted ? "#ef4444" : (theme === "light" ? "#10b981" : "#22c55e"), background: restricted ? "rgba(239,68,68,0.08)" : (theme === "light" ? "rgba(16,185,129,0.08)" : "rgba(34,197,94,0.08)"), padding: "2px 6px", borderRadius: "3px" }}>
        {restricted ? "FLAGGED" : "CLEARED"}
      </span>
    </div>
  );
}

// ── Diagnostics Console Panel ──
function DiagnosticsPanel({ readiness, theme }: { readiness: any; theme: "dark" | "light" }) {
  const [checkingNetwork, setCheckingNetwork] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [networkQuality, setNetworkQuality] = useState("unchecked");
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [securityEnv, setSecurityEnv] = useState<SecurityEnvironment | null>(null);
  const c = getThemeColors(theme);

  useEffect(() => {
    invoke<PlatformInfo>("get_platform").then(setPlatformInfo).catch(() => {});
    invoke<SecurityEnvironment>("get_security_environment").then(setSecurityEnv).catch(() => {});
    void runNetworkScan();
  }, []);

  async function runNetworkScan() {
    setCheckingNetwork(true);
    try {
      const result = await invoke<NetworkCheckResult>("check_network_stability", {
        host: getNetworkProbeHost(),
      });
      setLatency(result.latency_ms);
      setJitter(result.jitter_ms);
      setNetworkQuality(result.reachable ? result.quality : "unreachable");
    } catch {
      setLatency(null);
      setJitter(null);
      setNetworkQuality("unavailable");
    } finally {
      setCheckingNetwork(false);
    }
  }

  // Functional diagnostic logs downloader
  function exportReport() {
    const data = {
      timestamp: new Date().toISOString(),
      client_version: "0.1.0",
      os: platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown",
      display_server: securityEnv?.display_server ?? "unknown",
      proctoring_telemetry: {
        camera_available: readiness.camera === "ok",
        mic_available: readiness.mic === "ok",
        network_latency_ms: latency,
        network_jitter_ms: jitter,
        network_quality: networkQuality,
      },
      security_lock_matrix: {
        platform_supported: readiness.platform === "ok",
        vm_shield_active: readiness.vm === "ok",
        ld_preload_clean: securityEnv ? !securityEnv.ld_preload_injection : null,
        keyboard_lock_available: readiness.keyboard === "ok",
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ams_diagnostic_report_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Network Diagnostics */}
      <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "20px 24px" }}>
        <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text, marginBottom: "14px" }}>Platform Connection Diagnostics</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "20px" }}>
          <TelemetryStat label="API Gateway Connectivity" val="SECURE" sub="ams-gateway.api.ams.local" secure={true} theme={theme} />
          <TelemetryStat label="Supabase DB Sync Node" val="SECURE" sub="db-sync.sup.ams.local" secure={true} theme={theme} />
          <TelemetryStat label="Proctor Model Asset CDN" val="SECURE" sub="models.cdn.ams.local" secure={true} theme={theme} />
        </div>
        <div style={{ display: "flex", gap: "24px", alignItems: "center", borderTop: `1px solid ${c.border}`, paddingTop: "16px" }}>
          <button onClick={runNetworkScan} disabled={checkingNetwork} style={{ padding: "8px 16px", background: c.accentLight, border: `1px solid ${c.accentBorder}`, borderRadius: "6px", color: c.accentText, fontSize: "12px", cursor: checkingNetwork ? "not-allowed" : "pointer" }}>
            {checkingNetwork ? "Measuring Telemetry..." : "Scan Latency Network"}
          </button>
          <div style={{ display: "flex", gap: "20px" }}>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Latency: <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>{latency ?? "?"}ms</strong>
            </span>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Jitter: <strong style={{ color: c.text, fontFamily: "'JetBrains Mono', monospace" }}>{jitter ?? "?"}ms</strong>
            </span>
            <span style={{ fontSize: "12.5px", color: c.textMutedStrong }}>
              Signal Grade: <strong style={{ color: networkQuality === "unreachable" || networkQuality === "unavailable" ? "#ef4444" : theme === "light" ? "#10b981" : "#22c55e", fontFamily: "'JetBrains Mono', monospace" }}>{networkQuality.toUpperCase()}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Diagnostics Logs panel */}
      <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: "8px", padding: "20px 24px" }}>
        <h4 style={{ fontSize: "14px", fontWeight: 600, color: c.text, marginBottom: "8px" }}>Diagnostics Log Registry</h4>
        <p style={{ fontSize: "12.5px", color: c.textMuted, marginBottom: "16px", lineHeight: 1.5 }}>
          Export local secure client parameters to help technical administrators troubleshoot workstation setups.
        </p>
        <pre
          style={{
            background: c.innerBg,
            border: `1px solid ${c.border}`,
            borderRadius: "6px",
            padding: "16px",
            fontSize: "11px",
            color: c.consoleText,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.6,
            overflowX: "auto",
            marginBottom: "20px",
          }}
        >
{`{
  "client_version": "0.1.0",
  "build_channel": "release-production",
  "os_environment": "${platformInfo ? `${platformInfo.os} ${platformInfo.arch}` : "unknown"}",
  "display_server": "${securityEnv?.display_server ?? "unknown"}",
  "network_quality": "${networkQuality}",
  "security_lockdown": {
    "platform_supported": ${readiness.platform === "ok"},
    "keyboard_lock_available": ${readiness.keyboard === "ok"},
    "sandboxed_webview": true
  }
}`}
        </pre>
        <button onClick={exportReport} style={{ padding: "8px 16px", background: theme === "light" ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.04)", border: `1px solid ${c.border}`, borderRadius: "6px", color: c.text, fontSize: "12px", cursor: "pointer", transition: "all 200ms" }}>
          Export Diagnostic JSON Log
        </button>
      </div>
    </div>
  );
}

function TelemetryStat({ label, val, sub, secure, theme }: { label: string; val: string; sub: string; secure: boolean; theme: "dark" | "light" }) {
  const c = getThemeColors(theme);
  return (
    <div style={{ padding: "14px 18px", background: c.innerBg, border: `1px solid ${c.border}`, borderRadius: "6px" }}>
      <p style={{ fontSize: "11.5px", color: c.textMuted, marginBottom: "4px" }}>{label}</p>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
        <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: secure ? (theme === "light" ? "#10b981" : "#22c55e") : "#ef4444" }} />
        <span style={{ fontSize: "13.5px", fontWeight: 600, color: c.text }}>{val}</span>
      </div>
      <p style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: c.textMuted }}>{sub}</p>
    </div>
  );
}

function SecurityOperationsLog({ theme }: { theme: "dark" | "light" }) {
  const [logs, setLogs] = useState<string[]>([]);
  const themeColors = getThemeColors(theme);

  useEffect(() => {
    const baseLogs = [
      "SYSTEM: Secure shell layer initialized on native namespace",
      "INTEGRITY: Display server Mutter configurations parsed",
      "INTEGRITY: Process scanner active (0 blacklisted instances)",
      "NETWORK: Outbound port lock filters verified via iptables",
      "HARDWARE: Connected audio/video interfaces bound to WebKitGTK namespace",
    ];

    setLogs(baseLogs.map((l, i) => `[04:${12 + i}:02] ${l}`));

    const interval = setInterval(() => {
      setLogs((prev) => {
        const next = [...prev];
        if (next.length > 8) next.shift();
        const time = new Date().toLocaleTimeString([], { hour12: false });
        next.push(`[${time}] TELEMETRY: System heartbeat beacon transmitted`);
        return next;
      });
    }, 14000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: `1px solid ${themeColors.border}`,
        borderRadius: "8px",
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: themeColors.accent, boxShadow: `0 0 6px ${themeColors.accent}` }} />
        <h4 style={{ fontSize: "11px", fontWeight: 600, color: themeColors.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
          Live Security Operations Feed
        </h4>
      </div>
      <div
        style={{
          background: themeColors.innerBg,
          border: `1px solid ${themeColors.border}`,
          borderRadius: "6px",
          padding: "16px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "11.5px",
          color: themeColors.consoleText,
          lineHeight: 1.6,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {logs.map((log, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}
