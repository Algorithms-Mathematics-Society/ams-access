import { useEffect, useState } from "react";
import { useTheme } from "./hooks";
import { type StageStatus } from "../support";

// ─── Shared sub-components ────────────────────────────────────────────────────

export function CheckLine({
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
      ? "rgba(255,255,255,0.58)"
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
          color: status === "pass" ? (isLight ? "rgba(255,255,255,0.58)" : "#ffffff") : color,
          fontWeight: status === "pass" ? 400 : 600,
          lineHeight: 1.5,
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function Spinner({ size = 20 }: { size?: number }) {
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

export function StageHeader({ label }: { id?: number; label: string; total?: number }) {
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
          fontSize: "19px",
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

export function StatusBadge({ status, label }: { status: StageStatus; label: string }) {
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
      color: "rgba(255,255,255,0.58)",
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
        borderRadius: "var(--radius-sm)",
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
