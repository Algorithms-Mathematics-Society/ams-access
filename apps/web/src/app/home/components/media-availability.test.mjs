import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  createMediaRequestOwner,
  getBrowserMediaAvailability,
  getUserMediaWithTimeout,
} from "./media-availability.ts";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const utilsSource = readFileSync(new URL("./utils.ts", import.meta.url), "utf8");
const CAMERA_START_TIMEOUT_MS = Number(
  /export const CAMERA_START_TIMEOUT_MS = ([0-9_]+);/.exec(utilsSource)?.[1].replaceAll("_", "")
);
assert.equal(CAMERA_START_TIMEOUT_MS, 6000, "test must follow the Settings media deadline");
const componentPath = new URL("./SettingsPanel.tsx", import.meta.url);
const componentSource = readFileSync(componentPath, "utf8");
const componentAst = ts.createSourceFile(
  "SettingsPanel.tsx",
  componentSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function componentFunction(name, context) {
  let declaration;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(componentAst);
  assert.ok(declaration, `SettingsPanel must define ${name}`);
  const js = ts
    .transpileModule(declaration.getText(componentAst), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/\bmicActive\b/g, "state.active")
    .replace(/\bmicPending\b/g, "state.pending");
  return new Function(...Object.keys(context), `${js}; return ${name};`)(...Object.values(context));
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function media(t, getUserMedia) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia } },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  });
}

test("permission denial rejects only the returned promise (no unhandled side promise)", async (t) => {
  media(t, async () => {
    throw new Error("Permission denied");
  });
  await assert.rejects(getUserMediaWithTimeout({ video: true }), /Permission denied/);
  await settle();
});

test("a timed-out permission request stops a stream that arrives late", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve,
    stopped = 0;
  media(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const request = getUserMediaWithTimeout({ video: true }, 10);
  const rejected = assert.rejects(request, /timed out/);
  await settle();
  t.mock.timers.tick(10);
  await rejected;
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await settle();
  assert.equal(stopped, 1);
});

test("overlapping readiness probes share camera/mic requests, release tracks, and later rescan freshly", async (t) => {
  let calls = 0,
    stops = 0;
  media(t, async () => {
    calls++;
    return { getTracks: () => [{ stop: () => stops++ }] };
  });
  const first = getBrowserMediaAvailability(),
    second = getBrowserMediaAvailability();
  assert.equal(first, second);
  assert.deepEqual(await first, { cameraAvailable: true, microphoneAvailable: true });
  assert.equal(calls, 2);
  assert.equal(stops, 2);
  await getBrowserMediaAvailability();
  assert.equal(calls, 4);
  assert.equal(stops, 4);
});

test("request ownership rejects superseded grants and keeps camera and microphone independent", async () => {
  const camera = createMediaRequestOwner();
  const microphone = createMediaRequestOwner();
  const oldCamera = camera.begin();
  const currentCamera = camera.begin();
  const currentMic = microphone.begin();
  assert.equal(camera.owns(oldCamera), false);
  assert.equal(camera.owns(currentCamera), true);
  assert.equal(microphone.owns(currentMic), true);
  camera.cancel();
  assert.equal(camera.owns(currentCamera), false);
  assert.equal(microphone.owns(currentMic), true);
});

test("microphone lifecycle releases stream, analyser, frame, and context on stop", async () => {
  const resources = createMediaRequestOwner();
  let stopped = 0,
    cancelled = 0,
    closed = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const context = {
    close: async () => {
      closed++;
    },
  };
  const analyser = { getByteFrequencyData() {} };
  const request = resources.begin(() => {});
  resources.setStream(stream);
  resources.setContext(context);
  resources.setAnalyser(analyser);
  resources.setFrame(42);
  resources.cancel((frame) => {
    assert.equal(frame, 42);
    cancelled++;
  });
  assert.equal(resources.owns(request), false);
  assert.equal(resources.getAnalyser(), null);
  assert.equal(stopped, 1);
  assert.equal(cancelled, 1);
  await Promise.resolve();
  assert.equal(closed, 1);
});

test("a replacement microphone request releases adopted prior resources", async () => {
  const resources = createMediaRequestOwner();
  let stopped = 0,
    closed = 0;
  const first = resources.begin(() => {});
  resources.setStream({ getTracks: () => [{ stop: () => stopped++ }] });
  resources.setContext({
    close: async () => {
      closed++;
    },
  });
  const second = resources.begin(() => {});
  assert.equal(resources.owns(first), false);
  assert.equal(resources.owns(second), true);
  assert.equal(stopped, 1);
  await Promise.resolve();
  assert.equal(closed, 1);
});

