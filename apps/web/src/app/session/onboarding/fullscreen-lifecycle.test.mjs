import test from "node:test";
import assert from "node:assert/strict";
import {
  createFullscreenLifecycle,
  hasPendingFullscreenWork,
} from "./components/stages/fullscreen-lifecycle.ts";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(hang) {
  const calls = [];
  let resolve;
  const win = Object.fromEntries(
    ["setFullscreen", "setSimpleFullscreen", "setAlwaysOnTop", "setDecorations"].map((method) => [
      method,
      async (value) => {
        calls.push([method, value]);
        if (method === hang && value === (method !== "setDecorations"))
          await new Promise((r) => {
            resolve = r;
          });
      },
    ])
  );
  win.isFullscreen = async () => true;
  return {
    win,
    calls,
    settle() {
      resolve?.();
    },
  };
}
test("cancel during platform lookup never acquires fullscreen", async () => {
  let resolve;
  const f = fixture();
  const operation = createFullscreenLifecycle()({
    getWindow: async () => f.win,
    isMacos: () =>
      new Promise((r) => {
        resolve = r;
      }),
    ready: async () => assert.fail("cancelled ready"),
  });
  await tick();
  operation.cancel();
  resolve(true);
  await operation.settled;
  assert.deepEqual(f.calls, []);
});
test("cancel at each late native grant rolls back and skips remaining acquisition", async () => {
  for (const [hang, macos] of [
    ["setFullscreen", false],
    ["setSimpleFullscreen", true],
    ["setAlwaysOnTop", false],
    ["setDecorations", false],
  ]) {
    const f = fixture(hang);
    const operation = createFullscreenLifecycle()({
      getWindow: async () => f.win,
      isMacos: async () => macos,
      ready: async () => assert.fail("cancelled ready"),
    });
    await tick();
    operation.cancel();
    f.settle();
    await operation.settled;
    const applied = f.calls.filter(([, value], index) => index < f.calls.length / 2);
    assert.equal(f.calls.length, applied.length * 2);
    assert.deepEqual(
      f.calls.slice(applied.length),
      applied.reverse().map(([method, value]) => [method, !value])
    );
  }
});
test("a new setup waits until cancelled late acquisition is restored", async () => {
  const start = createFullscreenLifecycle();
  const old = fixture("setFullscreen");
  const next = fixture();
  const first = start({
    getWindow: async () => old.win,
    isMacos: async () => false,
    ready: async () => {},
  });
  await tick();
  first.cancel();
  const second = start({
    getWindow: async () => next.win,
    isMacos: async () => false,
    ready: async () => {},
  });
  await tick();
  assert.deepEqual(next.calls, []);
  old.settle();
  await Promise.all([first.settled, second.settled]);
  assert.deepEqual(old.calls, [
    ["setFullscreen", true],
    ["setFullscreen", false],
  ]);
  assert.equal(next.calls.length, 3);
});
test("ordinary successful stage completion leaves controls engaged for next stage", async () => {
  const f = fixture();
  let ready = false;
  const operation = createFullscreenLifecycle()({
    getWindow: async () => f.win,
    isMacos: async () => false,
    ready: async () => {
      ready = true;
    },
  });
  await operation.settled;
  operation.cancel();
  assert.equal(ready, true);
  assert.equal(f.calls.length, 3);
});

test("pending ownership includes cancelled acquisition and its actual rollback", async () => {
  assert.equal(hasPendingFullscreenWork(), false);
  let grant;
  let restored;
  const f = fixture();
  f.win.setFullscreen = async (value) => {
    await new Promise((resolve) => {
      if (value) grant = resolve;
      else restored = resolve;
    });
  };
  const operation = createFullscreenLifecycle()({
    getWindow: async () => f.win,
    isMacos: async () => false,
    ready: async () => {},
  });
  assert.equal(hasPendingFullscreenWork(), true);
  await tick();
  operation.cancel();
  assert.equal(hasPendingFullscreenWork(), true);
  grant();
  await tick();
  assert.equal(hasPendingFullscreenWork(), true);
  restored();
  await operation.settled;
  assert.equal(hasPendingFullscreenWork(), false);
});
