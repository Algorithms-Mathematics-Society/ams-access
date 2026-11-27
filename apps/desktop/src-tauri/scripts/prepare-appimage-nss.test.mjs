import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareAppImageNss } from "./prepare-appimage-nss.mjs";

test("stages NSS modules from the Arch library path", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ams-appimage-nss-"));
  try {
    for (const name of ["libsoftokn3.so", "libfreeblpriv3.so"]) {
      const source = path.join(root, "usr/lib", name);
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, name);
    }
    prepareAppImageNss({ root, repoRoot: root });
    const staged = path.join(root, "apps/desktop/src-tauri/helpers/appimage");
    for (const name of ["libsoftokn3.so", "libfreeblpriv3.so"])
      assert.equal(readFileSync(path.join(staged, name), "utf8"), name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stages NSS modules from the Debian library path", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "ams-appimage-nss-"));
  try {
    for (const name of ["libsoftokn3.so", "libfreeblpriv3.so"]) {
      const source = path.join(root, "usr/lib/x86_64-linux-gnu", name);
      mkdirSync(path.dirname(source), { recursive: true });
      writeFileSync(source, name);
    }
    prepareAppImageNss({ root, repoRoot: root });
    const staged = path.join(root, "apps/desktop/src-tauri/helpers/appimage");
    for (const name of ["libsoftokn3.so", "libfreeblpriv3.so"])
      assert.equal(readFileSync(path.join(staged, name), "utf8"), name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does no work off Linux", () => {
  assert.equal(prepareAppImageNss({ platform: "darwin" }), undefined);
});
