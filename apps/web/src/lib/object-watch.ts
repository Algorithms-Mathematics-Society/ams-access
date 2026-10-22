/**
 * Spotting a phone in frame.
 *
 * MediaPipe's object detector over the COCO label set, which carries a
 * `cell phone` class. Loaded lazily and only when the exam is running, next
 * to the BlazeFace presence check that already owns the camera.
 *
 * **Advisory, and only ever advisory.** At the resolution a webcam gives, a
 * dark rectangle is a phone, a wallet, a calculator case or a closed book.
 * This produces a flag and a thumbnail for a human to look at. Nothing here
 * decides anything about a candidate.
 *
 * It is now also surfaced to them, as a banner saying the frame will be
 * flagged. That is a deliberate reversal: this file used to argue that
 * telling someone "we think that is a phone" would wreck their sitting, and
 * the quieter reading is that a candidate who has left a phone on the desk
 * by accident would much rather be told while they can still move it than
 * find out from a flag afterwards. It stays a toast, never a block.
 *
 * Offline by construction: the model and the wasm runtime ship in `public/`
 * and are served from the app bundle. The exam machine's CSP and network
 * lockdown permit nothing else, so a fetch to a CDN would simply fail.
 */

/** The COCO classes worth flagging. Deliberately short. */
const WATCHED = new Set(["cell phone"]);

/**
 * Below this, it is a guess rather than a detection.
 *
 * 0.5 was borrowed from the MediaPipe sample pages, which score tidy stock
 * photographs. This runs on a webcam in a bedroom: EfficientDet-Lite0 is
 * already the smallest model in the family, the int8 build is quantised on
 * top of that, and a phone held at arm's length under a ceiling light lands
 * well under half. The cost of being slightly generous is a human glancing
 * at a thumbnail of a wallet, which is the job an invigilator already has.
 */
export const MIN_SCORE = 0.35;

/**
 * What the detector itself is told to discard.
 *
 * Deliberately below `MIN_SCORE`. The detector used to be built with
 * `scoreThreshold: MIN_SCORE`, which meant everything weaker was dropped
 * inside MediaPipe before this file ever saw it -- so "the model scored the
 * phone 0.38" and "the model never loaded" produced exactly the same
 * silence, and neither could be told apart from a room with no phone in it.
 * Keeping the near misses is what makes the threshold tunable from evidence
 * rather than from guessing.
 */
export const DETECT_THRESHOLD = 0.2;

/**
 * The width this detector is fed at.
 *
 * EfficientDet-Lite0 resizes its input to 320x320 internally. It was being
 * handed the BlazeFace canvas, which is 128x128 -- a phone in someone's hand
 * survives that as roughly a dozen pixels, which cannot reach `MIN_SCORE`
 * for any class, so the detector ran for the whole paper and found nothing
 * it was ever capable of finding. Feeding it a frame at its own input width
 * is the difference between "no phones were seen" and "phones could not
 * have been seen".
 *
 * Drawn at the video's aspect ratio rather than squashed into a square: the
 * model letterboxes internally, and a stretched phone matches nothing.
 */
export const DETECT_WIDTH = 320;

/**
 * Draw a video frame into `canvas` at detector resolution.
 *
 * Returns false when the video has no frame yet, so the caller can skip the
 * sample rather than score an empty canvas.
 */
export function drawForObjects(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;
  const w = DETECT_WIDTH;
  const h = Math.max(1, Math.round((DETECT_WIDTH * vh) / vw));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.drawImage(video, 0, 0, w, h);
  return true;
}

export type ObjectDetector = {
  detect: (input: HTMLCanvasElement) => {
    detections: Array<{
      categories?: Array<{ categoryName?: string; score?: number }>;
    }>;
  };
  close?: () => void;
};

export type ObjectSample = {
  /** The watched label with the highest score, or null. */
  label: string | null;
  score: number;
};

/**
 * Load the detector, or throw.
 *
 * The caller treats a throw as "this machine cannot do object detection"
 * and stops asking -- an old laptop that cannot spare the cycles must not
 * retry every few seconds for two hours.
 */
export async function loadObjectDetector(): Promise<ObjectDetector> {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const detector = await vision.ObjectDetector.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: "/mediapipe/efficientdet_lite0.tflite",
      delegate: "CPU",
    },
    runningMode: "IMAGE",
    scoreThreshold: DETECT_THRESHOLD,
    maxResults: 8,
  });
  return detector as unknown as ObjectDetector;
}

/** The highest-scoring watched object in one frame. */
export function watchedObject(result: {
  detections: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }>;
}): ObjectSample {
  let best: ObjectSample = { label: null, score: 0 };
  for (const detection of result.detections ?? []) {
    for (const category of detection.categories ?? []) {
      const name = (category.categoryName ?? "").toLowerCase();
      const score = category.score ?? 0;
      if (!WATCHED.has(name)) continue;
      if (score >= MIN_SCORE && score > best.score) best = { label: name, score };
    }
  }
  return best;
}

/** One frame's worth of detector output. */
export type ObjectFrame = {
  /** The watched object worth acting on, or null. */
  found: ObjectSample | null;
  /**
   * Everything the detector saw at all, best first, watched or not.
   *
   * Carried purely so a failure to flag can be diagnosed: "laptop 0.71,
   * person 0.64" says the model is working and the phone simply did not
   * score, which is a different problem from an empty list.
   */
  candidates: ObjectSample[];
};

/**
 * Sample one frame.
 *
 * `found` is null when nothing watched cleared `MIN_SCORE`, so the caller
 * acts on the interesting case rather than a steady stream of "no phone".
 */
export function sampleObjects(canvas: HTMLCanvasElement, detector: ObjectDetector): ObjectFrame {
  const result = detector.detect(canvas);
  const candidates: ObjectSample[] = [];
  for (const detection of result.detections ?? []) {
    for (const category of detection.categories ?? []) {
      const label = (category.categoryName ?? "").toLowerCase();
      if (label) candidates.push({ label, score: category.score ?? 0 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = watchedObject(result);
  return { found: best.label ? best : null, candidates: candidates.slice(0, 6) };
}
