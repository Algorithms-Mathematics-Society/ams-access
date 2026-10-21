import assert from "node:assert/strict";
import test from "node:test";

import { CameraTimeoutError } from "../../../lib/camera-readiness.ts";
import { classifyCameraFailure } from "./camera-failure.ts";

test("known browser names outrank conflicting or localized messages", () => {
  const denied = new Error("camera missing");
  denied.name = "NotAllowedError";
  assert.equal(classifyCameraFailure(denied), "denied");

  const busy = new Error("permission denied");
  busy.name = "NotReadableError";
  assert.equal(classifyCameraFailure(busy), "busy");

  const localized = new Error("Zugriff verweigert");
  localized.name = "NotFoundError";
  assert.equal(classifyCameraFailure(localized), "missing");
});

test("DOMException-like objects are classified from their name", () => {
  assert.equal(classifyCameraFailure({ name: "SecurityError", message: "" }), "denied");
  assert.equal(classifyCameraFailure({ name: "DevicesNotFoundError" }), "missing");
  assert.equal(classifyCameraFailure({ name: "TrackStartError" }), "busy");
  assert.equal(classifyCameraFailure({ name: "AbortError" }), "not_ready");
  assert.equal(classifyCameraFailure({ name: "InvalidStateError" }), "not_ready");
});

test("the shared camera timeout error always classifies as timeout", () => {
  const error = new CameraTimeoutError("permission denied while timing out");
  error.name = "NotAllowedError";
  assert.equal(classifyCameraFailure(error), "timeout");
});

test("generic errors retain message fallback and unknown failures are not-ready", () => {
  assert.equal(classifyCameraFailure(new Error("device is busy")), "busy");
  assert.equal(classifyCameraFailure(new Error("operation timed out")), "timeout");
  assert.equal(classifyCameraFailure(new Error("preview decoded no frames")), "not_ready");
  assert.equal(
    classifyCameraFailure({ name: "FutureBrowserError", message: "permission denied" }),
    "not_ready"
  );
  assert.equal(classifyCameraFailure(null), "not_ready");
});
