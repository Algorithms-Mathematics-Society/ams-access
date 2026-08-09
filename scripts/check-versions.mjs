// One version, declared once.
//
// The Cargo workspace said 0.1.0 while every shipping manifest said 1.1.0, for
// several releases. Nothing noticed because `tauri.conf.json > version`
// silently overrides the crate version, so the installers were labelled
// correctly and the binary metadata was not.
//
// `tauri.conf.json` no longer declares a version at all — Tauri falls back to
// the crate — and this checks that everything else agrees with it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

function cargoWorkspaceVersion() {
  const toml = read("Cargo.toml");
  const section = toml.split("[workspace.package]")[1];
  if (!section) throw new Error("Cargo.toml has no [workspace.package] section");
  const match = section.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("[workspace.package] has no version");
  return match[1];
}

const expected = cargoWorkspaceVersion();

const manifests = [
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/api-client/package.json",
];

const problems = [];

for (const path of manifests) {
  const found = JSON.parse(read(path)).version;
  if (found !== expected) {
    problems.push(`${path} is ${found}, expected ${expected} (from Cargo.toml)`);
  }
}

// The one that must NOT be set: if it comes back, it silently wins over the
// crate version again and the drift becomes invisible again.
if (JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version !== undefined) {
  problems.push(
    "apps/desktop/src-tauri/tauri.conf.json declares a version. Remove it — " +
      "it overrides the Cargo workspace version and hides drift."
  );
}

if (problems.length > 0) {
  console.error(`Version mismatch (workspace version is ${expected}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`OK all manifests agree on ${expected}`);
