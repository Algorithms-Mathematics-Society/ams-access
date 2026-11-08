import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./Stage8_FaceCalibration.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "stage.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let handler;
function visit(node) {
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.attributes.properties.some(
      (attr) => attr.name?.getText(ast) === "label" && attr.initializer?.text === "Retry face scan"
    )
  )
    handler = node.attributes.properties.find((attr) => attr.name?.getText(ast) === "onClick")
      ?.initializer?.expression;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(handler);
const code = ts.transpileModule(`const retry = ${handler.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test("face scan retry releases an unusable preview handle but retains a working detector-retry camera", () => {
  for (const reason of ["preview_failed", "detector_failed", "scan_deadline"]) {
    const incoming = {};
    const local = {};
    const released = [];
    let retries = 0;
    const retry = new Function(
      "owns",
      "attemptRef",
      "invalidateAttempt",
      "reviewReasonRef",
      "cameraSession",
      "localStreamRef",
      "stream",
      "onRetry",
      `${code}; return retry;`
    )(
      () => true,
      { current: { generation: 1 } },
      () => {},
      { current: reason },
      { releaseVideo: (stream) => released.push(stream) },
      { current: local },
      incoming,
      () => retries++
    );
    retry();
    assert.deepEqual(released, reason === "preview_failed" ? [local] : []);
    assert.equal(retries, 1);
  }
});

test("retry stops the failed shared handle and the next scan opens a fresh camera", async () => {
  const { createCameraSession } = await import("../../../../../lib/camera-session.ts");
  const opened = [];
  const createStream = (tracks) => ({
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => [],
  });
  const session = createCameraSession({
    createStream,
    mediaDevices: {
      async getUserMedia() {
        const track = {
          kind: "video",
          readyState: "live",
          muted: false,
          stop() {
            this.readyState = "ended";
          },
          addEventListener() {},
        };
        opened.push(track);
        return createStream([track]);
      },
    },
  });
  const stream = await session.ensure();
  const retry = new Function(
    "owns",
    "attemptRef",
    "invalidateAttempt",
    "reviewReasonRef",
    "cameraSession",
    "localStreamRef",
    "stream",
    "onRetry",
    `${code}; return retry;`
  )(
    () => true,
    { current: { generation: 1 } },
    () => {},
    { current: "preview_failed" },
    session,
    { current: null },
    stream,
    () => {}
  );
  retry();
  assert.equal(
    stream.getVideoTracks()[0].readyState,
    "ended",
    "the next scan's live-track gate rejects this failed stream"
  );
  await session.ensure();
  assert.equal(opened.length, 2);
  const replacement = session.current().getVideoTracks()[0];
  retry(); // An old retry cannot stop a newer shared owner.
  assert.equal(replacement.readyState, "live");
  session.release();
});

test("rendered camera stays unobscured while detector loads or needs review", () => {
  let preview;
  const statuses = [];
  function find(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === "VStack" &&
      node.children.some(
        (child) => ts.isJsxSelfClosingElement(child) && child.tagName.getText(ast) === "video"
      )
    )
      preview = node;
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ["!detectorReady && !reviewAvailable", "stageBlocked &&"].some((text) =>
        node.expression.getText(ast).startsWith(text)
      )
    )
      statuses.push(node.expression);
    ts.forEachChild(node, find);
  }
  find(ast);
  assert.ok(preview);
  assert.equal(statuses.length, 2);
  const jsx = `[${[preview, ...statuses].map((node) => node.getText(ast)).join(",")} ]`;
  const rendered = ts.transpileModule(`const render = () => (${jsx});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat().filter(Boolean),
    }),
  };
  for (const [detectorReady, reviewAvailable, stageBlocked, message] of [
    [false, false, false, "Preparing face check"],
    [false, true, true, "Face check needs review"],
    [true, false, false, null],
  ]) {
    const scope = {
      React,
      VStack: "stack",
      Text: "text",
      detectorReady,
      reviewAvailable,
      stageBlocked,
      flash: false,
      facePresent: false,
      done: false,
      qualityOk: false,
      lostTracking: false,
      videoRef: {},
      overlayCanvasRef: {},
      captureCanvasRef: {},
    };
    const render = new Function(...Object.keys(scope), `${rendered}; return render;`)(
      ...Object.values(scope)
    );
    const [tile, ...status] = render();
    const walk = (node) => (typeof node === "object" ? [node, ...node.children.flatMap(walk)] : []);
    const previewElements = walk(tile);
    assert.ok(previewElements.some((node) => node.type === "video"));
    assert.equal(
      previewElements.some(
        (node) => node.props.style?.position === "absolute" && node.props.style?.background
      ),
      false,
      "loading/review must never paint an opaque layer over the video"
    );
    if (message) {
      const text = status
        .flatMap(walk)
        .flatMap((node) => node.children)
        .filter((child) => typeof child === "string")
        .join(" ");
      assert.ok(text.includes(message));
      assert.ok(
        status
          .flatMap(walk)
          .some((node) => node.props.role === "status" && node.props["aria-live"] === "polite")
      );
    } else assert.ok(status.every((node) => !node));
  }
});
