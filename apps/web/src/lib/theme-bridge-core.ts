import type { Theme } from './theme-core';

/** Saved preference stays intact while an exam route enforces dark mode. */
export function effectiveTheme(preference: Theme, darkLocked: boolean): Theme {
  return darkLocked ? 'dark' : preference;
}

/** Runs after preference + route-lock initialization, before any page content. */
export function buildThemeBridgeBody(): string {
  return `var h=document.documentElement;h.setAttribute('data-astryx-theme','access');h.setAttribute('data-theme',h.classList.contains('theme-dark-locked')?'dark':h.classList.contains('light')?'light':'dark');`;
}

/** Keep portal and native-control theme attributes aligned with the existing store. */
export function syncThemeAttributes(): void {
  const root = document.documentElement;
  root.setAttribute('data-astryx-theme', 'access');
  root.setAttribute('data-theme', effectiveTheme(
    root.classList.contains('light') ? 'light' : 'dark',
    root.classList.contains('theme-dark-locked'),
  ));
}
