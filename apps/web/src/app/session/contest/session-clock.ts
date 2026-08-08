/**
 * The exam clock.
 *
 * Pure, and separate from the countdown hook, because the rule it encodes is
 * the one a candidate has the most incentive to break: **the clock is the
 * server's**. The room used to compute remaining time from `Date.now()`, so
 * setting the system clock back extended your own exam. Every function here
 * takes `nowMs` from the caller, and the caller passes `serverNow()`.
 *
 * The second rule is subtler. When there is no server clock at all, this
 * reports *no clock* rather than guessing. The previous code fell back to
 * "one hour from page load" and rendered it identically to a real deadline —
 * so a candidate whose contest metadata failed to load was shown a confident
 * countdown to a time that meant nothing.
 */

export type ClockPhase = "before_window" | "verification" | "running" | "ended";

export type ClockSnapshot = {
  /** Epoch ms. Null when the server has not told us yet. */
  endsAtMs: number | null;
  /** The server's own view, which outranks anything derived locally. */
  phase: ClockPhase;
};

/** Milliseconds left, floored at zero. Null when there is no known deadline. */
export function remainingMs(snapshot: ClockSnapshot, nowMs: number): number | null {
  if (snapshot.endsAtMs === null) return null;
  return Math.max(0, snapshot.endsAtMs - nowMs);
}

/**
 * Whether the exam is over.
 *
 * `phase` is checked first and on its own: the server saying "ended" is
 * authoritative even if the local deadline has not passed, which is what
 * closes the gap for a client whose clock is behind. A null deadline is *not*
 * a bell — not knowing when the exam ends must never end it.
 */
export function isBell(snapshot: ClockSnapshot, nowMs: number): boolean {
  if (snapshot.phase === "ended") return true;
  const remaining = remainingMs(snapshot, nowMs);
  return remaining !== null && remaining <= 0;
}

/** `HH:MM:SS`, floored at `00:00:00`. `null` renders as em-dashes, not zeros —
 * an unknown deadline must not look like an expired one. */
export function formatRemaining(ms: number | null): string {
  if (ms === null) return "—:—:—";
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Whether the paper should be open.
 *
 * Distinct from `isBell`: during the verification window a session exists and
 * the proctor is arming itself, but the statements are withheld — the server
 * 409s `getProblem` outside RUNNING, and this is what lets the room say
 * "opens in HH:MM:SS" instead of showing a load error.
 */
export function paperIsOpen(snapshot: ClockSnapshot): boolean {
  return snapshot.phase === "running";
}
