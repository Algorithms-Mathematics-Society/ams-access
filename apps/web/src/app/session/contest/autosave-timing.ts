// Autosave delay policy. Split into two knobs so a snappy warm-save debounce
// (AUTOSAVE_DEBOUNCE_MS) is DECOUPLED from the failure-retry backoff base
// (SAVE_RETRY_BASE_DELAY_MS) — trimming the debounce must not make retries
// hammer harder. See design 2026-07-03-contest-save-latency-and-region §5 2c.

/** First-attempt debounce floor: fire the save ~600ms after typing stops. */
export const AUTOSAVE_DEBOUNCE_MS = 600;
/** Backoff base AFTER a failed save (unchanged from prior behaviour). */
export const SAVE_RETRY_BASE_DELAY_MS = 1500;
/** Backoff cap. */
export const SAVE_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Delay (ms) before the next autosave fires.
 * @param failures consecutive failed-save count (0 = fresh edit, no failure yet)
 * @param rand injectable RNG for jitter; defaults to Math.random
 */
export function computeAutosaveDelayMs(failures: number, rand: () => number = Math.random): number {
  const base =
    failures === 0
      ? AUTOSAVE_DEBOUNCE_MS
      : Math.min(SAVE_RETRY_BASE_DELAY_MS * 2 ** failures, SAVE_RETRY_MAX_DELAY_MS);
  const jitter = Math.round(rand() * 400);
  return base + jitter;
}
