import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import ts from "typescript";
import { releaseDeviceControls } from "./release-device-controls.ts";

const source = readFileSync(new URL("./exit-to-home.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function("require", "exports", compiled)((name) => {
  assert.equal(name, "./release-device-controls");
  return { releaseDeviceControls };
}, exports);
const { exitToHome } = exports;

const releases = [
  "setFullscreen",
  "setSimpleFullscreen",
  "setAlwaysOnTop",
  "setDecorations",
  "unlock_desktop",
  "disable_keyboard_intercept",
  "disable_network_lockdown",
];

async function fixture({ fail, status = { pending: false, items: [] } } = {}) {
  const calls = [];
  const windowMethods = Object.fromEntries(
    releases.slice(0, 4).map((name) => [
      name,
      async () => {
        calls.push(name);
        if (fail === name) throw Error("release failed");
      },
    ])
  );
  globalThis.window = {
    __TAURI__: {
      window: {
        getCurrentWindow() {
          if (fail === "getCurrentWindow") throw Error("window unavailable");
          return windowMethods;
        },
      },
      core: {
        async invoke(name) {
          calls.push(name);
          if (fail === name) throw Error("native failed");
          if (name === "get_platform") return { os: "macos" };
          if (name === "get_lockdown_restore_status") return status;
        },
      },
    },
  };
  const destinations = [];
  await exitToHome({ push: (href) => destinations.push(href) }, "/login");
  return { calls, destinations };
}

test("browser exit retains the requested destination", async () => {
  globalThis.window = {};
  const destinations = [];
  await exitToHome({ push: (href) => destinations.push(href) }, "/login");
  assert.deepEqual(destinations, ["/login"]);
});

test("confirmed desktop release retains the requested destination", async () => {
  const { calls, destinations } = await fixture();
  assert.deepEqual(calls, ["get_platform", ...releases, "get_lockdown_restore_status"]);
  assert.deepEqual(destinations, ["/login"]);
});

test("simple-fullscreen release failure opens recovery", async () => {
  const { calls, destinations } = await fixture({ fail: "setSimpleFullscreen" });
  assert.deepEqual(calls, ["get_platform", ...releases, "get_lockdown_restore_status"]);
  assert.deepEqual(destinations, ["/home?restore=pending"]);
});

test("pending restore opens Home recovery", async () => {
  const { destinations } = await fixture({ status: { pending: true } });
  assert.deepEqual(destinations, ["/home?restore=pending"]);
});

test("failed window or native release still attempts later cleanup and opens recovery", async () => {
  for (const fail of ["getCurrentWindow", "setFullscreen", "disable_keyboard_intercept"]) {
    const { calls, destinations } = await fixture({ fail });
    assert.ok(calls.includes("disable_network_lockdown"), fail);
    assert.ok(calls.includes("get_lockdown_restore_status"), fail);
    assert.deepEqual(destinations, ["/home?restore=pending"], fail);
  }
});

test("unavailable or unconfirmed status opens Home recovery", async () => {
  for (const options of [
    { fail: "get_lockdown_restore_status" },
    { status: null },
    { status: {} },
  ]) {
    const { destinations } = await fixture(options);
    assert.deepEqual(destinations, ["/home?restore=pending"]);
  }
});
