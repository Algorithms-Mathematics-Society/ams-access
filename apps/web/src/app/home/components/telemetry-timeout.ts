// Native collection allows 2s admission + 20s scanning; network transport can
// take 6s and the clock probe another 3s. Leave room for IPC scheduling too.
export const TELEMETRY_TIMEOUT_MS = 35_000;

export function withTelemetryTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native telemetry scan timed out. Retry device checks.")),
      TELEMETRY_TIMEOUT_MS
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
