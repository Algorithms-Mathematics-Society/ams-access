import assert from "node:assert/strict";
import test from "node:test";
import { footerCameraStatus } from "./camera-status.ts";

test("turning the camera off overrides a previously healthy preview", () => {
  assert.equal(footerCameraStatus(true, true, null), "on");
  assert.equal(footerCameraStatus(false, true, null), "off");
  assert.equal(footerCameraStatus(true, true, null), "on");
});

test("a disabled camera never shows on or starting", () => {
  for (const healthy of [true, false]) {
    for (const error of [null, "Camera disconnected"]) {
      assert.equal(footerCameraStatus(false, healthy, error), "off");
    }
  }
});

test("an enabled camera reports health, startup and errors", () => {
  assert.equal(footerCameraStatus(true, false, null), "starting");
  assert.equal(footerCameraStatus(true, true, null), "on");
  assert.equal(footerCameraStatus(true, true, "Camera disconnected"), "off");
  assert.equal(footerCameraStatus(true, false, "Camera permission denied"), "off");
});

// Execute the real media handlers with React updates intentionally uncommitted.
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const clientSource = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
function mediaHarness() {
  const start = clientSource.indexOf("  function applyMediaToggle(");
  const end = clientSource.indexOf("\n  useEffect(() => {", start);
  const audio = { enabled: false, readyState: "live" };
  const video = { enabled: true };
  const logs = [];
  const context = {
    cameraEnabledRef: { current: true },
    micEnabledRef: { current: false },
    pendingMediaToggleRef: { current: null },
    hasToggledMediaRef: { current: false },
    cameraStreamRef: { current: { getVideoTracks: () => [video], getAudioTracks: () => [audio] } },
    navigator: { userAgent: "Mac" },
    setCameraEnabled() {},
    setMicEnabled() {},
    setPresenceStatus() {},
    setShowMediaToggleWarning() {},
    useCallback: (fn) => fn,
    logMediaToggle: (...args) => logs.push(args),
  };
  vm.runInNewContext(
    ts.transpileModule(clientSource.slice(start, end), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + ";globalThis.cancel = cancelMediaToggle",
    context
  );
  return { context, logs, audio, video };
}
test("same-target microphone burst produces one track transition and audit", () => {
  const h = mediaHarness();
  for (let n = 0; n < 100; n++) h.context.handleToggleMedia("mic", true);
  assert.equal(h.audio.enabled, true);
  assert.equal(h.logs.length, 1);
  h.context.handleToggleMedia("mic", false);
  for (let n = 0; n < 100; n++) h.context.confirmMediaToggle();
  assert.equal(h.audio.enabled, false);
  assert.equal(h.logs.length, 2);
  // A fresh deliberate activation is not blocked by a time-based cooldown.
  h.context.handleToggleMedia("mic", true);
  h.context.handleToggleMedia("mic", false);
  assert.equal(h.audio.enabled, false);
  assert.equal(h.logs.length, 4);
});
test("pending confirmation cannot be overwritten and cancel cannot later apply it", () => {
  const h = mediaHarness();
  h.context.handleToggleMedia("camera", false);
  h.context.handleToggleMedia("mic", true);
  h.context.cancel();
  h.context.confirmMediaToggle();
  assert.equal(h.video.enabled, true);
  assert.equal(h.audio.enabled, false);
  assert.equal(h.logs.length, 0);
  h.context.handleToggleMedia("camera", false);
  h.context.confirmMediaToggle();
  h.context.confirmMediaToggle();
  assert.equal(h.video.enabled, false);
  assert.equal(h.logs.length, 1);
});
test("unavailable macOS microphone does not claim or audit a successful enable", () => {
  const h = mediaHarness();
  h.context.handleToggleMedia("mic", false);
  assert.equal(h.context.pendingMediaToggleRef.current, null, "no warning for an unchanged device");
  h.audio.readyState = "ended";
  h.context.handleToggleMedia("mic", true);
  assert.equal(h.context.micEnabledRef.current, false);
  assert.equal(h.logs.length, 0);
});

const tileCode = ts.transpileModule(
  readFileSync(new URL("./components/CameraTile.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;
test("camera and normal mic consume native multiclicks and held activation keys", () => {
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return { useEffect() {}, useState: (value) => [value, () => {}] };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(tileCode, context);
  const calls = [];
  const render = (micEnabled) =>
    context.exports.CameraTile({
      cameraVideoRef: { current: null },
      cameraEnabled: true,
      micEnabled,
      handleToggleMedia: (...args) => calls.push(args),
    });
  function find(node, label) {
    if (Array.isArray(node)) return node.map((n) => find(n, label)).find(Boolean);
    if (!node || typeof node !== "object") return undefined;
    return node.props?.label === label ? node : find(node.props?.children, label);
  }
  const mic = find(render(false), "Turn microphone on");
  mic.props.onClick({ detail: 1 });
  const changed = find(render(true), "Turn microphone off");
  changed.props.onClick({ detail: 2 });
  changed.props.onClick({ detail: 3 });
  assert.equal(
    calls.length,
    1,
    "multi-click sequence must not undo first activation after rerender"
  );
  changed.props.onClick({ detail: 1 });
  changed.props.onClick({ detail: 0 });
  assert.equal(calls.length, 3, "fresh mouse and accessibility clicks remain accepted");
  for (const button of [mic, find(render(false), "Turn camera off")]) {
    for (const key of ["Enter", " "]) {
      let prevented = false;
      button.props.onKeyDown({
        key,
        repeat: true,
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    }
  }
});
