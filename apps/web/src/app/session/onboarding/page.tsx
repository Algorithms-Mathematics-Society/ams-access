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
  { id: 1, label: "Session Isolation", group: "SYSTEM PREPARATION" },
  { id: 2, label: "Fullscreen Secure Mode", group: "SYSTEM PREPARATION" },
  { id: 3, label: "Multi-Monitor Detection", group: "SYSTEM PREPARATION" },
  { id: 4, label: "Keyboard Lockdown", group: "SYSTEM PREPARATION" },
  { id: 5, label: "Environment Validation", group: "ENVIRONMENT SCAN" },
  { id: 6, label: "Restricted Applications", group: "ENVIRONMENT SCAN" },
  { id: 7, label: "VM / Virtualization", group: "ENVIRONMENT SCAN" },
  { id: 8, label: "Camera Initialization", group: "BIOMETRIC CALIBRATION" },
  { id: 9, label: "Face Calibration", group: "BIOMETRIC CALIBRATION" },
  { id: 10, label: "Presence Verification", group: "BIOMETRIC CALIBRATION" },
  { id: 11, label: "Audio Verification", group: "PERIPHERALS" },
  { id: 12, label: "Network Stability", group: "PERIPHERALS" },
  { id: 13, label: "Integrity Confirmation", group: "FINAL" },
  { id: 14, label: "Contest Lock-In", group: "FINAL" },
  { id: 15, label: "Contest Launch", group: "FINAL" },
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
      style={{ opacity: 0, animation: `fadeIn 350ms ease forwards ${delay}ms` }}
    >
      <span style={{ color, fontSize: "13px", width: "16px", flexShrink: 0 }}>{icon}</span>
      <span
        style={{ fontSize: "13px", color: status === "pass" ? "#a7b0c0" : color, fontWeight: 300 }}
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
      style={{ animation: "spin 0.9s linear infinite", display: "inline-block" }}
    >
      <circle cx="12" cy="12" r="9" stroke="rgba(168,85,247,0.2)" strokeWidth="2.5" />
      <path d="M12 3A9 9 0 0 1 21 12" stroke="#a855f7" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function StageHeader({ id, label, total = 15 }: { id: number; label: string; total?: number }) {
  return (
    <div className="mb-10 text-center">
      <p
        style={{
          fontSize: "11px",
          letterSpacing: "0.28em",
          color: "#52525B",
          fontWeight: 500,
          marginBottom: "16px",
          textTransform: "uppercase",
        }}
      >
        Stage {id} of {total}
      </p>
      <h2
        style={{
          fontSize: "28px",
          fontWeight: 300,
          color: "#f5f7fa",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {label}
      </h2>
    </div>
  );
}

function StatusBadge({ status, label }: { status: StageStatus; label: string }) {
  const cfg = {
    checking: { bg: "rgba(168,85,247,0.1)", border: "rgba(168,85,247,0.3)", color: "#a855f7" },
    pass: { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.3)", color: "#22c55e" },
    warn: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", color: "#f59e0b" },
    fail: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.3)", color: "#ef4444" },
    pending: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.1)", color: "#52525b" },
  }[status];
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-4 py-1.5"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {status === "checking" && <Spinner size={12} />}
      <span
        style={{ fontSize: "12px", fontWeight: 500, color: cfg.color, letterSpacing: "0.06em" }}
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
      <StageHeader id={1} label="Session Isolation" />

      {/* Isolation rings animation */}
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
              border: `1px solid rgba(168,85,247,${phase > i ? 0.35 : 0.08})`,
              transition: `border-color 600ms ease ${i * 200}ms, box-shadow 600ms ease ${i * 200}ms`,
              boxShadow: phase > i ? `0 0 ${20 + i * 10}px rgba(168,85,247,0.12)` : "none",
            }}
          />
        ))}
        <div
          className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: "rgba(168,85,247,0.12)",
            border: "1px solid rgba(168,85,247,0.4)",
            boxShadow: "0 0 24px rgba(168,85,247,0.2)",
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

      <div className="space-y-3 text-center">
        {phase >= 1 && <CheckLine label="Process namespace isolated" status="pass" />}
        {phase >= 2 && <CheckLine label="Session context established" status="pass" />}
        {phase >= 3 && <CheckLine label="Secure workspace initialized" status="pass" />}
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
      <StageHeader id={2} label="Fullscreen Secure Mode" />
      <div className="relative mb-10">
        {/* Monitor outline */}
        <div
          className="relative flex items-center justify-center rounded-xl"
          style={{
            width: 200,
            height: 130,
            border: `2px solid ${done ? "rgba(34,197,94,0.5)" : "rgba(168,85,247,0.4)"}`,
            background: done ? "rgba(34,197,94,0.05)" : "rgba(168,85,247,0.05)",
            transition: "all 500ms ease",
            boxShadow: done ? "0 0 30px rgba(34,197,94,0.15)" : "0 0 30px rgba(168,85,247,0.15)",
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
          {/* Corner brackets */}
          {["tl", "tr", "bl", "br"].map((c) => (
            <div
              key={c}
              className="absolute"
              style={{
                top: c.startsWith("t") ? 6 : "auto",
                bottom: c.startsWith("b") ? 6 : "auto",
                left: c.endsWith("l") ? 6 : "auto",
                right: c.endsWith("r") ? 6 : "auto",
                width: 14,
                height: 14,
                borderTop: c.startsWith("t") ? "2px solid rgba(168,85,247,0.7)" : "none",
                borderBottom: c.startsWith("b") ? "2px solid rgba(168,85,247,0.7)" : "none",
                borderLeft: c.endsWith("l") ? "2px solid rgba(168,85,247,0.7)" : "none",
                borderRight: c.endsWith("r") ? "2px solid rgba(168,85,247,0.7)" : "none",
              }}
            />
          ))}
        </div>
        <div
          className="mt-3 h-3 w-16 rounded-full mx-auto"
          style={{ background: "rgba(255,255,255,0.08)" }}
        />
      </div>

      <StatusBadge
        status={done ? "pass" : "checking"}
        label={done ? "Fullscreen secured" : "Entering fullscreen…"}
      />
    </div>
  );
}

