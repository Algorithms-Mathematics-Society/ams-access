import assert from "node:assert/strict";
import test from "node:test";
import { DETECT_WIDTH, drawForObjects, watchedObject } from "./object-watch.ts";

function fakeCanvas() {
  const drawn = [];
  return {
    width: 128,
    height: 128,
    getContext: () => ({
      drawImage: (_source, x, y, w, h) => drawn.push({ x, y, w, h }),
    }),
    drawn,
  };
}

test("the detector is fed at its own input width, not the presence canvas size", () => {
  // The bug this pins: `sampleObjects` was handed the 128x128 BlazeFace
  // canvas. EfficientDet-Lite0 resizes to 320x320, so a phone in someone's
  // hand arrived as roughly a dozen pixels and could not reach any score
  // threshold. Phone detection ran all paper and was incapable of a hit.
  const canvas = fakeCanvas();
  assert.equal(drawForObjects({ videoWidth: 640, videoHeight: 480 }, canvas), true);
  assert.equal(canvas.width, DETECT_WIDTH);
  assert.ok(DETECT_WIDTH > 128, "must exceed the presence canvas");
  assert.deepEqual(canvas.drawn, [{ x: 0, y: 0, w: 320, h: 240 }]);
});

test("the frame keeps the camera's aspect ratio", () => {
  // Squashing 16:9 into a square makes a stretched phone, which matches
  // nothing: the model letterboxes internally and expects true proportions.
  for (const [vw, vh, expected] of [
    [640, 480, 240],
    [1280, 720, 180],
    [640, 640, 320],
  ]) {
    const canvas = fakeCanvas();
    drawForObjects({ videoWidth: vw, videoHeight: vh }, canvas);
    assert.equal(canvas.height, expected, `${vw}x${vh}`);
  }
});

test("a camera with no frame yet is skipped rather than scored blank", () => {
  for (const video of [
    { videoWidth: 0, videoHeight: 0 },
    { videoWidth: 640, videoHeight: 0 },
    { videoWidth: 0, videoHeight: 480 },
  ]) {
    const canvas = fakeCanvas();
    assert.equal(drawForObjects(video, canvas), false);
    assert.deepEqual(canvas.drawn, [], "nothing drawn");
  }
});

test("a canvas without a 2d context reports failure instead of throwing", () => {
  const canvas = { width: 0, height: 0, getContext: () => null };
  assert.equal(drawForObjects({ videoWidth: 640, videoHeight: 480 }, canvas), false);
});

test("only watched classes are reported, and only above the threshold", () => {
  assert.equal(watchedObject({ detections: [] }).label, null);
  assert.equal(
    watchedObject({
      detections: [{ categories: [{ categoryName: "laptop", score: 0.99 }] }],
    }).label,
    null,
    "a laptop is the exam machine"
  );
  assert.equal(
    watchedObject({
      detections: [{ categories: [{ categoryName: "cell phone", score: 0.31 }] }],
    }).label,
    null,
    "a low score is a guess"
  );
  const hit = watchedObject({
    detections: [
      { categories: [{ categoryName: "cell phone", score: 0.62 }] },
      { categories: [{ categoryName: "Cell Phone", score: 0.88 }] },
    ],
  });
  assert.equal(hit.label, "cell phone", "matched case-insensitively");
  assert.equal(hit.score, 0.88, "the highest-scoring box wins");
});

test("malformed detector output does not throw", () => {
  assert.equal(watchedObject({ detections: [{}] }).label, null);
  assert.equal(watchedObject({ detections: [{ categories: [{}] }] }).label, null);
  assert.equal(watchedObject({}).label, null);
});
