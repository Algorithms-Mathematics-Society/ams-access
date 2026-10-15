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
