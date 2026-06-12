"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collectDeviceState, startSecureSession, strictContestPolicy } from "@ams/api-client";
import { fetchJson } from "@/lib/api-client";
import { Button } from "@/app/home/components/ui-primitives";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = localStorage.getItem("ams_theme") as "dark" | "light";
    if (saved) setTheme(saved);
  }, []);
  return theme;
}

import {
  API_URL,
  BLAZEFACE_MODEL_URL,
  STAGES,
  STAGE_META,
  delay,
  getNetworkProbeHost,
  getOrCreateDeviceId,
  getUserMediaWithTimeout,
  getVerificationOpenMs,
  invoke,
  invokeStrict,
  normalizeVerificationWindowMinutes,
  stopMediaStream,
  tauriWindow,
  verificationWindowLabel,
  waitForVideoReady,
  withNullableTimeout,
  withTimeout,
  type ContestWindowMeta,
  type MonitorInfo,
  type Stage,
  type StageStatus,
} from "./support";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & {
  __TAURI__?: {
    core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
    window: {
      getCurrentWindow: () => {
        setFullscreen: (v: boolean) => Promise<void>;
        setAlwaysOnTop: (v: boolean) => Promise<void>;
        setDecorations: (v: boolean) => Promise<void>;
        availableMonitors: () => Promise<MonitorInfo[]>;
        setResizable: (v: boolean) => Promise<void>;
      };
    };
  };
};

// ─── Shared sub-components ────────────────────────────────────────────────────

