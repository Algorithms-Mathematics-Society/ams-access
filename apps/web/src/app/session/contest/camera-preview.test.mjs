import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { startCameraPreview } from "../../../lib/camera-readiness.ts";

const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const helper = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "attachVideoStream"
);
assert.ok(helper);
const code = ts.transpileModule(helper.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const attach = new Function(
  "keepPlaying",
  "startCameraPreview",
  "isVideoRendering",
  `${code}; return attachVideoStream;`
)(
  () => {},
  (video, stream, ms) => {
    assert.equal(ms, 3000, "contest preview retains its bounded three-second deadline");
    return startCameraPreview(video, stream, 20);
  },
  (video) => video.readyState >= 2 && video.videoWidth > 0
);
function video() {
  return Object.assign(new EventTarget(), {
    srcObject: null,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    play: () => new Promise(() => {}),
  });
}

test("contest attachment resolves false when play remains pending with no frame", async () => {
  assert.equal(await attach(video(), {}), false);
});

test("contest attachment resolves true from a real frame even while play remains pending", async () => {
  const preview = video();
  const ready = attach(preview, {});
  preview.dispatchEvent(new Event("loadeddata"));
  Object.assign(preview, { readyState: 2, videoWidth: 640, videoHeight: 480 });
  preview.dispatchEvent(new Event("playing"));
  assert.equal(await ready, true);
});

function contestAcquisition(deps) {
  let acquire;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "acquire") acquire = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(acquire);
  const compiled = ts.transpileModule(acquire.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    ...Object.keys(deps),
    `let acquiring = false; let retryTimer = null; ${compiled}; return acquire;`
  )(...Object.values(deps));
}

for (const stale of [false, true]) {
  test(`contest binds video before advisory audio settles${stale ? " and ignores stale audio" : ""}`, async () => {
    let grantAudio;
    const pendingAudio = new Promise((resolve) => {
      grantAudio = resolve;
    });
    const track = { readyState: "live" };
    const audio = { enabled: true };
    const stream = {
      getVideoTracks: () => [track],
      getAudioTracks: () => stream.audio,
      audio: [],
      addTrack: (track) => stream.audio.push(track),
    };
    const cameraStreamRef = { current: null };
    const calls = [];
    let bound = false;
    const noop = () => {};
    const acquire = contestAcquisition({
      cameraClosedRef: { current: false },
      cancelled: false,
      cameraSession: {
        ensure: (options) => {
          calls.push(options);
          return options?.audio ? pendingAudio : Promise.resolve(stream);
        },
      },
      withTimeout: (promise) => promise,
      cameraStreamRef,
      cameraEnabledRef: { current: true },
      micEnabledRef: { current: false },
      setCameraStream: noop,
      setCameraVideoReady: noop,
      setCameraError: noop,
      mediaInitialStateLoggedRef: { current: true },
      bindStream: async (value) => {
        assert.equal(value, stream);
        bound = true;
      },
      scheduleRetry: () => assert.fail("unexpected camera retry"),
      setProctoringOk: noop,
      setFaceStatus: noop,
      displayCameraError: String,
    });
    await acquire();
    assert.equal(bound, true, "camera preview binds while microphone is still pending");
    assert.deepEqual(calls, [undefined, { audio: true }]);
    if (stale) cameraStreamRef.current = null;
    grantAudio({ getAudioTracks: () => [audio] });
    await Promise.resolve();
    assert.deepEqual(stream.audio, stale ? [] : [audio]);
    if (!stale)
      assert.equal(audio.enabled, false, "background microphone honors default-off toggle");
  });
}

test("camera keeps a stable workspace anchor above the independently sized footer", () => {
  let region;
  const tileUses = [];
  function visit(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.attributes.properties.some(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.text === "className" &&
          prop.initializer?.text === "contest-camera-region"
      )
    )
      region = node;
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === "cameraTile")
      tileUses.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(region);
  assert.equal(tileUses.length, 1, "lobby and workspace share exactly one mounted video");
  assert.equal(
    tileUses[0].parent,
    region,
    "tile is an unconditional direct child of the stable region"
  );
  const regions = region.children.filter(ts.isJsxExpression);
  const members = regions.find((node) => node.getText(ast).includes("<TeamLobbyMembers"));
  assert.ok(members, "the assignment roster is a separate region child");
  assert.ok(
    regions.indexOf(members) > regions.indexOf(tileUses[0]),
    "camera precedes Members in DOM and narrow flow"
  );
  assert.match(members.getText(ast), /renderTeamLobby &&/);
  assert.match(region.getText(ast), /renderTeamLobby \?/);
  assert.doesNotMatch(region.getText(ast), /<FooterTrustStrip/);
  assert.match(region.parent.getText(ast), /<FooterTrustStrip/);
});

