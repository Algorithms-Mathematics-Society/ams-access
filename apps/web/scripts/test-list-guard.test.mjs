import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm test` runs an explicit file list, so a new *.test.mjs that is not
// added to it is committed but never executed. This keeps the list and the
// files on disk identical.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.test;
const listed = script.match(/[\w./-]+\.test\.mjs/g) ?? [];

/** Dependencies, hidden directories and the root export never hold suite files.
 * Symlinks are not followed. */
const skipped = (dir, name) =>
  name === "node_modules" || name.startsWith(".") || (dir === root && name === "out");

function testFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipped(dir, entry.name)) found.push(...testFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      found.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return found;
}

test("the test script lists each test file once", () => {
  assert.ok(listed.length > 0, "no *.test.mjs entries found in the test script");
  const duplicates = listed.filter((file, i) => listed.indexOf(file) !== i);
  assert.deepEqual(duplicates, [], "listed more than once in package.json scripts.test");
});

test("every listed test file exists", () => {
  const missing = listed.filter((file) => {
    try {
      return !statSync(path.join(root, file)).isFile();
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], "listed in package.json scripts.test but not on disk");
});

test("every test file on disk is in the test script", () => {
  const inScript = new Set(listed);
  const unlisted = testFiles(root)
    .filter((file) => !inScript.has(file))
    .sort();
  assert.deepEqual(unlisted, [], "add these to package.json scripts.test, or they never run in CI");
});
