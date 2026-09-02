// Whether a captured frame is worth sending to the backend validator yet.
//
// The bug: the capture fired the instant BlazeFace locked on, while the
// webcam's auto-exposure was still ramping, and it downscaled 640x480 to
// 320x240 first — which reduces exactly the variance the backend thresholds
// on. So the detector said "that is a face" and the validator said
// "blank_or_uniform_image" about the same frame, twelve times in fourteen
// seconds, and after three the candidate was offered a "contact your proctor"
// button for a camera that was working.

import test from "node:test";
import assert from "node:assert/strict";

import {
  lumaStats,
  decideCapture,
  settlingMessage,
  MIN_STD_DEV,
  MAX_SETTLING_ATTEMPTS,
} from "./face-frame.ts";

/** RGBA buffer where every pixel takes its grey value from `at(i)`. */
function frame(pixels, at) {
  const buf = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const v = at(i);
    buf[i * 4] = v;
    buf[i * 4 + 1] = v;
    buf[i * 4 + 2] = v;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

test("a flat grey frame has no variance", () => {
  const stats = lumaStats(frame(1000, () => 128));
  assert.ok(stats.stdDev < 0.001);
  assert.equal(stats.darkRatio, 0);
});

test("luma uses the same weights as the backend", () => {
  // A pure green pixel is 0.587 * 255. If these drift apart, the client and
  // the validator start disagreeing about the same frame again.
  const buf = new Uint8ClampedArray([0, 255, 0, 255]);
  assert.ok(Math.abs(lumaStats(buf).meanLuma - 0.587 * 255) < 0.5);
});

test("a dark frame is counted as dark", () => {
  assert.equal(lumaStats(frame(1000, () => 5)).darkRatio, 1);
});

test("a high-contrast frame is sent", () => {
  const stats = lumaStats(frame(1000, (i) => (i % 2 ? 240 : 30)));
  assert.ok(stats.stdDev > MIN_STD_DEV);
  assert.deepEqual(decideCapture(stats, 0), { action: "send" });
});

test("a still-settling frame waits instead of being submitted", () => {
  // The heart of it: this must NOT reach the backend, because a backend
  // rejection is what counts toward the proctor-escalation button.
  const stats = lumaStats(frame(1000, () => 120));
  const out = decideCapture(stats, 0);
  assert.equal(out.action, "wait");
  assert.equal(out.reason, "settling");
});

test("a very dark frame waits, and says so", () => {
  const out = decideCapture(lumaStats(frame(1000, () => 4)), 0);
  assert.equal(out.action, "wait");
  assert.equal(out.reason, "too_dark");
  assert.match(settlingMessage(out.reason), /dark/i);
});

test("the warm-up is bounded — a dark room still reaches a human", () => {
  // Silently retrying for ever would strand a candidate in a genuinely dark
  // room with no way to reach anybody. Once the budget is spent the frame goes
  // to the backend and its verdict stands.
  const stats = lumaStats(frame(1000, () => 4));
  assert.equal(decideCapture(stats, MAX_SETTLING_ATTEMPTS - 1).action, "wait");
  assert.equal(decideCapture(stats, MAX_SETTLING_ATTEMPTS).action, "send_anyway");
  assert.equal(decideCapture(stats, MAX_SETTLING_ATTEMPTS + 5).action, "send_anyway");
});

test("a good frame is sent even after the budget is spent", () => {
  const stats = lumaStats(frame(1000, (i) => (i % 2 ? 240 : 30)));
  assert.deepEqual(decideCapture(stats, MAX_SETTLING_ATTEMPTS + 3), { action: "send" });
});

test("an empty buffer is treated as dark rather than dividing by zero", () => {
  const stats = lumaStats(new Uint8ClampedArray(0));
  assert.equal(stats.darkRatio, 1);
  assert.equal(decideCapture(stats, 0).action, "wait");
});

test("the threshold matches the backend's", () => {
  // validate_face_image_bytes rejects std_dev < 15.0 as blank_or_uniform_image.
  // If the backend moves and this does not, the client resumes submitting
  // frames it knows will be refused.
  assert.equal(MIN_STD_DEV, 15);
});
