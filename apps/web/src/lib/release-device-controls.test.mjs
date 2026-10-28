import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceRelease, releaseRestoreStatus } from "./release-device-controls.ts";

function fixture({ fail, hang, status = { pending: false, items: [] }, os = "macos" } = {}) {
  const calls = [];
  let resolveHang;
  const call = async (id) => {
    calls.push(id);
    if (id === fail) throw Error("failed");
    if (id === hang)
      return new Promise((resolve) => {
        resolveHang = resolve;
      });
    if (id === "get_platform") return { os };
    if (id === "get_lockdown_restore_status") return status;
  };
  const bridge = {
    core: { invoke: call },
    window: {
      getCurrentWindow: () =>
        Object.fromEntries(
          ["setFullscreen", "setSimpleFullscreen", "setAlwaysOnTop", "setDecorations"].map((id) => [
            id,
            () => call(id),
          ])
        ),
    },
  };
  return { calls, release: createDeviceRelease(() => bridge, 5), settle: () => resolveHang?.() };
}

test("release verifies desktop and all independent commands", async () => {
  const f = fixture();
  const result = await f.release();
  assert.equal(result.outcome, "confirmed");
  assert.deepEqual(f.calls, [
    "get_platform",
    "setFullscreen",
    "setSimpleFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "disable_keyboard_intercept",
    "disable_network_lockdown",
    "get_lockdown_restore_status",
  ]);
  assert.equal(releaseRestoreStatus(result), null);
});

test("every failure preserves independent release and identifies uncertainty", async () => {
  for (const fail of [
    "get_platform",
    "setFullscreen",
    "setSimpleFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "disable_keyboard_intercept",
    "disable_network_lockdown",
    "get_lockdown_restore_status",
  ]) {
    const f = fixture({ fail });
    const result = await f.release();
    assert.notEqual(result.outcome, "confirmed", fail);
    assert.ok(f.calls.includes("disable_network_lockdown"), fail);
    assert.ok(f.calls.includes("get_lockdown_restore_status"), fail);
    assert.equal(releaseRestoreStatus(result).pending, true, fail);
  }
});

test("a healthy desktop query cannot erase a network failure", async () => {
  const result = await fixture({ fail: "disable_network_lockdown" }).release();
  assert.equal(result.outcome, "partial");
  assert.match(releaseRestoreStatus(result).items[0].label, /Network restrictions/);
});

test("absent and malformed verification are never confirmed", async () => {
  for (const status of [null, {}, { pending: false }, { pending: false, items: [null] }]) {
    assert.equal((await fixture({ status }).release()).outcome, "unknown");
  }
});

test("each hanging command is bounded and retries retain actual native ownership", async () => {
  for (const hang of [
    "get_platform",
    "setFullscreen",
    "setSimpleFullscreen",
    "setAlwaysOnTop",
    "setDecorations",
    "unlock_desktop",
    "disable_keyboard_intercept",
    "disable_network_lockdown",
    "get_lockdown_restore_status",
  ]) {
    const f = fixture({ hang });
    const first = f.release();
    assert.equal(f.release(), first);
    const result = await first;
    assert.equal(result.outcome, "unknown", hang);
    const count = f.calls.length;
    assert.equal(await f.release(), result);
    assert.equal(f.calls.length, count, "timeout must not cancel native ownership");
    f.settle();
    await new Promise((resolve) => setImmediate(resolve));
    assert.notEqual(f.release(), first);
    // Settle the retry too: no leftover test timers or pending native work.
    await new Promise((resolve) => setTimeout(resolve, 10));
    f.settle();
  }
});

test("desktop pending restoration is preserved", async () => {
  const status = { pending: true, items: [{ label: "Gestures", fix_command: "test" }] };
  const result = await fixture({ status }).release();
  assert.equal(result.outcome, "partial");
  assert.deepEqual(releaseRestoreStatus(result).items, status.items);
});

test("simple fullscreen is attempted only for macOS or an unknown platform", async () => {
  for (const os of ["linux", "windows"]) {
    const f = fixture({ os });
    assert.equal((await f.release()).outcome, "confirmed");
    assert.ok(!f.calls.includes("setSimpleFullscreen"));
  }
});

test("browser presentation is explicitly not native restoration", async () => {
  assert.equal((await createDeviceRelease(() => undefined)()).outcome, "browser");
});

test("home navigation is single-flight and uncertainty selects recovery", async () => {
  const { readFileSync } = await import("node:fs");
  const ts = await import("typescript");
  const source = readFileSync(new URL("./exit-to-home.ts", import.meta.url), "utf8")
    .replace(/^import .*;$/m, "")
    .replace("export function", "function");
  const compiled = ts.default.transpileModule(source, {
    compilerOptions: { target: ts.default.ScriptTarget.ES2022, module: ts.default.ModuleKind.None },
  }).outputText;
  for (const outcome of ["confirmed", "browser", "partial", "unknown"]) {
    let settle;
    const release = new Promise((resolve) => {
      settle = resolve;
    });
    const exit = new Function("releaseDeviceControls", `${compiled}; return exitToHome;`)(
      () => release
    );
    const paths = [];
    const router = { push: (path) => paths.push(path) };
    const first = exit(router, "/login");
    assert.equal(exit(router, "/login"), first);
    assert.deepEqual(paths, []);
    settle({ outcome });
    await first;
    assert.deepEqual(paths, [
      outcome === "confirmed" || outcome === "browser" ? "/login" : "/home?restore=pending",
    ]);
  }
});
