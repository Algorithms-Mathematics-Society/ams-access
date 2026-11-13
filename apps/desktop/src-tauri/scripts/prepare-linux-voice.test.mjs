import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareLinuxVoice } from "./prepare-linux-voice.mjs";

test("builds the independent locked workspace and stages its configured target", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ams-voice-prep-"));
  try {
    const target = path.join(root, "external target");
    const binary = path.join(target, "release/ams-linux-voice-worker");
    const manifest = path.join(root, "packages/linux-voice-worker/Cargo.toml");
    const calls = [];
    const staged = prepareLinuxVoice({
      repoRoot: root,
      platform: "linux",
      runCargo(command, args, options) {
        calls.push({ command, args, options });
        if (args[0] === "metadata") return JSON.stringify({ target_directory: target });
        mkdirSync(path.dirname(binary), { recursive: true });
        writeFileSync(binary, "fresh binary");
      },
    });
    assert.deepEqual(calls.map(({ command, args }) => [command, args]), [
      ["cargo", ["metadata", "--manifest-path", manifest, "--no-deps", "--format-version", "1", "--locked"]],
      ["cargo", ["build", "--manifest-path", manifest, "--locked", "--release"]],
    ]);
    assert.equal(calls[0].options.cwd, root);
    assert.equal(calls[0].options.env, undefined);
    assert.equal(calls[1].options.cwd, root);
    assert.equal(staged, path.join(root, "apps/desktop/src-tauri/helpers/ams-linux-voice-worker"));
    assert.equal(readFileSync(staged, "utf8"), "fresh binary");
    assert.equal(statSync(staged).mode & 0o777, 0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does no work on Windows or macOS", () => {
  for (const platform of ["win32", "darwin"]) {
    assert.equal(prepareLinuxVoice({ platform, runCargo() { throw new Error("cargo called"); } }), null);
  }
});

test("does not stage a stale binary when build output is missing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ams-voice-prep-"));
  try {
    assert.throws(() => prepareLinuxVoice({
      repoRoot: root,
      platform: "linux",
      runCargo(_command, args) {
        if (args[0] === "metadata") return JSON.stringify({ target_directory: path.join(root, "target") });
      },
    }), /did not produce/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
