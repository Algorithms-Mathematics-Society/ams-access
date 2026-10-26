export const RESUME_SETUP_KEY = "ams_resume_setup";
export const RESUME_SETUP_MAX_AGE_MS = 5 * 60_000;

export type ResumeSetup = {
  sessionId: string;
  contestId: string;
  deviceId: string;
  cameraId: string;
  passedAt: number;
};

export function readResumeSetup(
  raw: string | null,
  context: { sessionId: string; contestId: string; deviceId: string },
  now = Date.now()
): ResumeSetup | null {
  try {
    const saved = JSON.parse(raw ?? "null") as ResumeSetup | null;
    return saved &&
      saved.sessionId === context.sessionId &&
      saved.contestId === context.contestId &&
      saved.deviceId === context.deviceId &&
      typeof saved.cameraId === "string" &&
      saved.cameraId.length > 0 &&
      Number.isFinite(saved.passedAt) &&
      now >= saved.passedAt &&
      now - saved.passedAt < RESUME_SETUP_MAX_AGE_MS
      ? saved
      : null;
  } catch {
    return null;
  }
}

export function canReuseFaceScan(
  saved: ResumeSetup | null,
  cameraId: string,
  now = Date.now()
): boolean {
  return (
    !!saved &&
    saved.cameraId === cameraId &&
    cameraId.length > 0 &&
    now >= saved.passedAt &&
    now - saved.passedAt < RESUME_SETUP_MAX_AGE_MS
  );
}
