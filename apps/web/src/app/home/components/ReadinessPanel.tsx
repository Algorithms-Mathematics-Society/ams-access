"use client";

import { memo, useMemo } from "react";
import { Settings } from "lucide-react";
import { getThemeColors } from "./utils";
import { Button, ChecklistItem, InlineAlert } from "./ui-primitives";
import type { ReadinessState, ContestantReadinessContext } from "./types";


export const ReadinessWidget = memo(function ReadinessWidget({
  readiness,
  onSettingsRedirect,
  theme,
  onResolve,
  context,
}: {
  readiness: ReadinessState;
  onSettingsRedirect: () => void;
  theme: "dark" | "light";
  onResolve?: (key: string) => void;
  context?: ContestantReadinessContext;
}) {
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: `1px solid ${themeColors.border}`,
        borderRadius: "8px",
        padding: "24px",
        boxShadow: "none",
        transition: "all 150ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
        <h3
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: themeColors.textMuted,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Device Readiness
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
          label="Virtual machine check"
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
          label="Restricted apps"
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
          e.currentTarget.style.background = "#9333ea";
          e.currentTarget.style.borderColor = "#c084fc";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#a855f7";
          e.currentTarget.style.borderColor = "#a855f7";
        }}
      >
        <Settings size={14} strokeWidth={2} />
        Open Settings
      </Button>
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
            variant="danger"
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
