/** Published-only payload from the authenticated contest index. */
export type ReferenceSheet = {
  title: string;
  body: string;
  revision: number;
  published_at: string;
};

/** Fail closed for old servers and malformed/oversized optional guidance.
 * Never interpret organizer text as markup or silently truncate instructions. */
export function readReferenceSheet(value: unknown): ReferenceSheet | null {
  if (!value || typeof value !== "object") return null;
  const sheet = value as Partial<ReferenceSheet>;
  if (
    typeof sheet.title !== "string" ||
    // A code point occupies at most two UTF-16 units. Bound work before
    // trimming/counting an oversized response, while preserving Unicode.
    sheet.title.length > 240 ||
    !sheet.title.trim() ||
    Array.from(sheet.title).length > 120 ||
    typeof sheet.body !== "string" ||
    sheet.body.length > 40_000 ||
    !sheet.body.trim() ||
    Array.from(sheet.body).length > 20_000 ||
    !Number.isSafeInteger(sheet.revision) ||
    (sheet.revision ?? 0) < 1 ||
    typeof sheet.published_at !== "string" ||
    !Number.isFinite(Date.parse(sheet.published_at))
  )
    return null;
  return {
    title: sheet.title,
    body: sheet.body,
    revision: sheet.revision!,
    published_at: sheet.published_at,
  };
}
