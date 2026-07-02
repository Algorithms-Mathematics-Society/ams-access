"use client";

import { useMemo } from "react";
import { CalendarDays } from "lucide-react";
import { getThemeColors } from "./utils";
import { ActiveContestCard } from "./ContestCards";
import { Panel } from "./ui-primitives";
import type { InvitedContest, ContestantReadinessContext } from "./types";

export function ContestsPanel({
  contests,
  loading,
  theme,
  onPreflight,
  readinessContext,
}: {
  contests: InvitedContest[];
  loading: boolean;
  theme: "dark" | "light";
  onPreflight: (contestId: string, type: "new" | "resume") => void;
  readinessContext?: ContestantReadinessContext;
}) {
  const themeColors = getThemeColors(theme);

  function statusColor(s: string) {
    if (s === "ACTIVE")
      return {
        dot: "var(--theme-dot)",
        bg: "var(--home-status-ok-bg)",
        border: "var(--home-status-ok-border)",
      };
    if (s === "SCHEDULED")
      return {
        dot: "var(--home-accent-dot)",
        bg: "rgb(var(--accent-rgb) / 0.08)",
        border: "rgb(var(--accent-rgb) / 0.2)",
      };
    if (s === "ENDED")
      return {
        dot: "var(--home-dot-ended)",
        bg: "var(--home-overlay-ended)",
        border: "var(--home-border-ended)",
      };
    return {
      dot: "var(--home-status-warn-dot)",
      bg: "var(--home-status-warn-bg)",
      border: "var(--home-status-warn-border-20)",
    };
  }

  if (loading) {
    return (
      <div>
        <p
          style={{
            fontSize: "11px",
            color: "var(--theme-text-muted)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          }}
        >
          Contests
        </p>
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: "90px",
              borderRadius: "var(--radius-md)",
              background: "rgba(255,255,255,0.015)",
              border: "1px solid rgba(255,255,255,0.04)",
              marginBottom: "12px",
              animation: "pulse-dot 2.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <Panel
        theme={theme}
        style={{
          borderStyle: "dashed",
          padding: "24px 28px",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: "18px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "var(--radius-sm)",
            background: "rgba(255,255,255,0.01)",
            border: `1px solid ${themeColors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <CalendarDays size={18} strokeWidth={1.9} color={themeColors.accent} />
        </div>
        <div style={{ flex: 1 }}>
          <h4
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: themeColors.text,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              margin: 0,
              letterSpacing: "0.05em",
            }}
          >
            No contests yet.
          </h4>
          <p
            style={{
              fontSize: "12px",
              color: themeColors.textMuted,
              margin: "4px 0 0",
              lineHeight: 1.4,
            }}
          >
            If you have an invite code, enter it above. Upcoming contests will appear here after
            they are added.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div>
      <p
        style={{
          fontSize: "11px",
          color: "var(--theme-text-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
          fontWeight: 600,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      >
        CONTESTS ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {contests.map((c) => {
          const col = statusColor(c.status);
          return (
            <ActiveContestCard
              key={c.id}
              c={c}
              col={col}
              onPreflight={onPreflight}
              theme={theme}
              readinessContext={readinessContext}
            />
          );
        })}
      </div>
    </div>
  );
}
