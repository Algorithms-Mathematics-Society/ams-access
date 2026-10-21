export const PRESENCE_EVIDENCE_MIN_MS = 30_000;
export const PRESENCE_EVIDENCE_MAX_MS = 90_000;

export function nextPresenceEvidenceDelay(randomValue: number): number {
  const unit = Number.isFinite(randomValue) ? Math.min(1, Math.max(0, randomValue)) : 0.5;
  return PRESENCE_EVIDENCE_MIN_MS + unit * (PRESENCE_EVIDENCE_MAX_MS - PRESENCE_EVIDENCE_MIN_MS);
}

export function presenceUnavailableEvent(contestId: string) {
  return {
    kind: "presence_unavailable",
    detail: "periodic presence check unavailable: no camera stream",
    payload: { contest_id: contestId, reason: "no_camera_stream" },
  } as const;
}