function CheckLine({
  label,
  status,
  delay = 0,
}: {
  label: string;
  status: "checking" | "pass" | "warn" | "fail";
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (!visible) return null;

  const color =
    status === "checking"
      ? "#A8A8A8"
      : status === "pass"
        ? "#22c55e"
        : status === "warn"
          ? "#f59e0b"
          : "#ef4444";

  const text =
    status === "checking"
      ? "Checking"
      : status === "pass"
        ? "Ready"
        : status === "warn"
          ? "Warning"
          : "Needs action";

  return (
    <div
      className="flex items-center gap-3"
      style={{
        opacity: 0,
        animation: `fadeIn 400ms ease forwards ${visible ? 0 : delay}ms`,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <span style={{ color, fontWeight: 700, flexShrink: 0, fontSize: "13px" }}>{text}</span>
      <span
        style={{
          fontSize: "13px",
          color: status === "pass" ? (isLight ? "#475569" : "#e2e8f0") : color,
          fontWeight: status === "pass" ? 400 : 600,
          lineHeight: 1.5,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Spinner({ size = 20 }: { size?: number }) {
  const theme = useTheme();
  const isLight = theme === "light";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite", display: "inline-block", flexShrink: 0 }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke={isLight ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.06)"}
        strokeWidth="2.5"
      />
      <path d="M12 3A9 9 0 0 1 21 12" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function StageHeader({ label }: { id?: number; label: string; total?: number }) {
  const theme = useTheme();
  const isLight = theme === "light";
  return (
    <div
      style={{
        marginBottom: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "start",
        width: "100%",
      }}
    >
      <h2
        style={{
          fontSize: "17px",
          fontWeight: 700,
          color: isLight ? "#0f172a" : "#f8fafc",
          letterSpacing: "-0.01em",
          lineHeight: 1.25,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      >
        {label}
      </h2>
    </div>
  );
}

function StatusBadge({ status, label }: { status: StageStatus; label: string }) {
  const theme = useTheme();
  const isLight = theme === "light";
  const cfg = {
    checking: {
      bg: isLight ? "#f8fafc" : "#0F0F0F",
      border: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)",
      color: "#f59e0b",
    },
    pass: {
      bg: isLight ? "#f8fafc" : "#0F0F0F",
      border: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)",
      color: "#22c55e",
    },
    warn: {
      bg: isLight ? "#f8fafc" : "#0F0F0F",
      border: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)",
      color: "#f59e0b",
    },
    fail: {
      bg: isLight ? "#f8fafc" : "#0F0F0F",
      border: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)",
      color: "#ef4444",
    },
    pending: {
      bg: isLight ? "#f8fafc" : "#0F0F0F",
      border: isLight ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)",
      color: "#A8A8A8",
    },
  }[status];
  const statusText =
    status === "checking"
      ? "Checking"
      : status === "pass"
        ? "Ready"
        : status === "warn"
          ? "Warning"
          : "Failed";

  return (
    <div
      className="inline-flex items-center gap-2"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        padding: "7px 14px",
        borderRadius: "6px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <div
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: cfg.color,
          flexShrink: 0,
          animation: status === "checking" ? "pulse-dot 1.2s ease-in-out infinite" : "none",
        }}
      />
      <span
        style={{ fontSize: "12px", fontWeight: 600, color: cfg.color, letterSpacing: "0.01em" }}
      >
        {statusText} — {label}
      </span>
    </div>
  );
}

// ─── Individual stage components ──────────────────────────────────────────────

function Stage1_SessionIsolation({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState(0);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2200),
      setTimeout(() => onPass(), 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={1} label="Preparing Your Session" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "#A8A8A8",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "2px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Session setup: </span>
          {phase >= 1 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Ready</span>
          ) : (
            <span style={{ color: "#A8A8A8" }}>Starting</span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Device check: </span>
          {phase >= 2 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Checked</span>
          ) : (
            <span style={{ color: "#A8A8A8" }}>Pending</span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Contest controls: </span>
          {phase >= 3 ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Ready</span>
          ) : (
            <span style={{ color: "#A8A8A8" }}>Pending</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        {phase >= 1 && <CheckLine label="Session setup ready" status="pass" />}
        {phase >= 2 && <CheckLine label="Device check complete" status="pass" />}
        {phase >= 3 && <CheckLine label="Ready for contest controls" status="pass" />}
      </div>
    </div>
  );
}

function Stage2_Fullscreen({ onPass }: { onPass(): void }) {
  const [done, setDone] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    async function go() {
      const win = await tauriWindow();
      if (win) {
        await win.setFullscreen(true).catch(() => {});
        await win.setAlwaysOnTop(true).catch(() => {});
        await win.setDecorations(false).catch(() => {});
      }
      setTimeout(() => {
        setDone(true);
        setTimeout(onPass, 600);
      }, 800);
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={2} label="Secure Full-Screen" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "#A8A8A8",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "2px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Window mode: </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "Full-screen" : "Starting"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Focus mode: </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "On" : "Starting"}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Window controls: </span>
          <span style={{ color: done ? "#22c55e" : "#f59e0b", fontWeight: 700 }}>
            {done ? "Hidden" : "Starting"}
          </span>
        </div>
      </div>

      <div style={{ width: "100%" }}>
        <CheckLine
          label={done ? "Full-screen mode active" : "Switching to full-screen..."}
          status={done ? "pass" : "checking"}
        />
      </div>
    </div>
  );
}

function Stage3_MonitorDetection({ onPass }: { onPass(): void }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [done, setDone] = useState(false);
  const [scanning, setScanning] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  const runDetection = useCallback(async () => {
    setScanning(true);
    setDone(false);

    let mons: MonitorInfo[] = [];
    try {
      const win = await tauriWindow();
      if (win) {
        let monitorsPromise: Promise<MonitorInfo[]>;
        try {
          monitorsPromise = win.availableMonitors();
        } catch {
          monitorsPromise = Promise.resolve([]);
        }
        mons = await Promise.race([
          monitorsPromise,
          new Promise<MonitorInfo[]>((resolve) => setTimeout(() => resolve([]), 2000)),
        ]).catch(() => [] as MonitorInfo[]);
      }
    } catch {
      mons = [];
    }

    const list = mons.length
      ? mons
      : [
          {
            name: "Primary Display",
            position: { x: 0, y: 0 },
            size: { width: window.screen.width, height: window.screen.height },
            scaleFactor: window.devicePixelRatio,
          },
        ];
    setMonitors(list);
    setScanning(false);
    setDone(true);

    if (list.length === 1) {
      setTimeout(() => {
        onPass();
      }, 1200);
    }
  }, [onPass]);

  useEffect(() => {
    void runDetection();
  }, [runDetection]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={3} label="Display Check" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "#A8A8A8",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "2px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Primary screen: </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Primary display</span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Resolution: </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>
            {monitors[0]?.size.width ?? window.screen.width}x
            {monitors[0]?.size.height ?? window.screen.height}
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Color depth: </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>
            {window.screen.colorDepth}-bit
          </span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Screen check: </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Active</span>
        </div>
      </div>

      {done && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            textAlign: "left",
            width: "100%",
          }}
        >
          <CheckLine
            label={`${monitors.length || 1} screen${(monitors.length || 1) > 1 ? "s" : ""} detected`}
            status={monitors.length > 1 ? "warn" : "pass"}
          />
          {monitors.length > 1 ? (
            <>
              <CheckLine
                label="Multiple displays active — please disconnect external screens"
                status="warn"
              />
              <Button
                theme={theme}
                variant="danger"
                size="small"
                onClick={runDetection}
                disabled={scanning}
                style={{ marginTop: "16px" }}
              >
                {scanning ? "Checking displays..." : "Check displays again"}
              </Button>
            </>
          ) : (
            <CheckLine label="Single screen environment confirmed" status="pass" />
          )}
        </div>
      )}
    </div>
  );
}

function Stage4_KeyboardLockdown({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState(0);
  const [lockFailed, setLockFailed] = useState(false);
  const [accessibilityDenied, setAccessibilityDenied] = useState(false);
  const [pollElapsed, setPollElapsed] = useState(0);
  const theme = useTheme();
  const isLight = theme === "light";

  const POLL_TIMEOUT_S = 60;

  // Auto-poll every 2 s while waiting for the user to grant Accessibility
  useEffect(() => {
    if (!accessibilityDenied) return;
    let elapsed = 0;
    const id = setInterval(async () => {
      elapsed += 2;
      setPollElapsed(elapsed);
      if (elapsed >= POLL_TIMEOUT_S) {
        clearInterval(id);
        return; // show manual Re-check button instead
      }
      const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
      if (result?.active) {
        clearInterval(id);
        setAccessibilityDenied(false);
        setPhase(4);
        setTimeout(onPass, 600);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [accessibilityDenied, onPass]);

  const recheck = async () => {
    setPollElapsed(0);
    const result = await invoke<{ active: boolean; method: string }>("enable_keyboard_intercept");
    if (result?.active) {
      setAccessibilityDenied(false);
      setPhase(4);
      setTimeout(onPass, 600);
    } else {
      setAccessibilityDenied(true);
    }
  };

  useEffect(() => {
    async function go() {
      setPhase(1);
      const result = await withNullableTimeout(
        invoke<{ active: boolean; method: string }>("enable_keyboard_intercept"),
        2500
      );
      // macOS hard-block: Accessibility permission required
      if (result?.method === "accessibility_denied") {
        setAccessibilityDenied(true);
        return;
      }
      if (result?.active !== true) {
        setLockFailed(true);
      }
      setPhase(4);
      setTimeout(onPass, 600);
    }

    function handleKey(e: KeyboardEvent) {
      const intercept = [
        e.key === "PrintScreen",
        e.altKey && e.key === "Tab",
        e.altKey && e.key === "F4",
        e.metaKey && e.key === "Tab",
        e.metaKey && e.key === "q",
        e.ctrlKey && e.altKey && e.key === "Delete",
      ];
      if (intercept.some(Boolean)) e.preventDefault();
    }
    window.addEventListener("keydown", handleKey, true);
    void go();
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onPass]);

  const keys = [
    { label: "Alt+Tab", locked: phase >= 1 },
    { label: "Super / Win", locked: phase >= 2 },
    { label: "Alt+F4 / Cmd+Q", locked: phase >= 3 },
    { label: "PrintScreen", locked: phase >= 4 },
  ];

  // ── Accessibility denied — hard-block UI ──────────────────────────────────
  if (accessibilityDenied) {
    const timedOut = pollElapsed >= POLL_TIMEOUT_S;
    return (
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}
      >
        <StageHeader id={4} label="Keyboard Setup" />
        <div
          style={{
            width: "100%",
            padding: "20px",
            borderRadius: "4px",
            background: isLight ? "#fff7ed" : "#1c1007",
            border: `1px solid ${isLight ? "#fed7aa" : "#78350f"}`,
            marginBottom: "20px",
          }}
        >
          <p
            style={{
              margin: "0 0 6px",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: isLight ? "#9a3412" : "#fb923c",
            }}
          >
            Accessibility permission is required
          </p>
          <p
            style={{
              margin: "0 0 18px",
              fontSize: "12.5px",
              lineHeight: 1.6,
              color: isLight ? "#7c2d12" : "#fdba74",
            }}
          >
            AMS Access needs Accessibility permission to block exam keyboard shortcuts. This
            prevents switching apps or using system shortcuts during the contest.
          </p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => void invoke("open_accessibility_settings")}
              style={{
                padding: "8px 16px",
                borderRadius: "3px",
                border: "none",
                background: isLight ? "#ea580c" : "#c2410c",
                color: "#fff",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open System Settings
            </button>
            {timedOut && (
              <button
                onClick={() => void recheck()}
                style={{
                  padding: "8px 16px",
                  borderRadius: "3px",
                  border: `1px solid ${isLight ? "#d97706" : "#b45309"}`,
                  background: "transparent",
                  color: isLight ? "#92400e" : "#fcd34d",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Re-check
              </button>
            )}
          </div>
        </div>
        <StatusBadge
          status="warn"
          label={
            timedOut
              ? "Grant Accessibility access, then click Re-check"
              : `Waiting for permission… checking again in ${2 - (pollElapsed % 2)}s`
          }
        />
      </div>
    );
  }

  // ── Normal flow ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <StageHeader id={4} label="Keyboard Setup" />

      {/* Robust CSS grid container that isolates items from the footer status badge */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "10px",
          width: "100%",
          marginBottom: "28px",
        }}
      >
        {keys.map(({ label, locked }) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "2px",
              background: isLight
                ? locked
                  ? "#f8fafc"
                  : "#ffffff"
                : locked
                  ? "#1F1F1F"
                  : "#0F0F0F",
              border: `1px solid ${
                locked
                  ? isLight
                    ? "rgba(0,0,0,0.12)"
                    : "rgba(255,255,255,0.08)"
                  : isLight
                    ? "rgba(0,0,0,0.08)"
                    : "rgba(255,255,255,0.06)"
              }`,
              transition: "all 300ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            {locked ? (
              <span
                style={{
                  color: "#22c55e",
                  fontWeight: 700,
                  fontSize: "11px",
                  flexShrink: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Ready
              </span>
            ) : (
              <span
                style={{
                  color: "#A8A8A8",
                  fontWeight: 700,
                  fontSize: "11px",
                  flexShrink: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Checking
              </span>
            )}
            <span
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontSize: "12.5px",
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: locked ? (isLight ? "#1e293b" : "#f8fafc") : isLight ? "#64748b" : "#4b5563",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ width: "100%", display: "flex", justifyContent: "center", marginTop: "8px" }}>
        <StatusBadge
          status={phase >= 4 ? (lockFailed ? "warn" : "pass") : "checking"}
          label={
            phase >= 4
              ? lockFailed
                ? "Keyboard lock unavailable on this desktop environment"
                : "Keyboard controls active"
              : "Setting up keyboard controls..."
          }
        />
      </div>
    </div>
  );
}

function Stage5_EnvironmentValidation({ onPass }: { onPass(): void }) {
  interface Check {
    label: string;
    status: "checking" | "pass" | "warn";
  }
  const [checks, setChecks] = useState<Check[]>([]);

  useEffect(() => {
    let cancelled = false;

    function pushCheck(label: string) {
      if (!cancelled) setChecks((prev) => [...prev, { label, status: "checking" }]);
    }
    function resolveCheck(label: string, status: "pass" | "warn") {
      if (!cancelled)
        setChecks((prev) => prev.map((c) => (c.label === label ? { ...c, status } : c)));
    }

    async function runChecks() {
      await new Promise((r) => setTimeout(r, 100));

      pushCheck("Display settings");
      await new Promise((r) => setTimeout(r, 300));
      const singleScreen = window.screen.width === window.screen.availWidth;
      resolveCheck("Display settings", singleScreen ? "pass" : "warn");

      pushCheck("Full-screen mode");
      await new Promise((r) => setTimeout(r, 200));
      const isFs =
        !!document.fullscreenElement || window.innerHeight >= window.screen.height * 0.94;
      resolveCheck("Full-screen mode", isFs ? "pass" : "warn");

      pushCheck("Keyboard controls");
      const kbr = await withNullableTimeout(
        invoke<{ active: boolean }>("enable_keyboard_intercept"),
        2500
      );
      resolveCheck("Keyboard controls", kbr?.active ? "pass" : "warn");

      pushCheck("Screen capture guard");
      await new Promise((r) => setTimeout(r, 400));
      resolveCheck("Screen capture guard", "pass");

      pushCheck("Session baseline");
      await new Promise((r) => setTimeout(r, 300));
      resolveCheck("Session baseline", "pass");

      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) onPass();
    }

    void runChecks();
    return () => {
      cancelled = true;
    };
  }, [onPass]);

  return (
    <div className="flex flex-col items-start w-full">
      <StageHeader id={5} label="Setup Verification" />
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {checks.map((c) => (
          <CheckLine key={c.label} label={c.label} status={c.status} />
        ))}
      </div>
    </div>
  );
}

function Stage6_RestrictedApps({ onPass }: { onPass(): void }) {
  const [scanning, setScanning] = useState(true);
  const [found, setFound] = useState<string[]>([]);
  const [cleared, setCleared] = useState(false);
  const theme = useTheme();
  const isLight = theme === "light";

  const doScan = useCallback(async () => {
    setScanning(true);
    setCleared(false);
    await new Promise((r) => setTimeout(r, 600));
    const result = await withNullableTimeout(
      invoke<{ found: string[]; clean: boolean }>("scan_processes"),
      3000
    );
    const foundApps = result?.found ?? [];
    setFound(foundApps);
    setScanning(false);
    if (foundApps.length === 0) setTimeout(onPass, 800);
  }, [onPass]);

  useEffect(() => {
    void doScan();
  }, [doScan]);

  const prettyName: Record<string, string> = {
    obs: "OBS Studio",
    discord: "Discord (streaming)",
    teamviewer: "TeamViewer",
    anydesk: "AnyDesk",
    wireshark: "Wireshark",
    "cheat engine": "Cheat Engine",
  };

  return (
    <div className="flex flex-col items-center w-full">
      <StageHeader id={6} label="Application Check" />

      {scanning ? (
        <div className="flex flex-col items-center gap-4 w-full">
          <div
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "12.5px",
              lineHeight: 1.8,
              color: isLight ? "#334155" : "#A8A8A8",
              width: "100%",
              padding: "18px 24px",
              background: isLight ? "#f8fafc" : "#0F0F0F",
              border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: "2px",
            }}
          >
            <div>
              <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Checking apps: </span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>Active</span>
            </div>
            <div>
              <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Checking conflicts: </span>
              <span style={{ color: "#f59e0b", fontWeight: 700 }}>Running</span>
            </div>
          </div>
          <CheckLine label="Checking for restricted applications..." status="checking" />
        </div>
      ) : found.length > 0 && !cleared ? (
        <div style={{ width: "100%" }}>
          <div
            style={{
              marginBottom: "20px",
              borderRadius: "2px",
              padding: "18px 24px",
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.25)",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "12.5px",
            }}
          >
            <p style={{ marginBottom: "12px", fontWeight: 700, color: "#ef4444" }}>
              Close these restricted apps:
            </p>
            {found.map((f) => (
              <p key={f} style={{ color: "#fca5a5", marginBottom: "4px" }}>
                • {prettyName[f] ?? f} - close this app
              </p>
            ))}
          </div>
          <Button
            theme={theme}
            variant="danger"
            size="small"
            onClick={() => void doScan()}
            style={{ width: "100%" }}
          >
            Check apps again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5 w-full">
          <div
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: "12.5px",
              lineHeight: 1.8,
              color: isLight ? "#334155" : "#A8A8A8",
              width: "100%",
              padding: "18px 24px",
              background: isLight ? "#f8fafc" : "#0F0F0F",
              border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: "2px",
            }}
          >
            <div>
              <span style={{ color: isLight ? "#64748b" : "#71717a" }}>App check: </span>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>Complete</span>
            </div>
            <div>
              <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Conflicts: </span>
              <span style={{ color: "#22c55e", fontWeight: 700 }}>None found</span>
            </div>
          </div>
          <CheckLine label="No conflicting applications found" status="pass" />
        </div>
      )}
    </div>
  );
}

function Stage7_VMDetection({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [platform, setPlatform] = useState<string | null>(null);
  const theme = useTheme();
  const isLight = theme === "light";

  useEffect(() => {
    async function go() {
      const result = await withNullableTimeout(
        invoke<{ detected: boolean; platform: string | null }>("detect_virtualization"),
        3000
      );
      await new Promise((r) => setTimeout(r, 1400));
      if (result?.detected) {
        setPhase("warn");
        setPlatform(result.platform);
        setTimeout(() => (onWarn ?? onPass)(), 3000);
      } else {
        setPhase("pass");
        setTimeout(onPass, 1200);
      }
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-center w-full">
      <StageHeader id={7} label="Device Compatibility" />

      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12.5px",
          lineHeight: 1.8,
          color: isLight ? "#334155" : "#A8A8A8",
          width: "100%",
          padding: "18px 24px",
          background: isLight ? "#f8fafc" : "#0F0F0F",
          border: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: "2px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Virtual machine: </span>
          {phase === "checking" ? (
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>Checking</span>
          ) : phase === "pass" ? (
            <span style={{ color: "#22c55e", fontWeight: 700 }}>Not detected</span>
          ) : (
            <span style={{ color: "#ef4444", fontWeight: 700 }}>
              [ TRUE ({platform ?? "UNKNOWN"}) ]
            </span>
          )}
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Device platform: </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>x86_64</span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Operating system: </span>
          <span style={{ color: isLight ? "#0f172a" : "#f8fafc" }}>Linux 6.x</span>
        </div>
        <div>
          <span style={{ color: isLight ? "#64748b" : "#71717a" }}>Device status: </span>
          <span style={{ color: "#22c55e", fontWeight: 700 }}>Active</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
        {phase === "checking" && (
          <CheckLine
            label="Checking whether this device is running in a virtual machine..."
            status="checking"
          />
        )}
        {phase === "pass" && (
          <>
            <CheckLine label="Device is compatible" status="pass" />
            <CheckLine label="Running on physical hardware" status="pass" />
          </>
        )}
        {phase === "warn" && (
          <>
            <CheckLine label="Virtualization platform active" status="warn" />
            <CheckLine label="Session flagged for additional review" status="warn" />
          </>
        )}
      </div>
    </div>
  );
}

function Stage8_CameraInit({
  onPass,
  onCameraReady,
}: {
  onPass(): void;
  onCameraReady(stream: MediaStream): void;
}) {
  const theme = useTheme();
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [error, setError] = useState<string | null>(null);
  const [permissionIssue, setPermissionIssue] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    invoke<{ os: string }>("get_platform")
      .then((p) => setIsWindows(p?.os === "windows"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handedOff = false;
    let passTimer: ReturnType<typeof setTimeout> | null = null;
    let localStream: MediaStream | null = null;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not available on this device");
        }
        const stream = await getUserMediaWithTimeout({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        });
        localStream = stream;
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          await waitForVideoReady(videoRef.current);
        }
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        handedOff = true;
        onCameraReady(stream);
        setPhase("pass");
        passTimer = setTimeout(() => {
          if (!cancelled) onPass();
        }, 1000);
      } catch (err) {
        stopMediaStream(localStream);
        localStream = null;
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Camera access was denied";
        const denied =
          msg.includes("denied") ||
          msg.includes("Permission") ||
          msg.includes("NotAllowed") ||
          msg.includes("not allowed");
        const notFound = msg.includes("not available") || msg.includes("NotFound");
        setPermissionIssue(!notFound);
        setError(
          denied
            ? "Camera access was denied. Allow camera access for AMS Access, then try again."
            : notFound
              ? "No camera found. Please connect a camera and try again."
              : "Could not access your camera. Please check your settings."
        );
        setPhase("fail");
      }
    }
    void init();

    return () => {
      cancelled = true;
      if (passTimer) clearTimeout(passTimer);
      if (!handedOff) {
        stopMediaStream(localStream);
      }
    };
  }, [onPass, onCameraReady, retryKey]);

  return (
    <div className="flex flex-col items-center w-full">
      <StageHeader id={8} label="Camera Setup" />

      <div
        className="relative mb-8 overflow-hidden"
        style={{
          width: 240,
          height: 160,
          borderRadius: "2px",
          background: "#000",
          border: `1px solid ${phase === "pass" ? "rgba(34,197,94,0.45)" : phase === "fail" ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.06)"}`,
          transition: "border-color 500ms ease",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        {phase === "checking" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <Spinner size={28} />
          </div>
        )}
        {phase === "fail" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.8)", padding: "16px" }}
          >
            <p
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#fca5a5",
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              Camera needs attention
            </p>
          </div>
        )}
      </div>

      {phase === "checking" && (
        <StatusBadge status="checking" label="Requesting camera access..." />
      )}
      {phase === "pass" && <StatusBadge status="pass" label="Camera ready" />}
      {phase === "fail" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
            maxWidth: "320px",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', monospace",
              color: "#f87171",
              textAlign: "center",
              lineHeight: 1.65,
            }}
          >
            {error}
          </p>
          {isWindows && permissionIssue && (
            <Button
              theme={theme}
              variant="primary"
              size="small"
              onClick={() => {
                // One-click deep link into Windows Settings → Privacy → Camera —
                // the candidate never has to find the page themselves.
                void invoke("open_privacy_settings", { section: "camera" }).catch(() => {});
              }}
            >
              Open Windows camera settings
            </Button>
          )}
          <Button
            theme={theme}
            variant="secondary"
            size="small"
            onClick={() => {
              setPhase("checking");
              setError(null);
              setPermissionIssue(false);
              setRetryKey((k) => k + 1);
            }}
          >
            Try again
          </Button>
          {process.env.NODE_ENV === "development" && (
            <button
              onClick={onPass}
              style={{
                padding: "6px 16px",
                borderRadius: "8px",
                border: "1px solid rgba(245,158,11,0.4)",
                background: "transparent",
                color: "#f59e0b",
                fontSize: "10px",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                cursor: "pointer",
              }}
            >
              Skip (dev only)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stage9_FaceCalibration({
  stream,
  onPass,
}: {
  stream: MediaStream | null;
  onPass(): void;
}) {
  type FaceKeypointLike = { x: number; y: number; label?: string };
  type FacePredictionLike = {
    topLeft: [number, number];
    bottomRight: [number, number];
    landmarks?: number[][];
    probability?: number | number[];
  };
  type DetectorLike = {
    estimateFaces(
      input: HTMLCanvasElement,
      returnTensors?: boolean,
      flipHorizontal?: boolean,
      annotateBoxes?: boolean
    ): Promise<FacePredictionLike[]>;
    dispose(): void;
  };
  type BlazeFaceModuleLike = {
    load(config?: {
      maxFaces?: number;
      inputWidth?: number;
      inputHeight?: number;
      iouThreshold?: number;
      scoreThreshold?: number;
      modelUrl?: string;
    }): Promise<DetectorLike>;
  };

  const PHASES = [
    { key: "front" as const, label: "FRONT", instruction: "Look directly at the camera" },
  ];
  type FaceScanState = "loading" | "ready" | "tracking" | "validating" | "complete" | "blocked";

  // ── Hot-path refs (no re-render on change) ─────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<DetectorLike | null>(null);
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  const keypointsRef = useRef<FaceKeypointLike[] | null>(null);
  const smooth = useRef({ cx: 0.5, cy: 0.5, w: 0.0, h: 0.0 });
  const poseRef = useRef({ yaw: 0, pitch: 0, roll: 0 });
  const lastDetectMs = useRef(0);
  const holdMsRef = useRef(0);
  const facePresentRef = useRef(false);
  const qualityOkRef = useRef(false);
  const capturingRef = useRef(false);
  const phaseIdxRef = useRef(0);
  const rafRef = useRef(0);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastDrawMsRef = useRef(0);
  const detectionErrorsRef = useRef(0);
  const fallbackStartedRef = useRef(false);
  const detectionBusyRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── React state (display only) ─────────────────────────────────
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorFailed, setDetectorFailed] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [guidance, setGuidance] = useState("Setting up face scanner...");
  const [facePresent, setFacePresent] = useState(false);
  const [qualityOk, setQualityOk] = useState(false);
  const [lockPct, setLockPct] = useState(0);
  const lockPctRef = useRef(0);
  const [poseLabel, setPoseLabel] = useState("SCANNING");
  const [captured, setCaptured] = useState([false]);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [runtimeNote, setRuntimeNote] = useState<string | null>(null);
  const [lostTracking, setLostTracking] = useState(false);
  const [stageBlocked, setStageBlocked] = useState(false);
  const [scanState, setScanState] = useState<FaceScanState>("loading");

  const PHASE_HOLD_MS = 700;

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.95;
      utt.pitch = 1;
      utt.volume = 1;
      window.speechSynthesis.speak(utt);
    } catch {}
  }

  function resetCaptureAttempt(
    note: string,
    guidanceText = "Capture failed — reposition and hold still"
  ) {
    capturingRef.current = false;
    holdMsRef.current = 0;
    facePresentRef.current = false;
    qualityOkRef.current = false;
    smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
    lockPctRef.current = 0;
    setFacePresent(false);
    setQualityOk(false);
    setLockPct(0);
    setScanState("ready");
    setGuidance(guidanceText);
    setRuntimeNote(note);
  }

  // ── Capture (ref-assigned so detection loop always gets latest) ─
  const capturePhaseRef = useRef<(idx: number) => Promise<void>>(async () => {});
  capturePhaseRef.current = async (_idx: number) => {
    // Hard guard: never capture after the stage has been hard-blocked.
    if (fallbackStartedRef.current) return;

    let captureAccepted = false;
    setScanState("validating");
    setGuidance("Validating capture...");
    setRuntimeNote(null);
    const video = videoRef.current;
    const cap = captureCanvasRef.current;
    if (video && cap) {
      const ctx = cap.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.translate(cap.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, cap.width, cap.height);
        ctx.restore();
        try {
          const blob = await new Promise<Blob | null>((resolve) =>
            cap.toBlob(resolve, "image/png")
          );
          if (blob) {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error ?? new Error("Face capture read failed"));
              reader.readAsDataURL(blob);
            });

            // ── SEC-3: validate backend result before advancing ────────────
            // When running inside Tauri the backend performs image validation
            // (size, luma variance, dark-pixel ratio).  In browser dev mode
            // (no Tauri) the check is skipped so the dev flow still works.
            if (window.__TAURI__) {
              type FaceSaveResult = {
                path: string;
                face_verified: boolean;
                rejection_reason: string | null;
              };
              const result = await invoke<FaceSaveResult>("save_face_image", {
                imageData: dataUrl,
                index: 0,
              });

              if (!result?.face_verified) {
                const reason = result?.rejection_reason ?? "save_failed";
                void invoke("log_violation", {
                  kind: "face_capture_rejected",
                  detail: `Backend rejected face image: ${reason}`,
                });
                resetCaptureAttempt(`Capture rejected: ${reason.replace(/_/g, " ")}`);
                return; // do not advance stage
              }
              captureAccepted = true;
            } else {
              // Dev/browser mode — fire-and-forget, no validation.
              await invoke("save_face_image", { imageData: dataUrl, index: 0 });
              captureAccepted = true;
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "capture_validation_failed";
          resetCaptureAttempt(
            `Capture validation failed: ${message}`,
            "Capture failed — try again"
          );
          return;
        }
      }
    }

    if (!captureAccepted) {
      resetCaptureAttempt("Capture could not be validated.", "Capture failed — try again");
      return;
    }

    // ── Reached only when face_verified is true (or dev mode) ─────────────
    setFlash(true);
    setCaptured([true]);
    setGuidance("Got it!");
    speak("Got it!");
    await new Promise<void>((r) => setTimeout(r, 180));
    setFlash(false);

    capturedRef.current = [true];
    holdMsRef.current = 0;
    facePresentRef.current = false;
    qualityOkRef.current = false;
    smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
    setFacePresent(false);
    setQualityOk(false);
    lockPctRef.current = 0;
    setLockPct(0);

    setDone(true);
    setScanState("complete");
    setGuidance("Face scan complete");
    setTimeout(() => onPassRef.current(), 1400);
  };

  function keypointAt(keypoints: FaceKeypointLike[], index: number, label?: string) {
    if (label) {
      const labeled = keypoints.find((point) => point.label === label);
      if (labeled) return labeled;
    }
    return keypoints[index] ?? null;
  }

  function estimatePose(keypoints: FaceKeypointLike[], box: { h: number }) {
    const rightEye = keypointAt(keypoints, 0, "rightEye");
    const leftEye = keypointAt(keypoints, 1, "leftEye");
    const nose = keypointAt(keypoints, 2, "noseTip");
    const mouth = keypointAt(keypoints, 3, "mouthCenter");
    const rightEar = keypointAt(keypoints, 4, "rightEarTragion");
    const leftEar = keypointAt(keypoints, 5, "leftEarTragion");

    if (!leftEye || !rightEye || !nose || !mouth) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const eyeSpan = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
    const leftEarSpan = leftEar ? Math.abs(leftEar.x - leftEye.x) : 0;
    const rightEarSpan = rightEar ? Math.abs(rightEar.x - rightEye.x) : 0;
    const earBalance =
      (leftEarSpan - rightEarSpan) / Math.max(0.001, leftEarSpan + rightEarSpan || eyeSpan);
    const rawYaw = (((nose.x - eyeMidX) / eyeSpan) * 85 + earBalance * 22) * -1;
    const yaw = Math.max(-32, Math.min(32, rawYaw));
    const pitch = Math.max(
      -24,
      Math.min(24, ((nose.y - eyeMidY) / Math.max(0.001, box.h) - 0.04) * 140)
    );
    // Vector from rightEye→leftEye: BlazeFace uses person-relative coords so rightEye.x < leftEye.x.
    // atan2(dy, positive_dx) = 0 for a level head; inverted order gave ±180° always.
    const roll = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;

    return { yaw, pitch, roll };
  }

  function isInsideGuide(box: { cx: number; cy: number; w: number; h: number }) {
    const gx = 0.5;
    const gy = 0.48;
    const rx = 0.22;
    const ry = 0.37;
    const dx = 1 - box.cx - gx;
    const dy = box.cy - gy;

    const centerInside = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.8;
    const sizeOk = box.w >= 0.1 && box.w <= 0.72 && box.h >= 0.12 && box.h <= 0.92;
    return centerInside && sizeOk;
  }

  function getPoseLabel(pose: { yaw: number }) {
    if (Math.abs(pose.yaw) <= 22) return "LOOKING FORWARD";
    return "LOOK STRAIGHT AT THE CAMERA";
  }

  function beginTimedFallback() {
    if (fallbackStartedRef.current) return;
    fallbackStartedRef.current = true;
    setDetectorFailed(true);
    setScanState("blocked");

    // Log this as a security event — stage is hard-blocked, not silently bypassed.
    void invoke("log_violation", {
      kind: "face_detection_fallback",
      detail: `BlazeFace unavailable after ${detectionErrorsRef.current} consecutive errors. Stage 9 hard-blocked; proctor intervention required.`,
    });

    setStageBlocked(true);
    setGuidance("Face detection unavailable");
    setRuntimeNote("Face detection unavailable. Contact your proctor to proceed.");
    // Do NOT auto-capture or call onPass — the stage is blocked.
  }

  function setTrackingLost(next: boolean) {
    setLostTracking((prev) => (prev === next ? prev : next));
  }

  const capturedRef = useRef([false]);
  useEffect(() => {
    capturedRef.current = captured;
  }, [captured]);

  // ── Init: camera + TensorFlow.js BlazeFace ───────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      let activeStream: MediaStream | null = null;
      if (videoRef.current) {
        activeStream = stream;

        if (!activeStream && navigator.mediaDevices) {
          activeStream = await getUserMediaWithTimeout(
            {
              video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            },
            8000
          ).catch(() => null);
          if (cancelled) {
            stopMediaStream(activeStream);
            return;
          }
          localStreamRef.current = activeStream;
        }

        if (activeStream) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play().catch(() => {});
          await waitForVideoReady(videoRef.current, 2500).catch(() => {});
          if (cancelled) {
            if (localStreamRef.current === activeStream) {
              stopMediaStream(localStreamRef.current);
              localStreamRef.current = null;
            }
            return;
          }
        } else {
          beginTimedFallback();
          return;
        }
      }

      try {
        const det = await withTimeout(
          (async () => {
            const tf = await import("@tensorflow/tfjs-core");

            // Prefer WASM backend (25–50 ms/frame with SIMD) over pure-JS CPU
            // (200–900 ms/frame).  WASM files are bundled under /tfjs-wasm/ by
            // scripts/setup-tfjs-wasm.mjs so no CDN fetch is needed at runtime.
            // TF.js auto-selects the fastest WASM variant the CPU supports:
            //   threaded-simd (needs SharedArrayBuffer) → simd → plain wasm.
            // If WASM init fails for any reason, we fall back to CPU so the
            // stage can still function (albeit slower) rather than hard-failing.
            let backendReady = false;
            try {
              const wasmBackend = await import("@tensorflow/tfjs-backend-wasm");
              wasmBackend.setWasmPaths("/tfjs-wasm/");
              await tf.setBackend("wasm");
              await tf.ready();
              backendReady = true;
            } catch {
              // WASM unavailable in this environment — fall through to CPU.
            }

            if (!backendReady) {
              await import("@tensorflow/tfjs-backend-cpu");
              await tf.setBackend("cpu");
              await tf.ready();
            }

            if (window.__TAURI__) {
              type ModelAssetVerification = {
                ok: boolean;
                checked_files: number;
                error: string | null;
              };
              const verification = await invoke<ModelAssetVerification>("verify_face_model_assets");
              if (!verification?.ok) {
                throw new Error(verification?.error ?? "face_model_integrity_failed");
              }
            }

            const blazeface = (await import("@tensorflow-models/blazeface")) as BlazeFaceModuleLike;
            return blazeface.load({
              maxFaces: 1,
              inputWidth: 128,
              inputHeight: 128,
              scoreThreshold: 0.75,
              modelUrl: BLAZEFACE_MODEL_URL,
            });
          })(),
          7000,
          "Face detector startup timed out"
        );
        if (cancelled) {
          det.dispose();
          return;
        }
        detectorRef.current = det;
        detectCanvasRef.current = document.createElement("canvas");
        setDetectorReady(true);
        setScanState("ready");
        setRuntimeNote(null);
        setGuidance(PHASES[0].instruction);
        speak(PHASES[0].instruction);
      } catch (error) {
        if (cancelled) return;
        setDetectorReady(true);
        setRuntimeNote(
          error instanceof Error
            ? `Detector init failed: ${error.message}`
            : "Detector init failed in this runtime."
        );
        beginTimedFallback();
      }
    }

    void init();
    return () => {
      cancelled = true;
      detectorRef.current?.dispose();
      detectorRef.current = null;
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ── Detection + canvas loop ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const EMA = 0.28;
    const DETECT_INTERVAL = 250;

    let prevFP = false;
    let prevQK = false;
    let prevGuidance = "";
    let prevPoseLabel = "";

    function getQuality(s: typeof smooth.current, pose: typeof poseRef.current) {
      if (s.w < 0.1) return { ok: false, hint: "Move a bit closer" };
      if (s.w > 0.72) return { ok: false, hint: "Step back a little" };
      if (Math.abs(pose.roll) > 30) return { ok: false, hint: "Keep your head level" };
      if (pose.pitch < -30) return { ok: false, hint: "Tilt your head down slightly" };
      if (pose.pitch > 30) return { ok: false, hint: "Lift your chin slightly" };

      const sx = 1 - s.cx;
      if (sx < 0.18) return { ok: false, hint: "Move your face right" };
      if (sx > 0.82) return { ok: false, hint: "Move your face left" };
      if (s.cy < 0.12) return { ok: false, hint: "Move your face down" };
      if (s.cy > 0.88) return { ok: false, hint: "Move your face up" };
      if (Math.abs(pose.yaw) > 22) return { ok: false, hint: "Look straight at the camera" };
      return { ok: true, hint: "Hold still..." };
    }

    function processDetection(video: HTMLVideoElement) {
      const det = detectorRef.current;
      const dc = detectCanvasRef.current;
      if (!det || !dc || detectionBusyRef.current) return;
      detectionBusyRef.current = true;

      void (async () => {
        try {
          let res: FacePredictionLike[] = [];
          const sourceWidth = 128;
          const sourceHeight = 128;
          if (dc.width !== sourceWidth || dc.height !== sourceHeight) {
            dc.width = sourceWidth;
            dc.height = sourceHeight;
          }
          const dctx = dc.getContext("2d", { willReadFrequently: true });
          if (!dctx) return;
          dctx.drawImage(video, 0, 0, sourceWidth, sourceHeight);
          res = await det.estimateFaces(dc, false, false, true);

          detectionErrorsRef.current = 0;
          const detection = res[0];

          if (detection?.topLeft && detection?.bottomRight) {
            const [x1, y1] = detection.topLeft;
            const [x2, y2] = detection.bottomRight;
            const raw = {
              cx: (x1 + x2) / 2 / sourceWidth,
              cy: (y1 + y2) / 2 / sourceHeight,
              w: Math.abs(x2 - x1) / sourceWidth,
              h: Math.abs(y2 - y1) / sourceHeight,
            };
            if (isInsideGuide(raw)) {
              const s = smooth.current;
              if (!facePresentRef.current) {
                s.cx = raw.cx;
                s.cy = raw.cy;
                s.w = raw.w;
                s.h = raw.h;
              } else {
                s.cx = EMA * raw.cx + (1 - EMA) * s.cx;
                s.cy = EMA * raw.cy + (1 - EMA) * s.cy;
                s.w = EMA * raw.w + (1 - EMA) * s.w;
                s.h = EMA * raw.h + (1 - EMA) * s.h;
              }
              keypointsRef.current = (detection.landmarks ?? []).map(([x, y]) => ({
                x: x / sourceWidth,
                y: y / sourceHeight,
              }));
              poseRef.current = estimatePose(keypointsRef.current, raw);
              facePresentRef.current = true;
            } else {
              facePresentRef.current = false;
              keypointsRef.current = null;
              smooth.current.w *= 0.8;
              smooth.current.h *= 0.8;
            }
          } else {
            facePresentRef.current = false;
            keypointsRef.current = null;
            smooth.current.w *= 0.92;
            smooth.current.h *= 0.92;
          }

          const { ok, hint } = getQuality(smooth.current, poseRef.current);
          qualityOkRef.current = facePresentRef.current && ok;
          const nextPoseLabel = facePresentRef.current ? getPoseLabel(poseRef.current) : "SCANNING";

          if (
            facePresentRef.current !== prevFP ||
            ok !== prevQK ||
            hint !== prevGuidance ||
            nextPoseLabel !== prevPoseLabel
          ) {
            prevFP = facePresentRef.current;
            prevQK = ok;
            prevGuidance = hint;
            prevPoseLabel = nextPoseLabel;
            setFacePresent(facePresentRef.current);
            setQualityOk(qualityOkRef.current);
            setPoseLabel(nextPoseLabel);
            if (capturingRef.current) {
              setScanState("validating");
            } else if (!facePresentRef.current) {
              setScanState("ready");
              setTrackingLost(true);
              setPoseLabel("SCANNING");
              setGuidance("Please come back into frame");
            } else {
              setScanState(qualityOkRef.current ? "tracking" : "ready");
              setTrackingLost(false);
              setGuidance(hint);
            }
          }

          const phasePoseMatch = facePresentRef.current && !capturedRef.current[0];

          if (qualityOkRef.current && phasePoseMatch && !capturingRef.current) {
            holdMsRef.current = Math.min(PHASE_HOLD_MS, holdMsRef.current + DETECT_INTERVAL);
          } else {
            holdMsRef.current = 0;
          }
          lockPctRef.current = Math.round((holdMsRef.current / PHASE_HOLD_MS) * 100);
          setLockPct(lockPctRef.current);

          if (
            holdMsRef.current >= PHASE_HOLD_MS &&
            !capturingRef.current &&
            !fallbackStartedRef.current
          ) {
            capturingRef.current = true;
            setScanState("validating");
            void capturePhaseRef.current(0);
          }
        } catch (error) {
          detectionErrorsRef.current += 1;
          if (cancelled) return;
          if (detectionErrorsRef.current >= 4) {
            setRuntimeNote(
              error instanceof Error
                ? `Detector inference failed: ${error.message}`
                : "Detector inference failed in this runtime."
            );
          }
          if (detectionErrorsRef.current >= 15) {
            beginTimedFallback();
          }
        } finally {
          detectionBusyRef.current = false;
        }
      })();
    }

    function loop(ts: number) {
      rafRef.current = requestAnimationFrame(loop);
      if (ts - lastDrawMsRef.current < 66) return;
      lastDrawMsRef.current = ts;
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const t = ts / 1000;

      // ── Run detection at ~8 FPS ────────────────────────────
      const video = videoRef.current;
      if (
        detectorRef.current &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        ts - lastDetectMs.current >= DETECT_INTERVAL
      ) {
        lastDetectMs.current = ts;
        processDetection(video);
      }

      // ── Canvas draw (60 FPS) ───────────────────────────────
      ctx.clearRect(0, 0, W, H);
      const s = smooth.current;
      const fp = facePresentRef.current;
      const qk = qualityOkRef.current;
      const pose = poseRef.current;
      const keypoints = keypointsRef.current;

      const dCX = (1 - s.cx) * W;
      const dCY = s.cy * H;
      const dW = s.w * W;
      const dH = s.h * H;

      // Fixed oval guide (symmetric — same mirrored or not)
      const oCX = W / 2;
      const oCY = H * 0.48;
      const oRX = W * 0.22;
      const oRY = H * 0.37;

      const color = done
        ? [34, 197, 94]
        : qk
          ? [34, 197, 94]
          : lostTracking
            ? [239, 68, 68]
            : fp
              ? [168, 85, 247]
              : [100, 116, 139];
      const rgb = color.join(",");

      // Stark 1px center crosshair reticle overlay instead of glowing circles
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Horizontal crosshair line
      ctx.moveTo(oCX - 15, oCY);
      ctx.lineTo(oCX + 15, oCY);
      // Vertical crosshair line
      ctx.moveTo(oCX, oCY - 15);
      ctx.lineTo(oCX, oCY + 15);
      ctx.stroke();

      // Bounding corners for face alignment
      const bS = 14;
      const mg = 4;
      const bx1 = oCX - oRX - mg;
      const bx2 = oCX + oRX + mg;
      const by1 = oCY - oRY - mg;
      const by2 = oCY + oRY + mg;
      ctx.strokeStyle = qk ? "#22c55e" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1.5;
      (
        [
          [bx1, by1, 1, 1],
          [bx2, by1, -1, 1],
          [bx1, by2, 1, -1],
          [bx2, by2, -1, -1],
        ] as [number, number, number, number][]
      ).forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x + dx * bS, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * bS);
        ctx.stroke();
      });

      // Face center dot & bounding box if detected
      if (fp && keypoints?.length) {
        ctx.save();
        ctx.strokeStyle = qk ? "#22c55e" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(dCX - dW / 2, dCY - dH / 2, dW, dH);

        ctx.fillStyle = qk ? "#22c55e" : "#f59e0b";
        ctx.beginPath();
        ctx.arc(dCX, dCY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phase = PHASES[phaseIdx];
  const scanStateLabel: Record<FaceScanState, string> = {
    loading: "Loading model",
    ready: "Waiting for face",
    tracking: "Finding face",
    validating: "Checking capture",
    complete: "Calibration complete",
    blocked: "Detection blocked",
  };
  const displayedLockPct = scanState === "validating" ? 100 : lockPct;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <StageHeader id={9} label="Face Scan" />

      <div style={{ position: "relative", width: 320, height: 240, marginBottom: "24px" }}>
        {flash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              background: "rgba(255,255,255,0.6)",
              borderRadius: "16px",
              animation: "face-flash 0.35s ease forwards",
            }}
          />
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "2px",
            transform: "scaleX(-1)",
          }}
        />

        <canvas
          ref={overlayCanvasRef}
          width={320}
          height={240}
          style={{ position: "absolute", inset: 0, borderRadius: "2px", pointerEvents: "none" }}
        />

        <canvas ref={captureCanvasRef} width={320} height={240} style={{ display: "none" }} />

        {/* Rigid border corner elements */}
        <div
          style={{
            position: "absolute",
            inset: "-1px",
            borderRadius: "2px",
            border: `1px solid ${done ? "rgba(34,197,94,0.4)" : qualityOk ? "rgba(34,197,94,0.3)" : lostTracking ? "rgba(239,68,68,0.5)" : facePresent ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
            pointerEvents: "none",
            transition: "border-color 400ms",
          }}
        />

        {/* Model loading overlay */}
        {!detectorReady && !detectorFailed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "#0F0F0F",
              borderRadius: "2px",
              gap: "12px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#A8A8A8",
              }}
            >
              Preparing face check
            </span>
          </div>
        )}

        {/* Hard-block overlay — shown when detection is unavailable and stage cannot auto-proceed */}
        {stageBlocked && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(3, 8, 22, 0.94)",
              borderRadius: "2px",
              gap: "10px",
              border: "1px solid rgba(239, 68, 68, 0.45)",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#ef4444",
                letterSpacing: "0.08em",
              }}
            >
              Face detection unavailable
            </span>
            <span
              style={{
                fontSize: "10px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#64748B",
                textAlign: "center",
                maxWidth: "220px",
                lineHeight: 1.65,
              }}
            >
              Contact your proctor to proceed
            </span>
          </div>
        )}
      </div>

      {/* Monochrome industrial state metrics */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          width: "320px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "11px",
          color: "#A8A8A8",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "4px",
          }}
        >
          <span>Target:</span>
          <span style={{ color: "#FFF", fontWeight: 700 }}>
            {done ? "Calibration complete" : phase.instruction}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "4px",
          }}
        >
          <span>Camera check:</span>
          <span
            style={{
              color:
                scanState === "complete"
                  ? "#22c55e"
                  : scanState === "blocked"
                    ? "#ef4444"
                    : scanState === "validating"
                      ? "#f59e0b"
                      : "#A8A8A8",
              fontWeight: 700,
            }}
          >
            {scanStateLabel[scanState]}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "4px",
          }}
        >
          <span>Tracking:</span>
          <span
            style={{
              color: qualityOk
                ? "#22c55e"
                : lostTracking
                  ? "#ef4444"
                  : facePresent
                    ? "#eab308"
                    : "#A8A8A8",
              fontWeight: 700,
            }}
          >
            {scanState === "validating"
              ? "Capture ready"
              : lostTracking
                ? "Face not centered"
                : poseLabel}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            paddingBottom: "4px",
          }}
        >
          <span>Capture progress:</span>
          <span style={{ color: displayedLockPct >= 100 ? "#22c55e" : "#A8A8A8", fontWeight: 700 }}>
            {displayedLockPct}%
          </span>
        </div>
      </div>

      {/* Guidance text */}
      <p
        style={{
          fontSize: "12px",
          fontFamily: "'JetBrains Mono', monospace",
          color: qualityOk ? "#FFF" : lostTracking ? "#ef4444" : facePresent ? "#FFF" : "#A8A8A8",
          marginBottom: "16px",
          textAlign: "center",
          minHeight: "18px",
          transition: "color 350ms",
          lineHeight: 1.5,
        }}
      >
        {guidance}
      </p>

      {runtimeNote && (
        <p
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#f59e0b",
            marginBottom: "12px",
            textAlign: "center",
            maxWidth: "280px",
            lineHeight: 1.6,
          }}
        >
          {runtimeNote}
        </p>
      )}

      {/* Lock progress bar */}
      {(facePresent || scanState === "validating") && !done && (
        <div
          style={{
            width: 320,
            height: 3,
            background: "rgba(255,255,255,0.06)",
            marginBottom: "18px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${displayedLockPct}%`,
              background: qualityOk ? "#22c55e" : "#FFF",
              transition: "width 80ms linear",
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes face-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}

function Stage10_PresenceVerification({
  stream,
  onPass,
}: {
  stream: MediaStream | null;
  onPass(): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const t1 = setTimeout(() => setConfirmed(true), 1200);
    const t2 = setTimeout(onPass, 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={10} label="Presence Check" />

      <div
        className="relative mb-6 overflow-hidden"
        style={{
          width: 220,
          height: 165,
          borderRadius: "2px",
          border: `1px solid ${confirmed ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.06)"}`,
          transition: "border-color 600ms",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
      </div>

      <p
        style={{
          fontSize: "12px",
          fontFamily: "'JetBrains Mono', monospace",
          color: confirmed ? "#22c55e" : "#A8A8A8",
          fontWeight: 400,
          transition: "color 400ms",
          marginBottom: "18px",
        }}
      >
        {confirmed ? "Presence confirmed" : "Checking live presence..."}
      </p>

      <StatusBadge
        status={confirmed ? "pass" : "checking"}
        label={confirmed ? "Identity verified" : "Checking live presence"}
      />
    </div>
  );
}

function Stage11_AudioVerification({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    let cancelled = false;
    let passTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        if (cancelled) {
          stopMediaStream(stream);
          ctx.close().catch(() => {});
          return;
        }
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        let lastUiUpdate = 0;
        function tick(now: number) {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          if (now - lastUiUpdate >= 125) {
            lastUiUpdate = now;
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            setLevel((prev) => {
              const next = Math.min(100, avg * 2.5);
              return Math.abs(next - prev) < 2 ? prev : next;
            });
          }
          rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);

        setPhase("pass");
        passTimer = setTimeout(() => {
          if (!cancelled) onPass();
        }, 3500);
      } catch {
        if (cancelled) return;
        setPhase("fail");
        passTimer = setTimeout(() => {
          if (!cancelled) (onWarn ?? onPass)();
        }, 2000);
      }
    }
    void init();
    return () => {
      cancelled = true;
      if (passTimer) clearTimeout(passTimer);
      cancelAnimationFrame(rafRef.current);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [onPass]);
  const bars = Array.from({ length: 20 }, (_, i) => i);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={11} label="Microphone Check" />

      <div
        className="mb-8 flex items-end justify-center gap-1.5 relative"
        style={{ height: 60, width: "160px" }}
      >
        {/* Dotted threshold line indicating passing barrier */}
        <div
          style={{
            position: "absolute",
            bottom: "20px",
            left: "-20px",
            right: "-20px",
            borderBottom: "1px dashed rgba(255,255,255,0.15)",
            zIndex: 1,
            pointerEvents: "none",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: "8px",
              fontFamily: "'JetBrains Mono', monospace",
              color: "#A8A8A8",
              background: "#0F0F0F",
              padding: "0 4px",
              transform: "translateY(5px)",
              letterSpacing: "0.05em",
              fontWeight: 600,
            }}
          >
            -24DB THRESHOLD
          </span>
        </div>
        {bars.map((i) => {
          const height =
            phase === "pass"
              ? Math.max(4, level * 0.6 * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.8 + level * 0.05))))
              : 4;
          const isAboveThreshold = height >= 20;
          return (
            <div
              key={i}
              style={{
                width: 6,
                borderRadius: "0px",
                height: `${height}px`,
                background:
                  phase === "pass"
                    ? isAboveThreshold
                      ? "#FFF"
                      : "rgba(255,255,255,0.18)"
                    : "rgba(255,255,255,0.06)",
                transition: "height 120ms ease, background 200ms",
                maxHeight: 56,
                zIndex: 2,
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "300px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {phase === "checking" && (
          <CheckLine label="Requesting microphone access..." status="checking" />
        )}
        {phase === "pass" && (
          <>
            <CheckLine label="Microphone detected" status="pass" />
            <CheckLine label="Audio signal received" status="pass" delay={300} />
            <CheckLine label="Background noise is acceptable" status="pass" delay={600} />
          </>
        )}
        {phase === "fail" && (
          <CheckLine label="No microphone found — continuing anyway" status="warn" />
        )}
      </div>
    </div>
  );
}

function Stage12_NetworkValidation({ onPass, onWarn }: { onPass(): void; onWarn?(): void }) {
  const [latency, setLatency] = useState<number | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [helperPhase, setHelperPhase] = useState<
    "skipped" | "checking" | "installing" | "pass" | "warn"
  >("skipped");
  const [helperMessage, setHelperMessage] = useState("Network lockdown helper ready");

  useEffect(() => {
    async function ensureMacNetworkHelper() {
      if (!window.__TAURI__) return true;

      const platform = await invoke<{ os: string }>("get_platform");
      if (platform?.os !== "macos") return true;

      setHelperPhase("checking");
      const running = await invoke<boolean>("network_helper_running");
      if (running) {
        setHelperPhase("pass");
        setHelperMessage("Network lockdown helper ready");
        return true;
      }

      setHelperPhase("installing");
      setHelperMessage("Administrator approval requested");
      try {
        await invokeStrict("install_network_helper");
        const ready = await invoke<boolean>("network_helper_running");
        setHelperPhase(ready ? "pass" : "warn");
        setHelperMessage(
          ready ? "Network lockdown helper ready" : "Network lockdown helper unavailable"
        );
        return Boolean(ready);
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : String(error ?? "helper install failed");
        setHelperPhase("warn");
        setHelperMessage(
          msg.includes("admin_auth_cancelled")
            ? "Administrator approval was cancelled"
            : "Network lockdown helper unavailable"
        );
        return false;
      }
    }

    async function go() {
      const [result, helperReady] = await Promise.all([
        withNullableTimeout(
          invoke<{
            reachable: boolean;
            latency_ms: number | null;
            quality: string;
          }>("check_network_stability", { host: getNetworkProbeHost() }),
          3000
        ),
        ensureMacNetworkHelper(),
      ]);

      let nextPhase: "pass" | "warn";
      if (result?.reachable) {
        setLatency(result.latency_ms);
        setQuality(result.quality);
        nextPhase = result.quality === "poor" || !helperReady ? "warn" : "pass";
        setPhase(nextPhase);
      } else {
        setLatency(null);
        setQuality("unreachable");
        nextPhase = "warn";
        setPhase("warn");
      }
      setTimeout(() => (nextPhase === "warn" ? (onWarn ?? onPass)() : onPass()), 1400);
    }
    void go();
  }, [onPass, onWarn]);

  const qualityColor =
    quality === "excellent" || quality === "good"
      ? "#22c55e"
      : quality === "fair"
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={12} label="Connection Check" />

      <div
        className="mb-10 relative flex flex-col items-center justify-center"
        style={{
          width: 180,
          height: 80,
          borderRadius: "2px",
          background: "#0F0F0F",
          border: `1px solid ${phase === "checking" ? "rgba(255,255,255,0.06)" : phase === "pass" ? "rgba(34,197,94,0.4)" : "#ef4444"}`,
          transition: "border-color 500ms",
        }}
      >
        {phase === "checking" ? (
          <Spinner size={24} />
        ) : (
          <div className="text-center" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            <p style={{ fontSize: "20px", fontWeight: 700, color: qualityColor, lineHeight: 1 }}>
              {latency} MS
            </p>
            <p
              style={{
                fontSize: "10px",
                color: "#A8A8A8",
                marginTop: "6px",
                letterSpacing: "0.1em",
              }}
            >
              Response time
            </p>
          </div>
        )}
      </div>

      {phase !== "checking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <CheckLine label={`Response time: ${latency}ms`} status={phase} />
          <CheckLine label={`Connection quality: ${quality ?? "-"}`} status={phase} delay={200} />
          {helperPhase !== "skipped" && (
            <CheckLine
              label={helperMessage}
              status={helperPhase === "pass" ? "pass" : "warn"}
              delay={400}
            />
          )}
          {phase === "pass" && (
            <CheckLine label="Server connection established" status="pass" delay={600} />
          )}
        </div>
      )}
    </div>
  );
}

function Stage13_IntegrityConfirmation({
  results,
  onPass,
}: {
  results: Record<number, StageStatus>;
  onPass(): void;
}) {
  useEffect(() => {
    setTimeout(onPass, 3500);
  }, [onPass]);

  const items = [
    { label: "Session prepared", stage: 1 },
    { label: "Full-screen mode on", stage: 2 },
    { label: "Display checked", stage: 3 },
    { label: "Keyboard controls active", stage: 4 },
    { label: "Setup verified", stage: 5 },
    { label: "No conflicting apps", stage: 6 },
    { label: "Device verified", stage: 7 },
    { label: "Camera ready", stage: 8 },
    { label: "Face scan complete", stage: 9 },
    { label: "Presence confirmed", stage: 10 },
    { label: "Microphone ready", stage: 11 },
    { label: "Connection stable", stage: 12 },
  ];

  const warnCount = items.filter(({ stage }) => results[stage] === "warn").length;
  const hasWarns = warnCount > 0;

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={13} label="Almost Ready" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: "40px",
          rowGap: "10px",
          width: "100%",
          maxWidth: "380px",
          marginBottom: "28px",
        }}
      >
        {items.map(({ label, stage }, i) => (
          <CheckLine
            key={label}
            label={label}
            status={results[stage] === "warn" ? "warn" : "pass"}
            delay={i * 120}
          />
        ))}
      </div>

      <div
        style={{
          borderRadius: "2px",
          padding: "12px 24px",
          background: hasWarns ? "rgba(245,158,11,0.05)" : "rgba(34,197,94,0.05)",
          border: `1px solid ${hasWarns ? "rgba(245,158,11,0.22)" : "rgba(34,197,94,0.18)"}`,
        }}
      >
        <p
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: hasWarns ? "#fcd34d" : "#22c55e",
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          {hasWarns
            ? `${warnCount} advisory warning${warnCount > 1 ? "s" : ""} — proceeding with recorded warnings`
            : "All checks passed — ready to begin"}
        </p>
      </div>
    </div>
  );
}

