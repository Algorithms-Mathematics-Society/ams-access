"use client";

import { useState } from "react";
import { getThemeColors } from "./utils";

export function SignOutButton({
  onClick,
  loading,
  theme,
}: {
  onClick: () => void;
  loading: boolean;
  theme: "dark" | "light";
}) {
  const [hovered, setHovered] = useState(false);
  const c = getThemeColors(theme);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "9px 12px",
        borderRadius: "8px",
        border: "none",
        background: hovered ? "rgba(239,68,68,0.08)" : "transparent",
        color: hovered ? "#ef4444" : c.textMuted,
        fontSize: "13px",
        fontWeight: 400,
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition: "all 220ms cubic-bezier(0.22,1,0.36,1)",
        width: "100%",
        textAlign: "left",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3M11 11l3-3-3-3M14 8H6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sign out
    </button>
  );
}
