import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { exitToHome } from "./exit-to-home.ts";

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

test("a clean release goes to the destination", async () => {
  bridge();
  const r = router();
  await exitToHome(r, "/login");
  assert.deepEqual(r.pushed, ["/login"]);
});

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

test("outside the desktop shell it just navigates", async () => {
  globalThis.window = {};
  const r = router();
  await exitToHome(r);
  assert.deepEqual(r.pushed, ["/home"]);
});
