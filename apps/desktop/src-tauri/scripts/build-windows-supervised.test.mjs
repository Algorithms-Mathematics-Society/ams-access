import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  existsSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  privateRuntime,
  installerHooks,
  buildConfig,
  PRIVATE_RUNTIME_FOLDER,
  withStagedRuntime,
} from "./build-windows-supervised.mjs";

test("supervised package selects only its supplied Fixed Version runtime and NSIS ACL hook", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "ams-package-test-"));
  try {
    const source = path.join(temp, "Microsoft.WebView2.FixedVersionRuntime.test.x64");
    mkdirSync(source);
    assert.throws(() => privateRuntime("relative"), /absolute/);
    assert.throws(() => privateRuntime(source), /msedgewebview2/);
    writeFileSync(path.join(source, "msedgewebview2.exe"), "fixture, never executed");
    assert.throws(() => privateRuntime(source), /icudtl/);
    writeFileSync(path.join(source, "icudtl.dat"), "fixture");
    const { runtime } = privateRuntime(source);
    assert.equal(runtime, realpathSync(source));
    const config = buildConfig("private-runtime.nsh");
    assert.deepEqual(config.bundle.targets, ["nsis"]);
    assert.deepEqual(config.bundle.windows.webviewInstallMode, {
      type: "fixedRuntime",
      path: PRIVATE_RUNTIME_FOLDER,
    });
    assert.equal(config.bundle.windows.nsis.installMode, "perMachine");
    const hook = installerHooks(PRIVATE_RUNTIME_FOLDER);
    assert.ok(hook.includes(`$INSTDIR\\${PRIVATE_RUNTIME_FOLDER}`));
    assert.ok(hook.includes("*S-1-15-2-1:(OI)(CI)(RX)"));
    assert.ok(hook.includes("*S-1-15-2-2:(OI)(CI)(RX)"));
    assert.match(hook, /Abort/);
    assert.ok(
      hook.includes(
        `nsExec::ExecToStack '"$SYSDIR\\icacls.exe" "$INSTDIR\\${PRIVATE_RUNTIME_FOLDER}"`
      )
    );
    assert.ok(hook.includes('StrCmp $0 "0" +3'));
    assert.ok(!hook.includes('\\"'), "NSIS uses literal quotes, not backslash-escaped quotes");
    for (const unsafe of ["..", "$INSTDIR", 'bad"name', "a\\b"])
      assert.throws(() => installerHooks(unsafe));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("runtime staging cleans only its junction after success or failure and preserves existing paths", () => {
  const temp = mkdtempSync(path.join(tmpdir(), "ams-stage-test-"));
  const runtime = path.join(temp, "supplied-runtime");
  const staging = path.join(temp, PRIVATE_RUNTIME_FOLDER);
  mkdirSync(runtime);
  writeFileSync(path.join(runtime, "marker"), "supplied runtime stays intact");
  try {
    for (const fail of [false, true]) {
      const build = () => {
        assert.equal(realpathSync(staging), realpathSync(runtime));
        assert.equal(
          readFileSync(path.join(staging, "marker"), "utf8"),
          "supplied runtime stays intact"
        );
        if (fail) throw new Error("mock build failed");
        return "built";
      };
      if (fail)
        assert.throws(
          () => withStagedRuntime(realpathSync(runtime), staging, build),
          /mock build failed/
        );
      else assert.equal(withStagedRuntime(realpathSync(runtime), staging, build), "built");
      assert.ok(!existsSync(staging));
      assert.ok(existsSync(path.join(runtime, "marker")));
    }
    mkdirSync(staging);
    assert.throws(
      () => withStagedRuntime(realpathSync(runtime), staging, () => assert.fail("must not build")),
      /stale/
    );
    assert.ok(existsSync(staging));
    rmSync(staging, { recursive: true });

    const replacement = path.join(temp, "unrelated-runtime");
    mkdirSync(replacement);
    writeFileSync(path.join(replacement, "marker"), "unrelated runtime stays intact");
    assert.throws(
      () =>
        withStagedRuntime(realpathSync(runtime), staging, () => {
          unlinkSync(staging);
          symlinkSync(replacement, staging, "junction");
        }),
      /identity changed/
    );
    assert.equal(
      readFileSync(path.join(replacement, "marker"), "utf8"),
      "unrelated runtime stays intact"
    );
    assert.ok(existsSync(staging));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
