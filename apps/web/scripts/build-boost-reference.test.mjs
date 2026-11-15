import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
test("builds a verifiable two-page offline pack", async () => {
  const output = await mkdtemp(join(tmpdir(), "boost-pack-"));
  try {
    const built = spawnSync(
      process.execPath,
      [
        join(here, "build-boost-reference.mjs"),
        join(here, "fixtures/boost-reference"),
        output,
        "fixture-v1",
      ],
      { encoding: "utf8" }
    );
    assert.equal(built.status, 0, built.stderr);
    const manifest = JSON.parse(await readFile(join(output, "latest.json"), "utf8"));
    assert.equal(manifest.release, "fixture-v1");
    for (const file of [manifest.index, ...manifest.blocks]) {
      const bytes = await readFile(join(output, manifest.release, file.name));
      assert.equal(bytes.length, file.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    const index = JSON.parse(await readFile(join(output, manifest.release, "index.json")));
    const block = brotliDecompressSync(
      await readFile(join(output, manifest.release, index.blocks[0]))
    );
    for (const [path, [which, offset, length]] of Object.entries(index.files)) {
      assert.equal(which, 0);
      assert.match(block.subarray(offset, offset + length).toString(), /fixture/i, path);
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
