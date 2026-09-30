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

/** The `@access` a candidate sees after their handle. Rendered as a fixed
 * suffix beside the field rather than typed, so there is nothing to misspell —
 * and stripped here anyway, because they will paste the whole thing. */
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
 * Letters, dots and hyphens survive; digits do not, because no handle contains
 * a digit. That is what removes the `0`/`o` and `1`/`l` ambiguity when one is
 * read aloud across a room.
 */
export function formatHandle(raw: string): string {
  const beforeAt = raw.split("@", 1)[0];
  return beforeAt
    .toLowerCase()
    .replace(/[^a-z.-]/g, "")
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
