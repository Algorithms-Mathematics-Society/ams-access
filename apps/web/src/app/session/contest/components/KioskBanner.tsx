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
/** How long the toast stays up once the window is back in front. */
const VISIBLE_MS = 8000;

export function KioskBanner() {
  // The deadline travels with the message rather than living in a timer
  // handle. A lone `setTimeout` was dismissing this, and it is scheduled at
  // precisely the moment the webview is least likely to honour it: the
  // window has just come back from losing focus or from a lock screen, where
  // timers are throttled to seconds or suspended entirely. A dropped timeout
  // left the banner on screen for the rest of the exam, covering the
  // statement, with no way to dismiss it — `pointerEvents: none` means a
  // candidate cannot even click it away.
  const [toast, setToast] = useState<{ text: string; expiresAt: number } | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<ResumePayload>("lockdown-event", (p) => {
      if (p?.kind !== "focus_resumed") return;
      const secs = Math.round((p.duration_ms ?? 0) / 1000);
      setToast({
        text: p.ever_locked
          ? `Your screen was locked — ${secs}s logged`
          : `You left the exam window — ${secs}s logged`,
        expiresAt: Date.now() + VISIBLE_MS,
      });
    })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Three chances to retire it, so no single throttled callback can strand
  // the banner: a poll that still fires eventually however throttled, and
  // the two events that mean the candidate is looking at the screen again.
  useEffect(() => {
    if (!toast) return;
    const retireIfDue = () => {
      if (Date.now() >= toast.expiresAt) setToast(null);
    };
    const poll = setInterval(retireIfDue, 500);
    window.addEventListener("focus", retireIfDue);
    document.addEventListener("visibilitychange", retireIfDue);
    return () => {
      clearInterval(poll);
      window.removeEventListener("focus", retireIfDue);
      document.removeEventListener("visibilitychange", retireIfDue);
    };
  }, [toast]);

  const msg = toast?.text ?? null;
  if (!msg) return null;

  return (
    <VStack
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: "calc(var(--spacing-10) * 2)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        width: "min(calc(100% - var(--spacing-8)), calc(var(--spacing-10) * 12))",
        pointerEvents: "none",
      }}
    >
      <Banner status="warning" title={msg} />
    </VStack>
  );
}
