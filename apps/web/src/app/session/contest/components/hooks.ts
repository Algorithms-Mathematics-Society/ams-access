import { useEffect, useRef, useState } from "react";
import { countdownPhase, type CountdownPhase } from "../countdown";
import { serverNow } from "@/lib/proctor-api";
import {
  countdownLabel,
  formatRemaining,
  isBell,
  remainingMs,
  type ClockSnapshot,
} from "../session-clock";

export function useFocusTrap<T extends HTMLElement>(active: boolean, onEscape?: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const rootEl = ref.current;
    if (!rootEl) return;
    const trappedRoot: T = rootEl;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(trappedRoot.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
    );
    (focusable[0] ?? trappedRoot).focus({ preventScroll: true });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const currentFocusable = Array.from(
        trappedRoot.querySelectorAll<HTMLElement>(selector)
      ).filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true");
      if (currentFocusable.length === 0) {
        event.preventDefault();
        trappedRoot.focus({ preventScroll: true });
        return;
      }

      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [active, onEscape]);

  return ref;
}

/**
 * The exam countdown.
 *
 * Three properties, each of which was previously wrong:
 *
 * - **Driven by `serverNow()`, never `Date.now()`.** A candidate can set the
 *   system clock; this is the mechanism by which they could have extended
 *   their own exam.
 * - **A null deadline renders no countdown.** It used to fall back to "one
 *   hour from page load" and render that identically to a real deadline.
 * - **`onExpiry` lives in a ref.** It was excluded from the effect deps, so
 *   with a stable `endAt` the effect never re-ran and the callback stayed
 *   frozen at its mount-time closure — where `sessionId` was still null, so
 *   the handler returned immediately and the bell did nothing at all.
 */
export function useCountdown(
  snapshot: ClockSnapshot,
  onExpiry?: () => void
): { remaining: string; phase: CountdownPhase; percentLeft: number } {
  const totalMsRef = useRef<number | null>(null);
  const firedExpiryRef = useRef(false);

  // Read through a ref so a changing callback never needs an effect restart,
  // and a stable deadline never freezes a stale one.
  const onExpiryRef = useRef(onExpiry);
  onExpiryRef.current = onExpiry;

  const [state, setState] = useState<{
    remaining: string;
    phase: CountdownPhase;
    percentLeft: number;
  }>({ remaining: formatRemaining(null), phase: "nominal", percentLeft: 1 });

  const { endsAtMs, phase: serverPhase, untimed } = snapshot;

  useEffect(() => {
    totalMsRef.current = null;
    firedExpiryRef.current = false;

    if (endsAtMs === null) {
      // No deadline to count down. `countdownLabel` decides whether that is
      // "no time limit" (a practice contest, which the server has told us has
      // no end) or "we do not know yet" — both leave endsAtMs null, and only
      // the second should render as em-dashes.
      setState({
        remaining: countdownLabel({ endsAtMs, phase: serverPhase, untimed }, formatRemaining(null)),
        phase: "nominal",
        percentLeft: 1,
      });
      return;
    }

    let id: ReturnType<typeof setInterval> | null = null;

    function tick() {
      const current: ClockSnapshot = { endsAtMs, phase: serverPhase };
      const diff = remainingMs(current, serverNow()) ?? 0;
      if (totalMsRef.current === null) totalMsRef.current = Math.max(diff, 0);
      const percentLeft =
        totalMsRef.current > 0 ? Math.max(0, Math.min(1, diff / totalMsRef.current)) : 0;

      if (isBell(current, serverNow())) {
        setState((prev) =>
          prev.remaining === "00:00:00" && prev.phase === "expired"
            ? prev
            : { remaining: "00:00:00", phase: "expired", percentLeft: 0 }
        );
        if (!firedExpiryRef.current) {
          firedExpiryRef.current = true;
          onExpiryRef.current?.();
        }
        if (id) clearInterval(id);
        return;
      }

      const remaining = formatRemaining(diff);
      const phase = countdownPhase(diff);
      setState((prev) =>
        prev.remaining === remaining && prev.phase === phase
          ? prev
          : { remaining, phase, percentLeft }
      );
    }

    tick();
    id = setInterval(tick, 1000);
    return () => {
      if (id) clearInterval(id);
    };
  }, [endsAtMs, serverPhase, untimed]);

  return state;
}
