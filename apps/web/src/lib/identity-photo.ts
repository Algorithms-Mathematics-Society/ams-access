/**
 * One photograph of whoever is sitting the exam, at the start and at the end.
 *
 * The gap this closes: the only camera frames that ever reached the server
 * were anomaly thumbnails — ~96 px, quality 0.5, and written *only* when
 * presence detection failed. A session that ran cleanly from start to finish
 * therefore held no image of the candidate at all, which is precisely the
 * session someone would claim a stand-in had sat. There was no artefact to
 * put in front of the person making the claim.
 *
 * Two rules shape everything here.
 *
 * **It must never block the exam.** A candidate whose photo fails to upload
 * has done nothing wrong, and a contest that refuses to start over a dropped
 * request is a worse failure than a missing frame. Every function returns
 * rather than throws, and the absence is surfaced to an invigilator, who can
 * act on it, instead of to the candidate, who cannot.
 *
 * **It is for a human, not a matcher.** Nothing here compares faces. The
 * output is an image an invigilator looks at beside a name. That is why the
 * frame is 640 px and legible rather than 96 px and indicative, and why the
 * decision this supports is always a person's.
 */

/** Wide enough to recognise a face, small enough to upload on bad hotel
 *  wifi. At quality 0.82 this lands around 40-70 KB. */
export const PHOTO_WIDTH = 640;
export const PHOTO_QUALITY = 0.82;

/** The same frame at interval cadence: ~15-25 KB.
 *
 * Entry and exit are the two frames an invigilator studies beside a name, so
 * they stay full size. The ones in between are a timeline -- read as a strip,
 * opened only when something looks wrong -- and at a two-minute cadence there
 * are ninety of them per candidate. Full size, that is 1,236 people uploading
 * ~55 KB every two minutes into a single-worker API; this is a third of it. */
export const INTERVAL_PHOTO_WIDTH = 320;
export const INTERVAL_PHOTO_QUALITY = 0.6;

/** Anything smaller than this is not a photograph of anyone.
 *
 * A camera that has opened but not yet produced a frame yields a canvas that
 * encodes to a few hundred bytes of flat colour. Uploading that would put a
 * black rectangle in front of an invigilator and call it evidence. */
export const MIN_PLAUSIBLE_BYTES = 2_048;

/**
 * How often a frame is taken once the exam is running.
 *
 * Two minutes. Entry and exit alone cannot answer the question an
 * invigilator actually has -- a stand-in only has to be absent for the two
 * moments that get photographed -- so the gap has to be short enough that
 * swapping seats is visible.
 *
 * It was half an hour, which a substitution comfortably fits inside. Two
 * minutes over a two-hour paper is about sixty frames per candidate, which
 * is why the interval frame is downscaled and why the upload is jittered:
 * see INTERVAL_PHOTO_WIDTH and JITTER_MS.
 */
export const INTERVAL_MS = 2 * 60 * 1000;

/**
 * Spread each client's upload across a window instead of on the tick.
 *
 * Every machine in the hall starts its exam within a few minutes of the
 * others, so an unjittered interval has a thousand clients posting a photo
 * at the same instant, repeatedly, for two hours. The offset is drawn once
 * per session and then held, so the cadence stays even for that candidate.
 */
export const JITTER_MS = 20_000;

/** A per-session offset in [-JITTER_MS, +JITTER_MS]. */
export function jitterOffset(random: () => number = Math.random): number {
  return Math.round((random() * 2 - 1) * JITTER_MS);
}

export type PhotoKind = "entry" | "interval" | "exit";

/** The JPEG payload, base64 without the data-URL prefix. */
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64Bytes(base64: string): number {
  const clean = base64.replace(/[\r\n]/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/**
 * Whether a frame is worth sending.
 *
 * Deliberately a size check and nothing more. A blur detector or a face
 * count would be a second opinion on top of the one the invigilator is
 * being asked for, and a candidate whose frame this rejected would be told
 * their face was unacceptable by a program — for a photo that exists to
 * prove they turned up at all.
 */
export function isPlausiblePhoto(base64: string): boolean {
  return base64Bytes(base64) >= MIN_PLAUSIBLE_BYTES;
}

/** The target size for a frame, preserving aspect ratio. */
export function scaledSize(
  videoWidth: number,
  videoHeight: number,
  target = PHOTO_WIDTH
): { width: number; height: number } {
  if (!(videoWidth > 0) || !(videoHeight > 0)) {
    // A video element that has not produced metadata yet reports 0x0. Square
    // is as good a guess as any, and `isPlausiblePhoto` throws the frame out.
    return { width: target, height: target };
  }
  // Never upscale: a 320px webcam gets a 320px photo rather than a blurred
  // 640px one that looks like more evidence than it is.
  const width = Math.min(target, videoWidth);
  const height = Math.round((width / videoWidth) * videoHeight);
  return { width, height: Math.max(1, height) };
}

type CaptureSource = {
  videoWidth?: number;
  videoHeight?: number;
};

/**
 * Grab one frame from a live video element as base64 JPEG.
 *
 * Returns null rather than throwing on every failure path — no camera, a
 * canvas the browser refuses to encode, a frame that came out empty. The
 * caller's job is to carry on regardless.
 */
export function captureFrame(
  video: (CaptureSource & CanvasImageSource) | null,
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
  // Interval frames are a timeline; entry and exit are the portraits. The
  // default keeps every existing caller at full size.
  kind: PhotoKind = "entry"
): string | null {
  if (!video) return null;
  const interval = kind === "interval";
  const targetWidth = interval ? INTERVAL_PHOTO_WIDTH : PHOTO_WIDTH;
  const quality = interval ? INTERVAL_PHOTO_QUALITY : PHOTO_QUALITY;
  const { width, height } = scaledSize(video.videoWidth ?? 0, video.videoHeight ?? 0, targetWidth);

  try {
    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    const base64 = stripDataUrl(canvas.toDataURL("image/jpeg", quality));
    return isPlausiblePhoto(base64) ? base64 : null;
  } catch {
    // A tainted canvas, a browser that will not encode, a source that is not
    // ready. None of these are the candidate's problem.
    return null;
  }
}
