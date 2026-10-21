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

import { browserCameraPreferenceStore } from "./camera-selection.ts";

export function preferredCamera(): string | null {
  return browserCameraPreferenceStore().read();
}

export function setPreferredCamera(deviceId: string | null): void {
  try {
    browserCameraPreferenceStore().write(deviceId);
  } catch {
    // Legacy picker callers treated persistence as best-effort. The session
    // selection API remains strict and reports failed writes before switching.
  }
}

/**
 * Video constraints with the saved camera applied.
 *
 * A deliberate choice is exact: silently falling back can select an infrared
 * or unintended camera. Callers surface reconnect/reselection guidance when
 * the saved device is conclusively unavailable.
 */
export function withPreferredCamera(base: MediaTrackConstraints): MediaTrackConstraints {
  const saved = preferredCamera();
  return saved ? { ...base, deviceId: { exact: saved } } : base;
}
