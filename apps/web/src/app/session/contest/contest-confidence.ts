/** Presentation only: a server draft and a judged submission are different records. */
export type SourceSnapshot = { source: string; language: string };

export function sameSource(a: SourceSnapshot | null | undefined, b: SourceSnapshot): boolean {
  return Boolean(a && a.source === b.source && a.language === b.language);
}

export function draftStatus({ current, confirmed, saving, failed, ended }: {
  current: SourceSnapshot; confirmed?: SourceSnapshot; saving: boolean; failed: boolean; ended: boolean;
}): { label: string; confirmed: boolean } {
  const matches = sameSource(confirmed, current);
  if (matches) return { label: "Saved to server", confirmed: true };
  if (ended) return { label: "Latest draft not confirmed on server", confirmed: false };
  if (failed) return { label: "Server save not confirmed · retrying", confirmed: false };
  if (saving) return { label: "Saving to server…", confirmed: false };
  return { label: "Not yet saved to server", confirmed: false };
}

export function submissionComparison(current: SourceSnapshot, submitted?: SourceSnapshot): string {
  // Historical API records omit source. Absence must never imply a match.
  if (!submitted) return "";
  return sameSource(submitted, current) ? "Current code matches" : "Code or language changed since submission";
}

export type FinishReceipt = { confirmed: boolean; draftSaved: boolean };

/** Finishing acknowledges the session only; it never proves a failed draft save succeeded. */
export async function requestFinish(deps: {
  save: () => Promise<boolean>;
  finish: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  wait: (attempt: number) => Promise<void>;
}): Promise<FinishReceipt> {
  let draftSaved = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      draftSaved = (await deps.save()) || draftSaved;
    } catch { /* A later failed retry cannot erase an acknowledged, locked-source save. */ }
    try {
      const response = await deps.finish();
      if (response.ok) return { confirmed: true, draftSaved };
      const body = await response.json().catch(() => null);
      const code = body && typeof body === "object" && "code" in body ? body.code : undefined;
      if (code === "SESSION_ALREADY_SUBMITTED") return { confirmed: true, draftSaved };
      // A deadline being over does not acknowledge this request or its drafts.
      if (code === "CONTEST_ENDED") return { confirmed: false, draftSaved };
    } catch { /* Bounded retry; never claim there is a background uploader. */ }
    if (attempt < 3) await deps.wait(attempt);
  }
  return { confirmed: false, draftSaved };
}
