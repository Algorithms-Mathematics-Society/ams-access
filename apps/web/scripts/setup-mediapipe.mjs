#!/usr/bin/env node
/**
 * Copies MediaPipe WASM runtime files to public/mediapipe/wasm/ and
 * downloads the Face Landmarker task bundle if not already present.
 *
 * Run once: node scripts/setup-mediapipe.mjs
 * Or add to package.json prebuild: "prebuild": "node scripts/setup-mediapipe.mjs"
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync } from "fs";
import { get } from "https";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// pnpm hoists deps differently — walk up to find the package
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

const wasmSrc = findWasmSrc();
const wasmDest = join(root, "public/mediapipe/wasm");
const modelDest = join(root, "public/mediapipe/face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

function copyWasm() {
  if (!wasmSrc) {
    console.error("ERROR: @mediapipe/tasks-vision not found. Run pnpm install first.");
    process.exit(1);
  }
  mkdirSync(wasmDest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(wasmSrc)) {
    copyFileSync(join(wasmSrc, f), join(wasmDest, f));
    n++;
  }
  console.log(`✓ Copied ${n} WASM files → public/mediapipe/wasm/`);
}

function downloadModel() {
  if (existsSync(modelDest)) {
    console.log("✓ Face Landmarker model already present, skipping download");
    return Promise.resolve();
  }
  mkdirSync(join(root, "public/mediapipe"), { recursive: true });
  console.log("⬇  Downloading Face Landmarker model bundle…");
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
        const file = createWriteStream(modelDest);
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log("✓ Face Landmarker model saved → public/mediapipe/face_landmarker.task");
          resolve();
        });
        file.on("error", reject);
      }).on("error", reject);
    }
    fetch(MODEL_URL);
  });
}

copyWasm();
await downloadModel();