test("cancelled requests stay cancelled when their delayed grant arrives", async (t) => {
  const owner = createMediaRequestOwner();
  let resolve,
    stopped = 0;
  media(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const request = owner.begin();
  const grant = getUserMediaWithTimeout({ audio: true }, 1000);
  await settle();
  owner.cancel();
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  const stream = await grant;
  if (!owner.owns(request)) stream.getTracks().forEach((track) => track.stop());
  assert.equal(stopped, 1);
  assert.equal(owner.owns(request), false);
});

function micHandlerHarness(t, getUserMedia, AudioCtx) {
  const resources = createMediaRequestOwner();
  const state = {
    active: false,
    pending: false,
    stream: null,
    level: 0,
    contexts: 0,
    frames: [],
    cancelled: [],
    security: [],
  };
  const oldRaf = globalThis.requestAnimationFrame;
  const oldCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    state.frames.push(callback);
    return state.frames.length;
  };
  globalThis.cancelAnimationFrame = (id) => state.cancelled.push(id);
  t.after(() => {
    if (oldRaf) globalThis.requestAnimationFrame = oldRaf;
    else delete globalThis.requestAnimationFrame;
    if (oldCancelRaf) globalThis.cancelAnimationFrame = oldCancelRaf;
    else delete globalThis.cancelAnimationFrame;
  });
  media(t, getUserMedia);
  globalThis.window = {
    AudioContext: class extends AudioCtx {
      constructor() {
        super();
        state.contexts++;
      }
    },
  };
  const handler = componentFunction("toggleMicMonitor", {
    state,
    micResources: { current: resources },
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setMicStream: (value) => {
      state.stream = value;
    },
    setMicLevel: (value) => {
      state.level = value;
    },
    setMicActive: (value) => {
      state.active = value;
    },
    setMicPending: (value) => {
      state.pending = value;
    },
    setMicError() {},
    setReadiness() {},
    onSecurityEvent: (event) => state.security.push(event),
    describeMediaError: (error) => String(error),
    getUserMediaWithTimeout,
    CAMERA_START_TIMEOUT_MS,
    console,
    navigator: globalThis.navigator,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    Uint8Array,
  });
  return { handler, resources, state };
}

function fakeAudioContext({ failAnalyser = false } = {}) {
  return class {
    closeCalls = 0;
    close() {
      this.closeCalls++;
      return Promise.resolve();
    }
    createAnalyser() {
      if (failAnalyser) throw new Error("analyser setup failed");
      return {
        fftSize: 0,
        frequencyBinCount: 2,
        getByteFrequencyData(data) {
          data.fill(10);
        },
      };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
  };
}

test("actual microphone handler cancels pending acquisition and stops its late grant without creating audio", async (t) => {
  let resolve,
    stopped = 0;
  const harness = micHandlerHarness(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    fakeAudioContext()
  );
  const starting = harness.handler();
  assert.equal(harness.state.pending, true);
  await harness.handler();
  assert.equal(harness.state.pending, false);
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await starting;
  assert.equal(stopped, 1);
  assert.equal(harness.state.contexts, 0);
});

test("actual microphone handler times out, stops a late grant, and leaves retry available", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve;
  let stopped = 0;
  const harness = micHandlerHarness(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    fakeAudioContext()
  );
  const starting = harness.handler();
  await settle();
  assert.equal(harness.state.pending, true);
  t.mock.timers.tick(CAMERA_START_TIMEOUT_MS);
  await starting;
  assert.equal(harness.state.pending, false);
  assert.equal(harness.state.active, false);
  assert.equal(harness.state.contexts, 0);
  resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  await settle();
  assert.equal(stopped, 1);
  void harness.handler();
  await settle();
  assert.equal(harness.state.pending, true, "a timed-out monitor can be retried");
  await harness.handler();
  assert.equal(harness.state.pending, false);
});

test("actual microphone handler cleanup closes successful setup and stale rAF cannot reschedule", async (t) => {
  let stopped = 0;
  const harness = micHandlerHarness(
    t,
    async () => ({ getTracks: () => [{ stop: () => stopped++ }] }),
    fakeAudioContext()
  );
  await harness.handler();
  assert.equal(harness.state.active, true);
  const queuedDraw = harness.state.frames[0];
  await harness.handler();
  assert.equal(stopped, 1);
  assert.deepEqual(harness.state.cancelled, [1]);
  assert.equal(harness.resources.getAnalyser(), null);
  queuedDraw(200);
  assert.equal(harness.state.frames.length, 1);
});

test("actual microphone handler cleans setup failure and allows a fresh retry", async (t) => {
  let stopped = 0;
  let fail = true;
  class RetryAudioContext extends fakeAudioContext() {
    createAnalyser() {
      if (fail) throw new Error("analyser setup failed");
      return super.createAnalyser();
    }
  }
  const harness = micHandlerHarness(
    t,
    async () => ({ getTracks: () => [{ stop: () => stopped++ }] }),
    RetryAudioContext
  );
  await harness.handler();
  assert.equal(stopped, 1);
  assert.equal(harness.state.active, false);
  fail = false;
  await harness.handler();
  assert.equal(harness.state.active, true);
  assert.equal(harness.state.contexts, 2);
  await harness.handler();
  assert.equal(stopped, 2);
});

