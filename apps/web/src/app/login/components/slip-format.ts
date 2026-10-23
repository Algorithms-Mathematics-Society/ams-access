/**
 * Shaping what a candidate types into the sign-in fields, as they type it.
 *
 * Separate from the component because it is the part worth testing: someone is
 * transcribing or pasting under time pressure, about to sit an exam, and every
 * way the field can fight them is a support ticket during a live contest.
 *
 * Shaping as they type rather than validating afterwards: a candidate should
 * never be told "incorrect login" for punctuation or capitals.
 */

/** Optional suffix accepted when a candidate pastes their full login handle. */
export const HANDLE_SUFFIX = "@access";

/**
 * A handle, e.g. `ayush.s-kqmwd`.
 *
 * Lowercase, because handles are stored lowercase — the previous formatter
 * upper-cased for `AMS-7K3M-QR9T`, which for a handle matches nothing at all.
 *
 * Everything from an `@` onward is dropped. A handle never contains one, and
 * the candidate's email shows them `ayush.s-kqmwd@access`, so pasting the whole
 * string is the normal case rather than the exceptional one.
 *
 * Letters, digits, dots, underscores and hyphens survive. Newly allocated
 * handles are letters only, but an existing username is reused as the login id
 * when a credential is issued, and those can carry digits and underscores
 * (`john_doe`, `ayush-shukla-2`). Only what the server can never issue is
 * dropped, so a real login id is never changed into a different one.
 */
export function formatHandle(raw: string): string {
  const beforeAt = raw.split("@", 1)[0];
  return beforeAt
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 64);
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
