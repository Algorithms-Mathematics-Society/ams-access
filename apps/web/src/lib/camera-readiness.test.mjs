import assert from "node:assert/strict";
import test from "node:test";
import { CameraTimeoutError, startCameraPreview } from "./camera-readiness.ts";

function video() {
  return Object.assign(new EventTarget(), {
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    srcObject: null,
    play: () => new Promise(() => {}),
  });
}
function frame(preview) {
  Object.assign(preview, { readyState: 2, videoWidth: 640, videoHeight: 480 });
}

test("pending WebKit play cannot prevent the preview deadline", async () => {
  const preview = video();
  await assert.rejects(startCameraPreview(preview, {}, 20), CameraTimeoutError);
  assert.equal(preview.muted, true);
  assert.equal(preview.playsInline, true);
});

test("an early readiness hint does not reject a frame delivered later", async () => {
  const preview = video();
  const stream = {};
  const ready = startCameraPreview(preview, stream, 200);
  preview.dispatchEvent(new Event("loadeddata"));
  frame(preview);
  preview.dispatchEvent(new Event("resize"));
  await ready;
  assert.equal(preview.srcObject, stream);
});

test("dimensions without readiness events are detected by bounded polling", async () => {
  const preview = video();
  const ready = startCameraPreview(preview, {}, 200);
  frame(preview);
  await ready;
});

test("play rejection or synchronous failure still requires a decoded frame", async () => {
  for (const play of [
    () => Promise.reject(Error("blocked")),
    () => {
      throw Error("blocked");
    },
  ]) {
    const preview = video();
    preview.play = play;
    await assert.rejects(startCameraPreview(preview, {}, 20), CameraTimeoutError);
  }
});

test("width without height does not count as a decoded preview", async () => {
  const preview = video();
  frame(preview);
  preview.videoHeight = 0;
  await assert.rejects(startCameraPreview(preview, {}, 20), CameraTimeoutError);
});
