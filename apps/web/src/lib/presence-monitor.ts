import { CameraTimeoutError, withCameraTimeout } from "./camera-readiness.ts";

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
  landmarks?: number[][];
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

type TensorFlowLike = {
  setBackend(name: string): Promise<boolean>;
  ready(): Promise<void>;
  removeBackend(name: string): void;
};

type DetectorOptions = {
  maxFaces?: number;
  /** Onboarding's native integrity check must succeed before loading weights. */
  verifyAssets?: () => Promise<void>;
};

type DetectorLoaderDeps = {
  importCore: () => Promise<TensorFlowLike>;
  importWasm: () => Promise<{ setWasmPaths(path: string): void }>;
  importCpu: () => Promise<unknown>;
  importModel: () => Promise<BlazeFaceModuleLike>;
  timeoutMs?: number;
};

/** Shared backend initialization prevents calibration/presence from racing TF's global engine. */
export function createPresenceDetectorLoader(deps: DetectorLoaderDeps) {
  const ms = deps.timeoutMs ?? 5000;
  let backend: Promise<void> | null = null;
  const bounded = <T>(request: Promise<T>, phase: string) =>
    withCameraTimeout(request, ms, `Face detector ${phase} timed out`);

  async function prepareBackend() {
    const tf = await bounded(deps.importCore(), "runtime import");
    try {
      const wasm = await bounded(deps.importWasm(), "WASM import");
      wasm.setWasmPaths("/tfjs-wasm/");
      if (!(await bounded(tf.setBackend("wasm"), "WASM startup"))) {
        throw new Error("Face detector WASM backend unavailable");
      }
      await bounded(tf.ready(), "WASM readiness");
      return;
    } catch {
      // TF's CPU backend initializes synchronously, so simply selecting it does
      // not invalidate a pending asynchronous WASM initialization. Remove WASM
      // first: engine.removeBackend invalidates that pending init, preventing a
      // late completion from replacing the CPU backend used by a live model.
      try {
        tf.removeBackend("wasm");
      } catch {
        /* import may have failed */
      }
    }
    await bounded(deps.importCpu(), "CPU import");
    if (!(await bounded(tf.setBackend("cpu"), "CPU startup"))) {
      throw new Error("Face detector CPU backend unavailable");
    }
    await bounded(tf.ready(), "CPU readiness");
  }

  return async function load(options: DetectorOptions = {}): Promise<PresenceDetector> {
    if (!backend) {
      backend = prepareBackend().catch((error) => {
        backend = null;
        throw error;
      });
    }
    await backend;
    if (options.verifyAssets) await bounded(options.verifyAssets(), "asset verification");
    const blazeface = await bounded(deps.importModel(), "model import");
    return withCameraTimeout(
      blazeface.load({
        maxFaces: options.maxFaces ?? 3,
        inputWidth: 128,
        inputHeight: 128,
        scoreThreshold: 0.75,
        modelUrl: "/models/blazeface/model.json",
      }) as Promise<PresenceDetector>,
      ms,
      "Face detector model load timed out",
      (late) => late.dispose?.()
    );
  };
}

export const loadPresenceDetector = createPresenceDetectorLoader({
  importCore: () => import("@tensorflow/tfjs-core"),
  importWasm: () => import("@tensorflow/tfjs-backend-wasm"),
  importCpu: () => import("@tensorflow/tfjs-backend-cpu"),
  importModel: async () => (await import("@tensorflow-models/blazeface")) as BlazeFaceModuleLike,
});

/**
 * How the candidate is sitting in frame.
 *
 * Not a proctoring signal -- it is advice, shown to the candidate and to
 * nobody else. Every other check here is about whether the right person is
 * present; this one exists because most `face_missing` samples are not an
 * absent candidate at all, they are someone who has drifted out of shot
 * while thinking. Telling them costs nothing and removes the false flag at
 * source.
 */
export type Framing = "ok" | "off_centre" | "too_close" | "too_far";

export type PresenceSample = {
  status: "presence_ok" | "face_missing" | "multiple_faces";
  faces: number;
  /** Low-res JPEG data URL — only populated for anomaly samples. */
  thumbnail: string | null;
  /** Only meaningful when exactly one face was found. */
  framing: Framing;
};

/**
 * Judge one face box against the frame.
 *
 * Mirrors `isInsideGuide` in Stage8_FaceCalibration, which the candidate
 * already passed during onboarding, so the contest room asks for nothing
 * stricter than the door did. Tolerances are deliberately loose: this
 * interrupts someone sitting an exam, so it should only speak when they are
 * genuinely about to fall out of shot.
 */
export function framingOf(
  topLeft: number[] | undefined,
  bottomRight: number[] | undefined,
  width: number,
  height: number
): Framing {
  if (!topLeft || !bottomRight || width <= 0 || height <= 0) return "ok";
  const [x1, y1] = topLeft;
  const [x2, y2] = bottomRight;
  if ([x1, y1, x2, y2].some((n) => typeof n !== "number" || !Number.isFinite(n))) return "ok";

  const w = (x2 - x1) / width;
  const h = (y2 - y1) / height;
  if (w <= 0 || h <= 0) return "ok";

  // Size first: someone very close is also off-centre by definition, and
  // "move back" is the more useful of the two sentences.
  if (w > 0.72 || h > 0.92) return "too_close";
  if (w < 0.1 || h < 0.12) return "too_far";

  const cx = (x1 + x2) / 2 / width;
  const cy = (y1 + y2) / 2 / height;
  const dx = cx - 0.5;
  const dy = cy - 0.48;
  const inside = (dx * dx) / (0.22 * 0.22) + (dy * dy) / (0.37 * 0.37) <= 1.8;
  return inside ? "ok" : "off_centre";
}

// A deadline stops waiting; it cannot cancel TF inference. Keep the detector
// busy until its actual work settles, including across periodic contest ticks.
const pendingInferences = new WeakSet<PresenceDetector>();

/// One presence sample from the live camera video element.
export async function samplePresence(
  video: HTMLVideoElement,
  detector: PresenceDetector,
  canvas: HTMLCanvasElement,
  timeoutMs = 5000
): Promise<PresenceSample | null> {
  // readyState < 2 (HAVE_CURRENT_DATA) means no decodable frame yet.
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }
  if (pendingInferences.has(detector)) {
    throw new CameraTimeoutError("Face detector inference is still pending");
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

  // annotateBoxes so the face box comes back: it is what the framing hint
  // is computed from.
  pendingInferences.add(detector);
  const inference = Promise.resolve()
    .then(() => detector.estimateFaces(canvas, false, false, true))
    .finally(() => pendingInferences.delete(detector));
  const faces = await withCameraTimeout(inference, timeoutMs, "Face detector inference timed out");
  const count = faces.length;
  const framing =
    count === 1
      ? framingOf(faces[0]?.topLeft as number[], faces[0]?.bottomRight as number[], W, H)
      : "ok";
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

  return { status, faces: count, thumbnail, framing };
}
