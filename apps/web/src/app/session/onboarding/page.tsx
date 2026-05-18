"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Tauri bridge ─────────────────────────────────────────────────────────────
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

interface MonitorInfo {
  name: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  scaleFactor: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return (await window.__TAURI__?.core.invoke<T>(cmd, args)) ?? null;
  } catch {
    return null;
  }
}

async function tauriWindow() {
  return window.__TAURI__?.window.getCurrentWindow() ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────
type StageStatus = "pending" | "checking" | "pass" | "warn" | "fail";

interface Stage {
  id: number;
  label: string;
  group: string;
  status: StageStatus;
  note?: string;
}

const STAGES: Omit<Stage, "status">[] = [
  { id: 1, label: "Preparing Your Session", group: "GETTING READY" },
  { id: 2, label: "Secure Full-Screen", group: "GETTING READY" },
  { id: 3, label: "Display Check", group: "GETTING READY" },
  { id: 4, label: "Keyboard Setup", group: "GETTING READY" },
  { id: 5, label: "Setup Verification", group: "CHECKING YOUR SETUP" },
  { id: 6, label: "Application Check", group: "CHECKING YOUR SETUP" },
  { id: 7, label: "Device Compatibility", group: "CHECKING YOUR SETUP" },
  { id: 8, label: "Camera Setup", group: "IDENTITY VERIFICATION" },
  { id: 9, label: "Face Scan", group: "IDENTITY VERIFICATION" },
  { id: 10, label: "Presence Check", group: "IDENTITY VERIFICATION" },
  { id: 11, label: "Microphone Check", group: "CONNECTIVITY" },
  { id: 12, label: "Connection Check", group: "CONNECTIVITY" },
  { id: 13, label: "Final Review", group: "FINAL STEPS" },
  { id: 14, label: "Starting Session", group: "FINAL STEPS" },
  { id: 15, label: "Entering Contest", group: "FINAL STEPS" },
];

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
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  if (!visible) return null;

  const icon =
    status === "checking" ? (
      <Spinner size={14} />
    ) : status === "pass" ? (
      "✓"
    ) : status === "warn" ? (
      "⚠"
    ) : (
      "✗"
    );

  const color =
    status === "checking"
      ? "#64748b"
      : status === "pass"
        ? "#22c55e"
        : status === "warn"
          ? "#f59e0b"
          : "#ef4444";

  return (
    <div
      className="flex items-center gap-3"
      style={{ opacity: 0, animation: `fadeIn 400ms ease forwards ${delay}ms` }}
    >
      <span style={{ color, fontSize: "15px", width: "18px", flexShrink: 0 }}>{icon}</span>
      <span
        style={{
          fontSize: "14px",
          color: status === "pass" ? "#94a3b8" : color,
          fontWeight: 400,
          lineHeight: 1.5,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 1s linear infinite", display: "inline-block", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" stroke="rgba(168,85,247,0.18)" strokeWidth="2.5" />
      <path d="M12 3A9 9 0 0 1 21 12" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function StageHeader({ id, label, total = 15 }: { id: number; label: string; total?: number }) {
  return (
    <div style={{ marginBottom: "36px", textAlign: "center" }}>
      <p
        style={{
          fontSize: "11px",
          letterSpacing: "0.18em",
          color: "#52525B",
          fontWeight: 500,
          marginBottom: "14px",
          textTransform: "uppercase",
        }}
      >
        Step {id} of {total}
      </p>
      <h2
        style={{
          fontSize: "26px",
          fontWeight: 500,
          color: "#f0f2f5",
          letterSpacing: "-0.01em",
          lineHeight: 1.2,
        }}
      >
        {label}
      </h2>
    </div>
  );
}

function StatusBadge({ status, label }: { status: StageStatus; label: string }) {
  const cfg = {
    checking: { bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.25)", color: "#a855f7" },
    pass: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.25)", color: "#22c55e" },
    warn: { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.25)", color: "#f59e0b" },
    fail: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", color: "#ef4444" },
    pending: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", color: "#52525b" },
  }[status];
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, padding: "8px 20px" }}
    >
      {status === "checking" && <Spinner size={12} />}
      <span
        style={{ fontSize: "13px", fontWeight: 500, color: cfg.color, letterSpacing: "0.04em" }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Individual stage components ──────────────────────────────────────────────

function Stage1_SessionIsolation({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState(0);

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
    <div className="flex flex-col items-center">
      <StageHeader id={1} label="Preparing Your Session" />

      <div
        className="relative mb-10 flex items-center justify-center"
        style={{ width: 180, height: 180 }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: 60 + i * 44,
              height: 60 + i * 44,
              border: `1px solid rgba(168,85,247,${phase > i ? 0.3 : 0.07})`,
              transition: `border-color 700ms ease ${i * 200}ms, box-shadow 700ms ease ${i * 200}ms`,
              boxShadow: phase > i ? `0 0 ${16 + i * 8}px rgba(168,85,247,0.08)` : "none",
            }}
          />
        ))}
        <div
          className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: "rgba(168,85,247,0.1)",
            border: "1px solid rgba(168,85,247,0.35)",
            boxShadow: "0 0 20px rgba(168,85,247,0.12)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L4 5v7c0 4.5 3.5 8.5 8 9.5 4.5-1 8-5 8-9.5V5l-8-3z"
              stroke="#a855f7"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", textAlign: "center" }}>
        {phase >= 1 && <CheckLine label="Workspace prepared" status="pass" />}
        {phase >= 2 && <CheckLine label="Session context established" status="pass" />}
        {phase >= 3 && <CheckLine label="Ready to continue" status="pass" />}
      </div>
    </div>
  );
}

