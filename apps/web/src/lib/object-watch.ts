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
 * decides anything about a candidate, and nothing here is shown to them --
 * being told "we think that is a phone" mid-exam would wreck the sitting of
 * whoever it is wrong about.
 *
 * Offline by construction: the model and the wasm runtime ship in `public/`
 * and are served from the app bundle. The exam machine's CSP and network
 * lockdown permit nothing else, so a fetch to a CDN would simply fail.
 */

/** The COCO classes worth flagging. Deliberately short. */
const WATCHED = new Set(["cell phone"]);

/** Below this, it is a guess rather than a detection. */
export const MIN_SCORE = 0.5;

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
    scoreThreshold: MIN_SCORE,
    maxResults: 8,
  });
  return detector as unknown as ObjectDetector;
}

/** The highest-scoring watched object in one frame. */
export function watchedObject(
  result: { detections: Array<{ categories?: Array<{ categoryName?: string; score?: number }> }> }
): ObjectSample {
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

/**
 * Sample one frame.
 *
 * Returns null when nothing was found, so the caller logs only the
 * interesting case rather than a steady stream of "no phone".
 */
export function sampleObjects(
  canvas: HTMLCanvasElement,
  detector: ObjectDetector
): ObjectSample | null {
  const found = watchedObject(detector.detect(canvas));
  return found.label ? found : null;
}
