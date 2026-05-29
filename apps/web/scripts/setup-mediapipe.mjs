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
} from "fs";
import { createHash } from "crypto";
import { get } from "https";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const args = new Set(process.argv.slice(2));
const onlyIfUsed = args.has("--if-used");
const skipModel = args.has("--skip-model") || process.env.AMS_MEDIAPIPE_SKIP_MODEL === "1";

const wasmDest = join(root, "public/mediapipe/wasm");
const modelDest = join(root, "public/mediapipe/face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

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
    const src = join(wasmSrc, f);
    const dest = join(wasmDest, f);
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

function downloadModel() {
  if (skipModel) {
    console.log("MediaPipe model: skipped by flag/env");
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

copyWasm();
await downloadModel();
