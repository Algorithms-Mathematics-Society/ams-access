import { test } from "node:test";
import assert from "node:assert/strict";
import { withPreferredCamera, setPreferredCamera, preferredCamera } from "./preferred-camera.ts";

function fakeStorage() {
  const map = new Map();
  globalThis.window = globalThis.window ?? {};
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  globalThis.window.localStorage = globalThis.localStorage;
  return map;
}

test("no preference leaves the constraints alone", () => {
  fakeStorage();
  const base = { width: { ideal: 640 } };
  assert.deepEqual(withPreferredCamera(base), base);
});

test("a saved camera is requested by exact identity", () => {
  fakeStorage();
  setPreferredCamera("cam-abc");
  const out = withPreferredCamera({ width: { ideal: 640 } });
  assert.deepEqual(out.deviceId, { exact: "cam-abc" });
  assert.deepEqual(out.width, { ideal: 640 });
});

test("clearing the choice returns to the system default", () => {
  fakeStorage();
  setPreferredCamera("cam-abc");
  setPreferredCamera(null);
  assert.equal(preferredCamera(), null);
  assert.ok(!("deviceId" in withPreferredCamera({})));
});

test("storage that throws is not a reason to fail", () => {
  globalThis.window = globalThis.window ?? {};
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(preferredCamera(), null);
  assert.doesNotThrow(() => setPreferredCamera("x"));
  assert.doesNotThrow(() => withPreferredCamera({}));
});
