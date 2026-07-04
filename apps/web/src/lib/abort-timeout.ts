// Opt-in request timeout for otherwise-untimed fetches (e.g. the save/submit
// keepalive posts). Returns an AbortSignal that fires after timeoutMs, plus a
// clear() to cancel it once the request settles. See design 2026-07-03 §5 2a.
export function createAbortTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(id),
  };
}
