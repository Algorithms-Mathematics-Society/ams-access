/** Diagnostic metadata only: never images, device identifiers, or file paths. */
export type FaceReviewContext = {
  reason: string;
  elapsed_ms: number;
  video_ready_state: number;
  frame_width: number;
  frame_height: number;
};

/** Manual review is a warning, never an accepted face capture. */
export function buildFaceReviewEvent(dryRun: boolean, context?: FaceReviewContext) {
  return {
    kind: "face_verification_fallback",
    detail: "Candidate requested manual proctor review after the face calibration check.",
    payload: {
      stage: 8,
      stage_key: "face_calibration",
      outcome: "manual_review_requested",
      face_verified: false,
      review_required: true,
      dry_run: dryRun,
      ...(context
        ? {
            reason: context.reason,
            elapsed_ms: context.elapsed_ms,
            video_ready_state: context.video_ready_state,
            frame_width: context.frame_width,
            frame_height: context.frame_height,
          }
        : {}),
    },
  };
}

/** One request per onboarding visit, queued only once a session is bound.
 * A caller may time out its wait without cancelling the underlying write. Keep
 * that write in flight so Retry cannot append duplicates while IPC is pending.
 * A rejected write can be retried; acknowledgement means local spool persistence,
 * not server delivery. The native uploader owns delivery and backoff.
 */
export function createFaceReviewRequest() {
  let requested = false;
  const acknowledged = new Set<string>();
  const pending = new Map<string, Promise<void>>();
  return {
    request() {
      if (requested) return false;
      requested = true;
      return true;
    },
    isRequested: () => requested,
    persist(sessionId: string, write: () => Promise<void>): Promise<void> {
      if (!requested) return Promise.resolve();
      if (!sessionId.trim()) return Promise.reject(new Error("Review requires a session."));
      if (acknowledged.has(sessionId)) return Promise.resolve();
      const existing = pending.get(sessionId);
      if (existing) return existing;
      const operation = Promise.resolve()
        .then(write)
        .then(() => {
          acknowledged.add(sessionId);
        })
        .finally(() => {
          pending.delete(sessionId);
        });
      pending.set(sessionId, operation);
      return operation;
    },
  };
}
