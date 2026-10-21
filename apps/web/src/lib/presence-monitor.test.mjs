import assert from "node:assert/strict";
import test from "node:test";
import { createPresenceDetectorLoader, samplePresence } from "./presence-monitor.ts";

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
