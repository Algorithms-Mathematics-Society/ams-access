import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INTERVAL_MS,
  MIN_PLAUSIBLE_BYTES,
  PHOTO_WIDTH,
  base64Bytes,
  captureFrame,
  isPlausiblePhoto,
  scaledSize,
  stripDataUrl,
} from "./identity-photo.ts";

test("the data-URL prefix is stripped, and a bare payload is left alone", () => {
  assert.equal(stripDataUrl("data:image/jpeg;base64,AAECAw=="), "AAECAw==");
  assert.equal(stripDataUrl("AAECAw=="), "AAECAw==");
});

test("byte length is computed without decoding", () => {
  assert.equal(base64Bytes(""), 0);
  assert.equal(base64Bytes("AAECAw=="), 4);
  assert.equal(base64Bytes("AAEC"), 3);
  // A real payload arrives wrapped; newlines must not inflate the count.
  assert.equal(base64Bytes("AAEC\nAAEC"), 6);
});

test("a frame too small to be a face is rejected", () => {
  // A camera that opened but produced nothing encodes to a few hundred bytes
  // of flat colour. That must not reach an invigilator as evidence.
  assert.equal(isPlausiblePhoto("A".repeat(400)), false);
  assert.equal(isPlausiblePhoto("A".repeat(MIN_PLAUSIBLE_BYTES * 2)), true);
});

test("aspect ratio is preserved and the frame is never upscaled", () => {
  assert.deepEqual(scaledSize(1280, 720), { width: 640, height: 360 });
  // A 320px webcam keeps its own size rather than being blurred up to 640.
  assert.deepEqual(scaledSize(320, 240), { width: 320, height: 240 });
  assert.equal(scaledSize(1920, 1080).width, PHOTO_WIDTH);
});

test("a video with no metadata yet does not produce a zero-sized canvas", () => {
  const size = scaledSize(0, 0);
  assert.ok(size.width > 0 && size.height > 0);
});

test("no video means no photo, and no exception", () => {
  assert.equal(captureFrame(null), null);
});

test("a canvas the browser will not encode yields null rather than throwing", () => {
  const video = { videoWidth: 1280, videoHeight: 720 };
  const brokenCanvas = () => ({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toDataURL() {
      throw new Error("tainted canvas");
    },
  });
  assert.equal(captureFrame(video, brokenCanvas), null);
});

test("a context the browser refuses to give is not fatal", () => {
  const video = { videoWidth: 640, videoHeight: 480 };
  const noContext = () => ({ width: 0, height: 0, getContext: () => null });
  assert.equal(captureFrame(video, noContext), null);
});

test("a good frame comes back as bare base64 at the scaled size", () => {
  const video = { videoWidth: 1280, videoHeight: 720 };
  let drawn = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage(_source, _x, _y, w, h) {
        drawn = { w, h };
      },
    }),
    toDataURL: () => `data:image/jpeg;base64,${"A".repeat(MIN_PLAUSIBLE_BYTES * 2)}`,
  };
  const out = captureFrame(video, () => canvas);
  assert.ok(out && !out.startsWith("data:"));
  assert.deepEqual(drawn, { w: 640, h: 360 });
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
});

test("an empty frame is dropped even though encoding succeeded", () => {
  const video = { videoWidth: 640, videoHeight: 480 };
  const blank = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    // A black 640x480 JPEG really is this small.
    toDataURL: () => "data:image/jpeg;base64,AAECAw==",
  };
  assert.equal(captureFrame(video, () => blank), null);
});

test("the capture interval is short enough to catch a swap, long enough not to film", () => {
  // Thirty minutes over a three-hour paper is seven frames: a strip a
  // human reads in one glance, and a gap too short to swap seats inside.
  assert.equal(INTERVAL_MS, 30 * 60 * 1000);
  const threeHourPaper = Math.floor((3 * 60 * 60 * 1000) / INTERVAL_MS);
  assert.equal(threeHourPaper, 6);
});