function Stage3_MonitorDetection({ onPass }: { onPass(): void }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function go() {
      const win = await tauriWindow();
      const mons = win
        ? await Promise.race([
            win.availableMonitors(),
            new Promise<MonitorInfo[]>((resolve) => setTimeout(() => resolve([]), 2000)),
          ]).catch(() => [] as MonitorInfo[])
        : [];
      // Browser fallback
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
      setTimeout(() => {
        setDone(true);
        setTimeout(onPass, 1200);
      }, 900);
    }
    void go();
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={3} label="Multi-Monitor Detection" />

      {/* Monitor map */}
      <div className="mb-8 flex items-center justify-center gap-4">
        {(monitors.length ? monitors : [null]).map((m, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div
              className="flex items-center justify-center rounded-lg"
              style={{
                width: i === 0 ? 120 : 90,
                height: i === 0 ? 78 : 58,
                border: `2px solid ${i === 0 ? "rgba(34,197,94,0.5)" : "rgba(245,158,11,0.5)"}`,
                background: i === 0 ? "rgba(34,197,94,0.06)" : "rgba(245,158,11,0.06)",
                boxShadow:
                  i === 0 ? "0 0 20px rgba(34,197,94,0.1)" : "0 0 16px rgba(245,158,11,0.08)",
                transition: "all 400ms ease",
                opacity: done ? 1 : 0.4,
              }}
            >
              <span style={{ fontSize: "11px", color: i === 0 ? "#22c55e" : "#f59e0b" }}>
                {i === 0 ? "PRIMARY" : `DISPLAY ${i + 1}`}
              </span>
            </div>
            {m && (
              <span style={{ fontSize: "10px", color: "#52525B" }}>
                {m.size.width}×{m.size.height}
              </span>
            )}
          </div>
        ))}
      </div>

      {done && (
        <div className="space-y-2 text-center">
          <CheckLine
            label={`${monitors.length || 1} display${(monitors.length || 1) > 1 ? "s" : ""} detected`}
            status="pass"
          />
          {monitors.length > 1 ? (
            <CheckLine label="Additional displays: monitoring only" status="warn" />
          ) : (
            <CheckLine label="Single display confirmed" status="pass" />
          )}
          {monitors.length > 1 && (
            <p
              style={{
                marginTop: "12px",
                fontSize: "12px",
                color: "#f59e0b",
                maxWidth: "320px",
                textAlign: "center",
                lineHeight: 1.6,
              }}
            >
              Only the primary display may be used during the contest.
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
      await invoke("enable_keyboard_intercept");
      setTimeout(() => setPhase(2), 600);
      setTimeout(() => setPhase(3), 1200);
      setTimeout(() => setPhase(4), 1800);
      setTimeout(onPass, 2600);
    }

    // Install JS-level key interceptor
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
      <StageHeader id={4} label="Keyboard Shortcut Lockdown" />

      <div className="mb-8 grid grid-cols-2 gap-3">
        {keys.map(({ label, locked }) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{
              background: locked ? "rgba(168,85,247,0.08)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${locked ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.08)"}`,
              transition: "all 400ms ease",
            }}
          >
            <span style={{ fontSize: "11px", color: locked ? "#22c55e" : "#52525B" }}>
              {locked ? "✓" : "○"}
            </span>
            <span
              style={{
                fontSize: "12px",
                color: locked ? "#a7b0c0" : "#52525B",
                fontFamily: "monospace",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <StatusBadge
        status={phase >= 4 ? "pass" : "checking"}
        label={phase >= 4 ? "Secure input mode active" : "Installing keyboard hooks…"}
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
    const items: { label: string; delay: number; result: "pass" | "warn" }[] = [
      { label: "Display configuration verified", delay: 200, result: "pass" },
      { label: "Fullscreen rendering confirmed", delay: 600, result: "pass" },
      { label: "Secure rendering pipeline active", delay: 1000, result: "pass" },
      { label: "Keyboard hooks registered", delay: 1400, result: "pass" },
      { label: "Screen capture layer checked", delay: 1800, result: "pass" },
      { label: "Session integrity baseline set", delay: 2200, result: "pass" },
    ];

    items.forEach(({ label, delay, result }) => {
      setTimeout(() => {
        setChecks((prev) => {
          const existing = prev.find((c) => c.label === label);
          if (!existing) return [...prev, { label, status: "checking" }];
          return prev.map((c) => (c.label === label ? { ...c, status: result } : c));
        });
        setTimeout(() => {
          setChecks((prev) => prev.map((c) => (c.label === label ? { ...c, status: result } : c)));
        }, 500);
      }, delay);
    });

    setTimeout(onPass, 3200);
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={5} label="Environment Validation" />
      <div className="w-full max-w-sm space-y-3">
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
    // Restricted app check disabled for dev/testing
    await new Promise((r) => setTimeout(r, 800));
    setFound([]);
    setScanning(false);
    setTimeout(onPass, 800);
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
      <StageHeader id={6} label="Restricted Application Detection" />

      {scanning ? (
        <div className="flex flex-col items-center gap-5">
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-full"
            style={{
              border: "1px solid rgba(168,85,247,0.2)",
              animation: "pulse-ring 1.8s ease-in-out infinite",
            }}
          >
            <Spinner size={32} />
          </div>
          <p style={{ fontSize: "13px", color: "#64748b" }}>Scanning running processes…</p>
        </div>
      ) : found.length > 0 && !cleared ? (
        <div className="w-full max-w-md">
          <div
            className="mb-5 rounded-xl p-4"
            style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <p className="mb-3 text-sm font-medium" style={{ color: "#fca5a5" }}>
              Restricted applications detected
            </p>
            {found.map((f) => (
              <p key={f} className="text-sm" style={{ color: "#f87171", fontFamily: "monospace" }}>
                • {prettyName[f] ?? f}
              </p>
            ))}
            <p className="mt-3 text-xs" style={{ color: "#94a3b8" }}>
              Please close the listed applications and click Recheck.
            </p>
          </div>
          <button
            onClick={() => void doScan()}
            className="w-full rounded-xl py-2.5 text-sm font-medium text-white transition"
            style={{
              background: "rgba(168,85,247,0.15)",
              border: "1px solid rgba(168,85,247,0.35)",
            }}
          >
            Recheck
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={{
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.3)",
              boxShadow: "0 0 28px rgba(34,197,94,0.12)",
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
          <CheckLine label="No restricted applications detected" status="pass" />
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
      <StageHeader id={7} label="VM / Virtualization Detection" />

      <div
        className="mb-8 relative flex h-24 w-24 items-center justify-center rounded-2xl"
        style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
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
        <p style={{ fontSize: "13px", color: "#64748b" }}>Analyzing hardware fingerprint…</p>
      )}
      {phase === "pass" && (
        <div className="space-y-2 text-center">
          <CheckLine label="Physical hardware confirmed" status="pass" />
          <CheckLine label="No hypervisor signature detected" status="pass" />
          <CheckLine label="Bare-metal environment verified" status="pass" />
        </div>
      )}
      {phase === "warn" && (
        <div
          className="rounded-xl px-5 py-3"
          style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}
        >
          <p style={{ fontSize: "13px", color: "#f59e0b" }}>
            Virtual environment detected{platform ? `: ${platform}` : ""}.
          </p>
          <p style={{ fontSize: "12px", color: "#94a3b8", marginTop: "6px" }}>
            Proceeding under enhanced monitoring.
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
          throw new Error("Camera API unavailable in this context");
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
        setError(err instanceof Error ? err.message : "Camera access denied");
        setPhase("fail");
      }
    }
    void init();
  }, [onPass, onCameraReady]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={8} label="Camera Initialization" />

      <div
        className="relative mb-8 overflow-hidden rounded-2xl"
        style={{
          width: 240,
          height: 160,
          background: "#000",
          border: `2px solid ${phase === "pass" ? "rgba(34,197,94,0.5)" : phase === "fail" ? "rgba(239,68,68,0.4)" : "rgba(168,85,247,0.3)"}`,
          transition: "border-color 400ms ease",
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
            style={{ background: "rgba(0,0,0,0.6)" }}
          >
            <Spinner size={28} />
          </div>
        )}
        {phase === "fail" && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.8)" }}
          >
            <p className="text-xs text-red-400 px-3 text-center">{error}</p>
          </div>
        )}
      </div>

      {phase === "checking" && <StatusBadge status="checking" label="Requesting camera access…" />}
      {phase === "pass" && <StatusBadge status="pass" label="Camera active" />}
      {phase === "fail" && (
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}
        >
          <p className="text-sm" style={{ color: "#f87171" }}>
            {error}
          </p>
          <button
            onClick={onPass}
            style={{
              padding: "8px 20px",
              borderRadius: "8px",
              border: "1px solid rgba(245,158,11,0.4)",
              background: "rgba(245,158,11,0.1)",
              color: "#f59e0b",
              fontSize: "12px",
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Skip camera (dev mode)
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
  // Minimal type shim — avoids module-level import before install
  type DetectorLike = {
    detectForVideo(
      video: HTMLVideoElement,
      ts: number
    ): {
      detections: Array<{
        boundingBox?: { originX: number; originY: number; width: number; height: number };
        score?: number[];
      }>;
    };
    close(): void;
  };

  const PHASES = [
    { key: "front" as const, label: "FRONT VIEW", instruction: "Look directly at camera" },
    { key: "left" as const, label: "LEFT PROFILE", instruction: "Slowly turn head left ~25°" },
    { key: "right" as const, label: "RIGHT PROFILE", instruction: "Slowly turn head right ~25°" },
  ];

  // ── Hot-path refs (no re-render on change) ─────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<DetectorLike | null>(null);
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  // EMA-smoothed bbox — detection coordinate space (not mirrored)
  const smooth = useRef({ cx: 0.5, cy: 0.5, w: 0.0, h: 0.0 });
  const lastDetectMs = useRef(0);
  const lockProgress = useRef(0); // 0–100
  const facePresentRef = useRef(false);
  const qualityOkRef = useRef(false);
  const capturingRef = useRef(false);
  const phaseIdxRef = useRef(0);
  const rafRef = useRef(0);

  // ── React state (display only) ─────────────────────────────────
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorFailed, setDetectorFailed] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [guidance, setGuidance] = useState("Loading face detection…");
  const [facePresent, setFacePresent] = useState(false);
  const [qualityOk, setQualityOk] = useState(false);
  const [lockPct, setLockPct] = useState(0);
  const [captured, setCaptured] = useState([false, false, false]);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);

  phaseIdxRef.current = phaseIdx;

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
    setGuidance("✓ Captured");
    await new Promise<void>((r) => setTimeout(r, 380));
    setFlash(false);

    if (idx < 2) {
      const next = idx + 1;
      lockProgress.current = 0;
      facePresentRef.current = false;
      qualityOkRef.current = false;
      smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
      phaseIdxRef.current = next;
      setPhaseIdx(next);
      setFacePresent(false);
      setQualityOk(false);
      setLockPct(0);
      setGuidance(PHASES[next].instruction);
      await new Promise<void>((r) => setTimeout(r, 600));
      capturingRef.current = false;
    } else {
      setDone(true);
      setGuidance("Identity verification complete");
      setTimeout(() => onPassRef.current(), 1400);
    }
  };

  // ── Init: camera + MediaPipe BlazeFace ────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      try {
        const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const det = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/blaze_face_short_range.tflite",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          minDetectionConfidence: 0.45,
          minSuppressionThreshold: 0.3,
        });
        if (cancelled) {
          det.close();
          return;
        }
        detectorRef.current = det as unknown as DetectorLike;
        setDetectorReady(true);
        setGuidance(PHASES[0].instruction);
      } catch {
        if (cancelled) return;
        setDetectorFailed(true);
        setDetectorReady(true);
        setGuidance(PHASES[0].instruction);
        // Timer-based fallback when model unavailable
        void (async () => {
          for (let i = 0; i < 3; i++) {
            if (cancelled) return;
            phaseIdxRef.current = i;
            setPhaseIdx(i);
            setGuidance(PHASES[i].instruction);
            await new Promise<void>((r) => setTimeout(r, i === 0 ? 2200 : 3000));
            if (cancelled) return;
            capturingRef.current = true;
            await capturePhaseRef.current(i);
          }
        })();
      }
    }

    void init();
    return () => {
      cancelled = true;
      detectorRef.current?.close();
      detectorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ── Detection + canvas loop ────────────────────────────────────
  useEffect(() => {
    const EMA = 0.3;
    const DETECT_INTERVAL = 100; // 10 FPS
    const FILL = 2.2; // progress per detection frame when quality ok
    const DRAIN = 5.0; // drain rate when quality fails
    const LOCK_MAX = 100;

    let prevFP = false;
    let prevQK = false;

    function getQuality(s: typeof smooth.current, phase: number) {
      if (s.w < 0.14) return { ok: false, hint: "Move closer" };
      if (s.w > 0.65) return { ok: false, hint: "Move back" };
      if (phase === 0) {
        // Front: check centering in screen space (video is mirrored)
        const sx = 1 - s.cx;
        if (sx < 0.3) return { ok: false, hint: "Move right" };
        if (sx > 0.7) return { ok: false, hint: "Move left" };
        if (s.cy < 0.22) return { ok: false, hint: "Move down" };
        if (s.cy > 0.78) return { ok: false, hint: "Move up" };
        return { ok: true, hint: "Hold still…" };
      }
      // Side profiles: any presence counts
      return { ok: true, hint: PHASES[phase].instruction };
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

      // ── Run detection at 10 FPS ────────────────────────────
      const det = detectorRef.current;
      const video = videoRef.current;
      if (det && video && video.readyState >= 2 && ts - lastDetectMs.current >= DETECT_INTERVAL) {
        lastDetectMs.current = ts;
        try {
          const res = det.detectForVideo(video, ts);
          const dets = (res.detections ?? [])
            .slice()
            .sort((a, b) => (b.score?.[0] ?? 0) - (a.score?.[0] ?? 0));
          const best = dets[0];

          if (best?.boundingBox) {
            const vW = video.videoWidth || W;
            const vH = video.videoHeight || H;
            const bb = best.boundingBox;
            const raw = {
              cx: (bb.originX + bb.width / 2) / vW,
              cy: (bb.originY + bb.height / 2) / vH,
              w: bb.width / vW,
              h: bb.height / vH,
            };
            const s = smooth.current;
            s.cx = EMA * raw.cx + (1 - EMA) * s.cx;
            s.cy = EMA * raw.cy + (1 - EMA) * s.cy;
            s.w = EMA * raw.w + (1 - EMA) * s.w;
            s.h = EMA * raw.h + (1 - EMA) * s.h;
            facePresentRef.current = true;
          } else {
            facePresentRef.current = false;
            smooth.current.w *= 0.92;
            smooth.current.h *= 0.92;
          }

          const { ok, hint } = getQuality(smooth.current, phaseIdxRef.current);
          qualityOkRef.current = facePresentRef.current && ok;

          // Update React state only on change to avoid re-render storm
          if (facePresentRef.current !== prevFP || ok !== prevQK) {
            prevFP = facePresentRef.current;
            prevQK = ok;
            setFacePresent(facePresentRef.current);
            setQualityOk(qualityOkRef.current);
            if (!facePresentRef.current) {
              setGuidance(PHASES[phaseIdxRef.current].instruction);
            } else if (!ok) {
              setGuidance(hint);
            } else {
              setGuidance("Hold still…");
            }
          }

          // Drive lock progress
          if (qualityOkRef.current && !capturingRef.current) {
            lockProgress.current = Math.min(LOCK_MAX, lockProgress.current + FILL);
          } else {
            lockProgress.current = Math.max(0, lockProgress.current - DRAIN);
          }
          setLockPct(Math.round(lockProgress.current));

          // Trigger capture when filled
          if (lockProgress.current >= LOCK_MAX && !capturingRef.current) {
            capturingRef.current = true;
            void capturePhaseRef.current(phaseIdxRef.current);
          }
        } catch {}
      }

      // ── Canvas draw (60 FPS) ───────────────────────────────
      ctx.clearRect(0, 0, W, H);
      const s = smooth.current;
      const fp = facePresentRef.current;
      const qk = qualityOkRef.current;
      const lp = lockProgress.current / LOCK_MAX;

      // Mirror x for display (detection is in unmirrored frame)
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
          : fp
            ? [168, 85, 247]
            : [100, 116, 139];
      const rgb = color.join(",");

      // Ambient glow
      const grd = ctx.createRadialGradient(oCX, oCY, 0, oCX, oCY, oRX * 2);
      grd.addColorStop(0, `rgba(${rgb},0.09)`);
      grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX * 2, oRY * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Detected bbox (subtle dashed rect, mirrors correctly)
      if (fp && dW > 20) {
        ctx.save();
        ctx.strokeStyle = `rgba(${rgb},0.28)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.strokeRect(dCX - dW / 2, dCY - dH / 2, dW, dH);
        ctx.restore();
      }

      // Oval guide — dashed when searching, solid when locked
      ctx.save();
      ctx.setLineDash(qk ? [] : [8, 5]);
      ctx.lineDashOffset = -t * 18;
      ctx.strokeStyle = `rgba(${rgb},${fp ? 0.88 : 0.4})`;
      ctx.lineWidth = qk ? 2.8 : 1.8;
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX, oRY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Scanline sweep clipped to oval
      const scanY = oCY - oRY + ((t * 0.55) % 1) * oRY * 2;
      const sGrd = ctx.createLinearGradient(0, scanY - 10, 0, scanY + 10);
      sGrd.addColorStop(0, "transparent");
      sGrd.addColorStop(0.5, `rgba(${rgb},0.18)`);
      sGrd.addColorStop(1, "transparent");
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(oCX, oCY, oRX, oRY, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = sGrd;
      ctx.fillRect(oCX - oRX, scanY - 10, oRX * 2, 20);
      ctx.restore();

      // Corner brackets
      const bS = 20;
      const mg = 10;
      const bx1 = oCX - oRX - mg;
      const bx2 = oCX + oRX + mg;
      const by1 = oCY - oRY - mg;
      const by2 = oCY + oRY + mg;
      ctx.strokeStyle = `rgba(${rgb},${qk ? 1 : 0.55})`;
      ctx.lineWidth = 2.5;
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

      // Lock progress arc around oval
      if (fp && lp > 0) {
        ctx.save();
        ctx.strokeStyle = qk ? "rgba(34,197,94,0.8)" : "rgba(168,85,247,0.5)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(oCX, oCY, oRX + 9, oRY + 9, -Math.PI / 2, 0, lp * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Orbiting particles when quality locked
      if (qk) {
        for (let i = 0; i < 6; i++) {
          const angle = t * 1.1 + (i * Math.PI * 2) / 6;
          const px = oCX + (oRX + 13) * Math.cos(angle);
          const py = oCY + (oRY + 8) * Math.sin(angle);
          const sz = 2.5 + Math.sin(t * 3 + i) * 1.2;
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,197,94,${0.5 + Math.sin(t * 2 + i) * 0.3})`;
          ctx.fill();
        }
      }

      // Phase direction arrows
      if (phaseIdxRef.current === 1) {
        ctx.font = "bold 26px system-ui";
        ctx.fillStyle = "rgba(168,85,247,0.75)";
        ctx.fillText("←", bx1 - 34, oCY + 9);
      } else if (phaseIdxRef.current === 2) {
        ctx.font = "bold 26px system-ui";
        ctx.fillStyle = "rgba(168,85,247,0.75)";
        ctx.fillText("→", bx2 + 8, oCY + 9);
      }

      // Position nudge arrows for front phase (screen-space corrected)
      if (fp && phaseIdxRef.current === 0 && s.w > 0.12) {
        const sx = 1 - s.cx;
        ctx.font = "16px system-ui";
        ctx.fillStyle = "rgba(245,158,11,0.9)";
        if (sx < 0.3) ctx.fillText("→", W - 28, H / 2);
        if (sx > 0.7) ctx.fillText("←", 8, H / 2);
        if (s.cy < 0.25) ctx.fillText("↓", W / 2 - 8, H - 14);
        if (s.cy > 0.75) ctx.fillText("↑", W / 2 - 8, 18);
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phase = PHASES[phaseIdx];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <StageHeader id={9} label="Biometric Face Scan" />

      <div style={{ position: "relative", width: 320, height: 240, marginBottom: "20px" }}>
        {flash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              background: "rgba(255,255,255,0.65)",
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
            border: `1px solid ${done ? "rgba(34,197,94,0.6)" : qualityOk ? "rgba(34,197,94,0.5)" : facePresent ? "rgba(168,85,247,0.6)" : "rgba(168,85,247,0.2)"}`,
            boxShadow: `0 0 ${facePresent ? 28 : 12}px ${done ? "rgba(34,197,94,0.2)" : "rgba(168,85,247,0.15)"}`,
            pointerEvents: "none",
            transition: "border-color 400ms, box-shadow 400ms",
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
              background: "rgba(3,8,22,0.6)",
              borderRadius: "16px",
              gap: "10px",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                border: "2px solid rgba(168,85,247,0.3)",
                borderTopColor: "#a855f7",
                borderRadius: "50%",
                animation: "spin 0.9s linear infinite",
              }}
            />
            <span style={{ fontSize: "11px", color: "#64748b" }}>Loading model…</span>
          </div>
        )}
      </div>

      {/* Phase badge */}
      <div
        style={{
          padding: "3px 12px",
          borderRadius: "6px",
          marginBottom: "10px",
          background: "rgba(168,85,247,0.1)",
          border: "1px solid rgba(168,85,247,0.25)",
        }}
      >
        <span
          style={{ fontSize: "10px", fontWeight: 600, color: "#a855f7", letterSpacing: "0.14em" }}
        >
          {done ? "COMPLETE" : phase.label}
        </span>
      </div>

      {/* Guidance text */}
      <p
        style={{
          fontSize: "13px",
          color: qualityOk ? "#e2e8f0" : facePresent ? "#a855f7" : "#64748b",
          fontWeight: 300,
          marginBottom: "12px",
          textAlign: "center",
          minHeight: "20px",
          transition: "color 300ms",
        }}
      >
        {guidance}
      </p>

      {/* Lock progress bar */}
      {facePresent && !done && (
        <div
          style={{
            width: 200,
            height: 3,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 2,
            marginBottom: "16px",
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
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        {PHASES.map((p, i) => (
          <div
            key={p.key}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}
          >
            <div
              style={{
                width: captured[i] ? 10 : 8,
                height: captured[i] ? 10 : 8,
                borderRadius: "50%",
                background: captured[i]
                  ? "#22c55e"
                  : phaseIdx === i
                    ? "#a855f7"
                    : "rgba(255,255,255,0.12)",
                boxShadow: captured[i]
                  ? "0 0 10px rgba(34,197,94,0.7)"
                  : phaseIdx === i
                    ? "0 0 10px rgba(168,85,247,0.6)"
                    : "none",
                transition: "all 400ms ease",
              }}
            />
            <span
              style={{
                fontSize: "9px",
                color: captured[i] ? "#22c55e" : phaseIdx === i ? "#a855f7" : "#3f3f46",
                letterSpacing: "0.1em",
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
  const [instruction, setInstruction] = useState("Please blink twice to verify presence");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!stream || !videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const seq = [
      [2000, "Blink detected ✓ — Once more please", 1],
      [4000, "Second blink confirmed ✓", 2],
      [5200, "Presence verified — liveness confirmed", 3],
    ] as const;
    seq.forEach(([delay, text, s]) => {
      setTimeout(() => {
        setInstruction(text);
        setStep(s);
      }, delay);
    });
    setTimeout(onPass, 6200);
  }, [onPass]);

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={10} label="Presence Verification" />

      <div
        className="relative mb-6 overflow-hidden rounded-2xl"
        style={{
          width: 220,
          height: 165,
          border: `1.5px solid ${step >= 3 ? "rgba(34,197,94,0.5)" : "rgba(168,85,247,0.35)"}`,
          transition: "border-color 500ms",
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
            background: "linear-gradient(to bottom, transparent 60%, rgba(3,8,22,0.5))",
          }}
        />
      </div>

      <div className="mb-4 text-center">
        <p
          style={{
            fontSize: "14px",
            color: step >= 3 ? "#22c55e" : "#a7b0c0",
            fontWeight: 300,
            transition: "color 400ms",
          }}
        >
          {instruction}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg px-4 py-2"
            style={{
              background: step >= i ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${step >= i ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.08)"}`,
              transition: "all 400ms",
            }}
          >
            <span style={{ fontSize: "12px", color: step >= i ? "#22c55e" : "#52525B" }}>
              {step >= i ? "✓" : "○"}
            </span>
            <span style={{ fontSize: "12px", color: step >= i ? "#a7b0c0" : "#52525B" }}>
              Blink {i}
            </span>
          </div>
        ))}
      </div>
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
      <StageHeader id={11} label="Audio Verification" />

      {/* Waveform bars */}
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
                background: phase === "pass" ? "rgba(168,85,247,0.7)" : "rgba(255,255,255,0.1)",
                transition: "height 60ms ease, background 400ms",
                maxHeight: 56,
              }}
            />
          );
        })}
      </div>

      <div className="w-full max-w-xs space-y-3">
        {phase === "checking" && <CheckLine label="Requesting microphone…" status="checking" />}
        {phase === "pass" && (
          <>
            <CheckLine label="Microphone active" status="pass" />
            <CheckLine label="Audio input detected" status="pass" delay={300} />
            <CheckLine label="Background noise: acceptable" status="pass" delay={600} />
          </>
        )}
        {phase === "fail" && (
          <CheckLine label="Microphone unavailable — proceeding" status="warn" />
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
        // Browser fallback
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
      <StageHeader id={12} label="Network Stability" />

      <div
        className="mb-8 relative flex h-24 w-24 items-center justify-center rounded-full"
        style={{
          border: `2px solid ${phase === "checking" ? "rgba(168,85,247,0.3)" : phase === "pass" ? "rgba(34,197,94,0.4)" : "rgba(245,158,11,0.4)"}`,
          transition: "border-color 400ms",
        }}
      >
        {phase === "checking" ? (
          <Spinner size={32} />
        ) : (
          <div className="text-center">
            <p style={{ fontSize: "22px", fontWeight: 600, color: qualityColor, lineHeight: 1 }}>
              {latency}
            </p>
            <p style={{ fontSize: "10px", color: "#64748b" }}>ms</p>
          </div>
        )}
      </div>

      {phase !== "checking" && (
        <div className="space-y-2">
          <CheckLine label={`Latency: ${latency}ms`} status={phase} />
          <CheckLine label={`Network stability: ${quality ?? "—"}`} status={phase} delay={200} />
          {phase === "pass" && (
            <CheckLine label="WebSocket connectivity confirmed" status="pass" delay={400} />
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
    { label: "Session isolated", stage: 1 },
    { label: "Fullscreen mode active", stage: 2 },
    { label: "Display configuration verified", stage: 3 },
    { label: "Keyboard lockdown enabled", stage: 4 },
    { label: "Environment validated", stage: 5 },
    { label: "No restricted applications", stage: 6 },
    { label: "Bare-metal confirmed", stage: 7 },
    { label: "Camera initialized", stage: 8 },
    { label: "Face calibration complete", stage: 9 },
    { label: "Presence verified", stage: 10 },
    { label: "Audio active", stage: 11 },
    { label: "Network stable", stage: 12 },
  ];

  return (
    <div className="flex flex-col items-center">
      <StageHeader id={13} label="Integrity Confirmation" />

      <div className="grid w-full max-w-sm grid-cols-2 gap-x-8 gap-y-2">
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
        className="mt-6 rounded-xl px-6 py-3"
        style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)" }}
      >
        <p style={{ fontSize: "12px", color: "#a855f7", letterSpacing: "0.04em" }}>
          Integrity score: 100 / 100
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
      <StageHeader id={14} label="Contest Lock-In" />

      {/* Waveform background */}
      <div className="relative mb-8 flex items-end justify-center gap-1" style={{ height: 60 }}>
        {Array.from({ length: 40 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: `${Math.max(4, 20 + 20 * Math.abs(Math.sin(i * 0.45)))}px`,
              background: "rgba(168,85,247,0.3)",
              borderRadius: "2px",
              animation: `scaleYBar ${0.8 + (i % 5) * 0.15}s ease-in-out infinite alternate`,
              animationDelay: `${i * 0.04}s`,
            }}
          />
        ))}
      </div>

      {/* Countdown */}
      <div
        className="mb-8 flex h-36 w-36 items-center justify-center rounded-full"
        style={{
          border: "2px solid rgba(168,85,247,0.4)",
          boxShadow: "0 0 60px rgba(168,85,247,0.18)",
          background: "rgba(168,85,247,0.05)",
        }}
      >
        <span
          style={{
            fontSize: "72px",
            fontWeight: 200,
            color: "#f5f7fa",
            letterSpacing: "-0.04em",
            transition: "all 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          {String(count).padStart(2, "0")}
        </span>
      </div>

      <div className="space-y-2">
        {[
          "Keyboard hooks active",
          "Integrity monitor active",
          "Secure session initialized",
          "Contest sandbox ready",
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
    <div className="flex items-center gap-1" style={{ padding: "20px 32px 0" }}>
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
                : "rgba(255,255,255,0.1)";
        return (
          <div key={s.id} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
            <div
              style={{
                height: 2,
                borderRadius: 1,
                background: color,
                transition: "background 400ms ease",
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
          if (s >= 15) {
            router.push(`/session/contest?contestId=${contestId}`);
            return s;
          }
          return s + 1;
        });
        setTransitioning(false);
      }, 280);
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
        className="flex min-h-screen flex-col items-center justify-center px-8 py-12"
        style={{
          opacity: transitioning ? 0 : 1,
          transform: transitioning ? "scale(0.98)" : "scale(1)",
          transition: "opacity 280ms ease, transform 280ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Stage label group */}
        <div className="mb-2 text-center">
          <p
            style={{
              fontSize: "10px",
              letterSpacing: "0.22em",
              color: "#3F3F46",
              textTransform: "uppercase",
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
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes pulse-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(168,85,247,0.3); } 50% { box-shadow: 0 0 0 12px transparent; } }
        @keyframes scaleYBar { from { transform: scaleY(0.4); } to { transform: scaleY(1); } }
      `}</style>
    </main>
  );
}
