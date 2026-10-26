import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createCameraSession } from "../../../../../lib/camera-session.ts";

const source = readFileSync(new URL("./Stage7_CameraInit.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "Stage7_CameraInit.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let retryHandler;
function visit(node) {
  if (
    ts.isJsxElement(node) &&
    node.openingElement.tagName.getText(ast) === "Button" &&
    node.children.some((child) => child.getText(ast).includes("Try again"))
  ) {
    const click = node.openingElement.attributes.properties.find(
      (attribute) => attribute.name?.getText(ast) === "onClick"
    );
    retryHandler = click?.initializer?.expression?.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(retryHandler, "Stage 7 must expose its camera retry action");
const retryCode = ts.transpileModule(`const retry = ${retryHandler};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test("camera retry replaces a live but muted handle after the user repairs access", async () => {
  const tracks = { video: [], audio: [] };
  const session = createCameraSession({
    mediaDevices: {
      async getUserMedia(constraints) {
        const kind = constraints.audio ? "audio" : "video";
        const track = {
          kind,
          readyState: "live",
          muted: false,
          stopped: false,
          stop() {
            this.stopped = true;
            this.readyState = "ended";
          },
          addEventListener() {},
        };
        tracks[kind].push(track);
        return {
          getTracks: () => [track],
          getVideoTracks: () => (kind === "video" ? [track] : []),
          getAudioTracks: () => (kind === "audio" ? [track] : []),
        };
      },
    },
    createStream: (owned) => ({
      getTracks: () => owned,
      getVideoTracks: () => owned.filter((track) => track.kind === "video"),
      getAudioTracks: () => owned.filter((track) => track.kind === "audio"),
    }),
  });
  await session.ensure({ audio: true });
  await session.ensure({ audio: true });
  assert.equal(tracks.video.length, 1, "routine reuse must not reopen the camera");
  assert.equal(tracks.audio.length, 1, "routine reuse must not reopen the microphone");
  tracks.video[0].muted = true;

  const generationRef = { current: 0 };
  const completedRef = { current: false };
  let retryKey = 0;
  const retry = new Function(
    "cameraSession",
    "generationRef",
    "completedRef",
    "cancelPass",
    "setPhase",
    "setError",
    "setPermissionIssue",
    "setRetryKey",
    `${retryCode}; return retry;`
  )(
    session,
    generationRef,
    completedRef,
    () => {},
    () => {},
    () => {},
    () => {},
    (update) => {
      retryKey = update(retryKey);
    }
  );
  retry();
  assert.equal(retryKey, 1);
  await session.ensure({ audio: true }); // The retryKey effect runs the video acquisition.

  assert.equal(tracks.video[0].stopped, true);
  assert.equal(tracks.video.length, 2);
  assert.equal(tracks.audio.length, 1);
  assert.equal(tracks.audio[0].stopped, false);
  assert.equal(session.current()?.getVideoTracks()[0], tracks.video[1]);
});

test("setup requests Location only after macOS camera readiness and never gates entry", async () => {
  let effect;
  function find(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes('invoke("request_wifi_location")')
    ) {
      effect = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(effect);
  assert.match(source.replace(/\s+/g, " "), /Denying this does not block contest entry/);
  const code = ts.transpileModule(`const effect = ${effect};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [isMac, phase, alreadyRequested, expected] of [
    [false, "pass", false, 0],
    [true, "checking", false, 0],
    [true, "fail", false, 0],
    [true, "pass", true, 0],
    [true, "pass", false, 1],
  ]) {
    const calls = [];
    const run = new Function(
      "isMac",
      "phase",
      "locationRequested",
      "invoke",
      `${code}; return effect;`
    )(isMac, phase, { current: alreadyRequested }, (command) => {
      calls.push(command);
      return Promise.reject(new Error("optional permission unavailable"));
    });
    assert.equal(run(), undefined, "entry does not await optional access");
    await new Promise(setImmediate);
    assert.equal(calls.length, expected);
    if (expected) assert.equal(calls[0], "request_wifi_location");
  }
});
