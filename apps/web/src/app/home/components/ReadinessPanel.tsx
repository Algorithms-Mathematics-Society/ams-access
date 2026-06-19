"use client";

import { memo, useMemo } from "react";
import { Settings, PlayCircle } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, ChecklistItem, InlineAlert } from "./ui-primitives";
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

      {context && (
        <InlineAlert
          theme={theme}
          tone={
            context.status === "ready"
              ? "success"
              : context.status === "advisory_warning"
                ? "warning"
                : context.status === "checking"
                  ? "accent"
                  : "danger"
          }
          style={{ marginBottom: "18px" }}
        >
          {context.message}
        </InlineAlert>
      )}

      <Button
        onClick={onSettingsRedirect}
        theme={theme}
        variant="primary"
        style={{ width: "100%" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--color-accent-base)";
          e.currentTarget.style.borderColor = "var(--color-accent-light)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--color-accent-base)";
          e.currentTarget.style.borderColor = "var(--color-accent-base)";
        }}
      >
        <Settings size={14} strokeWidth={2} />
        Open Settings
      </Button>

      {onPracticeRun && (
        <Button
          onClick={onPracticeRun}
          theme={theme}
          variant="secondary"
          style={{ width: "100%", marginTop: "10px" }}
        >
          <PlayCircle size={14} strokeWidth={2} />
          Test my setup (practice run)
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
