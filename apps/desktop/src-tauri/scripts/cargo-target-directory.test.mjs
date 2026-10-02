import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cargoTargetDirectory } from "./cargo-target-directory.mjs";

const root = path.resolve("workspace");

test("resolves Cargo's configured directory instead of assuming workspace/target", () => {
  const configured = path.resolve("external cache", "release-target");
  const result = cargoTargetDirectory(root, (command, args, options) => {
    assert.equal(command, "cargo");
    assert.deepEqual(args, ["metadata", "--no-deps", "--format-version", "1", "--locked"]);
    assert.equal(options.cwd, root);
    assert.equal(options.env, undefined, "Cargo must inherit the same env as the build");
    assert.equal(options.encoding, "utf8");
    return JSON.stringify({ target_directory: configured });
  });
  assert.equal(result, configured);
  assert.notEqual(result, path.join(root, "target"));
});

test("accepts the ordinary default target directory", () => {
  const expected = path.join(root, "target");
  assert.equal(
    cargoTargetDirectory(root, () => JSON.stringify({ target_directory: expected })),
    expected
  );
});

test("fails clearly instead of guessing a potentially stale artifact directory", () => {
  for (const target_directory of [undefined, null, "", "relative/target", 42]) {
    assert.throws(
      () => cargoTargetDirectory(root, () => JSON.stringify({ target_directory })),
      /absolute target_directory/
    );
  }
});

test("propagates Cargo metadata failure and invalid JSON", () => {
  const failure = new Error("Cargo metadata failed");
  assert.throws(
    () =>
      cargoTargetDirectory(root, () => {
        throw failure;
      }),
    (error) => error === failure
  );
  assert.throws(() => cargoTargetDirectory(root, () => "not JSON"), SyntaxError);
});

test(
  "prepare script stages the configured external artifact without overwriting macOS resource",
  { skip: process.platform !== "linux" },
  async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ams-helper-staging-"));
    try {
      const workspace = path.join(temporary, "workspace");
      const scripts = path.join(workspace, "apps/desktop/src-tauri/scripts");
      const helpers = path.join(workspace, "apps/desktop/src-tauri/helpers");
      const target = path.join(temporary, "external cache");
      const bin = path.join(temporary, "bin");
      await Promise.all([
        fs.mkdir(scripts, { recursive: true }),
        fs.mkdir(helpers, { recursive: true }),
        fs.mkdir(bin),
      ]);
      for (const filename of ["prepare-network-helper.mjs", "cargo-target-directory.mjs"]) {
        await fs.copyFile(new URL(filename, import.meta.url), path.join(scripts, filename));
      }
      await fs.writeFile(
        path.join(helpers, "com.ams.access.networkhelper"),
        "existing macOS resource"
      );
      await fs.writeFile(
        path.join(bin, "cargo"),
        `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.CARGO_TARGET_DIR;
if (process.argv[2] === 'metadata') {
  process.stdout.write(JSON.stringify({ target_directory: target }));
} else if (process.argv[2] === 'build') {
  fs.mkdirSync(path.join(target, 'release'), { recursive: true });
  fs.writeFileSync(path.join(target, 'release', 'ams-access-networkhelper'), 'fresh host helper');
} else { process.exit(1); }
`,
        { mode: 0o755 }
      );
      execFileSync(process.execPath, [path.join(scripts, "prepare-network-helper.mjs")], {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ""}`,
          CARGO_TARGET_DIR: target,
        },
        stdio: "pipe",
      });
      assert.equal(
        await fs.readFile(path.join(helpers, "ams-access-networkhelper"), "utf8"),
        "fresh host helper"
      );
      assert.equal(
        await fs.readFile(path.join(helpers, "com.ams.access.networkhelper"), "utf8"),
        "existing macOS resource"
      );
      assert.equal(
        (await fs.stat(path.join(helpers, "ams-access-networkhelper"))).mode & 0o777,
        0o755
      );
      await assert.rejects(fs.access(path.join(workspace, "target")), { code: "ENOENT" });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
);
