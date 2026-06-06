"use client";

import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import { getThemeColors } from "./utils";
import type { SecurityLogEntry, SecurityLogLevel } from "./types";

const LEVEL_COLOR: Record<SecurityLogLevel, string> = {
  error: "#ef4444",
  warn: "#f59e0b",
  info: "",
};

export function parseLogLine(text: string, statusColor: string): ReactNode {
  let splitIndex = text.indexOf("... ");
  let sep = "... ";
  if (splitIndex === -1) {
    splitIndex = text.indexOf(": ");
    sep = ": ";
  }

  if (splitIndex === -1) {
    return <span style={{ color: statusColor }}>{text}</span>;
  }

  const prefix = text.substring(0, splitIndex + sep.length);
  const status = text.substring(splitIndex + sep.length);

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
              {parseLogLine(log.text, LEVEL_COLOR[log.level] || themeColors.consoleText)}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
