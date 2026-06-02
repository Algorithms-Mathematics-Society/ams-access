#!/usr/bin/env node
/**
 * Copy TF.js WASM backend binaries to public/tfjs-wasm/.
 *
 * The three WASM variants (plain / simd / threaded-simd) must be served as
 * static files so TF.js can load them at runtime without a network request.
 * TF.js auto-selects the fastest variant supported by the environment:
 *   threaded-simd  → fastest, requires SharedArrayBuffer
 *   simd           → ~25–50 ms/frame for BlazeFace (vs 200–900 ms on CPU)
 *   plain          → safe fallback for older CPUs
 *
 * The copy is idempotent — files are only written when the source differs
 * (size + SHA-256 check), so re-runs are fast.
 *
 * Usage:
 *   node scripts/setup-tfjs-wasm.mjs          # always run
 *   node scripts/setup-tfjs-wasm.mjs --check  # exit 1 if public/ is stale
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dest = join(root, "public/tfjs-wasm");
const checkOnly = process.argv.includes("--check");

// ── Locate the dist/ directory that contains the .wasm binaries ───────────────
function findWasmSrc() {
  // 1. Direct node_modules symlink (npm / yarn hoisting)
  const direct = join(root, "node_modules/@tensorflow/tfjs-backend-wasm/dist");
  if (existsSync(direct)) return direct;

  // 2. Workspace root hoisted
  const workspaceHoisted = join(
    root,
    "../../node_modules/@tensorflow/tfjs-backend-wasm/dist"
  );
  if (existsSync(workspaceHoisted)) return workspaceHoisted;

  // 3. pnpm content-addressable store — scan for the versioned entry
  const pnpmStore = join(root, "../../node_modules/.pnpm");
  if (existsSync(pnpmStore)) {
    for (const entry of readdirSync(pnpmStore)) {
      if (!entry.startsWith("@tensorflow+tfjs-backend-wasm")) continue;
      const candidate = join(
        pnpmStore,
        entry,
        "node_modules/@tensorflow/tfjs-backend-wasm/dist"
      );
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

// ── SHA-256 idempotency check ─────────────────────────────────────────────────
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isIdentical(src, dst) {
  if (!existsSync(dst)) return false;
  if (statSync(src).size !== statSync(dst).size) return false;
  return sha256(src) === sha256(dst);
}

// ── Main ──────────────────────────────────────────────────────────────────────
const src = findWasmSrc();
if (!src) {
  console.error(
    "ERROR: @tensorflow/tfjs-backend-wasm dist/ not found.\n" +
      "       Run `pnpm install` from the repo root and try again."
  );
  process.exit(1);
}

const wasmFiles = readdirSync(src).filter((f) => f.endsWith(".wasm"));
if (wasmFiles.length === 0) {
  console.error(`ERROR: No .wasm files found in ${src}`);
  process.exit(1);
}

if (checkOnly) {
  const stale = wasmFiles.filter((f) => !isIdentical(join(src, f), join(dest, f)));
  if (stale.length > 0) {
    console.error(
      `TF.js WASM check: ${stale.length} stale file(s) — run node scripts/setup-tfjs-wasm.mjs`
    );
    process.exit(1);
  }
  console.log("TF.js WASM check: public/tfjs-wasm/ is up to date");
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
let copied = 0;
let skipped = 0;

for (const f of wasmFiles) {
  const s = join(src, f);
  const d = join(dest, f);
  if (isIdentical(s, d)) {
    skipped++;
    continue;
  }
  copyFileSync(s, d);
  copied++;
}

console.log(
  `TF.js WASM: ${copied} copied, ${skipped} unchanged → ${relative(process.cwd(), dest)}/`
);
