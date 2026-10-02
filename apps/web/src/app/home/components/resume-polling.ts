import type { ActiveSession } from "./types";

type ResumeRequest = { id?: string; status?: string; requested_at?: string; review_note?: string | null };

/** Preserve identity (and avoid storage writes) when the server has no new decision. */
export function mergeResumeRequestIntoSession(session: ActiveSession, request?: ResumeRequest | null): ActiveSession {
  if (!request) return session;
  const fields = {
    resume_request_id: request.id ?? session.resume_request_id,
    resume_request_status: request.status ?? session.resume_request_status,
    resume_request_requested_at: request.requested_at ?? session.resume_request_requested_at,
    resume_request_review_note: request.review_note ?? session.resume_request_review_note ?? null,
  };
  if (Object.entries(fields).every(([key, value]) => session[key as keyof ActiveSession] === value)) return session;
  return { ...session, ...fields };
}

/** Fixed cadence, one request at a time; disposal also invalidates an outstanding response. */
export function startResumePolling(refresh: (isCancelled: () => boolean) => void | Promise<void>) {
  let cancelled = false;
  let inFlight = false;
  const poll = async () => {
    if (cancelled || inFlight) return;
    inFlight = true;
    try { await refresh(() => cancelled); }
    finally { inFlight = false; }
  };
  const timer = setInterval(() => { void poll(); }, 3000);
  void poll();
  return () => { cancelled = true; clearInterval(timer); };
}