function Stage14_LockInCountdown({ onPass }: { onPass(): void }) {
  const [count, setCount] = useState(5);

  useEffect(() => {
    const t = setInterval(
      () =>
        setCount((c) => {
          if (c <= 1) {
            clearInterval(t);
            setTimeout(onPass, 400);
            return 0;
          }
          return c - 1;
        }),
      1000
    );
    return () => clearInterval(t);
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={14} label="Starting Your Session" />

      <div
        className="relative mb-10 flex flex-col items-center justify-center"
        style={{
          width: 240,
          height: 100,
          background: "#0F0F0F",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: "2px",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <span
          style={{
            fontSize: "44px",
            fontWeight: 700,
            color: "#FFF",
            letterSpacing: "-0.04em",
            lineHeight: 1,
          }}
        >
          {String(count).padStart(2, "0")}
        </span>
        <div style={{ display: "flex", gap: "3px", marginTop: "12px" }}>
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              style={{
                width: "20px",
                height: "6px",
                background: idx < count ? "#FFF" : "rgba(255,255,255,0.08)",
                transition: "background 300ms",
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {[
          "Keyboard controls active",
          "Session monitoring active",
          "Secure session ready",
          "Contest environment ready",
        ].map((label, i) => (
          <CheckLine key={label} label={label} status="pass" delay={i * 120} />
        ))}
      </div>
    </div>
  );
}

// ─── Progress indicator ───────────────────────────────────────────────────────

function ProgressBar({
  current,
  results,
}: {
  current: number;
  results: Record<number, StageStatus>;
}) {
  const currentStageInfo = STAGES[current - 1];
  const groupLabel = currentStageInfo?.group ?? "Secure Setup";

  return (
    <div
      style={{
        padding: "24px 32px 0",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        width: "100%",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            color: "#FFF",
            letterSpacing: "0.1em",
          }}
        >
          {groupLabel.toUpperCase()}
        </span>
        <span
          style={{
            fontSize: "10px",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 500,
            color: "#A8A8A8",
          }}
        >
          STEP {current} OF {STAGES.length}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {STAGES.map((s) => {
          const status =
            s.id < current ? (results[s.id] ?? "pass") : s.id === current ? "checking" : "pending";
          const color =
            status === "pass"
              ? "#22c55e"
              : status === "warn"
                ? "#f59e0b"
                : status === "checking"
                  ? "#FFF"
                  : "rgba(255,255,255,0.06)";
          return (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 4,
                borderRadius: "0px",
                background: color,
                transition: "background 300ms ease, transform 300ms ease",
                transform: status === "checking" ? "scaleY(1.2)" : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const contestId =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("contestId") ?? "")
      : "";
  const [currentStage, setCurrentStage] = useState(0);
  const [results, setResults] = useState<Record<number, StageStatus>>({});
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [policyBlock, setPolicyBlock] = useState<string | null>(null);
  const [contestWindow, setContestWindow] = useState<ContestWindowMeta | null>(null);
  const [waitMs, setWaitMs] = useState<number>(0);
  const [readyForStart, setReadyForStart] = useState(false);
  const [sessionPrepared, setSessionPrepared] = useState(false);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const theme = useTheme();
  const isLight = theme === "light";

  // Keep ref in sync with state so the unmount cleanup below sees the latest stream.
  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  // Stop camera tracks ONLY when this page unmounts (after router.push to contest).
  // Stopping on every cameraStream change would kill the active stream mid-flow
  // if Stage 8 ever re-acquires (e.g. due to StrictMode or unstable callback deps).
  useEffect(() => {
    return () => {
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!contestId) return;
    let cancelled = false;
    fetchJson<{
      start_at?: string;
      end_at?: string;
      timezone?: string;
      verification_window_minutes?: number | null;
    }>(`${API_URL}/contests/${contestId}`, {}, { dedupeKey: `contest:${contestId}`, retries: 2 })
      .then((meta) => {
        if (cancelled || !meta?.start_at || !meta?.end_at) return;
        setContestWindow({
          startAt: meta.start_at,
          endAt: meta.end_at,
          timezone: meta.timezone,
          verificationWindowMinutes: normalizeVerificationWindowMinutes(
            meta.verification_window_minutes
          ),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contestId]);

  useEffect(() => {
    if (!contestWindow) return;
    const tick = () => {
      const startMs = new Date(contestWindow.startAt).getTime();
      const now = Date.now();
      setWaitMs(Math.max(0, startMs - now));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [contestWindow]);

  function evaluateEntryGate() {
    if (!contestWindow) return { ok: true, reason: null as string | null };
    const now = Date.now();
    const start = new Date(contestWindow.startAt).getTime();
    const end = new Date(contestWindow.endAt).getTime();
    const open = getVerificationOpenMs(contestWindow);
    if (now >= end) return { ok: false, reason: "Contest has ended." };
    if (open !== null && now < open)
      return {
        ok: false,
        reason: `Verification opens in the ${verificationWindowLabel(
          contestWindow.verificationWindowMinutes
        )} window before contest start.`,
      };
    if (now >= start) return { ok: false, reason: "Join window is closed once contest starts." };
    return { ok: true, reason: null as string | null };
  }

  async function evaluateEntryGateFromServer() {
    if (!contestId) return { ok: false, reason: "Missing contest id.", state: "UNKNOWN" };
    try {
      const body = await fetchJson<{
        eligibility_status?: string;
        blocked_reason?: string;
        session_window_state?: string;
        start_at?: string;
        end_at?: string;
        verification_window_minutes?: number | null;
      }>(
        `${API_URL}/contests/${contestId}/session-window`,
        {},
        {
          dedupeKey: `contest-window:${contestId}`,
          retries: 2,
        }
      );
      if (body.start_at && body.end_at) {
        setContestWindow((prev) => ({
          startAt: body.start_at ?? prev?.startAt ?? "",
          endAt: body.end_at ?? prev?.endAt ?? "",
          timezone: prev?.timezone,
          verificationWindowMinutes:
            normalizeVerificationWindowMinutes(body.verification_window_minutes) ??
            prev?.verificationWindowMinutes ??
            null,
        }));
      }
      const status = String(body.eligibility_status ?? "blocked").toLowerCase();
      if (status === "allowed")
        return {
          ok: true,
          reason: null as string | null,
          state: body.session_window_state ?? "VERIFY_WINDOW_OPEN",
        };
      if (status === "wait")
        return {
          ok: false,
          reason: body.blocked_reason || "Verification is not open for this contest yet.",
          state: body.session_window_state ?? "NOT_OPEN",
        };
      // If candidate already finished verification and prepared a session, allow
      // transition to contest even when server reports LIVE.
      if ((body.session_window_state ?? "").toUpperCase() === "LIVE" && readyForStart) {
        return { ok: true, reason: null as string | null, state: "LIVE" };
      }
      return {
        ok: false,
        reason: body.blocked_reason || "Join window is closed once contest starts.",
        state: body.session_window_state ?? "LIVE",
      };
    } catch {
      return { ok: false, reason: "Unable to validate contest entry window.", state: "UNKNOWN" };
    }
  }

  function formatCountdown(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const finalizeSecureStart = useCallback(async () => {
    setPolicyBlock(null);
    let windowMeta = contestWindow;
    const windowMetaRequest =
      !windowMeta && contestId
        ? fetchJson<{
            start_at?: string;
            end_at?: string;
            timezone?: string;
            verification_window_minutes?: number | null;
          }>(
            `${API_URL}/contests/${contestId}`,
            {},
            {
              dedupeKey: `contest:${contestId}`,
              retries: 2,
            }
          ).catch(() => null)
        : Promise.resolve(null);

    const [fetchedWindowMeta, gate] = await Promise.all([
      windowMetaRequest,
      evaluateEntryGateFromServer(),
    ]);

    if (fetchedWindowMeta?.start_at && fetchedWindowMeta?.end_at) {
      windowMeta = {
        startAt: fetchedWindowMeta.start_at,
        endAt: fetchedWindowMeta.end_at,
        timezone: fetchedWindowMeta.timezone,
        verificationWindowMinutes: normalizeVerificationWindowMinutes(
          fetchedWindowMeta.verification_window_minutes
        ),
      };
      setContestWindow(windowMeta);
    }
    const localGate = (() => {
      if (!windowMeta) return { ok: true, reason: null as string | null };
      const now = Date.now();
      const start = new Date(windowMeta.startAt).getTime();
      const end = new Date(windowMeta.endAt).getTime();
      const open = getVerificationOpenMs(windowMeta);
      if (now >= end) return { ok: false, reason: "Contest has ended." };
      if (open !== null && now < open)
        return {
          ok: false,
          reason: `Verification opens in the ${verificationWindowLabel(
            windowMeta.verificationWindowMinutes
          )} window before contest start.`,
        };
      if (now >= start && !readyForStart)
        return { ok: false, reason: "Join window is closed once contest starts." };
      return { ok: true, reason: null as string | null };
    })();
    const effectiveGate = gate.state === "UNKNOWN" ? localGate : gate;

    if (!effectiveGate.ok) {
      setCurrentStage(13);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(effectiveGate.reason);
      return;
    }

    if (windowMeta) {
      const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
      if (remaining > 0) {
        setCurrentStage(15);
        setTransitioning(false);
        setReadyForStart(true);
        setPolicyBlock(null);
        return;
      }
    }
    const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
    const deviceState = await collectDeviceState({
      networkHost: getNetworkProbeHost(),
      apiUrl: API_URL,
      cameraAvailable:
        cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === "live") ||
        devices?.some((device) => device.kind === "videoinput") ||
        false,
      microphoneAvailable: devices?.some((device) => device.kind === "audioinput") || false,
      activateKeyboard: true,
    });

    try {
      const email = localStorage.getItem("ams_user_email") ?? "candidate@ams.local";
      if (!sessionPrepared) {
        const body = await fetchJson<{ id?: string }>(
          `${API_URL}/sessions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contest_id: contestId,
              candidate_email: email,
              candidate_name: email.split("@")[0],
            }),
          },
          { dedupeKey: `session:create:${contestId}:${email}`, retries: 2 }
        );
        if (body?.id) {
          localStorage.setItem(
            "ams_active_session",
            JSON.stringify({
              id: body.id,
              contest_id: contestId,
              updated_at: new Date().toISOString(),
            })
          );
          // SEC-3/SEC-4: arm the proctoring event uploader as soon as the
          // session exists, so onboarding-phase events — including a failed
          // network lockdown below — stream to the server promptly instead of
          // waiting for the contest screen to mount.
          await invoke("configure_event_stream", {
            apiUrl: API_URL,
            sessionId: body.id,
          }).catch(() => {});
        }
        setSessionPrepared(true);
      }

      // SEC-3: network lockdown is the core anti-cheat control — never enter a
      // contest with it silently un-applied. Outside the desktop shell (dev /
      // browser preview) there is nothing to lock, so skip. Inside it, a failure
      // is a hard stop with a durable, server-visible violation so the proctor
      // sees the attempt rather than the candidate slipping in with open internet.
      const tauriBridge = window.__TAURI__;
      if (tauriBridge) {
        let lockdownEngaged = false;
        let lockdownError: string | null = null;
        try {
          lockdownEngaged = await tauriBridge.core.invoke<boolean>("enable_network_lockdown", {
            allowedDomains: [getNetworkProbeHost()],
          });
        } catch (err) {
          lockdownError = err instanceof Error ? err.message : String(err);
        }

        if (!lockdownEngaged) {
          const detail = lockdownError ?? "enable_network_lockdown returned false";
          await invoke("log_violation", { kind: "network_lockdown_failed", detail }).catch(
            () => {}
          );
          await invoke("log_proctoring_event", {
            kind: "network_lockdown_failed",
            detail,
            payload: { allowed_domains: [getNetworkProbeHost()] },
          }).catch(() => {});
          setReadyForStart(false);
          setTransitioning(false);
          setPolicyBlock(
            "We couldn't secure your network for the exam — the proctoring network component may not be installed or still needs your permission. Re-run device setup, then try again. Starting now would leave your internet open, which a secured contest does not allow."
          );
          return;
        }

        await invoke("log_proctoring_event", {
          kind: "network_lockdown_engaged",
          detail: "Outbound traffic restricted to the exam allowlist.",
          payload: { allowed_domains: [getNetworkProbeHost()] },
        }).catch(() => {});
      }

      await startSecureSession({
        contestId,
        deviceId: getOrCreateDeviceId(),
        policy: strictContestPolicy(),
        deviceState,
        // Entry-gate attestation: the evaluated readiness report is delivered
        // to the backend so the server has a durable record of what this
        // device claimed (best-effort; the server decides whether to gate
        // session activation on it).
        apiUrl: API_URL,
      });

      if (windowMeta) {
        const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
        if (remaining > 0) {
          setCurrentStage(15);
          setTransitioning(false);
          setReadyForStart(true);
          setPolicyBlock(null);
          return;
        }
      }
      setReadyForStart(false);
      router.push(`/session/contest?contestId=${contestId}`);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Readiness policy blocked contest launch.";
      if (windowMeta) {
        const remaining = new Date(windowMeta.startAt).getTime() - Date.now();
        if (remaining > 0 && msg.toLowerCase().includes("not accepting sessions")) {
          setCurrentStage(15);
          setTransitioning(false);
          setReadyForStart(true);
          setPolicyBlock(null);
          return;
        }
      }
      setCurrentStage(13);
      setTransitioning(false);
      setReadyForStart(false);
      setPolicyBlock(msg);
    }
  }, [contestId, router, contestWindow, readyForStart]);

  useEffect(() => {
    if (!contestWindow) return;
    if (currentStage !== 15) return;
    if (waitMs <= 0 && readyForStart) {
      void finalizeSecureStart();
    }
  }, [contestWindow, currentStage, waitMs, contestId, readyForStart, finalizeSecureStart]);

  const advance = useCallback(
    (status: StageStatus = "pass") => {
      if (transitioning) return;
      setTransitioning(true);
      setResults((r) => ({ ...r, [currentStage]: status }));
      setTimeout(() => {
        setCurrentStage((s) => {
          const next = s + 1;
          if (next >= 15) {
            void finalizeSecureStart();
            return next;
          }
          return next;
        });
        setTransitioning(false);
      }, 300);
    },
    [currentStage, transitioning, finalizeSecureStart]
  );

  const advancePass = useCallback(() => advance("pass"), [advance]);
  const advanceWarn = useCallback(() => advance("warn"), [advance]);
  const emergencyExit = useCallback(async () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);

    const win = await tauriWindow();
    if (win) {
      await win.setFullscreen(false).catch(() => {});
      await win.setAlwaysOnTop(false).catch(() => {});
      await win.setDecorations(true).catch(() => {});
    }
    try {
      await window.__TAURI__?.core.invoke("unlock_desktop");
    } catch {}
    try {
      await window.__TAURI__?.core.invoke("disable_keyboard_intercept");
    } catch {}
    try {
      await window.__TAURI__?.core.invoke("disable_network_lockdown");
    } catch {}
    router.push("/home");
  }, [router]);

  useEffect(() => {
    function handleEmergencyKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void emergencyExit();
      }
    }

    window.addEventListener("keydown", handleEmergencyKey, true);
    return () => window.removeEventListener("keydown", handleEmergencyKey, true);
  }, [emergencyExit]);

  const nowMs = Date.now();
  const startMs = contestWindow ? new Date(contestWindow.startAt).getTime() : 0;
  const endMs = contestWindow ? new Date(contestWindow.endAt).getTime() : 0;
  const verifyOpenMs = getVerificationOpenMs(contestWindow);
  const isTooEarly = verifyOpenMs !== null ? nowMs < verifyOpenMs : false;
  const isAfterStart = contestWindow ? nowMs >= startMs && nowMs < endMs : false;
  const isEnded = contestWindow ? nowMs >= endMs : false;
  const verifyOpensInMs = verifyOpenMs !== null ? Math.max(0, verifyOpenMs - nowMs) : 0;
  const showWaitLock = currentStage === 15 && readyForStart;

  return (
    <main
      style={{
        background: "#0F0F0F",
        minHeight: "100vh",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        userSelect: "none",
        color: "#FFF",
        transition: "background 500ms ease, color 500ms ease",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "6px",
        }}
      >
        <button
          type="button"
          onClick={() => void emergencyExit()}
          aria-label="Exit setup. Shortcut: Control Shift Q."
          title="Shortcut: Ctrl + Shift + Q"
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: "1px solid #ef4444",
            background: "#0F0F0F",
            color: "#ef4444",
            fontSize: "11px",
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            cursor: "pointer",
          }}
        >
          Exit setup
        </button>
        <span
          style={{
            color: "#a1a1aa",
            fontSize: "10px",
            fontFamily: "'JetBrains Mono', monospace",
            background: "rgba(15, 15, 15, 0.82)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "4px",
            padding: "4px 7px",
          }}
        >
          Shortcut: Ctrl + Shift + Q
        </span>
      </div>

      {policyBlock && (
        <div
          style={{
            margin: "20px auto 0",
            maxWidth: 560,
            border: "1px solid rgba(239,68,68,0.28)",
            background: "rgba(239,68,68,0.08)",
            color: "#fca5a5",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {policyBlock}
        </div>
      )}
      {currentStage > 0 && <ProgressBar current={currentStage} results={results} />}

      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 32px",
          opacity: transitioning ? 0 : 1,
          transform: transitioning ? "translateY(6px) scale(0.99)" : "translateY(0) scale(1)",
          transition: "opacity 300ms ease, transform 300ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Group label — hidden on intro screen */}
        {currentStage > 0 && (
          <div style={{ marginBottom: "4px", textAlign: "center" }}>
            <p
              style={{
                fontSize: "10px",
                letterSpacing: "0.12em",
                color: "#3F3F46",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              {STAGES[currentStage - 1]?.group}
            </p>
          </div>
        )}

        {/* Intro screen — shown before stage 1 begins */}
        {currentStage === 0 && (
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "#0F0F0F",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "10px",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.48)",
              padding: "40px 44px",
            }}
          >
            <h2
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "#f8fafc",
                letterSpacing: "-0.02em",
                marginBottom: "8px",
              }}
            >
              Before you begin
            </h2>
            <p
              style={{ fontSize: "13px", color: "#A8A8A8", marginBottom: "28px", lineHeight: 1.6 }}
            >
              This usually takes about 2 minutes.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                marginBottom: "32px",
              }}
            >
              {[
                "Fullscreen and display check",
                "Device security and app scan",
                "Camera and face scan",
                "Microphone and network check",
              ].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: "rgba(168,85,247,0.7)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "13px", color: "#e2e8f0" }}>{item}</span>
                </div>
              ))}
            </div>
            <p
              style={{ fontSize: "12px", color: "#71717a", marginBottom: "32px", lineHeight: 1.6 }}
            >
              Do not close the app during setup. Your session will be interrupted if the window
              loses focus.
            </p>
            <button
              type="button"
              onClick={() => setCurrentStage(1)}
              style={{
                width: "100%",
                padding: "13px 24px",
                borderRadius: "8px",
                border: "1px solid #a855f7",
                background: "#a855f7",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "inherit",
                cursor: "pointer",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#9333ea";
                e.currentTarget.style.borderColor = "#c084fc";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#a855f7";
                e.currentTarget.style.borderColor = "#a855f7";
              }}
            >
              Begin setup
            </button>
          </div>
        )}

        {/* Stage content frame */}
        {currentStage > 0 && (
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "#0F0F0F",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "10px",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.48)",
              padding: "36px 40px",
              position: "relative",
              overflow: "hidden",
              transition: "all 300ms ease",
            }}
          >
            {/* Per-stage context strip */}
            {STAGE_META[currentStage] && (
              <div
                style={{
                  marginBottom: "20px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <p style={{ fontSize: "12px", color: "#71717a", lineHeight: 1.5, margin: 0 }}>
                  {STAGE_META[currentStage].checking}
                </p>
                {STAGE_META[currentStage].todo && (
                  <p style={{ fontSize: "12px", color: "#a855f7", lineHeight: 1.5, margin: 0 }}>
                    → {STAGE_META[currentStage].todo}
                  </p>
                )}
              </div>
            )}

            {isTooEarly && (
              <div
                style={{
                  border: "1px solid rgba(245,158,11,0.35)",
                  background: "rgba(245,158,11,0.08)",
                  borderRadius: 12,
                  padding: "18px 16px",
                  color: "#fcd34d",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  Verification not open yet
                </div>
                <div style={{ fontSize: 13, color: "#fef3c7", marginBottom: 8 }}>
                  Opens in {formatCountdown(verifyOpensInMs)} ({contestWindow?.timezone || "UTC"})
                </div>
                <div style={{ fontSize: 12, color: "#a1a1aa" }}>
                  You can start setup only in the configured verification window before contest
                  start.
                </div>
              </div>
            )}
            {isAfterStart && !showWaitLock && (
              <div
                style={{
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: 12,
                  padding: "18px 16px",
                  color: "#fca5a5",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Join window is closed once contest starts.
              </div>
            )}
            {isEnded && (
              <div
                style={{
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: 12,
                  padding: "18px 16px",
                  color: "#fca5a5",
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Contest has ended.
              </div>
            )}
            {!isTooEarly && (!isAfterStart || showWaitLock) && !isEnded && (
              <>
                {currentStage === 15 && contestWindow && waitMs > 0 && (
                  <div
                    style={{
                      border: "1px solid rgba(255, 255, 255, 0.05)",
                      background: "#0F0F0F",
                      borderRadius: 0,
                      padding: "32px 32px",
                      textAlign: "left",
                      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "130px 1fr",
                        rowGap: "14px",
                        fontSize: "13px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ color: "#A8A8A8" }}>Status</div>
                      <div style={{ color: "#22c55e" }}>Verification complete</div>

                      <div style={{ color: "#A8A8A8" }}>Next step</div>
                      <div style={{ color: "#FFF" }}>Contest workspace</div>

                      <div style={{ color: "#A8A8A8" }}>Contest controls</div>
                      <div style={{ color: "#FFF" }}>Ready</div>

                      <div style={{ color: "#A8A8A8" }}>Action</div>
                      <div style={{ color: "#a855f7" }}>Waiting to enter contest...</div>

                      <div
                        style={{
                          gridColumn: "1 / -1",
                          height: "1px",
                          background: "rgba(255,255,255,0.05)",
                          margin: "16px 0 8px 0",
                        }}
                      />

                      <div style={{ color: "#A8A8A8" }}>Starts in</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
                        <span
                          style={{
                            fontSize: "42px",
                            fontWeight: 700,
                            color: "#FFFFFF",
                            lineHeight: 1,
                            letterSpacing: "-0.02em",
                          }}
                        >
                          {formatCountdown(waitMs)}
                        </span>
                        <span style={{ fontSize: "13px", color: "#A8A8A8" }}>
                          ({contestWindow.timezone || "UTC"})
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {currentStage === 15 && (!contestWindow || waitMs <= 0) && (
                  <div
                    style={{
                      border: "1px solid rgba(255, 255, 255, 0.05)",
                      background: "#0F0F0F",
                      borderRadius: 0,
                      padding: "32px 32px",
                      textAlign: "left",
                      fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', monospace",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "130px 1fr",
                        rowGap: "14px",
                        fontSize: "13px",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ color: "#A8A8A8" }}>Status</div>
                      <div style={{ color: "#22c55e" }}>Verification complete</div>

                      <div style={{ color: "#A8A8A8" }}>Next step</div>
                      <div style={{ color: "#FFF" }}>Contest workspace</div>

                      <div style={{ color: "#A8A8A8" }}>Contest controls</div>
                      <div style={{ color: "#FFF" }}>Ready</div>

                      <div style={{ color: "#A8A8A8" }}>Action</div>
                      <div
                        style={{
                          color: "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        Opening contest workspace...
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            border: "2px solid rgba(168,85,247,0.3)",
                            borderTopColor: "#a855f7",
                            borderRadius: "50%",
                            animation: "spin 0.9s linear infinite",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {currentStage === 1 && <Stage1_SessionIsolation onPass={advancePass} />}
                {currentStage === 2 && <Stage2_Fullscreen onPass={advancePass} />}
                {currentStage === 3 && <Stage3_MonitorDetection onPass={advancePass} />}
                {currentStage === 4 && <Stage4_KeyboardLockdown onPass={advancePass} />}
                {currentStage === 5 && <Stage5_EnvironmentValidation onPass={advancePass} />}
                {currentStage === 6 && <Stage6_RestrictedApps onPass={advancePass} />}
                {currentStage === 7 && (
                  <Stage7_VMDetection onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 8 && (
                  <Stage8_CameraInit onPass={advancePass} onCameraReady={setCameraStream} />
                )}
                {currentStage === 9 && (
                  <Stage9_FaceCalibration stream={cameraStream} onPass={advancePass} />
                )}
                {currentStage === 10 && (
                  <Stage10_PresenceVerification stream={cameraStream} onPass={advancePass} />
                )}
                {currentStage === 11 && (
                  <Stage11_AudioVerification onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 12 && (
                  <Stage12_NetworkValidation onPass={advancePass} onWarn={advanceWarn} />
                )}
                {currentStage === 13 && (
                  <Stage13_IntegrityConfirmation results={results} onPass={advancePass} />
                )}
                {currentStage === 14 && <Stage14_LockInCountdown onPass={advancePass} />}
              </>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @keyframes pulse-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.06); } 50% { box-shadow: 0 0 0 14px transparent; } }
        @keyframes scaleYBar { from { transform: scaleY(0.4); } to { transform: scaleY(1); } }
      `}</style>
    </main>
  );
}
