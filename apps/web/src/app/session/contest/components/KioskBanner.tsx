"use client";

import { useEffect, useState } from "react";
import { listen } from "@ams/api-client";

type ResumePayload = {
  kind: string;
  detail: string;
  duration_ms: number;
  ever_locked: boolean;
};

/**
 * Non-blocking toast shown when the exam window regains foreground after a
 * focus-loss / lock episode. Informational only — no input capture, no action.
 * Reacts to the Windows-only `focus_resumed` event; inert on macOS/Linux.
 */
export function KioskBanner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    listen<ResumePayload>("lockdown-event", (p) => {
      if (p?.kind !== "focus_resumed") return;
      const secs = Math.round((p.duration_ms ?? 0) / 1000);
      setMsg(
        p.ever_locked
          ? `Your screen was locked — ${secs}s logged`
          : `You left the exam window — ${secs}s logged`
      );
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 8000);
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!msg) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        // Below the 48px TopBar: at top:16 the banner fully covered the
        // redesign's centered countdown badge for its whole 8s life — the one
        // moment (post-lock resume) a candidate most needs the remaining time.
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        padding: "10px 18px",
        borderRadius: "var(--radius-md, 14px)",
        background: "rgba(21,21,21,0.95)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
        color: "#F5F7FA",
        fontSize: 13,
        letterSpacing: "0.01em",
        backdropFilter: "blur(6px)",
        pointerEvents: "none",
      }}
    >
      {msg}
    </div>
  );
}
