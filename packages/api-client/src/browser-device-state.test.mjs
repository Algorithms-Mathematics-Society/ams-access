import test from "node:test";
import assert from "node:assert/strict";

import { browserDeviceState, hasNativeBridge } from "./index.ts";

// Running outside the Tauri shell must never make an unsupervised machine look
// supervised. Every field the native layer owns stays null, which the
// readiness evaluator reads as "not probed" rather than "probed and passed".

test("every native-only field is null, not a passing value", () => {
  const state = browserDeviceState({ cameraAvailable: true, microphoneAvailable: true });
  assert.equal(state.keyboard, null, "keyboard lockdown must not look engaged");
  assert.equal(state.virtualization, null, "VM detection must not look clear");
  assert.equal(state.restricted_processes, null, "a process scan must not look clean");
  assert.equal(state.network, null);
  assert.equal(state.network_helper_ready, null, "egress must not look restricted");
});

test("camera and microphone are real, because the browser knows them", () => {
  const state = browserDeviceState({ cameraAvailable: true, microphoneAvailable: false });
  assert.equal(state.camera_available, true);
  assert.equal(state.microphone_available, false);
});

test("a packaged build is detected and never takes the browser path", () => {
  assert.equal(hasNativeBridge({ __TAURI__: { core: { invoke: () => {} } } }), true);
  assert.equal(hasNativeBridge({}), false);
});
