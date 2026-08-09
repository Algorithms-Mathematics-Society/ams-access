/**
 * Formatting the two codes on a printed slip, as they are typed.
 *
 * Separate from the component because it is the part worth testing: someone
 * is transcribing by hand, under time pressure, about to sit an exam, and
 * every way the field can fight them is a support ticket during a live
 * contest. (It is also why the server's alphabet omits 0/O and 1/I/L.)
 *
 * Formatting as they type rather than validating afterwards: a candidate
 * should never be told "incorrect login" for punctuation.
 */

/** `AMS-XXXX-XXXX`. The prefix is added, not demanded. */
export function formatLoginId(raw: string): string {
  const body = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const withoutPrefix = body.startsWith("AMS") ? body.slice(3) : body;
  const groups = [withoutPrefix.slice(0, 4), withoutPrefix.slice(4, 8)].filter(Boolean);
  if (groups.length === 0) return "";
  return ["AMS", ...groups].join("-");
}

/** `XXXX-XXXX-XXXX`. Anything past twelve characters is dropped rather than
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
