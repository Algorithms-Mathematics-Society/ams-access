"use client";

import { memo, useMemo } from "react";
import { Info } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, toneForStatus, toneStyles } from "./ui-primitives";
import type { ReadinessState, ContestantReadinessContext } from "./types";

export const ReadinessWidget = memo(function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
  onResolve,
  context,
  onPracticeRun,
}: {
  readiness: ReadinessState;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
  onResolve?: (key: string) => void;
  context?: ContestantReadinessContext;
  onPracticeRun?: () => void;
}) {
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: "1px solid var(--theme-border)",
        borderRadius: "var(--radius-md)",
        padding: "24px",
        boxShadow: "none",
        transition: "all var(--transition-fast)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <h3
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--theme-text-muted)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          System Integrity Hub
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: "24px" }}>
        <ReadinessItem
          label="Network Connection"
          status={readiness.network}
          theme={theme}
          onResolve={onResolve ? () => onResolve("network") : undefined}
        />
        <ReadinessItem
          label="Video Capture"
          status={readiness.camera}
          theme={theme}
          onResolve={onResolve ? () => onResolve("camera") : undefined}
        />
        <ReadinessItem
          label="Audio Input"
          status={readiness.mic}
          theme={theme}
          onResolve={onResolve ? () => onResolve("mic") : undefined}
        />
        <ReadinessItem
          label="Secure VM Shield"
          status={readiness.vm}
          theme={theme}
          onResolve={onResolve ? () => onResolve("vm") : undefined}
        />
        <ReadinessItem
          label="Keyboard Lockdown"
          status={readiness.keyboard}
          theme={theme}
          onResolve={onResolve ? () => onResolve("keyboard") : undefined}
        />
        <ReadinessItem
          label="Platform Support"
          status={readiness.platform}
          theme={theme}
          onResolve={onResolve ? () => onResolve("platform") : undefined}
        />
        <ReadinessItem
          label="Restricted Processes"
          status={readiness.restrictedApps}
          theme={theme}
          onResolve={onResolve ? () => onResolve("restrictedApps") : undefined}
        />
      </div>

      {context &&
        (() => {
          // Highlighted trace log, not a consumer alert box: a 2px left rule +
          // a bracketed monospace tag, coloured by state (electric amber for WARN).
          const log =
            context.status === "ready"
              ? { tag: "OK", color: "var(--home-status-ok)" }
              : context.status === "advisory_warning"
                ? { tag: "WARN", color: "var(--home-status-warn)" }
                : context.status === "checking"
                  ? { tag: "SCAN", color: "var(--theme-accent-text)" }
                  : { tag: "FAIL", color: "var(--home-status-error)" };
          return (
            <div
              style={{
                borderLeft: `2px solid ${log.color}`,
                padding: "8px 0 8px 12px",
                marginBottom: "18px",
                fontFamily: "var(--font-mono), monospace",
                fontSize: "12px",
                lineHeight: 1.55,
                color: log.color,
              }}
            >
              <span style={{ fontWeight: 700 }}>[{log.tag}]</span>{" "}
              <span className="rl-info" tabIndex={0} style={{ color: log.color }}>
                <Info size={13} strokeWidth={2.5} aria-label={context.message} />
                <span className="rl-tip" role="tooltip">
                  {context.message}
                </span>
              </span>
            </div>
          );
        })()}

      <Button
        onClick={onSettingsRedirect}
        theme={theme}
        variant="primary"
        style={{
          width: "100%",
          borderRadius: "9999px",
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Open settings
      </Button>

      {onPracticeRun && (
        <Button
          onClick={onPracticeRun}
          theme={theme}
          variant="secondary"
          style={{
            width: "100%",
            marginTop: "10px",
            borderRadius: "9999px",
            background: "transparent",
            border: "1px solid var(--home-border-control)",
            color: "var(--text-dim)",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--theme-text)";
            e.currentTarget.style.borderColor = "var(--home-border-hover)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-dim)";
            e.currentTarget.style.borderColor = "var(--home-border-control)";
          }}
        >
          Test setup
        </Button>
      )}
    </div>
  );
});

export const ReadinessItem = memo(function ReadinessItem({
  label,
  status,
  theme,
  onResolve,
}: {
  label: string;
  status: "ok" | "fail" | "checking";
  theme: "dark" | "light";
  onResolve?: () => void;
}) {
  const c = getThemeColors(theme);
  const tone = toneForStatus(status);
  const t = toneStyles(tone, theme);
  // Dot LED palette — indicator tokens (AA-checked), not raw hex
  const dotColor =
    status === "ok"
      ? "var(--theme-dot)"
      : status === "fail"
        ? "var(--color-indicator-error)"
        : "var(--color-indicator-warn)";
  const stateWord = status === "ok" ? "SECURE" : status === "fail" ? "NEEDS ACTION" : "SCANNING";
  const statusLabel = status === "ok" ? "Secure" : status === "fail" ? "Needs action" : "Scanning";

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
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 500,
            color: c.textMutedStrong,
            letterSpacing: 0,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: t.text,
          }}
        >
          {stateWord}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {status === "fail" && onResolve ? (
          <Button
            type="button"
            theme={theme}
            variant="secondary"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onResolve();
            }}
          >
            Resolve
          </Button>
        ) : null}
      </div>
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
});
