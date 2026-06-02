#!/usr/bin/env node
/**
 * Bundle BlazeFace graph-model assets under public/models/blazeface/.
 *
 * Stage 9 must never fetch TFHub during exam lockdown. This script downloads
 * the pinned TF.js graph model at build/dev setup time and writes a SHA-256
 * manifest that the Tauri backend verifies before the model is loaded.
 */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dest = join(root, "public/models/blazeface");
const checkOnly = process.argv.includes("--check");
const modelUrl = "https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/model.json?tfjs-format=file";
const expectedAssets = new Map([
  [
    "group1-shard1of1.bin",
    {
      sha256: "60b481ab6c19352673cdb21e02e639f90883db1393ac52d07c7ea4e1e11cb2cd",
      bytes: 401768,
    },
  ],
  [
    "model.json",
    {
      sha256: "7b6bb6f35e5a7899232de51dda8bf514ef9664ca7ec58388c9fecc088c883b58",
      bytes: 64036,
    },
  ],
]);

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function existingManifestIsValid() {
  const manifestPath = join(dest, "manifest.json");
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return manifest.files.length === expectedAssets.size && manifest.files.every((file) => {
      const expected = expectedAssets.get(file.path);
      const path = join(dest, file.path);
      return (
        expected &&
        file.bytes === expected.bytes &&
        file.sha256 === expected.sha256 &&
        existsSync(path) &&
        statSync(path).size === expected.bytes &&
        sha256File(path) === expected.sha256
      );
    });
  } catch {
    return false;
  }
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function weightPaths(modelJson) {
  const paths = [];
  for (const group of modelJson.weightsManifest ?? []) {
    for (const path of group.paths ?? []) {
      paths.push(path);
    }
  }
  return [...new Set(paths)];
}

function assertExpectedAsset(path) {
  const expected = expectedAssets.get(path);
  if (!expected) throw new Error(`Unexpected BlazeFace asset: ${path}`);
  const actualSha256 = sha256File(join(dest, path));
  const actualBytes = statSync(join(dest, path)).size;
  if (actualSha256 !== expected.sha256 || actualBytes !== expected.bytes) {
    throw new Error(`BlazeFace asset integrity failed: ${path}`);
  }
}

function buildManifest() {
  const files = [...expectedAssets.entries()].map(([name, expected]) => {
    assertExpectedAsset(name);
    return {
      path: name,
      sha256: expected.sha256,
      bytes: expected.bytes,
    };
  });

  return {
    source: "tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1",
    generated_at: new Date().toISOString(),
    files,
  };
}

if (checkOnly) {
  if (!existingManifestIsValid()) {
    console.error("BlazeFace model check failed; run node scripts/setup-blazeface-model.mjs");
    process.exit(1);
  }
  console.log("BlazeFace model check: public/models/blazeface/ is verified");
  process.exit(0);
}

if (existingManifestIsValid()) {
  console.log(`BlazeFace model: verified existing ${relative(process.cwd(), dest)}/`);
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const entry of readdirSync(dest)) {
  rmSync(join(dest, entry), { recursive: true, force: true });
}

const modelBytes = await fetchBytes(modelUrl);
const modelJson = JSON.parse(modelBytes.toString("utf8"));
writeFileSync(join(dest, "model.json"), modelBytes);
assertExpectedAsset("model.json");

function modelAssetUrl(path) {
  return `https://tfhub.dev/tensorflow/tfjs-model/blazeface/1/default/1/${path}?tfjs-format=file&download=true`;
}

for (const path of weightPaths(modelJson)) {
  writeFileSync(join(dest, path), await fetchBytes(modelAssetUrl(path)));
  assertExpectedAsset(path);
}

for (const path of expectedAssets.keys()) {
  assertExpectedAsset(path);
}

writeFileSync(join(dest, "manifest.json"), JSON.stringify(buildManifest(), null, 2) + "\n");
console.log(`BlazeFace model: downloaded and verified ${relative(process.cwd(), dest)}/`);
