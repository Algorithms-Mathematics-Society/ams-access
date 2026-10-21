import assert from "node:assert/strict";
import test from "node:test";

import {
  FACE_SCAN_DEADLINE_MS,
  createFaceScanAttempt,
  finishFaceScanAttempt,
  ownsFaceScanAttempt,
  remainingFaceScanMs,
  startFaceScanning,
} from "./face-scan-attempt.ts";

test("the 45 second deadline starts only when scanning becomes available", () => {
  const loading = createFaceScanAttempt(1);
  assert.equal(remainingFaceScanMs(loading, 90_000), null);
  const scanning = startFaceScanning(loading, 1_000);
  assert.equal(scanning.scanStartedAt, 1_000);
  assert.equal(remainingFaceScanMs(scanning, 1_000), FACE_SCAN_DEADLINE_MS);
});

test("intermittent detections cannot restart the monotonic deadline", () => {
  const started = startFaceScanning(createFaceScanAttempt(3), 2_000);
  const afterPoseLoss = startFaceScanning(started, 22_000);
  const afterAnotherDetection = startFaceScanning(afterPoseLoss, 31_000);
  assert.equal(afterPoseLoss, started);
  assert.equal(afterAnotherDetection, started);
  assert.equal(remainingFaceScanMs(afterAnotherDetection, 31_000), 16_000);
});

test("a visibility return recheck observes elapsed monotonic time", () => {
  const started = startFaceScanning(createFaceScanAttempt(4), 10_000);
  // No timer callback is assumed while hidden. The caller rechecks on return.
  assert.equal(remainingFaceScanMs(started, 54_999), 1);
  assert.equal(remainingFaceScanMs(started, 55_000), 0);
  assert.equal(remainingFaceScanMs(started, 80_000), 0);
});

test("success immediately before the deadline wins and becomes terminal", () => {
  const started = startFaceScanning(createFaceScanAttempt(5), 1_000);
  assert.equal(remainingFaceScanMs(started, 45_999), 1);
  const succeeded = finishFaceScanAttempt(started, 5);
  assert.equal(succeeded.terminal, true);
  assert.equal(remainingFaceScanMs(succeeded, 46_000), null);
  assert.equal(ownsFaceScanAttempt(succeeded, 5), false);
});

test("review at the deadline invalidates a validation that finishes late", () => {
  const validating = startFaceScanning(createFaceScanAttempt(6), 500);
  assert.equal(remainingFaceScanMs(validating, 45_500), 0);
  const review = finishFaceScanAttempt(validating, 6);
  // The pending save captured generation 6, but it no longer owns a live attempt.
  assert.equal(ownsFaceScanAttempt(review, 6), false);
  assert.equal(finishFaceScanAttempt(review, 6), review);
});

test("retry generation rejects a stale pass from the previous visit", () => {
  const prior = startFaceScanning(createFaceScanAttempt(7), 0);
  const retry = startFaceScanning(createFaceScanAttempt(8), 10_000);
  assert.equal(ownsFaceScanAttempt(prior, retry.generation), false);
  assert.equal(finishFaceScanAttempt(prior, retry.generation), prior);
  assert.equal(ownsFaceScanAttempt(retry, 8), true);
});

test("finishing with a stale generation cannot terminate the current attempt", () => {
  const current = startFaceScanning(createFaceScanAttempt(12), 3_000);
  const unchanged = finishFaceScanAttempt(current, 11);
  assert.equal(unchanged, current);
  assert.equal(ownsFaceScanAttempt(unchanged, 12), true);
});
