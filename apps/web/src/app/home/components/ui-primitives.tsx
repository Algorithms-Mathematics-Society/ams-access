"use client";

import { Children, forwardRef, isValidElement } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { AlertCircle, CheckCircle, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { Button as SharedButton, HStack, Grid, Text, Token, StatusDot } from "@ams/shared-ui";
import { Card } from "@astryxdesign/core/Card";

type ThemeName = "dark" | "light";
type Tone = "neutral" | "success" | "warning" | "danger" | "accent" | "muted";

// The effective root Theme owns these roles, including route dark locks.
const toneTokens: Record<Tone, { text: string; bg: string; border: string; icon: LucideIcon }> = {
  neutral: {
    text: "var(--color-text-secondary)", bg: "var(--color-background-muted)",
    border: "var(--color-border)", icon: AlertCircle,
  },
  success: {
    text: "var(--color-text-green)", bg: "var(--color-success-muted)",
    border: "var(--color-border-green)", icon: CheckCircle,
  },
  warning: {
    text: "var(--color-text-yellow)", bg: "var(--color-warning-muted)",
    border: "var(--color-border-yellow)", icon: AlertCircle,
  },
  danger: {
    text: "var(--color-text-red)", bg: "var(--color-error-muted)",
    border: "var(--color-border-red)", icon: XCircle,
  },
  // A check in progress is neutral; purple is reserved for focus/selection.
  accent: {
    text: "var(--color-text-secondary)", bg: "var(--color-background-muted)",
    border: "var(--color-border)", icon: Loader2,
  },
  muted: {
    text: "var(--color-text-secondary)", bg: "var(--color-background-muted)",
    border: "var(--color-border)", icon: AlertCircle,
  },
};

export function toneForStatus(status: "ok" | "fail" | "checking"): Tone {
  return status === "ok" ? "success" : status === "fail" ? "danger" : "accent";
}

export function toneStyles(tone: Tone, _theme: ThemeName) {
  return toneTokens[tone];
}

export function Panel({ children, theme: _theme, style }: {
  children: ReactNode; theme: ThemeName; style?: CSSProperties;
}) {
  return <Card padding={0} style={{ boxShadow: "none", ...style }}>{children}</Card>;
}

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return textContent(child.props.children);
    return "";
  }).join("").trim();
}

// Retain native HTML props, events and the button ref for existing Home callers.
// New page slices should use @ams/shared-ui's label-based Button directly.
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode; theme: ThemeName;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "standard" | "small" | "icon";
}>(function Button({
  children, theme: _theme, variant = "secondary", size = "standard",
  disabled = false, type = "button", style, ...props
}, ref) {
  return (
    <SharedButton
      {...props}
      ref={ref}
      type={type}
      label={props["aria-label"] ?? textContent(children)}
      variant={variant === "danger" ? "destructive" : variant}
      size={size === "standard" ? "lg" : "md"}
      isDisabled={disabled}
      // Keep native disabled semantics even when a caller supplies a title.
      style={{
        ...style,
        ...(size === "icon" ? {
          width: "var(--size-element-md)", minWidth: "var(--size-element-md)", padding: 0,
        } : {}),
        // Some legacy consumers pass purple inline fills. Shared primary
        // ownership wins while their page geometry remains unchanged in P1.
        ...(variant === "primary" ? {
          background: "var(--color-background-inverted)",
          color: "var(--color-background-body)",
          borderColor: "var(--color-background-inverted)",
        } : {}),
      }}
    >
      <HStack as="span" gap={2} vAlign="center">{children}</HStack>
    </SharedButton>
  );
});

