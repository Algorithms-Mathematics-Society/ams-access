"use client";

import { useEffect, useState } from "react";
import { listen } from "@ams/api-client";
import { VStack } from "@astryxdesign/core/Stack";
import { Banner } from "@astryxdesign/core/Banner";

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

  return <VStack role="status" aria-live="polite" style={{ position: "fixed", top: "calc(var(--spacing-10) * 2)", left: "50%", transform: "translateX(-50%)", zIndex: 1000, width: "min(calc(100% - var(--spacing-8)), calc(var(--spacing-10) * 12))", pointerEvents: "none" }}><Banner status="warning" title={msg} /></VStack>;
}
