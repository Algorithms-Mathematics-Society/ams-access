export const FACE_SCAN_DEADLINE_MS = 45_000;

export type FaceScanAttempt = Readonly<{
  generation: number;
  scanStartedAt: number | null;
  terminal: boolean;
}>;

export function createFaceScanAttempt(generation: number): FaceScanAttempt {
  return { generation, scanStartedAt: null, terminal: false };
}

export function startFaceScanning(attempt: FaceScanAttempt, now: number): FaceScanAttempt {
  if (attempt.terminal || attempt.scanStartedAt !== null) return attempt;
  return { ...attempt, scanStartedAt: now };
}

export function remainingFaceScanMs(attempt: FaceScanAttempt, now: number): number | null {
  if (attempt.scanStartedAt === null || attempt.terminal) return null;
  return Math.max(0, FACE_SCAN_DEADLINE_MS - (now - attempt.scanStartedAt));
}

export function ownsFaceScanAttempt(attempt: FaceScanAttempt, generation: number): boolean {
  return attempt.generation === generation && !attempt.terminal;
}

export function finishFaceScanAttempt(
  attempt: FaceScanAttempt,
  generation: number
): FaceScanAttempt {
  return ownsFaceScanAttempt(attempt, generation) ? { ...attempt, terminal: true } : attempt;
}
