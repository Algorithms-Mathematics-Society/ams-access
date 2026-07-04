"use client";
import { useSyncExternalStore } from "react";
import { type Theme, isValidTheme, resolveThemeFrom } from "./theme-core";
import { STORAGE_KEYS } from "@/constants/storage-keys";

const KEY = STORAGE_KEYS.THEME; // "ams_theme"

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return isValidTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function systemPrefersLight(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(): Theme {
  return resolveThemeFrom(storedTheme(), systemPrefersLight());
}

/** THE ONLY writer of the html theme class. */
function apply(t: Theme): void {
  const c = document.documentElement.classList;
  c.remove(t === "dark" ? "light" : "dark");
  c.add(t);
}

/** Reads the applied DOM truth (the class the FOUC script / apply() set). */
export function getSnapshot(): Theme {
  try {
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  } catch {
    return "dark";
  }
}

const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}

let wired = false;
function wireOnce(): void {
  if (wired) return;
  wired = true;
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (storedTheme() === null) {
        apply(systemPrefersLight() ? "light" : "dark");
        notify();
      }
    });
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) {
        apply(resolveTheme());
        notify();
      }
    });
  } catch {
    /* non-browser / SSR build — no listeners */
  }
}

export function subscribe(cb: () => void): () => void {
  wireOnce();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** THE ONLY writer of localStorage[ams_theme]. */
export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage blocked — still apply for this session */
  }
  apply(t);
  notify();
}

export function toggleTheme(): void {
  setTheme(getSnapshot() === "dark" ? "light" : "dark");
}

export function useTheme(): {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
} {
  const theme = useSyncExternalStore<Theme>(subscribe, getSnapshot, () => "dark");
  return { theme, setTheme, toggle: toggleTheme };
}
