import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./Stage10_AudioVerification.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(
  source.slice(source.indexOf("    async function init()"), source.indexOf("    void init();")),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
function harness(os, permission = async () => {}) {
  const calls = [];
  const c = {
    cancelled: false,
    passTimer: null,
    DOMException,
    Error,
    Uint8Array,
    invoke: async (cmd) => {
      calls.push(cmd);
      return cmd === "get_platform" ? { os } : permission();
    },
    invokeStrict: async (cmd) => {
      calls.push(cmd);
      return permission();
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          calls.push("audio");
          return {};
        },
      },
    },
    stopMediaStream: () => calls.push("stop"),
    AudioContext: class {
      createMediaStreamSource() {
        return { connect() {} };
      }
      createAnalyser() {
        return { frequencyBinCount: 8 };
      }
      close() {
        return Promise.resolve();
      }
    },
    streamRef: { current: null },
    audioCtxRef: { current: null },
    analyserRef: { current: null },
    rafRef: { current: 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    setPhase: (p) => calls.push(p),
    setMissing() {},
    setUnanswered: (value) => calls.push(`unanswered:${value}`),
    setLevel() {},
    onPass() {},
  };
  vm.runInNewContext(code, c);
  return { c, calls, run: () => c.init() };
}
test("Mac waits for native permission before opening audio", async () => {
  let grant;
  const h = harness("macos", () => new Promise((r) => (grant = r)));
  const pending = h.run();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  assert.deepEqual(h.calls, ["get_platform", "request_macos_microphone_permission"]);
  grant();
  await pending;
  assert.deepEqual(h.calls, [
    "get_platform",
    "request_macos_microphone_permission",
    "audio",
    "pass",
  ]);
});
test("denial preserves optional failure and never acquires audio", async () => {
  const h = harness("macos", async () => {
    throw Error("denied");
  });
  await h.run();
  assert.ok(h.calls.includes("fail"));
  assert.ok(!h.calls.includes("audio"));
});
test("late permission after navigation does not open audio or advance", async () => {
  let grant;
  const h = harness("macos", () => new Promise((r) => (grant = r)));
  const pending = h.run();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  h.c.cancelled = true;
  grant();
  await pending;
  assert.ok(!h.calls.includes("audio"));
  assert.ok(!h.calls.includes("pass"));
});
test("other platforms do not invoke native Mac permission", async () => {
  for (const os of ["windows", "linux", undefined]) {
    const h = harness(os);
    await h.run();
    assert.deepEqual(h.calls, ["get_platform", "audio", "pass"]);
  }
});

test("microphone meter reads analyser only at its UI sampling interval", async () => {
  const h = harness("linux");
  let reads = 0;
  let frame;
  let level = 0;
  h.c.AudioContext = class extends h.c.AudioContext {
    createAnalyser() {
      return {
        frequencyBinCount: 8,
        getByteFrequencyData(data) {
          reads += 1;
          data.fill(20);
        },
      };
    }
  };
  h.c.requestAnimationFrame = (callback) => {
    frame = callback;
    return 1;
  };
  h.c.setLevel = (update) => {
    level = update(level);
  };
  await h.run();
  for (const now of [0, 16, 32, 64, 100, 124]) frame(now);
  assert.equal(reads, 0);
  frame(125);
  assert.equal(reads, 1);
  assert.equal(level, 50);
  for (const now of [140, 180, 230, 249]) frame(now);
  assert.equal(reads, 1);
  frame(250);
  assert.equal(reads, 2);
  h.c.cancelled = true;
  frame(500);
  assert.equal(reads, 2, "a cancelled stage must stop sampling");
});
