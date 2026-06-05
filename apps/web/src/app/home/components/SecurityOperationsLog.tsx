"use client";

import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { getThemeColors } from "./utils";
import type { SecurityLogEntry } from "./types";

export function parseLogLine(log: string, dotColor: string): ReactNode {
  let splitIndex = log.indexOf("... ");
  let sep = "... ";
  if (splitIndex === -1) {
    splitIndex = log.indexOf(": ");
    sep = ": ";
  }

  if (splitIndex === -1) {
    return <span>{log}</span>;
  }

  const prefix = log.substring(0, splitIndex + sep.length);
  const status = log.substring(splitIndex + sep.length);

  let statusColor = dotColor;
  if (
    status.includes("ERROR") ||
    status.includes("CRITICAL") ||
    status.includes("DENIED") ||
    status.includes("UNREACHABLE")
  ) {
    statusColor = "#ef4444";
  } else if (status.includes("WARNING") || status.includes("MUTED") || status.includes("pending")) {
    statusColor = "#f59e0b";
  }

  return (
    <>
      <span style={{ color: "#A8A8A8" }}>{prefix}</span>
      <span style={{ color: statusColor, fontWeight: 700 }}>{status}</span>
    </>
  );
}

export const SecurityOperationsLog = memo(function SecurityOperationsLog({
  theme,
  logs,
}: {
  theme: "dark" | "light";
  logs: SecurityLogEntry[];
}) {
  const themeColors = useMemo(() => getThemeColors(theme), [theme]);

  return (
    <div
      style={{
        background: themeColors.cardBg,
        border: `1px solid ${themeColors.border}`,
        borderRadius: "8px",
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: themeColors.accent,
            boxShadow: `0 0 6px ${themeColors.accent}`,
          }}
        />
        <h4
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: themeColors.textMuted,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Session activity
        </h4>
      </div>
      <div
        style={{
          background: themeColors.innerBg,
          border: `1px solid ${themeColors.border}`,
          borderRadius: "6px",
          padding: "16px",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12px",
          color: themeColors.consoleText,
          lineHeight: 1.6,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        {logs.length === 0 ? (
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            No local security events observed in this session yet.
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {log.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
