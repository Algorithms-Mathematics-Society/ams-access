type FrameVideo = Pick<
  HTMLVideoElement,
  "currentTime" | "readyState" | "videoWidth" | "videoHeight"
> & {
  srcObject?: HTMLVideoElement["srcObject"];
};

export type FrameProgressOptions = {
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
  intervalMs?: number;
  stallAfterMs?: number;
};

/**
 * Watches decoded-frame progress only. It never samples pixels or judges image
 * content; a dark room is still a progressing camera.
 */
export function watchCameraFrameProgress(
  video: FrameVideo,
  onStalled: (stalled: boolean) => void,
  options: FrameProgressOptions = {}
): () => void {
  const now = options.now ?? performance.now.bind(performance);
  const schedule = options.setInterval ?? ((callback, delay) => setInterval(callback, delay));
  const cancel = options.clearInterval ?? ((timer) => clearInterval(timer));
  const intervalMs = options.intervalMs ?? 500;
  const stallAfterMs = options.stallAfterMs ?? 5000;
  let lastTime = video.currentTime;
  let lastProgressAt = now();
  let reported: boolean | null = null;

  const report = (stalled: boolean) => {
    if (reported === stalled) return;
    reported = stalled;
    onStalled(stalled);
  };

  const check = () => {
    const source = video.srcObject;
    const track =
      source && typeof (source as { getVideoTracks?: unknown }).getVideoTracks === "function"
        ? (source as MediaStream).getVideoTracks()[0]
        : undefined;
    const hasFrame =
      video.readyState >= 2 &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      track?.muted !== true &&
      track?.readyState !== "ended";
    if (hasFrame && video.currentTime > lastTime) {
      lastTime = video.currentTime;
      lastProgressAt = now();
      report(false);
      return;
    }
    if (now() - lastProgressAt >= stallAfterMs) report(true);
  };

  const timer = schedule(check, intervalMs);
  check();
  return () => cancel(timer);
}
