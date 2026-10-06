/** Presentation only: a server draft and a judged submission are different records. */
export type SourceSnapshot = { source: string; language: string };

export function sameSource(a: SourceSnapshot | null | undefined, b: SourceSnapshot): boolean {
  return Boolean(a && a.source === b.source && a.language === b.language);
}

/**
 * Where the candidate's work currently is.
 *
 * Drafts are not sent to the server. They are written to this device on every
 * change and read back on restart, so there is no in-flight state to report
 * and no failure mode to warn about — which is the point: the old version
 * could put "Server save not confirmed · retrying" in front of someone
 * mid-contest about code that was never at risk, and a flaky connection made
 * that a routine sight rather than an alarming one.
 *
 * Kept as a function rather than inlined so the footer keeps one place to ask,
 * and so restoring server drafts later means changing this and nothing else.
 */
export function draftStatus(): { label: string; confirmed: boolean } {
  return { label: "Saved on this device", confirmed: true };
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
