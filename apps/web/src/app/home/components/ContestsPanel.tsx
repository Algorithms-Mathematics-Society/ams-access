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
        dot: theme === "light" ? "#10b981" : "#22c55e",
        bg: "rgba(34,197,94,0.08)",
        border: "rgba(34,197,94,0.2)",
      };
    if (s === "SCHEDULED")
      return {
        dot: theme === "light" ? "#7c3aed" : "#8b5cf6",
        bg: theme === "light" ? "rgba(124,58,237,0.08)" : "rgba(139,92,246,0.08)",
        border: theme === "light" ? "rgba(124,58,237,0.2)" : "rgba(139,92,246,0.2)",
      };
    if (s === "ENDED")
      return {
        dot: theme === "light" ? "#7c7467" : "rgba(255,255,255,0.25)",
        bg: theme === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)",
        border: theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.1)",
      };
    return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" };
  }

  if (loading) {
    return (
      <div>
        <p
          style={{
            fontSize: "11px",
            color: themeColors.textMuted,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "16px",
            fontWeight: 700,
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
              borderRadius: "8px",
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
            borderRadius: "6px",
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
          color: themeColors.textMuted,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
          fontWeight: 600,
        }}
      >
        Contests ({contests.length})
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {contests.map((c) => {
          const col = statusColor(c.status);
          return (
            <ActiveContestCard key={c.id} c={c} col={col} onPreflight={onPreflight} theme={theme} readinessContext={readinessContext} />
          );
        })}
      </div>
    </div>
  );
}
