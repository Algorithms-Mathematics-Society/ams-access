import assert from "node:assert/strict";
import test from "node:test";
import { createPresenceDetectorLoader, framingOf, samplePresence } from "./presence-monitor.ts";

function deferred() {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function fixture() {
  const calls = [];
  const detector = {
    estimateFaces: async () => [],
    dispose() {
      calls.push("dispose");
    },
  };
  const tf = {
    async setBackend(name) {
      calls.push(name);
      return true;
    },
    async ready() {
      calls.push("ready");
    },
    removeBackend(name) {
      calls.push(`remove:${name}`);
    },
  };
  const deps = {
    timeoutMs: 10,
    importCore: async () => tf,
    importWasm: async () => ({ setWasmPaths: (path) => calls.push(path) }),
    importCpu: async () => {
      calls.push("import:cpu");
    },
    importModel: async () => ({
      load: async (options) => {
        calls.push(options);
        return detector;
      },
    }),
  };
  return { calls, detector, tf, deps };
}

test("a never-settling WASM startup falls back to CPU and loads the actual detector", async () => {
  const { calls, detector, tf, deps } = fixture();
  tf.setBackend = async (name) => {
    calls.push(name);
    return name === "wasm" ? new Promise(() => {}) : true;
  };
  const loaded = await createPresenceDetectorLoader(deps)({ maxFaces: 1 });
  assert.equal(loaded, detector);
  assert.ok(calls.indexOf("remove:wasm") < calls.indexOf("cpu"));
  assert.deepEqual(
    calls.filter((call) => typeof call === "string"),
    ["/tfjs-wasm/", "wasm", "remove:wasm", "import:cpu", "cpu", "ready"]
  );
  assert.equal(calls.at(-1).maxFaces, 1);
  assert.equal(calls.at(-1).modelUrl, "/models/blazeface/model.json");
});

test("WASM returning false or never becoming ready reaches CPU fallback", async () => {
  for (const failure of ["false", "ready-hang", "reject"]) {
    const { calls, tf, deps } = fixture();
    let selected;
    tf.setBackend = async (name) => {
      selected = name;
      calls.push(name);
      if (name === "wasm" && failure === "reject") throw new Error("unsupported");
      return !(name === "wasm" && failure === "false");
    };
    tf.ready = async () => {
      if (selected === "wasm" && failure === "ready-hang") return new Promise(() => {});
    };
    await createPresenceDetectorLoader(deps)();
    assert.ok(calls.includes("cpu"), failure);
  }
});

test("concurrent calibration and presence loads share backend initialization", async () => {
  const { calls, deps } = fixture();
  const load = createPresenceDetectorLoader(deps);
  await Promise.all([load({ maxFaces: 1 }), load()]);
  assert.equal(calls.filter((call) => call === "wasm").length, 1);
  assert.deepEqual(
    calls.filter((call) => typeof call === "object").map((call) => call.maxFaces),
    [1, 3]
  );
});

test("failed CPU startup is bounded and can be retried", async () => {
  const { calls, tf, deps } = fixture();
  tf.setBackend = async (name) => {
    calls.push(name);
    return name === "wasm" ? false : new Promise(() => {});
  };
  const load = createPresenceDetectorLoader(deps);
  await assert.rejects(load(), /CPU startup timed out/);
  tf.setBackend = async () => true;
  await load();
  assert.equal(calls.filter((call) => call === "/tfjs-wasm/").length, 2);
});

test("asset integrity denial and hanging verification never load a model", async () => {
  for (const verifyAssets of [
    async () => {
      throw new Error("face_model_integrity_failed");
    },
    () => new Promise(() => {}),
  ]) {
    const { calls, deps } = fixture();
    await assert.rejects(
      createPresenceDetectorLoader(deps)({ verifyAssets }),
      /integrity_failed|asset verification timed out/
    );
    assert.equal(
      calls.some((call) => typeof call === "object"),
      false
    );
  }
});

test("a timed-out model is disposed on late arrival and cannot replace a retry", async () => {
  const { calls, detector, deps } = fixture();
  const old = deferred();
  deps.importModel = async () => ({ load: () => old.promise });
  const load = createPresenceDetectorLoader(deps);
  await assert.rejects(load(), /model load timed out/);
  deps.importModel = async () => ({ load: async () => detector });
  assert.equal(await load(), detector);
  let staleDisposed = 0;
  old.resolve({
    dispose: () => {
      staleDisposed++;
    },
  });
  await new Promise(setImmediate);
  assert.equal(staleDisposed, 1);
  assert.equal(calls.includes("dispose"), false);
});

test("a live preview whose inference hangs rejects rather than reporting presence", async () => {
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvas = { width: 128, height: 128, getContext: () => ({ drawImage() {} }) };
  await assert.rejects(
    samplePresence(video, { estimateFaces: () => new Promise(() => {}) }, canvas, 10),
    /inference timed out/
  );
});

test("periodic retries do not overlap timed-out inference and recover after it settles", async () => {
  const running = deferred();
  let calls = 0;
  const detector = {
    estimateFaces() {
      calls++;
      return running.promise;
    },
  };
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvas = { width: 128, height: 128, getContext: () => ({ drawImage() {} }) };
  await assert.rejects(samplePresence(video, detector, canvas, 10), /inference timed out/);
  await assert.rejects(samplePresence(video, detector, canvas, 10), /still pending/);
  assert.equal(calls, 1);

  running.resolve([{ topLeft: [40, 30], bottomRight: [88, 100] }]);
  await new Promise(setImmediate);
  assert.equal((await samplePresence(video, detector, canvas, 10)).status, "presence_ok");
  assert.equal(calls, 2);
});

test("CPU fallback preserves presence decisions from mocked face predictions", async () => {
  const { deps, tf, detector } = fixture();
  tf.setBackend = async (name) => name !== "wasm";
  detector.estimateFaces = async () => [{ topLeft: [40, 30], bottomRight: [88, 100] }];
  const loaded = await createPresenceDetectorLoader(deps)();
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvas = { width: 128, height: 128, getContext: () => ({ drawImage() {} }) };
  const sample = await samplePresence(video, loaded, canvas);
  assert.equal(sample.status, "presence_ok");
  assert.equal(sample.faces, 1);
  assert.equal(sample.thumbnail, null);
});

test("installed TF engine cannot switch away from CPU when stalled WASM completes late", async () => {
  const tf = await import("@tensorflow/tfjs-core");
  await import("@tensorflow/tfjs-backend-cpu");
  const wasm = deferred();
  tf.registerBackend("wasm", () => wasm.promise, 10);
  const detector = { estimateFaces: async () => [] };
  const load = createPresenceDetectorLoader({
    timeoutMs: 10,
    importCore: async () => tf,
    importWasm: async () => ({ setWasmPaths() {} }),
    importCpu: async () => {},
    importModel: async () => ({ load: async () => detector }),
  });
  await load();
  assert.equal(tf.getBackend(), "cpu");
  const cpu = tf.backend();
  wasm.resolve({ dispose() {} });
  await new Promise(setImmediate);
  assert.equal(tf.getBackend(), "cpu");
  assert.equal(tf.backend(), cpu, "late WASM must not replace the active backend instance");
  const sum = tf.tidy(() => tf.add(tf.scalar(2), tf.scalar(3)));
  assert.equal((await sum.data())[0], 5, "CPU still performs actual tensor operations");
  sum.dispose();
});

// A face box of the given proportions, centred at (cx, cy) in a 1x1 frame.
function box(cx, cy, w = 0.3, h = 0.4) {
  return [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], 1, 1];
}

