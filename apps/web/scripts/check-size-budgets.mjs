#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function readBudget(name, fallback, unitBytes) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Invalid ${name}: expected a positive number, got ${process.env[name]}`);
    process.exit(1);
  }
  return value * unitBytes;
}

const budgets = {
  outBytes: readBudget("AMS_BUDGET_WEB_OUT_MB", 45, 1024 * 1024),
  publicMediaPipeBytes: readBudget("AMS_BUDGET_MEDIAPIPE_MB", 40, 1024 * 1024),
  maxJsChunkBytes: readBudget("AMS_BUDGET_JS_CHUNK_KB", 500, 1024),
  defaultRouteJsBytes: readBudget("AMS_BUDGET_ROUTE_JS_KB", 460, 1024),
};

// JS each exported screen executes on load, in KiB. Measured 2026-10-02 plus
// ~15% headroom: tight enough that one shared library leaking into every
// screen fails here (a 257 KiB KaTeX chunk once rode the root layout onto
// Login, Home and Onboarding while the largest-chunk check stayed green).
// Screens not listed use AMS_BUDGET_ROUTE_JS_KB.
const routeJsBudgetsKiB = {
  "/": 600,
  "/login/": 680,
  "/home/": 960,
  "/session/onboarding/": 770,
  "/results/": 640,
  "/session/contest/": 1900,
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

if (!existsSync(outDir)) {
  console.error("Size budget check failed: static export out/ is missing. Run next build first.");
  process.exit(1);
}

const jsChunks = files(join(outDir, "_next/static"), (path) => path.endsWith(".js"));
const largestChunk = jsChunks
  .map((path) => ({ path, size: statSync(path).size }))
  .sort((a, b) => b.size - a.size)[0];

if (!largestChunk) {
  console.error("Size budget check failed: no JS chunks found in out/_next/static.");
  process.exit(1);
}

checks.push({ label: "static export out/", actual: dirSize(outDir), budget: budgets.outBytes });
checks.push({
  label: "public/mediapipe/",
  actual: dirSize(mediaPipeDir),
  budget: budgets.publicMediaPipeBytes,
});
checks.push({
  label: `largest JS chunk (${relative(root, largestChunk.path)})`,
  actual: largestChunk.size,
  budget: budgets.maxJsChunkBytes,
});

// Per screen: every <script src> the page loads, excluding noModule polyfills
// (a modern webview skips them). Shared chunks count once per screen.
const pages = files(outDir, (path) => path.endsWith(".html"));
if (pages.length === 0) {
  console.error("Size budget check failed: no exported HTML pages found in out/.");
  process.exit(1);
}
for (const page of pages) {
  const rel = relative(outDir, page).split("\\").join("/");
  const route =
    rel === "index.html" ? "/" : rel.endsWith("/index.html") ? `/${rel.slice(0, -10)}` : `/${rel}`;
  const html = readFileSync(page, "utf8");
  const scripts = new Set();
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    if (/\bnomodule\b/i.test(tag)) continue;
    const src = tag.match(/\bsrc="(\/_next\/static\/[^"]+\.js)"/)?.[1];
    if (src) scripts.add(src);
  }
  let actual = 0;
  for (const src of scripts) {
    const path = join(outDir, src);
    if (!existsSync(path)) {
      console.error(`Size budget check failed: ${route} references missing ${src}.`);
      process.exit(1);
    }
    actual += statSync(path).size;
  }
  const kib = routeJsBudgetsKiB[route];
  checks.push({
    label: `screen JS ${route}`,
    actual,
    budget: kib === undefined ? budgets.defaultRouteJsBytes : kib * 1024,
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