test("actual hardware-tab effect releases microphone resources", async (t) => {
  let tabEffect;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(componentAst) === "useEffect" &&
      ts.isArrowFunction(node.arguments[0]) &&
      node.arguments[0].body.getText(componentAst).includes('activeTab !== "hardware"')
    ) {
      tabEffect = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(componentAst);
  assert.ok(tabEffect, "hardware-tab effect must exist");
  const resources = createMediaRequestOwner();
  let stopped = 0,
    closed = 0;
  resources.setStream({ getTracks: () => [{ stop: () => stopped++ }] });
  resources.setContext({
    close: async () => {
      closed++;
    },
  });
  const js = ts.transpileModule(`const effect = ${tabEffect.getText(componentAst)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const effect = new Function(
    "activeTab",
    "cameraRequestOwner",
    "micResources",
    "cancelAnimationFrame",
    "setMicStream",
    "setMicActive",
    "setMicPending",
    "setMicLevel",
    "setCameraBusy",
    "cameraOpeningRef",
    "cameraSession",
    "camStreamRef",
    "setCamStream",
    `${js}; return effect;`
  )(
    "security",
    { current: { cancel() {} } },
    { current: resources },
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    () => {},
    { current: false },
    { releaseVideo() {} },
    { current: null },
    () => {}
  );
  assert.equal(typeof effect, "function");
  effect();
  await Promise.resolve();
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
});

test("missing mediaDevices produces an unavailable report rather than an unhandled rejection", async (t) => {
  media(t, undefined);
  assert.deepEqual(await getBrowserMediaAvailability(), {
    cameraAvailable: false,
    microphoneAvailable: false,
  });
});

function cameraHandlerHarness(setPreferredVideoDevice) {
  const owner = createMediaRequestOwner();
  const state = {
    stream: null,
    busy: false,
    error: null,
    selected: null,
    readiness: [],
    events: [],
    refreshes: 0,
  };
  const cameraSession = {
    setPreferredVideoDevice,
    preferredVideoDevice: () => "previous-camera",
  };
  const handler = componentFunction("startCameraTest", {
    selectedCam: "",
    cameraRequestOwner: { current: owner },
    cameraStartedAt: { current: 0 },
    cameraOpeningRef: { current: false },
    setCameraBusy: (value) => {
      state.busy = value;
    },
    setCameraError: (value) => {
      state.error = value;
    },
    setFramesStalled() {},
    isTrackDelivering: () => true,
    setCamStream: (value) => {
      state.stream = value;
    },
    camStreamRef: { current: null },
    onSecurityEvent: (event) => state.events.push(event),
    cameraSession,
    refreshCameras: () => {
      state.refreshes += 1;
    },
    setSelectedCam: (value) => {
      state.selected = value;
    },
    describeMediaError: (error) => String(error),
    setReadiness: (update) => {
      state.readiness.push(update({ camera: "checking" }).camera);
    },
    performance: { now: () => 100 },
  });
  return { handler, owner, state };
}

test("actual Settings camera handler adopts shared selection but does not claim ready before preview", async () => {
  const stream = { getTracks: () => [] };
  const harness = cameraHandlerHarness(async (deviceId) => {
    assert.equal(deviceId, "rgb-camera");
    return stream;
  });
  await harness.handler("rgb-camera");
  assert.equal(harness.state.stream, stream);
  assert.equal(harness.state.busy, true, "preview effect owns the remaining busy state");
  assert.deepEqual(harness.state.readiness, [], "acquisition alone must not mark camera ok");
  assert.equal(harness.state.refreshes, 1);
  assert.match(harness.state.events.at(-1), /checking preview/i);
});

test("actual Settings camera handler rejects a late selection result after cancellation", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const harness = cameraHandlerHarness(() => pending);
  const opening = harness.handler("ir-camera");
  await settle();
  harness.owner.cancel();
  const stream = { getTracks: () => [] };
  resolve(stream);
  await opening;
  assert.equal(harness.state.stream, null);
  assert.equal(harness.state.refreshes, 0);
  assert.deepEqual(harness.state.readiness, []);
});

test("actual Settings camera handler surfaces preference persistence failure and restores selection", async () => {
  const error = new Error("Camera preference storage unavailable");
  const harness = cameraHandlerHarness(async () => {
    throw error;
  });
  await harness.handler("rgb-camera");
  assert.equal(harness.state.stream, null);
  assert.equal(harness.state.busy, false);
  assert.equal(harness.state.selected, "previous-camera");
  assert.match(harness.state.error, /could not be saved/i);
  assert.deepEqual(harness.state.readiness, ["fail"]);
});
