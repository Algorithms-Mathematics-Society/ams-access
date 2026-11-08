import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { decidePresence, isPresencePass } from "../../presence-check.ts";

// Execute the shipped sampling effect, with a deterministic WebView frame clock.
const source = readFileSync(new URL("./Stage9_PresenceVerification.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "stage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const effects = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
const effectCode = ts.transpileModule(`return (${effects.at(-1).getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const samples = [];
  const verdicts = [];
  const video = { readyState: 0, videoWidth: 0, videoHeight: 0 };
  let resolvePreview;
  let rejectPreview;
  let disposed = 0;
  let loaded = 0;
  const preview = new Promise((resolve, reject) => {
    resolvePreview = resolve;
    rejectPreview = reject;
  });
  const values = {
    stream: {},
    videoRef: { current: video },
    canvasRef: { current: null },
    setTaken() {},
    setVerdict: (value) => verdicts.push(value),
    onReferencePhoto: undefined,
    onPhotoFailure: undefined,
    onPass() {},
    onWarn() {},
    loadPresenceDetector: async () => {
      loaded++;
      return {
        estimateFaces: () => options.inference,
        dispose() {
          disposed++;
        },
      };
    },
    startCameraPreview: () => preview,
    samplePresence: async (_video, detector) => {
      samples.push(now);
      if (options.inference) {
        void detector.estimateFaces({});
        throw new values.CameraTimeoutError("Face detector inference timed out");
      }
      return video.readyState >= 2 ? { status: "presence_ok" } : null;
    },
    decidePresence,
    isPresencePass,
    SAMPLE_COUNT: 3,
    SAMPLE_INTERVAL_MS: 1300,
    CameraTimeoutError: class extends Error {},
    document: { createElement: () => ({}) },
    setTimeout: (fn, delay) => {
      const id = ++sequence;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const effect = new Function(...Object.keys(values), effectCode)(...Object.values(values));
  const cleanup = effect();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    samples,
    verdicts,
    cleanup,
    get disposed() {
      return disposed;
    },
    get loaded() {
      return loaded;
    },
    rejectPreview(error) {
      rejectPreview(error);
    },
    async tick(target) {
      await flush();
      while (true) {
        const next = [...timers]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flush();
      }
      now = target;
      await flush();
    },
    frame() {
      Object.assign(video, { readyState: 2, videoWidth: 640, videoHeight: 480 });
      resolvePreview();
    },
  };
}

test("presence sampling budget starts after decoded frames, including delayed WebView startup", async () => {
  const run = fixture();
  await run.tick(2700);
  assert.deepEqual(run.samples, [], "startup must not consume all three samples as null frames");
  run.frame();
  await run.tick(5300);
  assert.equal(run.samples.length, 3);
  assert.deepEqual(run.verdicts, ["present"]);
  run.cleanup();
});

test("leaving while preview starts prevents late presence sampling", async () => {
  const run = fixture();
  run.cleanup();
  run.frame();
  await run.tick(5300);
  assert.deepEqual(run.samples, []);
  assert.deepEqual(run.verdicts, []);
});

test("preview deadline records unknown without loading a detector or inventing samples", async () => {
  const run = fixture();
  run.rejectPreview(new Error("Camera preview timed out"));
  await run.tick(3000);
  assert.deepEqual(run.verdicts, ["unknown"]);
  assert.equal(run.loaded, 0);
  assert.deepEqual(run.samples, []);
  run.cleanup();
});

test("timed-out inference retains detector tensors until underlying work settles", async () => {
  let finish;
  const inference = new Promise((resolve) => {
    finish = resolve;
  });
  const run = fixture({ inference });
  run.frame();
  await run.tick(0);
  assert.deepEqual(run.verdicts, ["unknown"]);
  assert.equal(run.samples.length, 1, "timeout must not start overlapping inference");
  assert.equal(run.disposed, 0, "timeout does not cancel underlying TF work");
  run.cleanup();
  finish([]);
  await run.tick(0);
  assert.equal(run.disposed, 1);
});
