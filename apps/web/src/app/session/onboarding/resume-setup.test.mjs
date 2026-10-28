import assert from "node:assert/strict";
import test from "node:test";
import { readResumeSetup, canReuseFaceScan, RESUME_SETUP_MAX_AGE_MS } from "./resume-setup.ts";

const context = { sessionId: "s", contestId: "c", deviceId: "d" };
const saved = { ...context, cameraId: "camera", passedAt: 1000 };

test("recent setup is bound to the session, contest, device and camera", () => {
  assert.deepEqual(readResumeSetup(JSON.stringify(saved), context, 2000), saved);
  for (const field of Object.keys(context)) {
    assert.equal(
      readResumeSetup(JSON.stringify(saved), { ...context, [field]: "other" }, 2000),
      null
    );
  }
  assert.equal(canReuseFaceScan(saved, "camera", 2000), true);
  assert.equal(canReuseFaceScan(saved, "different", 2000), false);
  assert.equal(canReuseFaceScan(null, "camera", 2000), false);
});

test("expired, future, malformed and incomplete checkpoints run full setup", () => {
  for (const raw of [
    null,
    "bad",
    "{}",
    "null",
    JSON.stringify({ ...saved, cameraId: "" }),
    JSON.stringify({ ...saved, passedAt: "1000" }),
  ]) {
    assert.equal(readResumeSetup(raw, context, 2000), null);
  }
  for (const now of [999, 1000 + RESUME_SETUP_MAX_AGE_MS]) {
    assert.equal(readResumeSetup(JSON.stringify(saved), context, now), null);
    assert.equal(canReuseFaceScan(saved, "camera", now), false);
  }
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let advance;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "onAdvance")
    advance = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(advance);
const program = ts.transpileModule(`return (${advance.getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test("the stage transition reuses only the face scan and still runs fresh presence", () => {
  for (const [checkpoint, delivering, cameraId, next, expected] of [
    [saved, true, "camera", 7, 8],
    [saved, false, "camera", 7, 7],
    [saved, true, "other", 7, 7],
    [null, true, "camera", 7, 7],
    [saved, true, "camera", 2, 2],
    [saved, true, "camera", 10, 10],
  ]) {
    let stage,
      results = {},
      reused = false;
    const track = { getSettings: () => ({ deviceId: cameraId }) };
    const context = {
      resumeSetupRef: { current: checkpoint },
      cameraStreamRef: { current: { getVideoTracks: () => [track] } },
      passedFaceRef: { current: null },
      canReuseFaceScan: (value, id) => canReuseFaceScan(value, id, 2000),
      isTrackDelivering: () => delivering,
      setResults: (update) => {
        results = update(results);
      },
      setReusedFaceScan: (value) => {
        reused = value;
      },
      setCurrentStage: (value) => {
        stage = value;
      },
      setTransitioning: () => {},
    };
    new Function(...Object.keys(context), program)(...Object.values(context))(next);
    assert.equal(stage, expected);
    assert.equal(reused, expected === 8);
    assert.deepEqual(results, expected === 8 ? { 7: "pass" } : {});
  }
});

function expressionFrom(file, name) {
  const tree = ts.createSourceFile(name, file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name)
      expression = node.initializer;
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) expression = node;
    ts.forEachChild(node, find);
  }
  find(tree);
  assert(expression, `${name} must exist`);
  const code = ts.transpileModule(`return (${expression.getText(tree)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return (context) => {
    const body =
      name === "settle"
        ? code.replace("return (", "const callback = (") +
          "return Object.assign(callback, { cancel: () => { cancelled = true; } });"
        : code;
    return new Function(...Object.keys(context), body)(...Object.values(context));
  };
}

const savePhoto = expressionFrom(source, "saveResumeReferencePhoto");
function photoFixture(overrides = {}) {
  const calls = [];
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const context = {
    useCallback: (callback) => callback,
    resumeSetupRef: { current: saved },
    cameraStreamRef: {
      current: {
        getVideoTracks: () => [{ enabled: true, getSettings: () => ({ deviceId: "camera" }) }],
      },
    },
    isTrackDelivering: () => true,
    canReuseFaceScan: (value, id) => canReuseFaceScan(value, id, 2000),
    captureFrame: (input) => {
      assert.equal(input, video);
      calls.push("capture");
      return "fresh";
    },
    invokeStrict: async (command, args) => {
      calls.push([command, args]);
      return { face_verified: true };
    },
    withTimeout: (promise) => promise,
    uploadIdentityPhoto: async (...args) => {
      calls.push(args);
      return true;
    },
    ...overrides,
  };
  return { calls, context, save: () => savePhoto(context)(video) };
}

test("resume saves the fresh frame natively and awaits the existing session identity-photo upload", async () => {
  const fixture = photoFixture();
  assert.equal(await fixture.save(), true);
  assert.deepEqual(fixture.calls, [
    "capture",
    ["save_face_image", { imageData: "data:image/jpeg;base64,fresh", index: 0, dryRun: false }],
    [saved.sessionId, "entry", "fresh", 0],
  ]);
});

test("missing capture, stale camera, native rejection, timeout and upload failure cannot reuse the scan", async () => {
  for (const overrides of [
    { captureFrame: () => null },
    { isTrackDelivering: () => false },
    { canReuseFaceScan: () => false },
    { resumeSetupRef: { current: null } },
    { cameraStreamRef: { current: null } },
    { invokeStrict: async () => null },
    { invokeStrict: async () => ({ face_verified: false }) },
    { uploadIdentityPhoto: async () => false },
  ])
    assert.equal(await photoFixture(overrides).save(), false);
  for (const overrides of [
    {
      captureFrame: () => {
        throw Error("capture");
      },
    },
    {
      invokeStrict: async () => {
        throw Error("save");
      },
    },
    {
      withTimeout: async () => {
        throw Error("timeout");
      },
    },
    {
      uploadIdentityPhoto: async () => {
        throw Error("upload");
      },
    },
  ])
    await assert.rejects(photoFixture(overrides).save());
});

const presenceSource = readFileSync(
  new URL("./components/stages/Stage9_PresenceVerification.tsx", import.meta.url),
  "utf8"
);
const settlePresence = expressionFrom(presenceSource, "settle");
function presenceFixture(onReferencePhoto) {
  const calls = [];
  const context = {
    cancelled: false,
    settled: false,
    onReferencePhoto,
    videoRef: { current: "live video" },
    isPresencePass: (result) => result === "present",
    onPhotoFailure: () => calls.push("full scan"),
    setVerdict: (result) => calls.push(result),
    advanceTimer: null,
    setTimeout: (callback) => {
      calls.push("advance scheduled");
      callback();
    },
    onPass: () => calls.push("pass"),
    onWarn: () => calls.push("warn"),
  };
  return { calls, settle: settlePresence(context) };
}

test("resumed presence waits for the fresh photo before advancing", async () => {
  let finish;
  const fixture = presenceFixture((video) => {
    assert.equal(video, "live video");
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = fixture.settle("present");
  assert.deepEqual(fixture.calls, []);
  finish(true);
  await pending;
  assert.deepEqual(fixture.calls, ["present", "advance scheduled", "pass"]);
});

test("resume photo failure or unusable presence runs the full scan without advancing", async () => {
  for (const capture of [
    async () => false,
    async () => {
      throw Error("failed");
    },
  ]) {
    const fixture = presenceFixture(capture);
    await fixture.settle("present");
    assert.deepEqual(fixture.calls, ["full scan"]);
  }
  for (const verdict of ["unknown", "absent", "multiple"]) {
    const fixture = presenceFixture(async () =>
      assert.fail("must see one person before capturing")
    );
    await fixture.settle(verdict);
    assert.deepEqual(fixture.calls, ["full scan"]);
    const normal = presenceFixture(undefined);
    await normal.settle(verdict);
    assert.deepEqual(normal.calls, [verdict, "advance scheduled", "warn"]);
  }
});

test("photo fallback invalidates the checkpoint and returns to the full face scan", () => {
  let stage,
    reused = true,
    results = { 6: "pass", 7: "pass", 8: "pass" };
  const context = {
    useCallback: (callback) => callback,
    resumeSetupRef: { current: saved },
    passedFaceRef: { current: saved },
    setReusedFaceScan: (value) => {
      reused = value;
    },
    localStorage: { removeItem: (key) => assert.equal(key, "ams_resume_setup") },
    RESUME_SETUP_KEY: "ams_resume_setup",
    setResults: (update) => {
      results = update(results);
    },
    setCurrentStage: (value) => {
      stage = value;
    },
  };
  expressionFrom(source, "retryFullFaceScan")(context)();
  assert.equal(stage, 7);
  assert.equal(reused, false);
  assert.equal(context.resumeSetupRef.current, null);
  assert.equal(context.passedFaceRef.current, null);
  assert.deepEqual(results, { 6: "pass" });
  assert.match(
    source,
    /onReferencePhoto=\{\s*reusedFaceScan \? saveResumeReferencePhoto : undefined\s*\}/
  );
  assert.match(source, /onPhotoFailure=\{retryFullFaceScan\}/);
});

test("leaving presence ignores late photo success and failure", async () => {
  for (const result of [true, false]) {
    let finish;
    const fixture = presenceFixture(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = fixture.settle("present");
    fixture.settle.cancel();
    finish(result);
    await pending;
    assert.deepEqual(fixture.calls, []);
  }
});

test("resume requires a person in the final sampled frame before photographing", async () => {
  const { decidePresence } = await import("./presence-check.ts");
  for (const lastStatus of ["presence_ok", "no_face"]) {
    const samples = ["presence_ok", "presence_ok", lastStatus];
    let verdict;
    const run = expressionFrom(
      presenceSource,
      "run"
    )({
      stream: {},
      cancelled: false,
      detector: null,
      loadPresenceDetector: async () => ({}),
      canvasRef: { current: {} },
      videoRef: { current: {} },
      SAMPLE_COUNT: 3,
      SAMPLE_INTERVAL_MS: 1,
      samplePresence: async () => ({ status: samples.shift() }),
      CameraTimeoutError: class extends Error {},
      setTaken: () => {},
      setTimeout: (callback) => callback(),
      onReferencePhoto: () => {},
      decidePresence,
      settle: async (result) => {
        verdict = result;
      },
    });
    await run();
    assert.equal(verdict, lastStatus === "presence_ok" ? "present" : "unknown");
  }
});
