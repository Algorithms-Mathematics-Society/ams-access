"use client";
import { useEffect, useState } from "react";
import { IconButton } from "@ams/shared-ui";
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
    <IconButton
      type="button"
      onClick={toggle}
      className={className}
      label={mounted ? `Switch to ${isLight ? "dark" : "light"} theme` : "Toggle theme"}
      tooltip={mounted ? `Switch to ${isLight ? "dark" : "light"} theme` : "Toggle theme"}
      aria-pressed={mounted ? isLight : undefined}
      variant="ghost"
      size="md"
      icon={
        <svg
          width="var(--spacing-4)"
          height="var(--spacing-4)"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {isLight ? (
            // A sun needs its rays. The bare circle this replaces rendered as
            // a small empty ring next to the Exit button and read as a dead
            // dot rather than a control -- nobody pressed it because nothing
            // about it said it could be pressed.
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </>
          ) : (
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          )}
        </svg>
      }
    />
  );
}
