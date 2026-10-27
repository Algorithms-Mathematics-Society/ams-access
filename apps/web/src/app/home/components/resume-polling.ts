import type { ActiveSession } from "./types";

type ResumeRequest = {
  id?: string;
  status?: string;
  requested_at?: string;
  review_note?: string | null;
};

/** Preserve identity (and avoid storage writes) when the server has no new decision. */
export function mergeResumeRequestIntoSession(
  session: ActiveSession,
  request?: ResumeRequest | null
): ActiveSession {
  if (!request) return session;
  const fields = {
    resume_request_id: request.id ?? session.resume_request_id,
    resume_request_status: request.status ?? session.resume_request_status,
    resume_request_requested_at: request.requested_at ?? session.resume_request_requested_at,
    resume_request_review_note: request.review_note ?? session.resume_request_review_note ?? null,
  };
  if (Object.entries(fields).every(([key, value]) => session[key as keyof ActiveSession] === value))
    return session;
  return { ...session, ...fields };
}

/** One request at a time. Failures back off, respect Retry-After and never queue catch-up polls. */
export function startResumePolling(
  refresh: (isCancelled: () => boolean) => void | Promise<void>,
  random: () => number = Math.random
) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const schedule = (remaining: number) => {
    if (cancelled) return;
    // JS timers overflow at ~24.8 days. Chunk long server delays rather than
    // accidentally turning Retry-After into a one-millisecond request loop.
    const chunk = Math.min(remaining, 86_400_000);
    timer = setTimeout(() => {
      if (remaining > chunk) schedule(remaining - chunk);
      else void poll();
    }, chunk);
  };
  const poll = async () => {
    if (cancelled) return;
    let delay = 3000;
    try {
      await refresh(() => cancelled);
      failures = 0;
    } catch (error) {
      failures = Math.min(failures + 1, 4);
      const hint = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
      const serverWait =
        typeof hint === "number" && Number.isFinite(hint) && hint > 0 ? hint * 1000 : 0;
      delay = Math.max(serverWait, Math.min(30_000, 3000 * 2 ** failures)) + random() * 3000;
    } finally {
      if (!cancelled) schedule(delay);
    }
  };
  void poll();
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