test("lobby camera occupies its own region even after the workspace preview was collapsed", () => {
  const source = readFileSync(new URL("./components/CameraTile.tsx", import.meta.url), "utf8");
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react") return { useEffect() {}, useState: (v) => [v, () => {}] };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    return Object.fromEntries(
      [
        "HStack",
        "VStack",
        "Button",
        "Text",
        "StatusDot",
        "Video",
        "VideoOff",
        "Mic",
        "MicOff",
        "SwitchCamera",
      ].map((n) => [n, n])
    );
  }, exports);
  const props = {
    cameraVideoRef: { current: null },
    cameraStream: {},
    cameraError: null,
    sidebarCollapsed: true,
    cameraCollapsed: true,
    cameraStatusLabel: "Camera ready",
    cameraHealthy: true,
    cameraEnabled: true,
    micEnabled: false,
    handleToggleMedia() {},
  };
  const hidden = exports.CameraTile(props);
  assert.equal(hidden.props.style.display, "none");
  const docked = exports.CameraTile({ ...props, inLobby: true });
  assert.equal(docked.props.style.display, "flex");
  assert.equal(docked.props.style.position, "relative");
  assert.equal(docked.props.style.gridArea, "preview");
  assert.equal(docked.props.style.zIndex, undefined, "lobby preview never floats over actions");
  assert.equal(
    docked.props.children[2].props.children.type,
    "video",
    "same video subtree remains mounted across presentation changes"
  );
});

test("five rendered camera choices remain in a bounded scroll region in workspace and lobby", () => {
  const tileSource = readFileSync(new URL("./components/CameraTile.tsx", import.meta.url), "utf8");
  const exports = {};
  const cameras = Array.from({ length: 5 }, (_, index) => ({
    kind: "videoinput",
    deviceId: `camera-${index + 1}`,
    label: `Camera ${index + 1}`,
  }));
  const Stack = ({ children, ...props }) =>
    React.createElement("div", { style: props.style, role: props.role, "aria-label": props["aria-label"] }, React.Children.toArray(children));
  const renderedButtons = [];
  const Button = ({ label, ...props }) => {
    renderedButtons.push({ label, onClick: props.onClick });
    return React.createElement("button", { "aria-label": label, style: props.style }, label);
  };
  const Text = ({ children }) => React.createElement("span", null, children);
  new Function(
    "require",
    "exports",
    ts.transpileModule(tileSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react") return { useEffect() {}, useState: (initial) =>
      Array.isArray(initial) ? [cameras, () => {}] : [true, () => {}] };
    if (name === "react/jsx-runtime") return { jsx, jsxs };
    if (name === "@astryxdesign/core/Stack") return { HStack: Stack, VStack: Stack };
    if (name === "@astryxdesign/core/Button") return { Button };
    if (name === "@astryxdesign/core/Text") return { Text };
    if (name === "@astryxdesign/core/StatusDot") return { StatusDot: Text };
    return Object.fromEntries(["Video", "VideoOff", "Mic", "MicOff", "SwitchCamera"].map((key) => [key, Text]));
  }, exports);
  const selected = [];
  const props = {
    cameraVideoRef: { current: null },
    cameraStream: {},
    cameraError: null,
    sidebarCollapsed: false,
    cameraCollapsed: false,
    cameraStatusLabel: "Camera ready",
    cameraHealthy: true,
    cameraEnabled: true,
    micEnabled: false,
    handleToggleMedia() {},
    onPickCamera: (deviceId) => selected.push(deviceId),
  };
  for (const inLobby of [false, true]) {
    renderedButtons.length = 0;
    const markup = renderToStaticMarkup(exports.CameraTile({ ...props, inLobby }));
    assert.equal((markup.match(/aria-label="Camera [1-5]"/g) ?? []).length, 5);
    assert.equal((markup.match(/<video\b/g) ?? []).length, 1);
    assert.match(markup, /max-height:calc\(100% - var\(--spacing-10\) - var\(--spacing-4\)\)/);
    assert.match(markup, /overflow-y:auto/);
    assert.match(markup, /box-sizing:border-box/);
    renderedButtons.find((button) => button.label === "Camera 5").onClick();
  }
  assert.deepEqual(selected, ["camera-5", "camera-5"]);
});