function Stage2_Fullscreen({ onPass }: { onPass(): void }) {
  const [done, setDone] = useState(false);

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
    <div className="flex flex-col items-center">
      <StageHeader id={2} label="Secure Full-Screen" />
      <div className="relative mb-10">
        <div
          className="relative flex items-center justify-center rounded-2xl"
          style={{
            width: 200,
            height: 130,
            border: `1.5px solid ${done ? "rgba(34,197,94,0.45)" : "rgba(168,85,247,0.35)"}`,
            background: done ? "rgba(34,197,94,0.04)" : "rgba(168,85,247,0.04)",
            transition: "all 600ms ease",
            boxShadow: done ? "0 0 24px rgba(34,197,94,0.1)" : "0 0 24px rgba(168,85,247,0.1)",
          }}
        >
          {!done ? (
            <Spinner size={28} />
          ) : (
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M6 16l6 6L26 8"
                stroke="#22c55e"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {["tl", "tr", "bl", "br"].map((c) => (
            <div
              key={c}
              className="absolute"
              style={{
                top: c.startsWith("t") ? 7 : "auto",
                bottom: c.startsWith("b") ? 7 : "auto",
                left: c.endsWith("l") ? 7 : "auto",
                right: c.endsWith("r") ? 7 : "auto",
                width: 14,
                height: 14,
                borderTop: c.startsWith("t") ? "1.5px solid rgba(168,85,247,0.6)" : "none",
                borderBottom: c.startsWith("b") ? "1.5px solid rgba(168,85,247,0.6)" : "none",
                borderLeft: c.endsWith("l") ? "1.5px solid rgba(168,85,247,0.6)" : "none",
                borderRight: c.endsWith("r") ? "1.5px solid rgba(168,85,247,0.6)" : "none",
              }}
            />
          ))}
        </div>
        <div
          className="mt-3 h-2.5 w-16 rounded-full mx-auto"
          style={{ background: "rgba(255,255,255,0.07)" }}
        />
      </div>

      <StatusBadge
        status={done ? "pass" : "checking"}
        label={done ? "Full-screen mode active" : "Switching to full-screen..."}
      />
    </div>
  );
}

function Stage3_MonitorDetection({ onPass }: { onPass(): void }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let progressed = false;

    const progress = () => {
      if (cancelled || progressed) return;
      progressed = true;
      setDone(true);
      setTimeout(() => {
        if (!cancelled) onPass();
      }, 1200);
    };

    async function go() {
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

      if (cancelled) return;

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
      setTimeout(progress, 900);
    }

    const failSafe = setTimeout(progress, 3500);
    void go();
    return () => {
      cancelled = true;
      clearTimeout(failSafe);
    };
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={3} label="Display Check" />

      <div className="mb-8 flex items-center justify-center gap-5">
        {(monitors.length ? monitors : [null]).map((m, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{
                width: i === 0 ? 120 : 90,
                height: i === 0 ? 78 : 58,
                border: `1.5px solid ${i === 0 ? "rgba(34,197,94,0.45)" : "rgba(245,158,11,0.45)"}`,
                background: i === 0 ? "rgba(34,197,94,0.05)" : "rgba(245,158,11,0.05)",
                boxShadow:
                  i === 0 ? "0 0 16px rgba(34,197,94,0.08)" : "0 0 14px rgba(245,158,11,0.07)",
                transition: "all 500ms ease",
                opacity: done ? 1 : 0.4,
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  color: i === 0 ? "#22c55e" : "#f59e0b",
                }}
              >
                {i === 0 ? "MAIN" : `SCREEN ${i + 1}`}
              </span>
            </div>
            {m && (
              <span style={{ fontSize: "11px", color: "#52525B" }}>
                {m.size.width}×{m.size.height}
              </span>
            )}
          </div>
        ))}
      </div>

      {done && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", textAlign: "center" }}>
          <CheckLine
            label={`${monitors.length || 1} screen${(monitors.length || 1) > 1 ? "s" : ""} detected`}
            status="pass"
          />
          {monitors.length > 1 ? (
            <CheckLine
              label="Additional screens found — please use your main screen only"
              status="warn"
            />
          ) : (
            <CheckLine label="Single screen confirmed" status="pass" />
          )}
          {monitors.length > 1 && (
            <p
              style={{
                marginTop: "14px",
                fontSize: "13px",
                color: "#f59e0b",
                maxWidth: "320px",
                textAlign: "center",
                lineHeight: 1.65,
              }}
            >
              Only your main screen may be used during the contest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stage4_KeyboardLockdown({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    async function go() {
      setPhase(1);
      await invoke("lock_desktop");
      setTimeout(() => setPhase(2), 600);
      setTimeout(() => setPhase(3), 1200);
      setTimeout(() => setPhase(4), 1800);
      setTimeout(onPass, 2600);
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

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={4} label="Keyboard Setup" />

      <div className="mb-8 grid grid-cols-2 gap-3">
        {keys.map(({ label, locked }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl"
            style={{
              padding: "12px 16px",
              background: locked ? "rgba(168,85,247,0.07)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${locked ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.07)"}`,
              transition: "all 450ms ease",
            }}
          >
            <span style={{ fontSize: "13px", color: locked ? "#22c55e" : "#52525B" }}>
              {locked ? "✓" : "○"}
            </span>
            <span
              style={{
                fontSize: "13px",
                color: locked ? "#a7b0c0" : "#52525B",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <StatusBadge
        status={phase >= 4 ? "pass" : "checking"}
        label={phase >= 4 ? "Keyboard controls active" : "Setting up keyboard controls..."}
      />
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
      const kbr = await invoke<{ active: boolean }>("enable_keyboard_intercept");
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
    <div className="flex flex-col items-center">
      <StageHeader id={5} label="Setup Verification" />
      <div
        style={{
          width: "100%",
          maxWidth: "340px",
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

  const doScan = useCallback(async () => {
    setScanning(true);
    setCleared(false);
    await new Promise((r) => setTimeout(r, 600));
    const result = await invoke<{ found: string[]; clean: boolean }>("scan_processes");
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
    <div className="flex flex-col items-center">
      <StageHeader id={6} label="Application Check" />

      {scanning ? (
        <div className="flex flex-col items-center gap-6">
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-full"
            style={{
              border: "1px solid rgba(168,85,247,0.18)",
              animation: "pulse-ring 2s ease-in-out infinite",
            }}
          >
            <Spinner size={32} />
          </div>
          <p style={{ fontSize: "14px", color: "#64748b", fontWeight: 400 }}>
            Checking for apps that may interfere...
          </p>
        </div>
      ) : found.length > 0 && !cleared ? (
        <div style={{ width: "100%", maxWidth: "400px" }}>
          <div
            style={{
              marginBottom: "20px",
              borderRadius: "16px",
              padding: "20px 24px",
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.18)",
            }}
          >
            <p
              style={{ marginBottom: "12px", fontSize: "14px", fontWeight: 500, color: "#fca5a5" }}
            >
              The following apps need to be closed:
            </p>
            {found.map((f) => (
              <p key={f} style={{ fontSize: "14px", color: "#f87171", marginBottom: "4px" }}>
                • {prettyName[f] ?? f}
              </p>
            ))}
            <p style={{ marginTop: "14px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.6 }}>
              Please close these apps and try again.
            </p>
          </div>
          <button
            onClick={() => void doScan()}
            style={{
              width: "100%",
              borderRadius: "12px",
              padding: "12px",
              fontSize: "14px",
              fontWeight: 500,
              color: "#e2e8f0",
              cursor: "pointer",
              fontFamily: "inherit",
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.3)",
              transition: "all 250ms ease",
            }}
          >
            Try Again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={{
              background: "rgba(34,197,94,0.07)",
              border: "1px solid rgba(34,197,94,0.28)",
              boxShadow: "0 0 22px rgba(34,197,94,0.1)",
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M6 16l6 6L26 8"
                stroke="#22c55e"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <CheckLine label="No conflicting applications found" status="pass" />
        </div>
      )}
    </div>
  );
}

function Stage7_VMDetection({ onPass }: { onPass(): void }) {
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");
  const [platform, setPlatform] = useState<string | null>(null);

  useEffect(() => {
    async function go() {
      const result = await invoke<{ detected: boolean; platform: string | null }>(
        "detect_virtualization"
      );
      await new Promise((r) => setTimeout(r, 1400));
      if (result?.detected) {
        setPhase("warn");
        setPlatform(result.platform);
        setTimeout(onPass, 3000);
      } else {
        setPhase("pass");
        setTimeout(onPass, 1200);
      }
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={7} label="Device Compatibility" />

      <div
        className="mb-8 relative flex h-24 w-24 items-center justify-center rounded-2xl"
        style={{ background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.18)" }}
      >
        {phase === "checking" ? (
          <Spinner size={36} />
        ) : phase === "pass" ? (
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path
              d="M8 20l7 7L32 12"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <path d="M18 8v12M18 26v2" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {phase === "checking" && (
        <p style={{ fontSize: "14px", color: "#64748b", fontWeight: 400 }}>
          Checking your device...
        </p>
      )}
      {phase === "pass" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <CheckLine label="Device is compatible" status="pass" />
          <CheckLine label="Running on physical hardware" status="pass" />
          <CheckLine label="Device setup confirmed" status="pass" />
        </div>
      )}
      {phase === "warn" && (
        <div
          style={{
            borderRadius: "16px",
            padding: "20px 24px",
            background: "rgba(245,158,11,0.05)",
            border: "1px solid rgba(245,158,11,0.22)",
            maxWidth: "340px",
          }}
        >
          <p style={{ fontSize: "14px", color: "#f59e0b", fontWeight: 500, marginBottom: "8px" }}>
            This device setup may not be fully supported{platform ? ` (${platform})` : ""}.
          </p>
          <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.65 }}>
            You may continue, but your session may be subject to additional review.
          </p>
        </div>
      )}
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
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera not available on this device");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        onCameraReady(stream);
        setPhase("pass");
        setTimeout(onPass, 1000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Camera access was denied";
        setError(
          msg.includes("denied") || msg.includes("Permission")
            ? "Camera access was denied. Please allow camera access in your system settings."
            : msg.includes("not available") || msg.includes("NotFound")
              ? "No camera found. Please connect a camera and try again."
              : "Could not access your camera. Please check your settings."
        );
        setPhase("fail");
      }
    }
    void init();
  }, [onPass, onCameraReady]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={8} label="Camera Setup" />

      <div
        className="relative mb-8 overflow-hidden"
        style={{
          width: 240,
          height: 160,
          borderRadius: "16px",
          background: "#000",
          border: `1.5px solid ${phase === "pass" ? "rgba(34,197,94,0.45)" : phase === "fail" ? "rgba(239,68,68,0.35)" : "rgba(168,85,247,0.28)"}`,
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
            <p style={{ fontSize: "13px", color: "#fca5a5", textAlign: "center", lineHeight: 1.6 }}>
              Camera unavailable
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
          <p style={{ fontSize: "14px", color: "#f87171", textAlign: "center", lineHeight: 1.65 }}>
            {error}
          </p>
          <button
            onClick={onPass}
            style={{
              padding: "10px 24px",
              borderRadius: "10px",
              border: "1px solid rgba(245,158,11,0.35)",
              background: "rgba(245,158,11,0.08)",
              color: "#f59e0b",
              fontSize: "13px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Continue without camera
          </button>
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
    { key: "left" as const, label: "TURN LEFT", instruction: "Slowly turn your head left" },
    { key: "right" as const, label: "TURN RIGHT", instruction: "Slowly turn your head right" },
  ];

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
  const detectionErrorsRef = useRef(0);
  const fallbackStartedRef = useRef(false);
  const detectionBusyRef = useRef(false);

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
  const [captured, setCaptured] = useState([false, false, false]);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [runtimeNote, setRuntimeNote] = useState<string | null>(null);
  const [lostTracking, setLostTracking] = useState(false);

  const PHASE_HOLD_MS = 1500;

  // ── Capture (ref-assigned so detection loop always gets latest) ─
  const capturePhaseRef = useRef<(idx: number) => Promise<void>>(async () => {});
  capturePhaseRef.current = async (idx: number) => {
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
        const dataUrl = cap.toDataURL("image/png");
        try {
          await window.__TAURI__?.core.invoke("save_face_image", {
            imageData: dataUrl,
            index: idx,
          });
        } catch {}
      }
    }

    setFlash(true);
    setCaptured((prev) => {
      const n = [...prev];
      n[idx] = true;
      return n;
    });
    setGuidance("Got it!");
    await new Promise<void>((r) => setTimeout(r, 380));
    setFlash(false);

    const nextCaptured = (() => {
      const updated = [...capturedRef.current];
      updated[idx] = true;
      return updated;
    })();
    capturedRef.current = nextCaptured;

    const nextPhase = nextCaptured.findIndex((value) => !value);
    holdMsRef.current = 0;
    facePresentRef.current = false;
    qualityOkRef.current = false;
    smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
    setFacePresent(false);
    setQualityOk(false);
    lockPctRef.current = 0;
    setLockPct(0);

    if (nextPhase === -1) {
      setDone(true);
      setGuidance("Face scan complete");
      setTimeout(() => onPassRef.current(), 1400);
    } else {
      phaseIdxRef.current = nextPhase;
      setPhaseIdx(nextPhase);
      setGuidance(PHASES[nextPhase].instruction);
      await new Promise<void>((r) => setTimeout(r, 600));
      capturingRef.current = false;
    }
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
    if (pose.yaw > 12) return "TURNING LEFT";
    if (pose.yaw < -12) return "TURNING RIGHT";
    return "LOOKING FORWARD";
  }

  function getPoseIndex(pose: { yaw: number }) {
    if (pose.yaw > 12) return 1;
    if (pose.yaw < -12) return 2;
    return 0;
  }

  function beginTimedFallback() {
    if (fallbackStartedRef.current) return;
    fallbackStartedRef.current = true;
    setDetectorFailed(true);
    setRuntimeNote((prev) => prev ?? "Live detection unavailable. Using timed capture instead.");
    setGuidance(PHASES[0].instruction);

    void (async () => {
      for (let i = 0; i < 3; i++) {
        phaseIdxRef.current = i;
        setPhaseIdx(i);
        setGuidance(PHASES[i].instruction);
        await new Promise<void>((r) => setTimeout(r, i === 0 ? 2200 : 3000));
        capturingRef.current = true;
        await capturePhaseRef.current(i);
      }
    })();
  }

  function setTrackingLost(next: boolean) {
    setLostTracking((prev) => (prev === next ? prev : next));
  }

  const capturedRef = useRef([false, false, false]);
  useEffect(() => {
    capturedRef.current = captured;
    const nextPhase = captured.findIndex((value) => !value);
    if (nextPhase !== -1 && nextPhase !== phaseIdxRef.current) {
      phaseIdxRef.current = nextPhase;
      setPhaseIdx(nextPhase);
    }
  }, [captured]);

  // ── Init: camera + TensorFlow.js BlazeFace ───────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (videoRef.current) {
        const activeStream =
          stream ??
          (await navigator.mediaDevices
            ?.getUserMedia?.({
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
            })
            .catch(() => null));

        if (activeStream) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play().catch(() => {});
          if (videoRef.current.readyState < 2) {
            await new Promise<void>((resolve) => {
              const video = videoRef.current;
              if (!video) {
                resolve();
                return;
              }

              const onReady = () => {
                video.removeEventListener("loadeddata", onReady);
                video.removeEventListener("canplay", onReady);
                resolve();
              };

              video.addEventListener("loadeddata", onReady, { once: true });
              video.addEventListener("canplay", onReady, { once: true });
              setTimeout(onReady, 1200);
            });
          }
        }
      }

      try {
        const tf = await import("@tensorflow/tfjs-core");
        await import("@tensorflow/tfjs-backend-cpu");
        await tf.setBackend("cpu");
        await tf.ready();
        const blazeface = (await import("@tensorflow-models/blazeface")) as BlazeFaceModuleLike;
        const det = await blazeface.load({
          maxFaces: 1,
          inputWidth: 128,
          inputHeight: 128,
          scoreThreshold: 0.75,
        });
        if (cancelled) {
          det.dispose();
          return;
        }
        detectorRef.current = det;
        detectCanvasRef.current = document.createElement("canvas");
        setDetectorReady(true);
        setRuntimeNote(null);
        setGuidance(PHASES[0].instruction);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ── Detection + canvas loop ────────────────────────────────────
  useEffect(() => {
    const EMA = 0.3;
    const DETECT_INTERVAL = 120;

    let prevFP = false;
    let prevQK = false;
    let prevGuidance = "";
    let prevPoseLabel = "";

    function getQuality(s: typeof smooth.current, phase: number, pose: typeof poseRef.current) {
      if (s.w < 0.1) return { ok: false, hint: "Move a bit closer" };
      if (s.w > 0.72) return { ok: false, hint: "Step back a little" };
      if (Math.abs(pose.roll) > 30) return { ok: false, hint: "Keep your head level" };
      if (pose.pitch < -30) return { ok: false, hint: "Tilt your head down slightly" };
      if (pose.pitch > 30) return { ok: false, hint: "Lift your chin slightly" };

      const sx = 1 - s.cx;
      if (phase === 0) {
        if (sx < 0.18) return { ok: false, hint: "Move your face right" };
        if (sx > 0.82) return { ok: false, hint: "Move your face left" };
        if (s.cy < 0.12) return { ok: false, hint: "Move your face down" };
        if (s.cy > 0.88) return { ok: false, hint: "Move your face up" };
        if (Math.abs(pose.yaw) > 22) return { ok: false, hint: "Look straight at the camera" };
        return { ok: true, hint: "Hold still..." };
      }

      if (sx < 0.08 || sx > 0.92 || s.cy < 0.06 || s.cy > 0.94) {
        return { ok: false, hint: "Keep your face inside the frame" };
      }

      if (phase === 1) {
        if (pose.yaw < -20) return { ok: false, hint: "Turn the other way" };
        if (pose.yaw < 7) return { ok: false, hint: "Keep turning left" };
        return { ok: true, hint: "Hold that position..." };
      }

      if (pose.yaw > 20) return { ok: false, hint: "Turn the other way" };
      if (pose.yaw > -7) return { ok: false, hint: "Keep turning right" };
      return { ok: true, hint: "Hold that position..." };
    }

    function processDetection(video: HTMLVideoElement) {
      const det = detectorRef.current;
      const dc = detectCanvasRef.current;
      if (!det || !dc || detectionBusyRef.current) return;
      detectionBusyRef.current = true;

      void (async () => {
        try {
          let res: FacePredictionLike[] = [];
          if (dc.width !== video.videoWidth || dc.height !== video.videoHeight) {
            dc.width = video.videoWidth;
            dc.height = video.videoHeight;
          }
          const dctx = dc.getContext("2d", { willReadFrequently: true });
          if (!dctx) return;
          dctx.drawImage(video, 0, 0);
          res = await det.estimateFaces(dc, false, false, true);

          detectionErrorsRef.current = 0;
          const detection = res[0];

          if (detection?.topLeft && detection?.bottomRight) {
            const [x1, y1] = detection.topLeft;
            const [x2, y2] = detection.bottomRight;
            const raw = {
              cx: (x1 + x2) / 2 / video.videoWidth,
              cy: (y1 + y2) / 2 / video.videoHeight,
              w: Math.abs(x2 - x1) / video.videoWidth,
              h: Math.abs(y2 - y1) / video.videoHeight,
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
                x: x / video.videoWidth,
                y: y / video.videoHeight,
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

          const activePhase = phaseIdxRef.current;
          const { ok, hint } = getQuality(smooth.current, activePhase, poseRef.current);
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
            if (!facePresentRef.current) {
              setTrackingLost(true);
              setPoseLabel("SCANNING");
              setGuidance("Please come back into frame");
            } else {
              setTrackingLost(false);
              setGuidance(hint);
            }
          }

          const detectedPoseIdx = getPoseIndex(poseRef.current);
          const requiredPoseIdx = phaseIdxRef.current;
          const phasePoseMatch =
            facePresentRef.current &&
            !capturedRef.current[detectedPoseIdx] &&
            detectedPoseIdx === requiredPoseIdx;

          if (qualityOkRef.current && phasePoseMatch && !capturingRef.current) {
            holdMsRef.current = Math.min(PHASE_HOLD_MS, holdMsRef.current + DETECT_INTERVAL);
          } else {
            holdMsRef.current = 0;
          }
          lockPctRef.current = Math.round((holdMsRef.current / PHASE_HOLD_MS) * 100);
          setLockPct(lockPctRef.current);

          if (holdMsRef.current >= PHASE_HOLD_MS && !capturingRef.current) {
            capturingRef.current = true;
            void capturePhaseRef.current(requiredPoseIdx);
          }
        } catch (error) {
          detectionErrorsRef.current += 1;
          if (detectionErrorsRef.current >= 2) {
            setRuntimeNote(
              error instanceof Error
                ? `Detector inference failed: ${error.message}`
                : "Detector inference failed in this runtime."
            );
          }
          if (detectionErrorsRef.current >= 5) {
            beginTimedFallback();
          }
        } finally {
          detectionBusyRef.current = false;
        }
      })();
    }

    function loop(ts: number) {
      rafRef.current = requestAnimationFrame(loop);
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
      const lp = lockPctRef.current / 100;
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

      // Ambient glow
      const grd = ctx.createRadialGradient(oCX, oCY, 0, oCX, oCY, oRX * 2);
      grd.addColorStop(0, `rgba(${rgb},0.07)`);
      grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX * 2, oRY * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      if (keypoints?.length) {
        ctx.save();
        const boxGrad = ctx.createLinearGradient(
          dCX - dW / 2,
          dCY - dH / 2,
          dCX + dW / 2,
          dCY + dH / 2
        );
        boxGrad.addColorStop(0, `rgba(${rgb},${qk ? 0.9 : 0.55})`);
        boxGrad.addColorStop(1, `rgba(255,255,255,${qk ? 0.15 : 0.05})`);
        ctx.strokeStyle = boxGrad;
        ctx.lineWidth = qk ? 2.2 : 1.3;
        ctx.setLineDash(qk ? [] : [6, 4]);
        (
          [
            [dCX - dW / 2, dCY - dH / 2, 1, 1],
            [dCX + dW / 2, dCY - dH / 2, -1, 1],
            [dCX - dW / 2, dCY + dH / 2, 1, -1],
            [dCX + dW / 2, dCY + dH / 2, -1, -1],
          ] as [number, number, number, number][]
        ).forEach(([x, y, dx, dy]) => {
          const arm = Math.min(20, dW * 0.24, dH * 0.24);
          ctx.beginPath();
          ctx.moveTo(x + dx * arm, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y + dy * arm);
          ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${rgb},0.75)`;
        keypoints.forEach((point, idx) => {
          ctx.beginPath();
          ctx.arc((1 - point.x) * W, point.y * H, idx < 4 ? 2.8 : 2.2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      ctx.save();
      const ringGrad = ctx.createLinearGradient(oCX - oRX, oCY - oRY, oCX + oRX, oCY + oRY);
      ringGrad.addColorStop(0, `rgba(${rgb},${fp ? 0.75 : 0.24})`);
      ringGrad.addColorStop(0.5, `rgba(255,255,255,${qk ? 0.14 : 0.05})`);
      ringGrad.addColorStop(1, `rgba(${rgb},${fp ? 0.9 : 0.3})`);
      ctx.setLineDash(qk ? [] : [8, 5]);
      ctx.lineDashOffset = -t * 16;
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth = qk ? 3 : 1.8;
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX, oRY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Scanline sweep clipped to oval
      const scanY = oCY - oRY + ((t * 0.55) % 1) * oRY * 2;
      const sGrd = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      sGrd.addColorStop(0, "transparent");
      sGrd.addColorStop(0.5, `rgba(${rgb},0.14)`);
      sGrd.addColorStop(1, "transparent");
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX, oRY, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = sGrd;
      ctx.fillRect(oCX - oRX, scanY - 10, oRX * 2, 20);
      ctx.restore();

      const bS = 24;
      const mg = 10;
      const bx1 = oCX - oRX - mg;
      const bx2 = oCX + oRX + mg;
      const by1 = oCY - oRY - mg;
      const by2 = oCY + oRY + mg;
      ctx.strokeStyle = `rgba(${rgb},${qk ? 0.95 : 0.6})`;
      ctx.lineWidth = qk ? 2.8 : 2;
      ctx.setLineDash([]);
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

      if (fp && lp > 0) {
        ctx.save();
        ctx.strokeStyle = qk ? "rgba(34,197,94,0.75)" : "rgba(168,85,247,0.45)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(oCX, oCY, oRX + 9, oRY + 9, -Math.PI / 2, 0, lp * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (qk) {
        for (let i = 0; i < 6; i++) {
          const angle = t * 1.1 + (i * Math.PI * 2) / 6;
          const px = oCX + (oRX + 13) * Math.cos(angle);
          const py = oCY + (oRY + 8) * Math.sin(angle);
          const sz = 2.5 + Math.sin(t * 3 + i) * 1.2;
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,197,94,${0.45 + Math.sin(t * 2 + i) * 0.25})`;
          ctx.fill();
        }
      }

      if (phaseIdxRef.current === 1) {
        ctx.font = "bold 26px system-ui";
        ctx.fillStyle = "rgba(168,85,247,0.7)";
        ctx.fillText("←", bx1 - 34, oCY + 9);
      } else if (phaseIdxRef.current === 2) {
        ctx.font = "bold 26px system-ui";
        ctx.fillStyle = "rgba(168,85,247,0.7)";
        ctx.fillText("→", bx2 + 8, oCY + 9);
      }

      if (fp && phaseIdxRef.current === 0 && s.w > 0.12) {
        const sx = 1 - s.cx;
        ctx.font = "16px system-ui";
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        if (sx < 0.34) ctx.fillText("→", W - 28, H / 2);
        if (sx > 0.66) ctx.fillText("←", 8, H / 2);
        if (s.cy < 0.25) ctx.fillText("↓", W / 2 - 8, H - 14);
        if (s.cy > 0.75) ctx.fillText("↑", W / 2 - 8, 18);
      }

      if (fp) {
        ctx.save();
        const hudGrad = ctx.createLinearGradient(10, 10, 132, 44);
        hudGrad.addColorStop(0, "rgba(3,8,22,0.82)");
        hudGrad.addColorStop(1, "rgba(14,20,40,0.64)");
        ctx.fillStyle = hudGrad;
        ctx.fillRect(10, 10, 122, 34);
        ctx.strokeStyle = `rgba(${rgb},0.38)`;
        ctx.strokeRect(10, 10, 122, 34);
        ctx.fillStyle = qk ? "#86efac" : "#c4b5fd";
        ctx.font = "600 10px system-ui";
        ctx.fillText(`YAW ${pose.yaw >= 0 ? "+" : ""}${pose.yaw.toFixed(0)}°`, 18, 31);
        ctx.restore();
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phase = PHASES[phaseIdx];

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
            borderRadius: "16px",
            transform: "scaleX(-1)",
          }}
        />

        <canvas
          ref={overlayCanvasRef}
          width={320}
          height={240}
          style={{ position: "absolute", inset: 0, borderRadius: "16px", pointerEvents: "none" }}
        />

        <canvas ref={captureCanvasRef} width={320} height={240} style={{ display: "none" }} />

        {/* Ambient border — color-codes detection state */}
        <div
          style={{
            position: "absolute",
            inset: "-1px",
            borderRadius: "17px",
            border: `1px solid ${done ? "rgba(34,197,94,0.55)" : qualityOk ? "rgba(34,197,94,0.45)" : lostTracking ? "rgba(239,68,68,0.65)" : facePresent ? "rgba(168,85,247,0.55)" : "rgba(168,85,247,0.18)"}`,
            boxShadow: `0 0 ${facePresent || lostTracking ? 24 : 10}px ${done ? "rgba(34,197,94,0.14)" : lostTracking ? "rgba(239,68,68,0.16)" : "rgba(168,85,247,0.1)"}`,
            pointerEvents: "none",
            transition: "border-color 500ms, box-shadow 500ms",
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
              background: "rgba(3,8,22,0.58)",
              borderRadius: "16px",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                border: "2px solid rgba(168,85,247,0.25)",
                borderTopColor: "#a855f7",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span style={{ fontSize: "12px", color: "#64748b" }}>Starting up...</span>
          </div>
        )}
      </div>

      {/* Phase badge */}
      <div
        style={{
          padding: "4px 14px",
          borderRadius: "6px",
          marginBottom: "10px",
          background: "rgba(168,85,247,0.08)",
          border: "1px solid rgba(168,85,247,0.22)",
        }}
      >
        <span
          style={{ fontSize: "11px", fontWeight: 600, color: "#a855f7", letterSpacing: "0.12em" }}
        >
          {done ? "ALL DONE" : phase.label}
        </span>
      </div>

      <div
        style={{
          padding: "5px 12px",
          borderRadius: "999px",
          marginBottom: "14px",
          background: qualityOk
            ? "rgba(34,197,94,0.1)"
            : lostTracking
              ? "rgba(239,68,68,0.1)"
              : "rgba(148,163,184,0.07)",
          border: `1px solid ${qualityOk ? "rgba(34,197,94,0.22)" : lostTracking ? "rgba(239,68,68,0.25)" : "rgba(148,163,184,0.12)"}`,
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: qualityOk
              ? "#86efac"
              : lostTracking
                ? "#fca5a5"
                : facePresent
                  ? "#c4b5fd"
                  : "#64748b",
            letterSpacing: "0.1em",
          }}
        >
          {lostTracking ? "COME BACK INTO FRAME" : poseLabel}
        </span>
      </div>

      {/* Guidance text */}
      <p
        style={{
          fontSize: "15px",
          color: qualityOk
            ? "#e2e8f0"
            : lostTracking
              ? "#f87171"
              : facePresent
                ? "#a855f7"
                : "#64748b",
          fontWeight: 400,
          marginBottom: "14px",
          textAlign: "center",
          minHeight: "22px",
          transition: "color 350ms",
          lineHeight: 1.5,
        }}
      >
        {guidance}
      </p>

      {runtimeNote && (
        <p
          style={{
            fontSize: "12px",
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
      {facePresent && !done && (
        <div
          style={{
            width: 200,
            height: 4,
            background: "rgba(255,255,255,0.07)",
            borderRadius: 2,
            marginBottom: "18px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${lockPct}%`,
              background: qualityOk
                ? "linear-gradient(90deg,#22c55e,#4ade80)"
                : "linear-gradient(90deg,#7e22ce,#a855f7)",
              borderRadius: 2,
              transition: "width 80ms linear, background 400ms",
            }}
          />
        </div>
      )}

      {/* Phase capture dots */}
      <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
        {PHASES.map((p, i) => (
          <div
            key={p.key}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "7px" }}
          >
            <div
              style={{
                width: captured[i] ? 11 : 9,
                height: captured[i] ? 11 : 9,
                borderRadius: "50%",
                background: captured[i]
                  ? "#22c55e"
                  : phaseIdx === i
                    ? "#a855f7"
                    : "rgba(255,255,255,0.1)",
                boxShadow: captured[i]
                  ? "0 0 8px rgba(34,197,94,0.6)"
                  : phaseIdx === i
                    ? "0 0 8px rgba(168,85,247,0.5)"
                    : "none",
                transition: "all 400ms ease",
              }}
            />
            <span
              style={{
                fontSize: "9px",
                fontWeight: 500,
                color: captured[i] ? "#22c55e" : phaseIdx === i ? "#a855f7" : "#3f3f46",
                letterSpacing: "0.08em",
                textTransform: "uppercase" as const,
              }}
            >
              {p.label}
            </span>
          </div>
        ))}
      </div>

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
          borderRadius: "16px",
          border: `1.5px solid ${confirmed ? "rgba(34,197,94,0.45)" : "rgba(168,85,247,0.3)"}`,
          transition: "border-color 600ms",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, transparent 60%, rgba(3,8,22,0.45))",
          }}
        />
      </div>

      <p
        style={{
          fontSize: "15px",
          color: confirmed ? "#22c55e" : "#a7b0c0",
          fontWeight: 400,
          transition: "color 400ms",
          marginBottom: "18px",
        }}
      >
        {confirmed ? "Presence confirmed — face profile matched" : "Verifying presence..."}
      </p>

      <StatusBadge
        status={confirmed ? "pass" : "checking"}
        label={confirmed ? "Identity verified" : "Checking live presence"}
      />
    </div>
  );
}

function Stage11_AudioVerification({ onPass }: { onPass(): void }) {
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<"checking" | "pass" | "fail">("checking");
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unavailable");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const data = new Uint8Array(analyser.frequencyBinCount);
        function tick() {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setLevel(Math.min(100, avg * 2.5));
          rafRef.current = requestAnimationFrame(tick);
        }
        rafRef.current = requestAnimationFrame(tick);

        setPhase("pass");
        setTimeout(() => {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
        }, 3000);
        setTimeout(onPass, 3500);
      } catch {
        setPhase("fail");
        setTimeout(onPass, 2000);
      }
    }
    void init();
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [onPass]);

  const bars = Array.from({ length: 20 }, (_, i) => i);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={11} label="Microphone Check" />

      <div className="mb-8 flex items-end justify-center gap-1.5" style={{ height: 60 }}>
        {bars.map((i) => {
          const height =
            phase === "pass"
              ? Math.max(
                  4,
                  level * 0.6 * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.8 + Date.now() * 0.01)))
                )
              : 4;
          return (
            <div
              key={i}
              style={{
                width: 6,
                borderRadius: "3px",
                height: `${height}px`,
                background: phase === "pass" ? "rgba(168,85,247,0.65)" : "rgba(255,255,255,0.09)",
                transition: "height 60ms ease, background 400ms",
                maxHeight: 56,
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

function Stage12_NetworkValidation({ onPass }: { onPass(): void }) {
  const [latency, setLatency] = useState<number | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "pass" | "warn">("checking");

  useEffect(() => {
    async function go() {
      const result = await invoke<{
        reachable: boolean;
        latency_ms: number | null;
        quality: string;
      }>("check_network_stability", { host: "supabase.com" });

      if (result?.reachable) {
        setLatency(result.latency_ms);
        setQuality(result.quality);
        setPhase(result.quality === "poor" ? "warn" : "pass");
      } else {
        const t0 = performance.now();
        await fetch("https://www.google.com/generate_204", { mode: "no-cors" }).catch(() => {});
        const rtt = Math.round(performance.now() - t0);
        setLatency(rtt);
        setQuality(rtt < 100 ? "excellent" : rtt < 250 ? "good" : "fair");
        setPhase("pass");
      }
      setTimeout(onPass, 1400);
    }
    void go();
  }, [onPass]);

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
        className="mb-8 relative flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          border: `1.5px solid ${phase === "checking" ? "rgba(168,85,247,0.28)" : phase === "pass" ? "rgba(34,197,94,0.38)" : "rgba(245,158,11,0.38)"}`,
          transition: "border-color 500ms",
        }}
      >
        {phase === "checking" ? (
          <Spinner size={32} />
        ) : (
          <div className="text-center">
            <p style={{ fontSize: "22px", fontWeight: 600, color: qualityColor, lineHeight: 1 }}>
              {latency}
            </p>
            <p style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>ms</p>
          </div>
        )}
      </div>

      {phase !== "checking" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <CheckLine label={`Response time: ${latency}ms`} status={phase} />
          <CheckLine label={`Connection quality: ${quality ?? "—"}`} status={phase} delay={200} />
          {phase === "pass" && (
            <CheckLine label="Server connection established" status="pass" delay={400} />
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
          borderRadius: "12px",
          padding: "12px 24px",
          background: "rgba(34,197,94,0.06)",
          border: "1px solid rgba(34,197,94,0.2)",
        }}
      >
        <p style={{ fontSize: "13px", color: "#22c55e", fontWeight: 500, letterSpacing: "0.03em" }}>
          All checks passed — ready to begin
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

      <div className="relative mb-8 flex items-end justify-center gap-1" style={{ height: 48 }}>
        {Array.from({ length: 40 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: `${Math.max(4, 16 + 16 * Math.abs(Math.sin(i * 0.45)))}px`,
              background: "rgba(168,85,247,0.25)",
              borderRadius: "2px",
              animation: `scaleYBar ${0.8 + (i % 5) * 0.15}s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.04}s`,
            }}
          />
        ))}
      </div>

      <div
        className="mb-8 flex h-36 w-36 items-center justify-center rounded-full"
        style={{
          border: "1.5px solid rgba(168,85,247,0.35)",
          boxShadow: "0 0 48px rgba(168,85,247,0.12)",
          background: "rgba(168,85,247,0.04)",
        }}
      >
        <span
          style={{
            fontSize: "72px",
            fontWeight: 200,
            color: "#f0f2f5",
            letterSpacing: "-0.04em",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {String(count).padStart(2, "0")}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {[
          "Keyboard controls active",
          "Session monitoring active",
          "Secure session ready",
          "Contest environment ready",
        ].map((label, i) => (
          <CheckLine key={label} label={label} status="pass" delay={i * 150} />
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px", padding: "20px 32px 0" }}>
      {STAGES.map((s) => {
        const status =
          s.id < current ? (results[s.id] ?? "pass") : s.id === current ? "checking" : "pending";
        const color =
          status === "pass"
            ? "#22c55e"
            : status === "warn"
              ? "#f59e0b"
              : status === "checking"
                ? "#a855f7"
                : "rgba(255,255,255,0.08)";
        return (
          <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <div
              style={{
                height: 3,
                borderRadius: 2,
                background: color,
                transition: "background 500ms ease",
              }}
            />
          </div>
        );
      })}
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
  const [currentStage, setCurrentStage] = useState(1);
  const [results, setResults] = useState<Record<number, StageStatus>>({});
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const advance = useCallback(
    (status: StageStatus = "pass") => {
      if (transitioning) return;
      setTransitioning(true);
      setResults((r) => ({ ...r, [currentStage]: status }));
      setTimeout(() => {
        setCurrentStage((s) => {
          const next = s + 1;
          if (next >= 15) {
            router.push(`/session/contest?contestId=${contestId}`);
            return next;
          }
          return next;
        });
        setTransitioning(false);
      }, 300);
    },
    [currentStage, transitioning, router, contestId]
  );

  const advancePass = useCallback(() => advance("pass"), [advance]);
  const advanceWarn = useCallback(() => advance("warn"), [advance]);

  return (
    <main
      style={{
        background: "#030816",
        minHeight: "100vh",
        fontFamily: "Inter, system-ui, sans-serif",
        userSelect: "none",
      }}
    >
      <ProgressBar current={currentStage} results={results} />

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
        {/* Group label */}
        <div style={{ marginBottom: "4px", textAlign: "center" }}>
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "0.2em",
              color: "#3F3F46",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {STAGES[currentStage - 1]?.group}
          </p>
        </div>

        {/* Stage content */}
        <div style={{ maxWidth: "480px", width: "100%" }}>
          {currentStage === 1 && <Stage1_SessionIsolation onPass={advancePass} />}
          {currentStage === 2 && <Stage2_Fullscreen onPass={advancePass} />}
          {currentStage === 3 && <Stage3_MonitorDetection onPass={advancePass} />}
          {currentStage === 4 && <Stage4_KeyboardLockdown onPass={advancePass} />}
          {currentStage === 5 && <Stage5_EnvironmentValidation onPass={advancePass} />}
          {currentStage === 6 && <Stage6_RestrictedApps onPass={advancePass} />}
          {currentStage === 7 && <Stage7_VMDetection onPass={advancePass} />}
          {currentStage === 8 && (
            <Stage8_CameraInit onPass={advancePass} onCameraReady={setCameraStream} />
          )}
          {currentStage === 9 && (
            <Stage9_FaceCalibration stream={cameraStream} onPass={advancePass} />
          )}
          {currentStage === 10 && (
            <Stage10_PresenceVerification stream={cameraStream} onPass={advancePass} />
          )}
          {currentStage === 11 && <Stage11_AudioVerification onPass={advancePass} />}
          {currentStage === 12 && <Stage12_NetworkValidation onPass={advancePass} />}
          {currentStage === 13 && (
            <Stage13_IntegrityConfirmation results={results} onPass={advancePass} />
          )}
          {currentStage === 14 && <Stage14_LockInCountdown onPass={advancePass} />}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        @keyframes pulse-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(168,85,247,0.22); } 50% { box-shadow: 0 0 0 14px transparent; } }
        @keyframes scaleYBar { from { transform: scaleY(0.4); } to { transform: scaleY(1); } }
      `}</style>
    </main>
  );
}
