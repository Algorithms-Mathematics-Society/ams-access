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
    text: "#fde047",
    bg: "rgba(234,179,8,0.10)",
    border: "rgba(234,179,8,0.30)",
    icon: AlertCircle,
  },
  danger: {
    text: "#fca5a5",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.26)",
    icon: XCircle,
  },
  accent: {
    text: "var(--color-accent-light)",
    bg: "rgb(var(--accent-rgb) / 0.09)",
    border: "rgb(var(--accent-rgb) / 0.3)",
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
        borderRadius: "var(--radius-md)",
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
  const height = size === "small" ? "32px" : size === "icon" ? "32px" : "40px";
  const base =
    variant === "primary"
      ? { border: "var(--color-accent-base)", bg: "var(--color-accent-base)", color: "#ffffff" }
      : variant === "danger"
        ? {
            border: "var(--home-status-error-border)",
            bg: "var(--home-status-error-bg-10)",
            color: "var(--theme-error-text)",
          }
        : variant === "ghost"
          ? { border: c.border, bg: "transparent", color: c.textMutedStrong }
          : {
              border: c.border,
              bg: "var(--home-overlay-btn)",
              color: c.textMutedStrong,
            };
  const disabledStyle = {
    border: "var(--home-border-disabled)",
    bg: "var(--home-overlay-disabled)",
    color: "var(--home-text-disabled)",
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
        width: size === "icon" ? "32px" : "auto",
        minWidth: size === "icon" ? "32px" : undefined,
        borderRadius: "var(--radius-md)",
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
          "background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast), transform var(--transition-fast)",
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
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.text,
        fontSize: "11px",
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
        borderRadius: "var(--radius-md)",
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
  // Telemetry-dot pattern: a single 6px status LED on the far right replaces the
  // repetitive "Ready" pill, so the column scans as one vertical line of health.
  const dotColor =
    status === "ok"
      ? "var(--home-status-ok-dot)"
      : status === "fail"
        ? "var(--home-status-error-dot)"
        : "var(--home-status-warn-dot)";
  const statusLabel = status === "ok" ? "Ready" : status === "fail" ? "Needs action" : "Checking";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        gap: "12px",
        minHeight: "44px",
        borderBottom: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontWeight: 500,
          fontFamily: "var(--font-mono), monospace",
          color: "var(--text-dim)",
          letterSpacing: 0,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>{action}</div>
      <span
        role="img"
        aria-label={statusLabel}
        title={statusLabel}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />
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
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--home-shadow-panel)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
