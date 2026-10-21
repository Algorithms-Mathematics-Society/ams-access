/** Camera operations can remain pending in a WebView even after permission is granted. */
export class CameraTimeoutError extends Error {}

export function withCameraTimeout<T>(
  request: Promise<T>,
  ms: number,
  message: string,
  onLateValue?: (value: T) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new CameraTimeoutError(message));
    }, ms);
    request.then(
      (value) => {
        clearTimeout(timer);
        if (expired) onLateValue?.(value);
        else resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        if (!expired) reject(error);
      }
    );
  });
}

/** Events are hints; only a decodable frame with dimensions is ready. */
export function waitForVideoReady(video: HTMLVideoElement, ms = 2500): Promise<void> {
  const ready = () => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const event of ["loadeddata", "canplay", "playing", "resize"]) {
        video.removeEventListener(event, check);
      }
    };
    const check = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      if (ready()) resolve();
      else reject(new CameraTimeoutError("Camera preview timed out"));
    }, ms);
    // Some WebViews update dimensions without a usable readiness event.
    const poll = setInterval(check, 50);
    for (const event of ["loadeddata", "canplay", "playing", "resize"]) {
      video.addEventListener(event, check);
    }
    check();
  });
}

export function startCameraPreview(
  video: HTMLVideoElement,
  stream: MediaStream,
  ms = 2500
): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  if (video.srcObject !== stream) video.srcObject = stream;
  // Never await play(): WebKit can leave it pending while no frames arrive.
  // Readiness has its own deadline and must still prove there is a frame.
  try {
    void video.play().catch(() => {});
  } catch {
    // A synchronous playback error also goes through the frame deadline.
  }
  return waitForVideoReady(video, ms);
}
