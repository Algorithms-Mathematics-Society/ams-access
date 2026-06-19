"use client";

import { memo, useMemo } from "react";
import { Info } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, ChecklistItem } from "./ui-primitives";
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
        border: "1px solid #27272a",
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
            color: "rgba(255,255,255,0.45)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Device Readiness
        </h3>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: "24px" }}>
        <ReadinessItem
          label="Internet connection"
          status={readiness.network}
          theme={theme}
          onResolve={onResolve ? () => onResolve("network") : undefined}
        />
        <ReadinessItem
          label="Camera"
          status={readiness.camera}
          theme={theme}
          onResolve={onResolve ? () => onResolve("camera") : undefined}
        />
        <ReadinessItem
          label="Microphone"
          status={readiness.mic}
          theme={theme}
          onResolve={onResolve ? () => onResolve("mic") : undefined}
        />
        <ReadinessItem
          label="Real device"
          status={readiness.vm}
          theme={theme}
          onResolve={onResolve ? () => onResolve("vm") : undefined}
        />
        <ReadinessItem
          label="Keyboard"
          status={readiness.keyboard}
          theme={theme}
          onResolve={onResolve ? () => onResolve("keyboard") : undefined}
        />
        <ReadinessItem
          label="Supported system"
          status={readiness.platform}
          theme={theme}
          onResolve={onResolve ? () => onResolve("platform") : undefined}
        />
        <ReadinessItem
          label="Other apps closed"
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
              ? { tag: "OK", color: "#22c55e" }
              : context.status === "advisory_warning"
                ? { tag: "WARN", color: "#fbbf24" }
                : context.status === "checking"
                  ? { tag: "SCAN", color: "#c084fc" }
                  : { tag: "FAIL", color: "#ef4444" };
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
          borderRadius: "var(--radius-md)",
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
            borderRadius: "var(--radius-md)",
            background: "transparent",
            border: "1px solid #3f3f46",
            color: "#a1a1aa",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "#ffffff";
            e.currentTarget.style.borderColor = "#52525b";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "#a1a1aa";
            e.currentTarget.style.borderColor = "#3f3f46";
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
  return (
    <ChecklistItem
      label={label}
      status={status}
      theme={theme}
      action={
        status === "fail" && onResolve ? (
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
        ) : null
      }
    />
  );
});
