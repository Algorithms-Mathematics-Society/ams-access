/** Wait for permission without leaving a rejected side-promise or a late stream running. */
export function getUserMediaWithTimeout(constraints: MediaStreamConstraints, ms = 8000): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Camera request timed out"));
    }, ms);
    // Promise.resolve also catches a synchronous error (e.g. no mediaDevices).
    void Promise.resolve().then(() => navigator.mediaDevices.getUserMedia(constraints)).then(
      (stream) => {
        clearTimeout(timer);
        if (timedOut) stream.getTracks().forEach((track) => track.stop());
        else resolve(stream);
      },
      (error: unknown) => { clearTimeout(timer); reject(error); }
    );
  });
}

type MediaAvailability = { cameraAvailable: boolean; microphoneAvailable: boolean };
let availabilityInFlight: Promise<MediaAvailability> | null = null;

/** Share overlapping baseline/preflight probes; never cache a finished hardware check. */
export function getBrowserMediaAvailability(): Promise<MediaAvailability> {
  if (availabilityInFlight) return availabilityInFlight;
  // getUserMedia triggers OS permission prompts, unlike enumerateDevices. Allow
  // 30s for the candidate to answer. Release each successful stream immediately.
  const probe = async (constraints: MediaStreamConstraints) => {
    try {
      const stream = await getUserMediaWithTimeout(constraints, 30_000);
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch { return false; }
  };
  availabilityInFlight = Promise.all([probe({ video: true }), probe({ audio: true })])
    .then(([cameraAvailable, microphoneAvailable]) => ({ cameraAvailable, microphoneAvailable }))
    .finally(() => { availabilityInFlight = null; });
  return availabilityInFlight;
}
