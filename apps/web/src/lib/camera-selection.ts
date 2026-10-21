export const CAMERA_PREFERENCE_KEY = "ams_camera_preference_v1";
export const LEGACY_CAMERA_PREFERENCE_KEY = "ams_preferred_camera";

export type CameraPreferenceStore = {
  read(): string | null;
  write(deviceId: string | null): void;
};

export type CameraListStatus = "loading" | "available" | "empty" | "unavailable";

/** A saved exact choice is missing only when enumeration proved that fact.
 * Loading/errors and label-hidden entries remain unknown rather than missing. */
export function isSavedCameraUnavailable(
  preferredDeviceId: string | null,
  status: CameraListStatus,
  selectableDeviceIds: readonly string[]
): boolean {
  if (!preferredDeviceId) return false;
  if (status === "empty") return true;
  return (
    status === "available" &&
    selectableDeviceIds.length > 0 &&
    !selectableDeviceIds.includes(preferredDeviceId)
  );
}

export function missingCameraGuidance(hasSavedExactChoice: boolean): string {
  return hasSavedExactChoice
    ? "Your selected camera is unavailable. Reconnect it or choose another camera."
    : "No camera was found. Connect or enable a camera, then try again.";
}

export function browserCameraPreferenceStore(): CameraPreferenceStore {
  return {
    read() {
      if (typeof window === "undefined") return null;
      try {
        const value = window.localStorage.getItem(CAMERA_PREFERENCE_KEY);
        if (!value) {
          const legacy = window.localStorage.getItem(LEGACY_CAMERA_PREFERENCE_KEY);
          if (!legacy) return null;
          window.localStorage.setItem(
            CAMERA_PREFERENCE_KEY,
            JSON.stringify({ version: 1, deviceId: legacy })
          );
          window.localStorage.removeItem(LEGACY_CAMERA_PREFERENCE_KEY);
          return legacy;
        }
        const parsed = JSON.parse(value) as { version?: unknown; deviceId?: unknown };
        return parsed.version === 1 && typeof parsed.deviceId === "string" && parsed.deviceId
          ? parsed.deviceId
          : null;
      } catch {
        return null;
      }
    },
    write(deviceId) {
      if (typeof window === "undefined") throw new Error("Camera preference storage unavailable");
      if (deviceId) {
        window.localStorage.setItem(
          CAMERA_PREFERENCE_KEY,
          JSON.stringify({ version: 1, deviceId })
        );
      } else {
        window.localStorage.removeItem(CAMERA_PREFERENCE_KEY);
      }
      window.localStorage.removeItem(LEGACY_CAMERA_PREFERENCE_KEY);
    },
  };
}
