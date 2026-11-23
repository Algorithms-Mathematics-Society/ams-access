/** The server refuses longer questions; the panel says so before sending. */
export const MAX_QUESTION_WORDS = 200;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** What the participant sees when a question could not be answered at all. */
export function askErrorMessage(error: {
  status?: number;
  message?: string;
  detail?: Record<string, unknown> | null;
}): string {
  if (error.status === 429) {
    const wait = Number(error.detail?.retry_after);
    const minutes = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait / 60) : null;
    return minutes
      ? `You have reached the hourly question limit. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      : "You have reached the hourly question limit. Try again later.";
  }
  if (error.status === 503) return "The documentation assistant is unavailable right now.";
  if (error.status === 409 || error.status === 422)
    return error.message || "That question was not accepted.";
  return "The question could not be sent. Check your connection and try again.";
}

/** Keep the preferred rows in order, then append only unseen exchanges. */
export function mergeDocsMessages<T extends { exchange_uid: string }>(
  preferred: readonly T[],
  additional: readonly T[]
): T[] {
  const byId = new Map<string, T>();
  for (const rows of [preferred, additional]) {
    for (const row of rows) {
      if (!byId.has(row.exchange_uid)) byId.set(row.exchange_uid, row);
    }
  }
  return [...byId.values()];
}
