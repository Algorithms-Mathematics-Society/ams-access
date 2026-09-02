/**
 * Whether a captured frame is worth sending to the backend validator yet.
 *
 * The native validator (`validate_face_image_bytes`) rejects a frame whose
 * whole-image luma standard deviation is under 15, as `blank_or_uniform_image`.
 * That is a reasonable guard against a blank or spoofed capture. It was firing
 * on real candidates because of two things the client was doing to itself:
 *
 * 1. **No warm-up.** The capture fired the moment BlazeFace locked onto a
 *    face, which can be within a second of the stream opening — while the
 *    sensor's auto-exposure and gain are still ramping. Those early frames are
 *    genuinely low-contrast, so they genuinely fail, and a few seconds later
 *    the same subject in the same room passes.
 *
 * 2. **A 2x downscale.** The stream is 640x480 and the capture canvas was
 *    320x240. Averaging four pixels into one reduces variance and edge
 *    density — the two statistics the validator thresholds on. The client was
 *    degrading the frame and then failing it on the degradation.
 *
 * The result was a detector and a validator disagreeing about the same frame:
 * BlazeFace said "that is a face", the validator said "that is blank". Three
 * disagreements put the candidate in front of a "contact your proctor" button.
 *
 * So the frame is measured here first, with the same threshold the backend
 * uses, and a frame that is merely still settling is retried rather than
 * submitted and counted as a rejection.
 *
 * The warm-up is bounded on purpose. A room that is genuinely too dark will
 * never reach the threshold, and silently retrying for ever would leave the
 * candidate stuck with no way to reach a human. Once the budget is spent the
 * frame is sent regardless and the backend's answer stands — so a real failure
 * still surfaces, just not a transient one.
 */

/** Mirrors `std_dev < 15.0` in validate_face_image_bytes. */
export const MIN_STD_DEV = 15;
/** Mirrors `dark_count / total > 0.85`. */
export const MAX_DARK_RATIO = 0.85;
/** Frames spent waiting for the sensor before deferring to the backend. */
export const MAX_SETTLING_ATTEMPTS = 8;

export type FrameStats = {
  meanLuma: number;
  stdDev: number;
  darkRatio: number;
};

/**
 * Luma mean, standard deviation and dark-pixel ratio for RGBA pixel data.
 *
 * Same luma weights as the backend, so the two agree about the frame rather
 * than each having an opinion.
 */
export function lumaStats(rgba: ArrayLike<number>): FrameStats {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return { meanLuma: 0, stdDev: 0, darkRatio: 1 };

  let mean = 0;
  let m2 = 0;
  let n = 0;
  let dark = 0;

  for (let i = 0; i < pixels; i += 1) {
    const o = i * 4;
    const luma = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
    n += 1;
    const delta = luma - mean;
    mean += delta / n;
    m2 += delta * (luma - mean);
    if (luma < 20) dark += 1;
  }

  return {
    meanLuma: mean,
    stdDev: Math.sqrt(m2 / n),
    darkRatio: dark / pixels,
  };
}

export type CaptureAction =
  /** Good enough to submit. */
  | { action: "send" }
  /** Give the sensor another frame; do NOT count this as a rejection. */
  | { action: "wait"; reason: "settling" | "too_dark" }
  /** Warm-up spent. Submit and let the backend's verdict stand. */
  | { action: "send_anyway"; reason: "settling" | "too_dark" };

/**
 * `attemptsSoFar` counts frames already skipped for this capture, not backend
 * rejections — the two must not be conflated, which is the whole point.
 */
export function decideCapture(stats: FrameStats, attemptsSoFar: number): CaptureAction {
  const reason: "settling" | "too_dark" | null =
    stats.darkRatio > MAX_DARK_RATIO ? "too_dark" : stats.stdDev < MIN_STD_DEV ? "settling" : null;

  if (reason === null) return { action: "send" };
  if (attemptsSoFar >= MAX_SETTLING_ATTEMPTS) return { action: "send_anyway", reason };
  return { action: "wait", reason };
}

/** What to tell the candidate while the sensor settles. */
export function settlingMessage(reason: "settling" | "too_dark"): string {
  return reason === "too_dark"
    ? "It's quite dark — try turning on a light"
    : "Adjusting to the light — hold still";
}
