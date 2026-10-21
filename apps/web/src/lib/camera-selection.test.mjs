import assert from "node:assert/strict";
import test from "node:test";
import {
  browserCameraPreferenceStore,
  CAMERA_PREFERENCE_KEY,
  LEGACY_CAMERA_PREFERENCE_KEY,
  isSavedCameraUnavailable,
  missingCameraGuidance,
} from "./camera-selection.ts";

function withWindow(localStorage, run) {
  const previous = globalThis.window;
  globalThis.window = { localStorage };
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("browser preference persists and reloads a versioned exact id", () => {
  const storage = memoryStorage();
  withWindow(storage, () => {
    browserCameraPreferenceStore().write("camera-b");
    assert.equal(browserCameraPreferenceStore().read(), "camera-b");
    assert.deepEqual(JSON.parse(storage.values.get(CAMERA_PREFERENCE_KEY)), {
      version: 1,
      deviceId: "camera-b",
    });
  });
});

test("legacy picker preference migrates to the versioned exact store", () => {
  const storage = memoryStorage();
  storage.values.set(LEGACY_CAMERA_PREFERENCE_KEY, "camera-b");
  withWindow(storage, () => {
    assert.equal(browserCameraPreferenceStore().read(), "camera-b");
    assert.equal(storage.values.has(LEGACY_CAMERA_PREFERENCE_KEY), false);
    assert.deepEqual(JSON.parse(storage.values.get(CAMERA_PREFERENCE_KEY)), {
      version: 1,
      deviceId: "camera-b",
    });
  });
});

test("malformed, old-version and empty preferences are ignored", () => {
  const storage = memoryStorage();
  withWindow(storage, () => {
    for (const value of [
      "{broken",
      JSON.stringify({ version: 0, deviceId: "camera-b" }),
      JSON.stringify({ version: 1, deviceId: "" }),
    ]) {
      storage.values.set(CAMERA_PREFERENCE_KEY, value);
      assert.equal(browserCameraPreferenceStore().read(), null);
    }
  });
});

test("storage write failures are surfaced before a switch can be claimed saved", () => {
  withWindow(
    {
      getItem: () => null,
      setItem() {
        throw new Error("quota denied");
      },
      removeItem() {
        throw new Error("storage denied");
      },
    },
    () => {
      assert.throws(() => browserCameraPreferenceStore().write("camera-b"), /quota denied/);
      assert.throws(() => browserCameraPreferenceStore().write(null), /storage denied/);
    }
  );
});

test("server-side reads are empty and writes fail explicitly", () => {
  const previous = globalThis.window;
  delete globalThis.window;
  try {
    const store = browserCameraPreferenceStore();
    assert.equal(store.read(), null);
    assert.throws(() => store.write("camera-b"), /storage unavailable/);
  } finally {
    if (previous !== undefined) globalThis.window = previous;
  }
});

test("saved exact camera is missing only after conclusive enumeration", () => {
  assert.equal(isSavedCameraUnavailable("camera-b", "empty", []), true);
  assert.equal(isSavedCameraUnavailable("camera-b", "available", ["camera-a"]), true);
  assert.equal(isSavedCameraUnavailable("camera-b", "available", ["camera-b"]), false);
  assert.equal(isSavedCameraUnavailable("camera-b", "available", []), false);
  assert.equal(isSavedCameraUnavailable("camera-b", "loading", []), false);
  assert.equal(isSavedCameraUnavailable("camera-b", "unavailable", []), false);
  assert.equal(isSavedCameraUnavailable(null, "empty", []), false);
});

test("missing-camera guidance identifies an unavailable exact choice", () => {
  assert.match(missingCameraGuidance(true), /selected camera is unavailable/i);
  assert.match(missingCameraGuidance(true), /choose another camera/i);
  assert.doesNotMatch(missingCameraGuidance(false), /selected camera/i);
});
