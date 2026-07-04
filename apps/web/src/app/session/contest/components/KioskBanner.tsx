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
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        padding: "10px 18px",
        borderRadius: "var(--radius-md, 14px)",
        background: "rgba(12,24,48,0.92)",
        border: "1px solid rgba(168,85,247,0.55)",
        boxShadow: "0 0 20px rgba(168,85,247,0.18)",
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
