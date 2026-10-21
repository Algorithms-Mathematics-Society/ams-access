/**
 * The camera the candidate chose.
 *
 * Every path that opens a camera reads this, so a choice made once -- in
 * Settings before the exam, or in onboarding when the picture is wrong --
 * holds everywhere afterwards.
 *
 * It exists because the default is often wrong on exactly the machines that
 * fail: a Windows-Hello laptop exposes its infrared sensor as an ordinary
 * video device, and Linux hands it out as the default. The candidate sees a
 * near-black image, the face check never passes, and there was no way to say
 * "not that one".
 *
 * Stored per device, not per session, because it is a fact about the machine.
 */

// Inlined rather than imported from `constants/storage-keys`: the Node test
// runner does not resolve the `@/` alias, and camera-session has to stay
// testable. Must stay in sync with PREFERRED_CAMERA_KEY.
const PREFERRED_CAMERA_KEY = "ams_preferred_camera";

export function preferredCamera(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PREFERRED_CAMERA_KEY) || null;
  } catch {
    // Private mode, blocked storage. A missing preference is the OS default,
    // which is what happened before this existed.
    return null;
  }
}

export function setPreferredCamera(deviceId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (deviceId) localStorage.setItem(PREFERRED_CAMERA_KEY, deviceId);
    else localStorage.removeItem(PREFERRED_CAMERA_KEY);
  } catch {
    // Not being able to remember the choice must not stop them making it.
  }
}

/**
 * Video constraints with the saved camera applied.
 *
 * `ideal`, never `exact`: a saved id that no longer matches anything -- a
 * webcam unplugged, a driver that renumbered -- must fall back to the default
 * rather than fail with OverconstrainedError, which reads to a candidate as
 * "no camera" and has no remedy inside the exam shell.
 */
export function withPreferredCamera(base: MediaTrackConstraints): MediaTrackConstraints {
  const saved = preferredCamera();
  return saved ? { ...base, deviceId: { ideal: saved } } : base;
}
