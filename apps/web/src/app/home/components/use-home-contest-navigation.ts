"use client";

import { useCallback, useEffect, useState } from "react";

/** Calendar navigation is local UI state; it never invokes contest entry. */
export function useHomeContestNavigation(clearSearch: (query: string) => void, isHome: boolean) {
  const [target, setTarget] = useState<{ id: string } | null>(null);
  const [highlightedContestId, setHighlightedContestId] = useState<string | null>(null);
  const showContest = useCallback((id: string) => {
    clearSearch("");
    setHighlightedContestId(id);
    setTarget({ id });
  }, [clearSearch]);

  useEffect(() => {
    if (!isHome) {
      setTarget(null);
      setHighlightedContestId(null);
      return;
    }
    if (!target) return;
    // Wait for the cleared search to reveal the keyed contest row before focusing it.
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`home-contest-${encodeURIComponent(target.id)}`);
      if (!row) return;
      row.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
      row.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => {
      setHighlightedContestId(null);
      setTarget(null);
    }, 2500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [target, isHome]);

  return { highlightedContestId, showContest };
}
