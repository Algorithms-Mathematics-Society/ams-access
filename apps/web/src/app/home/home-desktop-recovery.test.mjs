import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {", source.indexOf("// Backstop for any screen"));
const end = source.indexOf("  const [signingOut", start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function harness({ fullscreen = async () => false } = {}) {
  const platform = deferred(),
    engaged = deferred(),
    calls = [];
  let cleanup, tick;
  const win = {
    isFullscreen: async () => {
      calls.push("isFullscreen");
      return fullscreen();
    },
    setSimpleFullscreen: async () => calls.push("simple"),
    setFullscreen: async () => calls.push("native"),
  };
  const context = {
    useEffect: (f) => (cleanup = f()),
    hasNativeBridge: () => true,
    invoke: (cmd) => {
      calls.push(cmd);
      return cmd === "get_platform" ? platform.promise : engaged.promise;
    },
    window: { __TAURI__: { window: { getCurrentWindow: () => win } } },
    setInterval: (f) => {
      tick = f;
      return 1;
    },
    clearInterval: () => calls.push("clear"),
    exitToHome: async () => calls.push("release"),
    setActiveNav: () => calls.push("navigate"),
  };
  vm.runInNewContext(code, context);
  return { calls, platform, engaged, stop: () => cleanup(), tick: () => tick() };
}
test("a late Home lockdown response cannot release a newly entered workspace", async () => {
  const h = harness();
  h.stop();
  h.platform.resolve({ os: "macos" });
  h.engaged.resolve(true);
  await flush();
  h.tick();
  assert.deepEqual(h.calls, ["get_platform", "is_lockdown_engaged", "clear"]);
});
test("navigation during platform lookup cancels window mutations too", async () => {
  const h = harness();
  h.engaged.resolve(false);
  await flush();
  h.stop();
  h.platform.resolve({ os: "macos" });
  await flush();
  assert.ok(!h.calls.includes("simple"));
  assert.ok(!h.calls.includes("native"));
});
test("mounted Mac Home still releases simple fullscreen and preserves native fullscreen", async () => {
  const h = harness();
  h.platform.resolve({ os: "macos" });
  h.engaged.resolve(false);
  await flush();
  assert.ok(h.calls.includes("simple"));
  assert.ok(!h.calls.includes("native"));
  h.stop();
});
test("mounted Home retains leftover lockdown restoration", async () => {
  const h = harness();
  h.platform.resolve({ os: "macos" });
  h.engaged.resolve(true);
  await flush();
  assert.ok(h.calls.includes("release"));
  h.stop();
});

test("windowed Linux Home does not repeatedly mutate the native window", async () => {
  const h = harness();
  h.platform.resolve({ os: "linux" });
  h.engaged.resolve(false);
  await flush();
  h.tick();
  await flush();
  assert.equal(h.calls.filter((call) => call === "isFullscreen").length, 2);
  assert.equal(h.calls.filter((call) => call === "is_lockdown_engaged").length, 2);
  assert.ok(!h.calls.includes("native"));
  assert.ok(!h.calls.includes("simple"));
  h.stop();
});

test("a late fullscreen transition on Linux is still restored on the next check", async () => {
  let fullscreen = false;
  const h = harness({ fullscreen: async () => fullscreen });
  h.platform.resolve({ os: "linux" });
  h.engaged.resolve(false);
  await flush();
  fullscreen = true;
  h.tick();
  await flush();
  assert.equal(h.calls.filter((call) => call === "native").length, 1);
  h.stop();
});

test("leaving Home during fullscreen lookup cannot mutate the next workspace", async () => {
  const fullscreen = deferred();
  const h = harness({ fullscreen: () => fullscreen.promise });
  h.platform.resolve({ os: "linux" });
  h.engaged.resolve(false);
  await flush();
  h.stop();
  fullscreen.resolve(true);
  await flush();
  assert.ok(!h.calls.includes("native"));
});
