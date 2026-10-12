/** Wait for permission without leaving a rejected side-promise or a late stream running. */
export function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  ms = 8000
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Camera request timed out"));
    }, ms);
    // Promise.resolve also catches a synchronous error (e.g. no mediaDevices).
    void Promise.resolve()
      .then(() => navigator.mediaDevices.getUserMedia(constraints))
      .then(
        (stream) => {
          clearTimeout(timer);
          if (timedOut) stream.getTracks().forEach((track) => track.stop());
          else resolve(stream);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
  });
}

/** Tracks request ownership and synchronously releases microphone resources. */
export function createMediaRequestOwner() {
  let generation = 0;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let frame: number | null = null;
  const release = (cancelFrame: (id: number) => void) => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    analyser = null;
    const oldContext = context;
    context = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (oldContext) void oldContext.close().catch(() => {});
  };
  return {
    begin(cancelFrame: (id: number) => void = () => {}) {
      release(cancelFrame);
      generation += 1;
      return generation;
    },
    owns(request: number) {
      return generation === request;
    },
    cancel(cancelFrame: (id: number) => void = () => {}) {
      generation += 1;
      release(cancelFrame);
    },
    setStream(value: MediaStream) {
      stream = value;
    },
    setContext(value: AudioContext) {
      context = value;
    },
    setAnalyser(value: AnalyserNode) {
      analyser = value;
    },
    setFrame(value: number) {
      frame = value;
    },
    getAnalyser() {
      return analyser;
    },
  };
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
    } catch {
      return false;
    }
  };
  availabilityInFlight = Promise.all([probe({ video: true }), probe({ audio: true })])
    .then(([cameraAvailable, microphoneAvailable]) => ({ cameraAvailable, microphoneAvailable }))
    .finally(() => {
      availabilityInFlight = null;
    });
  return availabilityInFlight;
}
