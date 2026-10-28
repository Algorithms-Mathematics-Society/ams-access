/** Bounded, session-local provenance; never store external clipboard content. */
let allowed: { text: string; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

export function resetAllowedClipboard() {
  allowed = null;
}

export function registerAllowedClipboard(text: string) {
  allowed = text ? { text: normalize(text), at: Date.now() } : null;
}

export function isAllowedClipboard(text: string): boolean {
  return Boolean(
    allowed && text && Date.now() - allowed.at < TTL_MS && normalize(text) === allowed.text
  );
}
