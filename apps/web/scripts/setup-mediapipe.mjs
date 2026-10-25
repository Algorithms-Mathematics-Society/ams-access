#!/usr/bin/env node
/**
 * Idempotent MediaPipe asset setup.
 *
 * Default: ensure assets.
 * --if-used: skip all work unless current source references MediaPipe.
 * --skip-model: copy WASM only; do not check/download the task bundle.
 */
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { get } from "https";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { patchMediaPipeLogging } from "./mediapipe-logging.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const onlyIfUsed = args.has("--if-used");
const skipModel = args.has("--skip-model") || process.env.AMS_MEDIAPIPE_SKIP_MODEL === "1";

const wasmDest = join(root, "public/mediapipe/wasm");
const modelDest = join(root, "public/mediapipe/face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Object detection (COCO), used by lib/object-watch.ts to flag a phone in
// frame. int8 rather than float32: 4.6 MB against 13.8 MB, for a model whose
// output a human reviews anyway.
const objectModelDest = join(root, "public/mediapipe/efficientdet_lite0.tflite");
const OBJECT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite";
// Pinned, as setup-blazeface-model.mjs pins its two files. This lands inside
// an exam binary; it is not something to take on trust from a CDN at build
// time.
const OBJECT_MODEL_SHA256 = "0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb";

// Only the SIMD build is shipped. The directory also carries an ES-module
// variant and a nosimd fallback, 33 MB in total, and every byte lands in the
// installer that 1,200 candidates download on exam morning. SIMD has been
// standard on x86-64 and ARM64 for a decade; a machine without it fails to
// load the detector, which is handled -- object detection is advisory, and
// the caller stops asking after one failure.
const WASM_KEEP = new Set(["vision_wasm_internal.js", "vision_wasm_internal.wasm"]);

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "out"].includes(entry.name)) continue;
      walk(path, files);
    } else if (/\.(ts|tsx|js|jsx|mjs|css|html)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function sourceUsesMediaPipe() {
  const needles = ["@mediapipe/tasks-vision", "/mediapipe/", "face_landmarker.task"];
  return walk(join(root, "src")).some((file) => {
    const text = readFileSync(file, "utf8");
    return needles.some((needle) => text.includes(needle));
  });
}

function findWasmSrc() {
  const candidates = [
    join(root, "node_modules/@mediapipe/tasks-vision/wasm"),
    join(root, "../../node_modules/@mediapipe/tasks-vision/wasm"),
    join(
      root,
      "../../node_modules/.pnpm/@mediapipe+tasks-vision@0.10.35/node_modules/@mediapipe/tasks-vision/wasm"
    ),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sameFile(src, dest) {
  if (!existsSync(dest)) return false;
  const srcStat = statSync(src);
  const destStat = statSync(dest);
  return srcStat.size === destStat.size && hashFile(src) === hashFile(dest);
}

function copyWasm() {
  const wasmSrc = findWasmSrc();
  if (!wasmSrc) {
    console.error("ERROR: @mediapipe/tasks-vision not found. Run pnpm install first.");
    process.exit(1);
  }
  mkdirSync(wasmDest, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const f of readdirSync(wasmSrc)) {
    if (!WASM_KEEP.has(f)) continue;
    const src = join(wasmSrc, f);
    const dest = join(wasmDest, f);
    if (f.endsWith(".js")) {
      const patched = patchMediaPipeLogging(readFileSync(src, "utf8"));
      if (existsSync(dest) && readFileSync(dest, "utf8") === patched) {
        skipped++;
      } else {
        writeFileSync(dest, patched);
        copied++;
      }
      continue;
    }
    if (sameFile(src, dest)) {
      skipped++;
      continue;
    }
    copyFileSync(src, dest);
    copied++;
  }
  console.log(
    `MediaPipe WASM: ${copied} copied, ${skipped} unchanged (${relative(root, wasmDest)})`
  );
}

function sourceUsesFaceLandmarker() {
  return walk(join(root, "src")).some((file) =>
    readFileSync(file, "utf8").includes("face_landmarker.task")
  );
}

function downloadModel() {
  if (skipModel) {
    console.log("MediaPipe model: skipped by flag/env");
    return Promise.resolve();
  }
  // Nothing imports the Face Landmarker today -- head pose and gaze were
  // considered and not shipped. Downloading it anyway puts 3.7 MB of unused
  // weights into an installer that candidates fetch on exam morning.
  if (!sourceUsesFaceLandmarker()) {
    console.log("MediaPipe model: skipped; no source references face_landmarker.task");
    return Promise.resolve();
  }
  if (existsSync(modelDest)) {
    console.log("MediaPipe model: already present");
    return Promise.resolve();
  }
  mkdirSync(join(root, "public/mediapipe"), { recursive: true });
  console.log("MediaPipe model: downloading Face Landmarker task bundle...");
  return new Promise((resolve, reject) => {
    function fetch(url) {
      get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          fetch(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const tempDest = `${modelDest}.tmp`;
        const file = createWriteStream(tempDest);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          renameSync(tempDest, modelDest);
          console.log("MediaPipe model: saved public/mediapipe/face_landmarker.task");
          resolve();
        });
        file.on("error", (error) => {
          try {
            unlinkSync(tempDest);
          } catch {}
          reject(error);
        });
      }).on("error", reject);
    }
    fetch(MODEL_URL);
  });
}

if (onlyIfUsed && !sourceUsesMediaPipe()) {
  console.log("MediaPipe setup: skipped; active source does not reference MediaPipe.");
  process.exit(0);
}

function downloadObjectModel() {
  if (skipModel) {
    console.log("MediaPipe object model: skipped by flag/env");
    return Promise.resolve();
  }
  if (existsSync(objectModelDest)) {
    if (hashFile(objectModelDest) === OBJECT_MODEL_SHA256) {
      console.log("MediaPipe object model: already present");
      return Promise.resolve();
    }
    console.log("MediaPipe object model: hash mismatch, re-downloading");
    unlinkSync(objectModelDest);
  }
  mkdirSync(join(root, "public/mediapipe"), { recursive: true });
  console.log("MediaPipe object model: downloading EfficientDet-Lite0 (int8)...");
  return new Promise((resolve, reject) => {
    function fetch(url) {
      get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          fetch(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const tempDest = `${objectModelDest}.tmp`;
        const file = createWriteStream(tempDest);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          const actual = hashFile(tempDest);
          if (actual !== OBJECT_MODEL_SHA256) {
            unlinkSync(tempDest);
            reject(
              new Error(
                `object model sha256 ${actual} does not match the pinned ${OBJECT_MODEL_SHA256}`
              )
            );
            return;
          }
          renameSync(tempDest, objectModelDest);
          console.log("MediaPipe object model: saved public/mediapipe/efficientdet_lite0.tflite");
          resolve();
        });
        file.on("error", (error) => {
          try {
            unlinkSync(tempDest);
          } catch {}
          reject(error);
        });
      }).on("error", reject);
    }
    fetch(OBJECT_MODEL_URL);
  });
}

copyWasm();
await downloadModel();
await downloadObjectModel();
