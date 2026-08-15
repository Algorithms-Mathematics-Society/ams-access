import { useEffect, useRef, useState } from "react";
import { isGatingRelaxed, warnGatingRelaxed } from "@/lib/gating";
import { StageHeader } from "../ui";
import { type TauriGlobals } from "../tauri-globals";
import {
  BLAZEFACE_MODEL_URL,
  getUserMediaWithTimeout,
  invoke,
  stopMediaStream,
  waitForVideoReady,
  withTimeout,
} from "../../support";

// Tauri global typing for the direct window.__TAURI__ uses in this file.
declare const window: Window & TauriGlobals;

export function Stage9_FaceCalibration({
  stream,
  onPass,
  dryRun = false,
  onFaceFallback,
}: {
  stream: MediaStream | null;
  onPass(): void;
  // When true (practice run) the native side should validate the capture for
  // feedback but NOT persist the image — no session exists to attach it to.
  dryRun?: boolean;
  // Equity fallback: after repeated capture rejections (lighting/glasses/skin-tone
  // can defeat the model), let the candidate proceed for manual proctor review
  // rather than being hard-blocked. Never a silent skip — the parent records it.
  onFaceFallback?: () => void;
}) {
  type FaceKeypointLike = { x: number; y: number; label?: string };
  type FacePredictionLike = {
    topLeft: [number, number];
    bottomRight: [number, number];
    landmarks?: number[][];
    probability?: number | number[];
  };
  type DetectorLike = {
    estimateFaces(
      input: HTMLCanvasElement,
      returnTensors?: boolean,
      flipHorizontal?: boolean,
      annotateBoxes?: boolean
    ): Promise<FacePredictionLike[]>;
    dispose(): void;
  };
  type BlazeFaceModuleLike = {
    load(config?: {
      maxFaces?: number;
      inputWidth?: number;
      inputHeight?: number;
      iouThreshold?: number;
      scoreThreshold?: number;
      modelUrl?: string;
    }): Promise<DetectorLike>;
  };

  const PHASES = [
    { key: "front" as const, label: "FRONT", instruction: "Look directly at the camera" },
  ];
  type FaceScanState = "loading" | "ready" | "tracking" | "validating" | "complete" | "blocked";

  // ── Hot-path refs (no re-render on change) ─────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<DetectorLike | null>(null);
  const onPassRef = useRef(onPass);
  onPassRef.current = onPass;

  const keypointsRef = useRef<FaceKeypointLike[] | null>(null);
  const smooth = useRef({ cx: 0.5, cy: 0.5, w: 0.0, h: 0.0 });
  const poseRef = useRef({ yaw: 0, pitch: 0, roll: 0 });
  const lastDetectMs = useRef(0);
  const holdMsRef = useRef(0);
  const facePresentRef = useRef(false);
  const qualityOkRef = useRef(false);
  const capturingRef = useRef(false);
  const phaseIdxRef = useRef(0);
  const rafRef = useRef(0);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastDrawMsRef = useRef(0);
  const detectionErrorsRef = useRef(0);
  const fallbackStartedRef = useRef(false);
  const detectionBusyRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);

  // ── React state (display only) ─────────────────────────────────
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorFailed, setDetectorFailed] = useState(false);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [guidance, setGuidance] = useState("Setting up face scanner...");
  const [facePresent, setFacePresent] = useState(false);
  const [qualityOk, setQualityOk] = useState(false);
  const [lockPct, setLockPct] = useState(0);
  const lockPctRef = useRef(0);
  const [poseLabel, setPoseLabel] = useState("SCANNING");
  const [captured, setCaptured] = useState([false]);
  const [flash, setFlash] = useState(false);
  const [done, setDone] = useState(false);
  const [runtimeNote, setRuntimeNote] = useState<string | null>(null);
  const [lostTracking, setLostTracking] = useState(false);
  const [stageBlocked, setStageBlocked] = useState(false);
  const [scanState, setScanState] = useState<FaceScanState>("loading");
  // Count of rejected captures; after a few we surface the proctor-review fallback.
  const [captureRejections, setCaptureRejections] = useState(0);
  const FACE_FALLBACK_AFTER = 3;

  const PHASE_HOLD_MS = 700;

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.95;
      utt.pitch = 1;
      utt.volume = 1;
      window.speechSynthesis.speak(utt);
    } catch {}
  }

  function resetCaptureAttempt(
    note: string,
    guidanceText = "Capture failed — reposition and hold still"
  ) {
    capturingRef.current = false;
    holdMsRef.current = 0;
    facePresentRef.current = false;
    qualityOkRef.current = false;
    smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
    lockPctRef.current = 0;
    setFacePresent(false);
    setQualityOk(false);
    setLockPct(0);
    setScanState("ready");
    setGuidance(guidanceText);
    setRuntimeNote(note);
  }

  // ── Capture (ref-assigned so detection loop always gets latest) ─
  const capturePhaseRef = useRef<(idx: number) => Promise<void>>(async () => {});
  capturePhaseRef.current = async (_idx: number) => {
    // Hard guard: never capture after the stage has been hard-blocked.
    if (fallbackStartedRef.current) return;

    let captureAccepted = false;
    setScanState("validating");
    setGuidance("Validating capture...");
    setRuntimeNote(null);
    const video = videoRef.current;
    const cap = captureCanvasRef.current;
    if (video && cap) {
      const ctx = cap.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.translate(cap.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, cap.width, cap.height);
        ctx.restore();
        try {
          const blob = await new Promise<Blob | null>((resolve) =>
            cap.toBlob(resolve, "image/png")
          );
          if (blob) {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error ?? new Error("Face capture read failed"));
              reader.readAsDataURL(blob);
            });

            // ── SEC-3: validate backend result before advancing ────────────
            // When running inside Tauri the backend performs image validation
            // (size, luma variance, dark-pixel ratio).  In browser dev mode
            // (no Tauri) the check is skipped so the dev flow still works.
            if (window.__TAURI__) {
              type FaceSaveResult = {
                path: string;
                face_verified: boolean;
                rejection_reason: string | null;
              };
              const result = await invoke<FaceSaveResult>("save_face_image", {
                imageData: dataUrl,
                index: 0,
                dryRun,
              });

              if (!result?.face_verified) {
                const reason = result?.rejection_reason ?? "save_failed";
                void invoke("log_violation", {
                  kind: "face_capture_rejected",
                  detail: `Backend rejected face image: ${reason}`,
                });
                setCaptureRejections((n) => n + 1);
                resetCaptureAttempt(`Capture rejected: ${reason.replace(/_/g, " ")}`);
                return; // do not advance stage
              }
              captureAccepted = true;
            } else {
              // Dev/browser mode — fire-and-forget, no validation.
              await invoke("save_face_image", { imageData: dataUrl, index: 0, dryRun });
              captureAccepted = true;
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "capture_validation_failed";
          setCaptureRejections((n) => n + 1);
          resetCaptureAttempt(
            `Capture validation failed: ${message}`,
            "Capture failed — try again"
          );
          return;
        }
      }
    }

    if (!captureAccepted) {
      setCaptureRejections((n) => n + 1);
      resetCaptureAttempt("Capture could not be validated.", "Capture failed — try again");
      return;
    }

    // ── Reached only when face_verified is true (or dev mode) ─────────────
    setFlash(true);
    setCaptured([true]);
    setGuidance("Got it!");
    speak("Got it!");
    await new Promise<void>((r) => setTimeout(r, 180));
    setFlash(false);

    capturedRef.current = [true];
    holdMsRef.current = 0;
    facePresentRef.current = false;
    qualityOkRef.current = false;
    smooth.current = { cx: 0.5, cy: 0.5, w: 0, h: 0 };
    setFacePresent(false);
    setQualityOk(false);
    lockPctRef.current = 0;
    setLockPct(0);

    setDone(true);
    setScanState("complete");
    setGuidance("Face scan complete");
    setTimeout(() => onPassRef.current(), 1400);
  };

  function keypointAt(keypoints: FaceKeypointLike[], index: number, label?: string) {
    if (label) {
      const labeled = keypoints.find((point) => point.label === label);
      if (labeled) return labeled;
    }
    return keypoints[index] ?? null;
  }

  function estimatePose(keypoints: FaceKeypointLike[], box: { h: number }) {
    const rightEye = keypointAt(keypoints, 0, "rightEye");
    const leftEye = keypointAt(keypoints, 1, "leftEye");
    const nose = keypointAt(keypoints, 2, "noseTip");
    const mouth = keypointAt(keypoints, 3, "mouthCenter");
    const rightEar = keypointAt(keypoints, 4, "rightEarTragion");
    const leftEar = keypointAt(keypoints, 5, "leftEarTragion");

    if (!leftEye || !rightEye || !nose || !mouth) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const eyeMidY = (leftEye.y + rightEye.y) / 2;
    const eyeSpan = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
    const leftEarSpan = leftEar ? Math.abs(leftEar.x - leftEye.x) : 0;
    const rightEarSpan = rightEar ? Math.abs(rightEar.x - rightEye.x) : 0;
    const earBalance =
      (leftEarSpan - rightEarSpan) / Math.max(0.001, leftEarSpan + rightEarSpan || eyeSpan);
    const rawYaw = (((nose.x - eyeMidX) / eyeSpan) * 85 + earBalance * 22) * -1;
    const yaw = Math.max(-32, Math.min(32, rawYaw));
    const pitch = Math.max(
      -24,
      Math.min(24, ((nose.y - eyeMidY) / Math.max(0.001, box.h) - 0.04) * 140)
    );
    // Vector from rightEye→leftEye: BlazeFace uses person-relative coords so rightEye.x < leftEye.x.
    // atan2(dy, positive_dx) = 0 for a level head; inverted order gave ±180° always.
    const roll = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;

    return { yaw, pitch, roll };
  }

  function isInsideGuide(box: { cx: number; cy: number; w: number; h: number }) {
    const gx = 0.5;
    const gy = 0.48;
    const rx = 0.22;
    const ry = 0.37;
    const dx = 1 - box.cx - gx;
    const dy = box.cy - gy;

    const centerInside = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1.8;
    const sizeOk = box.w >= 0.1 && box.w <= 0.72 && box.h >= 0.12 && box.h <= 0.92;
    return centerInside && sizeOk;
  }

  function getPoseLabel(pose: { yaw: number }) {
    if (Math.abs(pose.yaw) <= 22) return "LOOKING FORWARD";
    return "LOOK STRAIGHT AT THE CAMERA";
  }

  function beginTimedFallback() {
    if (fallbackStartedRef.current) return;
    fallbackStartedRef.current = true;
    setDetectorFailed(true);
    setScanState("blocked");

    // Log this as a security event — stage is hard-blocked, not silently bypassed.
    void invoke("log_violation", {
      kind: "face_detection_fallback",
      detail: `BlazeFace unavailable after ${detectionErrorsRef.current} consecutive errors. Stage 9 hard-blocked; proctor intervention required.`,
    });

    setStageBlocked(true);
    setGuidance("Face detection unavailable");
    setRuntimeNote("Face detection unavailable. Contact your proctor to proceed.");
    // Do NOT auto-capture or call onPass — the stage is blocked.
  }

  function setTrackingLost(next: boolean) {
    setLostTracking((prev) => (prev === next ? prev : next));
  }

  const capturedRef = useRef([false]);
  useEffect(() => {
    capturedRef.current = captured;
  }, [captured]);

  useEffect(() => {
    // Skip the face scan while working on onboarding itself. Build-time relax
    // flag required, so a shipping build ignores the key entirely.
    //
    // Keyed on the same `ams_dev_skip_onboarding` flag the orchestrator uses.
    // It was keyed on finding "tester@ams.local" in `ams_user_email` — a key
    // nothing has written since sign-in moved to printed slips — so it was
    // dead code that read as live, in the one stage where a stray devtools
    // value would have skipped face detection outright.
    if (!isGatingRelaxed()) return;
    if (localStorage.getItem("ams_dev_skip_onboarding") !== "1") return;
    warnGatingRelaxed("face scan skipped (ams_dev_skip_onboarding)");

    setDetectorReady(true);
    setPhaseIdx(0);
    setGuidance("Test account auto-passed face scan.");
    setFacePresent(true);
    setQualityOk(true);
    setLockPct(100);
    setCaptured([true]);
    setDone(true);
    setScanState("complete");
    const timer = setTimeout(() => onPassRef.current(), 250);
    return () => clearTimeout(timer);
  }, []);

  // ── Init: camera + TensorFlow.js BlazeFace ───────────────────
  useEffect(() => {
    // Don't spin up BlazeFace when the dev skip above already passed the
    // stage. A production build always runs the real scan: `isGatingRelaxed`
    // is build-time, so no localStorage value can reach this on its own.
    if (isGatingRelaxed() && localStorage.getItem("ams_dev_skip_onboarding") === "1") return;

    let cancelled = false;

    async function init() {
      let activeStream: MediaStream | null = null;
      if (videoRef.current) {
        activeStream = stream;

        if (!activeStream && navigator.mediaDevices) {
          activeStream = await getUserMediaWithTimeout(
            {
              video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            },
            8000
          ).catch(() => null);
          if (cancelled) {
            stopMediaStream(activeStream);
            return;
          }
          localStreamRef.current = activeStream;
        }

        if (activeStream) {
          videoRef.current.srcObject = activeStream;
          await videoRef.current.play().catch(() => {});
          await waitForVideoReady(videoRef.current, 2500).catch(() => {});
          if (cancelled) {
            if (localStreamRef.current === activeStream) {
              stopMediaStream(localStreamRef.current);
              localStreamRef.current = null;
            }
            return;
          }
        } else {
          beginTimedFallback();
          return;
        }
      }

      try {
        const det = await withTimeout(
          (async () => {
            const tf = await import("@tensorflow/tfjs-core");

            // Prefer WASM backend (25–50 ms/frame with SIMD) over pure-JS CPU
            // (200–900 ms/frame).  WASM files are bundled under /tfjs-wasm/ by
            // scripts/setup-tfjs-wasm.mjs so no CDN fetch is needed at runtime.
            // TF.js auto-selects the fastest WASM variant the CPU supports:
            //   threaded-simd (needs SharedArrayBuffer) → simd → plain wasm.
            // If WASM init fails for any reason, we fall back to CPU so the
            // stage can still function (albeit slower) rather than hard-failing.
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

            if (window.__TAURI__) {
              type ModelAssetVerification = {
                ok: boolean;
                checked_files: number;
                error: string | null;
              };
              const verification = await invoke<ModelAssetVerification>("verify_face_model_assets");
              if (!verification?.ok) {
                throw new Error(verification?.error ?? "face_model_integrity_failed");
              }
            }

            const blazeface = (await import("@tensorflow-models/blazeface")) as BlazeFaceModuleLike;
            return blazeface.load({
              maxFaces: 1,
              inputWidth: 128,
              inputHeight: 128,
              scoreThreshold: 0.75,
              modelUrl: BLAZEFACE_MODEL_URL,
            });
          })(),
          7000,
          "Face detector startup timed out"
        );
        if (cancelled) {
          det.dispose();
          return;
        }
        detectorRef.current = det;
        detectCanvasRef.current = document.createElement("canvas");
        setDetectorReady(true);
        setScanState("ready");
        setRuntimeNote(null);
        setGuidance(PHASES[0].instruction);
        speak(PHASES[0].instruction);
      } catch (error) {
        if (cancelled) return;
        setDetectorReady(true);
        setRuntimeNote(
          error instanceof Error
            ? `Detector init failed: ${error.message}`
            : "Detector init failed in this runtime."
        );
        beginTimedFallback();
      }
    }

    void init();
    return () => {
      cancelled = true;
      detectorRef.current?.dispose();
      detectorRef.current = null;
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // ── Detection + canvas loop ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const EMA = 0.28;
    const DETECT_INTERVAL = 250;

    let prevFP = false;
    let prevQK = false;
    let prevGuidance = "";
    let prevPoseLabel = "";

    function getQuality(s: typeof smooth.current, pose: typeof poseRef.current) {
      if (s.w < 0.1) return { ok: false, hint: "Move a bit closer" };
      if (s.w > 0.72) return { ok: false, hint: "Step back a little" };
      if (Math.abs(pose.roll) > 30) return { ok: false, hint: "Keep your head level" };
      if (pose.pitch < -30) return { ok: false, hint: "Tilt your head down slightly" };
      if (pose.pitch > 30) return { ok: false, hint: "Lift your chin slightly" };

      const sx = 1 - s.cx;
      if (sx < 0.18) return { ok: false, hint: "Move your face right" };
      if (sx > 0.82) return { ok: false, hint: "Move your face left" };
      if (s.cy < 0.12) return { ok: false, hint: "Move your face down" };
      if (s.cy > 0.88) return { ok: false, hint: "Move your face up" };
      if (Math.abs(pose.yaw) > 22) return { ok: false, hint: "Look straight at the camera" };
      return { ok: true, hint: "Hold still..." };
    }

    function processDetection(video: HTMLVideoElement) {
      const det = detectorRef.current;
      const dc = detectCanvasRef.current;
      if (!det || !dc || detectionBusyRef.current) return;
      detectionBusyRef.current = true;

      void (async () => {
        try {
          let res: FacePredictionLike[] = [];
          const sourceWidth = 128;
          const sourceHeight = 128;
          if (dc.width !== sourceWidth || dc.height !== sourceHeight) {
            dc.width = sourceWidth;
            dc.height = sourceHeight;
          }
          const dctx = dc.getContext("2d", { willReadFrequently: true });
          if (!dctx) return;
          dctx.drawImage(video, 0, 0, sourceWidth, sourceHeight);
          res = await det.estimateFaces(dc, false, false, true);

          detectionErrorsRef.current = 0;
          const detection = res[0];

          if (detection?.topLeft && detection?.bottomRight) {
            const [x1, y1] = detection.topLeft;
            const [x2, y2] = detection.bottomRight;
            const raw = {
              cx: (x1 + x2) / 2 / sourceWidth,
              cy: (y1 + y2) / 2 / sourceHeight,
              w: Math.abs(x2 - x1) / sourceWidth,
              h: Math.abs(y2 - y1) / sourceHeight,
            };
            if (isInsideGuide(raw)) {
              const s = smooth.current;
              if (!facePresentRef.current) {
                s.cx = raw.cx;
                s.cy = raw.cy;
                s.w = raw.w;
                s.h = raw.h;
              } else {
                s.cx = EMA * raw.cx + (1 - EMA) * s.cx;
                s.cy = EMA * raw.cy + (1 - EMA) * s.cy;
                s.w = EMA * raw.w + (1 - EMA) * s.w;
                s.h = EMA * raw.h + (1 - EMA) * s.h;
              }
              keypointsRef.current = (detection.landmarks ?? []).map(([x, y]) => ({
                x: x / sourceWidth,
                y: y / sourceHeight,
              }));
              poseRef.current = estimatePose(keypointsRef.current, raw);
              facePresentRef.current = true;
            } else {
              facePresentRef.current = false;
              keypointsRef.current = null;
              smooth.current.w *= 0.8;
              smooth.current.h *= 0.8;
            }
          } else {
            facePresentRef.current = false;
            keypointsRef.current = null;
            smooth.current.w *= 0.92;
            smooth.current.h *= 0.92;
          }

          const { ok, hint } = getQuality(smooth.current, poseRef.current);
          qualityOkRef.current = facePresentRef.current && ok;
          const nextPoseLabel = facePresentRef.current ? getPoseLabel(poseRef.current) : "SCANNING";

          if (
            facePresentRef.current !== prevFP ||
            ok !== prevQK ||
            hint !== prevGuidance ||
            nextPoseLabel !== prevPoseLabel
          ) {
            prevFP = facePresentRef.current;
            prevQK = ok;
            prevGuidance = hint;
            prevPoseLabel = nextPoseLabel;
            setFacePresent(facePresentRef.current);
            setQualityOk(qualityOkRef.current);
            setPoseLabel(nextPoseLabel);
            if (capturingRef.current) {
              setScanState("validating");
            } else if (!facePresentRef.current) {
              setScanState("ready");
              setTrackingLost(true);
              setPoseLabel("SCANNING");
              setGuidance("Please come back into frame");
            } else {
              setScanState(qualityOkRef.current ? "tracking" : "ready");
              setTrackingLost(false);
              setGuidance(hint);
            }
          }

          const phasePoseMatch = facePresentRef.current && !capturedRef.current[0];

          if (qualityOkRef.current && phasePoseMatch && !capturingRef.current) {
            holdMsRef.current = Math.min(PHASE_HOLD_MS, holdMsRef.current + DETECT_INTERVAL);
          } else {
            holdMsRef.current = 0;
          }
          lockPctRef.current = Math.round((holdMsRef.current / PHASE_HOLD_MS) * 100);
          setLockPct(lockPctRef.current);

          if (
            holdMsRef.current >= PHASE_HOLD_MS &&
            !capturingRef.current &&
            !fallbackStartedRef.current
          ) {
            capturingRef.current = true;
            setScanState("validating");
            void capturePhaseRef.current(0);
          }
        } catch (error) {
          detectionErrorsRef.current += 1;
          if (cancelled) return;
          if (detectionErrorsRef.current >= 4) {
            setRuntimeNote(
              error instanceof Error
                ? `Detector inference failed: ${error.message}`
                : "Detector inference failed in this runtime."
            );
          }
          if (detectionErrorsRef.current >= 15) {
            beginTimedFallback();
          }
        } finally {
          detectionBusyRef.current = false;
        }
      })();
    }

    function loop(ts: number) {
      rafRef.current = requestAnimationFrame(loop);
      if (ts - lastDrawMsRef.current < 66) return;
      lastDrawMsRef.current = ts;
      const canvas = overlayCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const t = ts / 1000;

      // ── Run detection at ~8 FPS ────────────────────────────
      const video = videoRef.current;
      if (
        detectorRef.current &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        ts - lastDetectMs.current >= DETECT_INTERVAL
      ) {
        lastDetectMs.current = ts;
        processDetection(video);
      }

      // ── Canvas draw (60 FPS) ───────────────────────────────
      ctx.clearRect(0, 0, W, H);
      const s = smooth.current;
      const fp = facePresentRef.current;
      const qk = qualityOkRef.current;
      const pose = poseRef.current;
      const keypoints = keypointsRef.current;

      const dCX = (1 - s.cx) * W;
      const dCY = s.cy * H;
      const dW = s.w * W;
      const dH = s.h * H;

      // Fixed oval guide (symmetric — same mirrored or not)
      const oCX = W / 2;
      const oCY = H * 0.48;
      const oRX = W * 0.22;
      const oRY = H * 0.37;

      const color = done
        ? [34, 197, 94]
        : qk
          ? [34, 197, 94]
          : lostTracking
            ? [239, 68, 68]
            : fp
              ? [168, 85, 247]
              : [100, 116, 139];
      const rgb = color.join(",");

      // Stark 1px center crosshair reticle overlay instead of glowing circles
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Horizontal crosshair line
      ctx.moveTo(oCX - 15, oCY);
      ctx.lineTo(oCX + 15, oCY);
      // Vertical crosshair line
      ctx.moveTo(oCX, oCY - 15);
      ctx.lineTo(oCX, oCY + 15);
      ctx.stroke();

      // Bounding corners for face alignment
      const bS = 14;
      const mg = 4;
      const bx1 = oCX - oRX - mg;
      const bx2 = oCX + oRX + mg;
      const by1 = oCY - oRY - mg;
      const by2 = oCY + oRY + mg;
      ctx.strokeStyle = qk ? "#22c55e" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1.5;
      (
        [
          [bx1, by1, 1, 1],
          [bx2, by1, -1, 1],
          [bx1, by2, 1, -1],
          [bx2, by2, -1, -1],
        ] as [number, number, number, number][]
      ).forEach(([x, y, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(x + dx * bS, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * bS);
        ctx.stroke();
      });

      // Face center dot & bounding box if detected
      if (fp && keypoints?.length) {
        ctx.save();
        ctx.strokeStyle = qk ? "#22c55e" : "rgba(255,255,255,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(dCX - dW / 2, dCY - dH / 2, dW, dH);

        ctx.fillStyle = qk ? "#22c55e" : "#f59e0b";
        ctx.beginPath();
        ctx.arc(dCX, dCY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phase = PHASES[phaseIdx];
  const scanStateLabel: Record<FaceScanState, string> = {
    loading: "Loading model",
    ready: "Waiting for face",
    tracking: "Finding face",
    validating: "Checking capture",
    complete: "Calibration complete",
    blocked: "Detection blocked",
  };
  const displayedLockPct = scanState === "validating" ? 100 : lockPct;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <StageHeader label="Face Scan" />

      <div style={{ position: "relative", width: 320, height: 240, marginBottom: "24px" }}>
        {flash && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              background: "rgba(255,255,255,0.6)",
              borderRadius: "var(--radius-lg)",
              animation: "face-flash 0.35s ease forwards",
            }}
          />
        )}

        {/* Crosshair pulse overlay when face tracked and quality ok */}
        {facePresent && !done && qualityOk && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 30,
              height: 30,
              zIndex: 15,
              pointerEvents: "none",
              animation: "countdown-pulse 1.2s ease-in-out infinite",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                border: "1.5px solid rgba(34,197,94,0.7)",
                borderRadius: "50%",
              }}
            />
          </div>
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "var(--radius-sm)",
            transform: "scaleX(-1)",
          }}
        />

        <canvas
          ref={overlayCanvasRef}
          width={320}
          height={240}
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "var(--radius-sm)",
            pointerEvents: "none",
          }}
        />

        <canvas ref={captureCanvasRef} width={320} height={240} style={{ display: "none" }} />

        {/* Rigid border corner elements */}
        <div
          style={{
            position: "absolute",
            inset: "-1px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${done ? "rgba(34,197,94,0.4)" : qualityOk ? "rgba(34,197,94,0.3)" : lostTracking ? "rgba(239,68,68,0.5)" : facePresent ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
            pointerEvents: "none",
            transition: "border-color var(--transition-standard)",
            ...(done ? { animation: "capture-border-pulse 0.6s ease forwards" } : {}),
          }}
        />

        {/* Model loading overlay */}
        {!detectorReady && !detectorFailed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "#0F0F0F",
              borderRadius: "var(--radius-sm)",
              gap: "12px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "rgba(255,255,255,0.58)",
              }}
            >
              Preparing face check
            </span>
          </div>
        )}

        {/* Hard-block overlay — shown when detection is unavailable and stage cannot auto-proceed */}
        {stageBlocked && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(3, 8, 22, 0.94)",
              borderRadius: "var(--radius-sm)",
              gap: "10px",
              border: "1px solid rgba(239, 68, 68, 0.45)",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "#ef4444",
                letterSpacing: "0.08em",
              }}
            >
              Face detection unavailable
            </span>
            <span
              style={{
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                color: "rgba(255,255,255,0.58)",
                textAlign: "center",
                maxWidth: "220px",
                lineHeight: 1.65,
              }}
            >
              Use the option below to continue for a proctor review.
            </span>
          </div>
        )}
      </div>

      {/* Two-up tracking/progress grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "12px 16px",
          width: 320,
          marginBottom: 16,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        <span style={{ fontSize: "var(--text-base)", color: "rgba(255,255,255,0.58)" }}>
          Tracking
        </span>
        <span
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: qualityOk
              ? "#22c55e"
              : lostTracking
                ? "#ef4444"
                : facePresent
                  ? "var(--color-indicator-warn)"
                  : "rgba(255,255,255,0.58)",
          }}
        >
          {scanState === "validating"
            ? "Capture ready"
            : lostTracking
              ? "Face not centered"
              : poseLabel}
        </span>
        <span style={{ fontSize: "var(--text-base)", color: "rgba(255,255,255,0.58)" }}>
          Progress
        </span>
        <span
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: displayedLockPct >= 100 ? "#22c55e" : "rgba(255,255,255,0.58)",
          }}
        >
          {displayedLockPct}%
        </span>
      </div>

      {/* Guidance text */}
      <p
        style={{
          fontSize: "12px",
          fontFamily: "'JetBrains Mono', monospace",
          color: qualityOk
            ? "#FFF"
            : lostTracking
              ? "#ef4444"
              : facePresent
                ? "#FFF"
                : "rgba(255,255,255,0.58)",
          marginBottom: "16px",
          textAlign: "center",
          minHeight: "18px",
          transition: "color var(--transition-standard)",
          lineHeight: 1.5,
        }}
      >
        {guidance}
      </p>

      {runtimeNote && (
        <p
          style={{
            fontSize: "11px",
            fontFamily: "'JetBrains Mono', monospace",
            color: "#f59e0b",
            marginBottom: "12px",
            textAlign: "center",
            maxWidth: "280px",
            lineHeight: 1.6,
          }}
        >
          {runtimeNote}
        </p>
      )}

      {/* Equity fallback: repeated rejections — or a detector that can't load at
          all — shouldn't trap a real candidate. */}
      {onFaceFallback && !done && (captureRejections >= FACE_FALLBACK_AFTER || detectorFailed) && (
        <div
          style={{
            maxWidth: 320,
            textAlign: "center",
            marginBottom: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <p
            style={{
              fontSize: "12px",
              color: "rgba(255,255,255,0.58)",
              lineHeight: 1.6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Still having trouble with the camera check? You can continue and have a proctor review
            this manually — your contest won&rsquo;t be blocked.
          </p>
          <button
            type="button"
            className="onb-btn onb-btn--secondary"
            onClick={() => onFaceFallback()}
          >
            Continue — request a proctor review
          </button>
        </div>
      )}

      {/* Lock progress bar */}
      {(facePresent || scanState === "validating") && !done && (
        <div
          style={{
            width: 320,
            height: 6,
            background: "rgba(255,255,255,0.06)",
            marginBottom: "18px",
            overflow: "hidden",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${displayedLockPct}%`,
              background: qualityOk ? "#22c55e" : "#FFF",
              transition: "width 200ms cubic-bezier(0.22,1,0.36,1)",
              borderRadius: "var(--radius-sm)",
            }}
          />
        </div>
      )}
      <style>{`
        @keyframes face-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes capture-border-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); } 60% { box-shadow: 0 0 0 8px rgba(34,197,94,0); } 100% { box-shadow: none; } }
        @keyframes onb-tick-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
