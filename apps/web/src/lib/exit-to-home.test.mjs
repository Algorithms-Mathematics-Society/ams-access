import { mock, test } from "node:test";
import assert from "node:assert/strict";

import { exitToHome } from "./exit-to-home.ts";

const releases = [
  "setFullscreen",
  "setSimpleFullscreen",
  "setAlwaysOnTop",
  "setDecorations",
  "unlock_desktop",
  "disable_keyboard_intercept",
  "disable_network_lockdown",
];

async function fixture({ fail, status = { pending: false } } = {}) {
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
  assert.deepEqual(calls, [...releases, "get_lockdown_restore_status"]);
  assert.deepEqual(destinations, ["/login"]);
});

test("simple-fullscreen release failure opens recovery", async () => {
  const { calls, destinations } = await fixture({ fail: "setSimpleFullscreen" });
  assert.deepEqual(calls, [...releases, "get_lockdown_restore_status"]);
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

function bridge(overrides = {}) {
  const win = {
    setFullscreen: async () => {},
    setSimpleFullscreen: async () => {},
    setAlwaysOnTop: async () => {},
    setDecorations: async () => {},
  };
  const calls = {
    unlock_desktop: async () => {},
    disable_keyboard_intercept: async () => {},
    disable_network_lockdown: async () => true,
    get_lockdown_restore_status: async () => ({ pending: false, items: [] }),
    ...overrides,
  };
  globalThis.window = {
    __TAURI__: {
      window: { getCurrentWindow: () => win },
      core: { invoke: (cmd) => calls[cmd]() },
    },
  };
}

function router() {
  const pushed = [];
  return { pushed, push: (href) => pushed.push(href) };
}

test("a failed firewall release opens Restore even when settings report clean", async () => {
  bridge({ disable_network_lockdown: async () => Promise.reject("helper unreachable") });
  const r = router();
  await exitToHome(r);
  assert.deepEqual(r.pushed, ["/home?restore=pending"]);
});

test("a hung native call times out instead of trapping the candidate", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    bridge({ unlock_desktop: () => new Promise(() => {}) });
    const r = router();
    const done = exitToHome(r);
    for (let i = 0; i < 20 && r.pushed.length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(10_000);
    }
    await done;
    assert.deepEqual(r.pushed, ["/home?restore=pending"]);
  } finally {
    mock.timers.reset();
  }
});
