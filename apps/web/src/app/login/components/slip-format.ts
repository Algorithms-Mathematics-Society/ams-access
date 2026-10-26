/**
 * Shaping what a candidate types into the sign-in fields, as they type it.
 *
 * Separate from the component because it is the part worth testing: someone is
 * transcribing or pasting under time pressure, about to sit an exam, and every
 * way the field can fight them is a support ticket during a live contest.
 *
 * Accept documented presentation differences without deleting meaningful
 * characters from an identity. Invalid input stays visible for correction.
 */

/** Optional suffix accepted when a candidate pastes their full login handle. */
export const HANDLE_SUFFIX = "@access";

/**
 * A handle, e.g. `ayush.s-kqmwd`.
 *
 * Lowercase, because handles are stored lowercase — the previous formatter
 * upper-cased for `AMS-7K3M-QR9T`, which for a handle matches nothing at all.
 *
 * Strip only the documented full-handle suffixes. Keep internal whitespace,
 * punctuation, unknown domains and overlong input visible: deleting them can
 * turn a typo into another participant's valid identity. The server remains
 * responsible for rejecting an unrecognised ID.
 */
export function formatHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/@access(?:\.amsaccess\.com)?$/, "")
    .trim();
}

/** `XXXX-XXXX-XXXX`. Unchanged: the server still issues this format, and a
 * field that reshaped it into something else would reject every real password.
 *
 * Anything past twelve characters is dropped rather than
 * sent for the server to reject with a message that would not say which
 * character was extra. */
export function formatPassword(raw: string): string {
  const body = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const groups: string[] = [];
  for (let index = 0; index < body.length && groups.length < 3; index += 4) {
    groups.push(body.slice(index, index + 4));
  }
  return groups.join("-");
}