// Compatibility-only native input: preserve arbitrary input types, IDs,
// uncontrolled defaults and native event contracts. Future forms use the
// exported Astryx TextInput/Selector APIs; an implicit conversion here would
// replace caller IDs and break native label associations in Astryx 0.1.8.
export function Field({ theme: _theme, style, ...props }:
  React.InputHTMLAttributes<HTMLInputElement> & { theme: ThemeName }) {
  return (
    <input
      {...props}
      className={`ams-field${props.className ? ` ${props.className}` : ""}`}
      style={{
        height: "var(--size-element-lg)",
        borderRadius: "var(--radius-element)",
        border: "var(--border-width) solid var(--color-border)",
        background: "var(--color-background-surface)",
        color: "var(--color-text-primary)",
        paddingInline: "var(--spacing-3)",
        fontFamily: "var(--font-family-body)",
        fontSize: "var(--text-body-size)",
        ...style,
      }}
    />
  );
}

export function StatusBadge({ children, tone, theme, icon, style }: {
  children: ReactNode; tone: Tone; theme: ThemeName;
  icon?: LucideIcon | false; style?: CSSProperties;
}) {
  const t = toneStyles(tone, theme);
  const Icon = icon === false ? null : (icon ?? t.icon);
  const label = textContent(children);
  const isText = typeof children === "string" || typeof children === "number";
  return (
    <Token
      label={label}
      size="sm"
      color={tone === "success" ? "green" : tone === "warning" ? "yellow" : tone === "danger" ? "red" : "default"}
      icon={Icon ? <Icon size="var(--spacing-3)" aria-hidden="true" /> : undefined}
      isLabelHidden={!isText}
      endContent={isText ? undefined : children}
      style={style}
    />
  );
}

export function InlineAlert({ children, tone, theme, style }: {
  children: ReactNode; tone: Tone; theme: ThemeName; style?: CSSProperties;
}) {
  const t = toneStyles(tone, theme);
  const Icon = t.icon;
  return (
    <HStack gap={2} padding={3} vAlign="start" style={{
      border: `var(--border-width) solid ${t.border}`,
      background: t.bg, borderRadius: "var(--radius-element)", color: t.text,
      fontSize: "var(--text-supporting-size)", lineHeight: "var(--text-body-leading)", ...style,
    }}>
      <Icon size="var(--spacing-4)" aria-hidden="true" style={{ flexShrink: 0 }} />
      <Text as="div" style={{ color: "inherit", fontSize: "inherit" }}>{children}</Text>
    </HStack>
  );
}

export function ChecklistItem({ label, status, theme: _theme, action }: {
  label: string; status: "ok" | "fail" | "checking"; theme: ThemeName; action?: ReactNode;
}) {
  const statusLabel = status === "ok" ? "Ready" : status === "fail" ? "Needs action" : "Checking";
  return (
    <Grid gap={3} align="center" style={{
      gridTemplateColumns: "1fr auto auto",
      minHeight: "var(--size-element-lg)",
      borderBottom: "var(--border-width) solid var(--color-border)",
    }}>
      <Text style={{ fontSize: "var(--text-supporting-size)", color: "var(--color-text-secondary)" }}>{label}</Text>
      <HStack hAlign="end">{action}</HStack>
      <StatusDot variant={status === "ok" ? "success" : status === "fail" ? "error" : "neutral"} label={statusLabel} tooltip={statusLabel} />
    </Grid>
  );
}

export function ContestStatePill({ children, phase, theme }: {
  children: ReactNode; phase: string; theme: ThemeName;
}) {
  const tone: Tone = phase === "live" || phase === "verification_open" ? "success"
    : phase === "too_early" ? "warning"
    : phase === "blocked" || phase === "metadata_unavailable" ? "danger"
    : phase === "ended" ? "muted" : "neutral";
  return <StatusBadge tone={tone} theme={theme}>{children}</StatusBadge>;
}

// Surface-only compatibility component. Existing overlay owners retain their
// dismissal, focus and stacking behavior; the shared native Dialog is opt-in.
export function Dialog({ children, theme: _theme, style }: {
  children: ReactNode; theme: ThemeName; style?: CSSProperties;
}) {
  return (
    <Card padding={0} style={{
      background: "var(--color-background-popover)",
      border: "var(--border-width) solid var(--color-border-emphasized)",
      borderRadius: "var(--radius-container)", boxShadow: "var(--shadow-high)", ...style,
    }}>{children}</Card>
  );
}
