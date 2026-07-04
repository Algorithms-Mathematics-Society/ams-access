import { useEffect, useRef, useState } from "react";
import { countdownPhase, type CountdownPhase } from "../countdown";

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

export function useCountdown(endAt: string, onExpiry?: () => void) {
  const totalMsRef = useRef<number | null>(null);
  const firedExpiryRef = useRef(false);
  const [state, setState] = useState<{
    remaining: string;
    phase: CountdownPhase;
    percentLeft: number;
  }>({
    remaining: "",
    phase: "nominal",
    percentLeft: 1,
  });

  useEffect(() => {
    totalMsRef.current = null;
    firedExpiryRef.current = false;
    let id: ReturnType<typeof setInterval> | null = null;
    function tick() {
      const diff = new Date(endAt).getTime() - Date.now();
      if (totalMsRef.current === null) totalMsRef.current = Math.max(diff, 0);
      const percentLeft =
        totalMsRef.current > 0 ? Math.max(0, Math.min(1, diff / totalMsRef.current)) : 0;
      if (diff <= 0) {
        setState((prev) =>
          prev.remaining === "00:00:00" && prev.phase === "expired"
            ? prev
            : { remaining: "00:00:00", phase: "expired", percentLeft: 0 }
        );
        if (!firedExpiryRef.current && onExpiry) {
          firedExpiryRef.current = true;
          onExpiry();
        }
        if (id) clearInterval(id);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const remaining = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
  }, [endAt]);

  return state;
}
