// When a 401 inside the contest room counts as a real sign-out.
//
// Signing out releases the lockdown and sends the candidate to the login
// screen, which mid-exam may mean a lost slip. A single 401 can come from a
// key rotation or a brief server fault and hit the whole hall at once, so it
// is treated as provisional: recheck after a pause, and only a second 401 at
// least that long after the first confirms it. Any success clears the record.

/** The pause before rechecking, and the minimum gap between the two 401s. */
export const AUTH_RECHECK_MS = 5_000;

/** `firstAt` is when the unconfirmed 401 arrived, or null if none is pending. */
export function onUnauthorized(
  firstAt: number | null,
  now: number
): { firstAt: number; signedOut: boolean } {
  if (firstAt === null) return { firstAt: now, signedOut: false };
  return { firstAt, signedOut: now - firstAt >= AUTH_RECHECK_MS };
}
