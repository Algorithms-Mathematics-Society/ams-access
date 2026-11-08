import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
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
