// Periodic presence verification for the contest surface.
//
// Reuses the BlazeFace pipeline that onboarding calibration ships: WASM
// backend preferred (files bundled under /tfjs-wasm/ by setup-tfjs-wasm.mjs),
// CPU fallback, model served from /models/blazeface. Unlike calibration
// (maxFaces: 1), the monitor asks for up to 3 faces so it can distinguish
// "multiple people in frame" from "one person present".
//
// Privacy / retention: frames never leave the analysis canvas except as a
// low-res JPEG thumbnail (~96 px wide, quality 0.5, a few KB) attached ONLY
// to anomaly samples (face_missing / multiple_faces). presence_ok samples
// carry metadata only. Thumbnails live in the local proctoring-events.jsonl
// spool and are uploaded through the session event stream; server-side
// retention policy is the backend's responsibility.

type FacePredictionLike = {
  topLeft?: [number, number] | number[];
  bottomRight?: [number, number] | number[];
};

export type PresenceDetector = {
  estimateFaces: (
    input: HTMLCanvasElement,
    returnTensors?: boolean,
    flipHorizontal?: boolean,
    annotateBoxes?: boolean
  ) => Promise<FacePredictionLike[]>;
  dispose?: () => void;
};

type BlazeFaceModuleLike = {
  load: (config: {
    maxFaces?: number;
    inputWidth?: number;
    inputHeight?: number;
    scoreThreshold?: number;
    modelUrl?: string;
  }) => Promise<unknown>;
};

export async function loadPresenceDetector(): Promise<PresenceDetector> {
  const tf = await import("@tensorflow/tfjs-core");

  let backendReady = false;
  try {
    const wasmBackend = await import("@tensorflow/tfjs-backend-wasm");
    wasmBackend.setWasmPaths("/tfjs-wasm/");
    await tf.setBackend("wasm");
    await tf.ready();
    backendReady = true;
  } catch {
    // WASM unavailable in this environment — fall through to CPU.
  }
  if (!backendReady) {
    await import("@tensorflow/tfjs-backend-cpu");
    await tf.setBackend("cpu");
    await tf.ready();
  }

  const blazeface = (await import("@tensorflow-models/blazeface")) as BlazeFaceModuleLike;
  const detector = await blazeface.load({
    maxFaces: 3,
    inputWidth: 128,
    inputHeight: 128,
    scoreThreshold: 0.75,
    modelUrl: "/models/blazeface/model.json",
  });
  return detector as PresenceDetector;
}

export type PresenceSample = {
  status: "presence_ok" | "face_missing" | "multiple_faces";
  faces: number;
  /** Low-res JPEG data URL — only populated for anomaly samples. */
  thumbnail: string | null;
};

/// One presence sample from the live camera video element.
export async function samplePresence(
  video: HTMLVideoElement,
  detector: PresenceDetector,
  canvas: HTMLCanvasElement
): Promise<PresenceSample | null> {
  // readyState < 2 (HAVE_CURRENT_DATA) means no decodable frame yet.
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  const W = 128;
  const H = 128;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, W, H);

  const faces = await detector.estimateFaces(canvas, false, false, false);
  const count = faces.length;
  const status: PresenceSample["status"] =
    count === 1 ? "presence_ok" : count === 0 ? "face_missing" : "multiple_faces";

  let thumbnail: string | null = null;
  if (status !== "presence_ok") {
    const thumb = document.createElement("canvas");
    thumb.width = 96;
    thumb.height = Math.max(1, Math.round((96 * video.videoHeight) / video.videoWidth));
    thumb.getContext("2d")?.drawImage(video, 0, 0, thumb.width, thumb.height);
    thumbnail = thumb.toDataURL("image/jpeg", 0.5);
  }

  return { status, faces: count, thumbnail };
}
