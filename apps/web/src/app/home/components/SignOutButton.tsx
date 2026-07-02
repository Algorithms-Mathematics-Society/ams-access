"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
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
        gap: "8px",
        padding: "9px 12px",
        borderRadius: "var(--radius-md)",
        border: hovered ? "1px solid var(--home-status-error-border-20)" : "1px solid transparent",
        background: hovered ? "var(--home-status-error-bg)" : "transparent",
        color: hovered ? "var(--home-status-error)" : c.textMuted,
        fontSize: "13px",
        fontWeight: 400,
        fontFamily: "inherit",
        cursor: loading ? "not-allowed" : "pointer",
        transition:
          "background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast)",
        width: "100%",
        textAlign: "left",
      }}
    >
      <LogOut size={16} strokeWidth={1.7} />
      Sign out
    </button>
  );
}
