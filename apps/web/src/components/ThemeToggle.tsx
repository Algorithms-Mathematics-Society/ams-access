"use client";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Until mounted, render a theme-neutral icon so the first client render matches
  // the static HTML (no hydration mismatch, no wrong-icon flicker). The page itself
  // never flashes — the FOUC script set the class pre-paint.
  const isLight = mounted && theme === "light";

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={mounted ? `Switch to ${isLight ? "dark" : "light"} theme` : "Toggle theme"}
      aria-pressed={mounted ? isLight : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--theme-border)",
        background: "transparent",
        color: "var(--text-dim)",
        cursor: "pointer",
        transition: "color var(--transition-fast), border-color var(--transition-fast)",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        {isLight ? (
          <circle cx="12" cy="12" r="5" />
        ) : (
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </svg>
    </button>
  );
}
