import assert from "node:assert/strict";
import test from "node:test";

import { classifyKeyboardOutcome } from "./keyboard-outcome.ts";

test("passes only an active non-Linux control", () => {
  assert.deepEqual(
    classifyKeyboardOutcome({ active: true, method: "ll-keyboard-hook", platform: "windows" }),
    { kind: "control_active", shouldPass: true }
  );
});

test("Linux applied coverage stays advisory because the probe restores it", () => {
  assert.deepEqual(
    classifyKeyboardOutcome({
      active: true,
      method: "gsettings/wayland (12/18 applied)",
      platform: "linux",
    }),
    { kind: "linux_control_checked", shouldPass: false }
  );
});

test("separates detection-only and unsupported Linux outcomes", () => {
  assert.equal(
    classifyKeyboardOutcome({
      active: false,
      method: "x11-detection-only",
      platform: "linux",
    }).kind,
    "detection_only"
  );
  assert.equal(
    classifyKeyboardOutcome({
      active: false,
      method: "cinnamon/unsupported-unverified-adapter (0/0 applied)",
      platform: "linux",
    }).kind,
    "unsupported"
  );
});

test("keeps permission and unavailable outcomes distinct", () => {
  assert.deepEqual(
    classifyKeyboardOutcome({
      active: false,
      method: "input_monitoring_denied",
      platform: "macos",
    }),
    { kind: "permission", permission: "input_monitoring", shouldPass: false }
  );
  assert.deepEqual(classifyKeyboardOutcome(null), {
    kind: "unavailable",
    shouldPass: false,
  });
});