test("a face slumped low in frame is off-centre rather than ok", () => {
  // The reported symptom: someone sinks down until the camera has the top of
  // their head and nothing else, and no nudge ever appeared. The old ellipse
  // carried a 1.8 tolerance on a 0.37 vertical radius, which left the bottom
  // of "ok" at y=0.98.
  assert.equal(framingOf(...box(0.5, 0.48)), "ok");
  assert.equal(framingOf(...box(0.5, 0.6)), "ok", "ordinary posture drift stays quiet");
  assert.equal(framingOf(...box(0.5, 0.7)), "ok");
  assert.equal(framingOf(...box(0.5, 0.75)), "off_centre");
  assert.equal(framingOf(...box(0.5, 0.8)), "off_centre");
  assert.equal(framingOf(...box(0.5, 0.9)), "off_centre");
});

test("a face running past an edge is off-centre whatever its midpoint says", () => {
  // Clipping is what "half my face is out of shot" looks like to the
  // detector: the box keeps a plausible centre while part of the face is
  // simply missing, so the midpoint test alone cannot see it.
  assert.equal(framingOf([0.35, 0.7], [0.65, 1.1], 1, 1), "off_centre", "chin below frame");
  assert.equal(framingOf([-0.08, 0.28], [0.22, 0.68], 1, 1), "off_centre", "past left edge");
  assert.equal(framingOf([0.8, 0.28], [1.1, 0.68], 1, 1), "off_centre", "past right edge");
  assert.equal(framingOf([0.35, -0.1], [0.65, 0.3], 1, 1), "off_centre", "crown above frame");
});

test("a centred face is never nudged", () => {
  for (const cy of [0.42, 0.48, 0.55]) {
    for (const cx of [0.44, 0.5, 0.58]) {
      assert.equal(framingOf(...box(cx, cy)), "ok", `cx=${cx} cy=${cy}`);
    }
  }
});

test("sideways drift is caught before the face leaves the frame", () => {
  assert.equal(framingOf(...box(0.65, 0.48)), "ok");
  assert.equal(framingOf(...box(0.75, 0.48)), "off_centre");
  assert.equal(framingOf(...box(0.25, 0.48)), "off_centre");
});

test("framing is unknown rather than wrong without a usable box", () => {
  assert.equal(framingOf(undefined, undefined, 1, 1), "ok");
  assert.equal(framingOf([0.4, 0.3], [0.6, 0.7], 0, 0), "ok");
  assert.equal(framingOf([0.4, 0.3], [Number.NaN, 0.7], 1, 1), "ok");
  assert.equal(framingOf([0.6, 0.3], [0.4, 0.7], 1, 1), "ok", "inverted box");
});

test("distance still takes precedence over centring", () => {
  assert.equal(framingOf(...box(0.5, 0.48, 0.8, 0.5)), "too_close");
  assert.equal(framingOf(...box(0.5, 0.48, 0.05, 0.08)), "too_far");
});
