#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const budgets = {
  outBytes: Number(process.env.AMS_BUDGET_WEB_OUT_MB ?? 45) * 1024 * 1024,
  publicMediaPipeBytes: Number(process.env.AMS_BUDGET_MEDIAPIPE_MB ?? 40) * 1024 * 1024,
  maxJsChunkBytes: Number(process.env.AMS_BUDGET_JS_CHUNK_KB ?? 350) * 1024,
};

function dirSize(path) {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? dirSize(child) : statSync(child).size;
  }
  return total;
}

function files(path, matcher, out = []) {
  if (!existsSync(path)) return out;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files(child, matcher, out);
    else if (matcher(child)) out.push(child);
  }
  return out;
}

function fmt(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const checks = [];
const outDir = join(root, "out");
const mediaPipeDir = join(root, "public/mediapipe");
const jsChunks = files(join(outDir, "_next/static"), (path) => path.endsWith(".js"));
const largestChunk = jsChunks
  .map((path) => ({ path, size: statSync(path).size }))
  .sort((a, b) => b.size - a.size)[0];

checks.push({ label: "static export out/", actual: dirSize(outDir), budget: budgets.outBytes });
checks.push({
  label: "public/mediapipe/",
  actual: dirSize(mediaPipeDir),
  budget: budgets.publicMediaPipeBytes,
});
if (largestChunk) {
  checks.push({
    label: `largest JS chunk (${relative(root, largestChunk.path)})`,
    actual: largestChunk.size,
    budget: budgets.maxJsChunkBytes,
  });
}

let failed = false;
for (const check of checks) {
  const ok = check.actual <= check.budget;
  failed ||= !ok;
  console.log(`${ok ? "OK" : "FAIL"} ${check.label}: ${fmt(check.actual)} / ${fmt(check.budget)}`);
}

if (failed) {
  console.error("Size budget check failed. Adjust budgets intentionally or reduce assets/chunks.");
  process.exit(1);
}
