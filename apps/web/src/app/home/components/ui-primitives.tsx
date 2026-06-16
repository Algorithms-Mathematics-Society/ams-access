"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { AlertCircle, CheckCircle, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { getThemeColors } from "./utils";

type ThemeName = "dark" | "light";
type Tone = "neutral" | "success" | "warning" | "danger" | "accent" | "muted";

const toneTokens: Record<Tone, { text: string; bg: string; border: string; icon: LucideIcon }> = {
  neutral: {
    text: "rgba(255,255,255,0.72)",
    bg: "rgba(255,255,255,0.045)",
    border: "rgba(255,255,255,0.1)",
    icon: AlertCircle,
  },
  success: {
    text: "#4ade80",
    bg: "rgba(34,197,94,0.08)",
    border: "rgba(34,197,94,0.22)",
    icon: CheckCircle,
  },
  warning: {
    text: "#fbbf24",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.24)",
    icon: AlertCircle,
  },
  danger: {
    text: "#fca5a5",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.26)",
    icon: XCircle,
  },
  accent: {
    text: "#c084fc",
    bg: "rgba(168,85,247,0.09)",
    border: "rgba(168,85,247,0.3)",
    icon: Loader2,
  },
  muted: {
    text: "rgba(255,255,255,0.5)",
    bg: "rgba(255,255,255,0.035)",
    border: "rgba(255,255,255,0.08)",
    icon: AlertCircle,
  },
};

export function toneForStatus(status: "ok" | "fail" | "checking"): Tone {
  if (status === "ok") return "success";
  if (status === "fail") return "danger";
  return "accent";
}

export function toneStyles(tone: Tone, theme: ThemeName) {
  const tokens = toneTokens[tone];
  if (theme === "dark") return tokens;
  if (tone === "neutral" || tone === "muted") {
    return {
      ...tokens,
      text: "rgba(31,25,18,0.62)",
      bg: "rgba(31,25,18,0.035)",
      border: "rgba(31,25,18,0.1)",
    };
  }
  return tokens;
}

export function Panel({
  children,
  theme,
  style,
}: {
  children: ReactNode;
  theme: ThemeName;
  style?: CSSProperties;
}) {
  const c = getThemeColors(theme);
  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        boxShadow: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    theme: ThemeName;
    variant?: "primary" | "secondary" | "danger" | "ghost";
    size?: "standard" | "small" | "icon";
  }
>(function Button(
  {
    children,
    theme,
    variant = "secondary",
    size = "standard",
    disabled = false,
    type = "button",
    style,
    ...props
  },
  ref
) {
  const c = getThemeColors(theme);
  const height = size === "small" ? "32px" : size === "icon" ? "32px" : "38px";
  const base =
    variant === "primary"
      ? { border: "#a855f7", bg: "#a855f7", color: "#ffffff" }
      : variant === "danger"
        ? { border: "rgba(239,68,68,0.3)", bg: "rgba(239,68,68,0.1)", color: "#fca5a5" }
        : variant === "ghost"
          ? { border: c.border, bg: "transparent", color: c.textMutedStrong }
          : {
              border: c.border,
              bg: theme === "light" ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.045)",
              color: c.textMutedStrong,
            };
  const disabledStyle = {
    border: theme === "light" ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.1)",
    bg: theme === "light" ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.055)",
    color: theme === "light" ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.38)",
  };
  const colors = disabled ? disabledStyle : base;

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      ref={ref}
      style={{
        minHeight: height,
        width: size === "icon" ? "32px" : undefined,
        minWidth: size === "icon" ? "32px" : undefined,
        borderRadius: "8px",
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: size === "icon" ? "0" : size === "small" ? "0 12px" : "0 16px",
        fontSize: size === "small" ? "12px" : "13px",
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.76 : 1,
        letterSpacing: 0,
        whiteSpace: "nowrap",
        transition:
          "background 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

export function Field({
  theme,
  style,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { theme: ThemeName }) {
  const c = getThemeColors(theme);
  return (
    <input
      {...props}
      className={`ams-field${props.className ? ` ${props.className}` : ""}`}
      style={{
        height: "38px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${c.border}`,
        background: "rgba(255,255,255,0.02)",
        color: c.text,
        padding: "0 14px",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: "13px",
        fontWeight: 600,
        outline: "2px solid transparent",
        letterSpacing: 0,
        ...style,
      }}
    />
  );
}

export function StatusBadge({
  children,
  tone,
  theme,
  icon,
  style,
}: {
  children: ReactNode;
  tone: Tone;
  theme: ThemeName;
  icon?: LucideIcon | false;
  style?: CSSProperties;
}) {
  const t = toneStyles(tone, theme);
  const Icon = icon === false ? null : (icon ?? t.icon);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        minHeight: "24px",
        padding: "0 9px",
        borderRadius: "6px",
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.text,
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        fontFamily: "'JetBrains Mono', monospace",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {Icon && <Icon size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

export function InlineAlert({
  children,
  tone,
  theme,
  style,
}: {
  children: ReactNode;
  tone: Tone;
  theme: ThemeName;
  style?: CSSProperties;
}) {
  const t = toneStyles(tone, theme);
  const Icon = t.icon;
  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        background: t.bg,
        borderRadius: "8px",
        color: t.text,
        padding: "11px 13px",
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        fontSize: "12px",
        lineHeight: 1.5,
        ...style,
      }}
    >
      <Icon size={15} strokeWidth={2} style={{ marginTop: "1px", flexShrink: 0 }} />
      <div>{children}</div>
    </div>
  );
}

export function ChecklistItem({
  label,
  status,
  theme,
  action,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  theme: ThemeName;
  action?: ReactNode;
}) {
  const c = getThemeColors(theme);
  const tone = toneForStatus(status);
  const t = toneStyles(tone, theme);
  const Icon = t.icon;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        gap: "12px",
        minHeight: "48px",
        borderBottom: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontWeight: 550,
          fontFamily: "var(--font-mono), monospace",
          color: c.textMutedStrong,
          letterSpacing: 0,
        }}
      >
        {label}
      </span>
      <StatusBadge tone={tone} theme={theme} icon={Icon}>
        {status === "ok" ? "Ready" : status === "fail" ? "Needs action" : "Checking"}
      </StatusBadge>
      <div style={{ minWidth: "80px", display: "flex", justifyContent: "flex-end" }}>{action}</div>
    </div>
  );
}

export function ContestStatePill({
  children,
  phase,
  theme,
}: {
  children: ReactNode;
  phase: string;
  theme: ThemeName;
}) {
  const tone: Tone =
    phase === "live" || phase === "verification_open"
      ? "success"
      : phase === "too_early"
        ? "warning"
        : phase === "blocked" || phase === "metadata_unavailable"
          ? "danger"
          : phase === "ended"
            ? "muted"
            : "neutral";
  return (
    <StatusBadge tone={tone} theme={theme}>
      {children}
    </StatusBadge>
  );
}

export function Dialog({
  children,
  theme,
  style,
}: {
  children: ReactNode;
  theme: ThemeName;
  style?: CSSProperties;
}) {
  const c = getThemeColors(theme);
  return (
    <div
      style={{
        background: c.cardBg,
        border: `1px solid ${c.borderStrong}`,
        borderRadius: "10px",
        boxShadow:
          theme === "light" ? "0 24px 70px rgba(0,0,0,0.18)" : "0 24px 80px rgba(0,0,0,0.55)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
