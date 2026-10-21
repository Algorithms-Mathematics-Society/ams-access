import assert from "node:assert/strict";
import test from "node:test";

import { createCameraDeviceListing } from "./camera-devices.ts";

const camera = (deviceId, label = "") => ({ kind: "videoinput", deviceId, label });
const microphone = { kind: "audioinput", deviceId: "mic", label: "Mic" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

test("a pending enumeration becomes unavailable at its deadline and ignores a late result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = deferred();
  const states = [];
  const listing = createCameraDeviceListing(
    () => pending.promise,
    (state) => states.push(state),
    4000
  );
  listing.refresh();
  await settle();
  assert.equal(states.at(-1).status, "loading");
  t.mock.timers.tick(4000);
  assert.equal(states.at(-1).status, "unavailable");
  assert.match(states.at(-1).error, /timed out/i);
  pending.resolve([camera("late")]);
  await settle();
  assert.equal(states.at(-1).status, "unavailable");
  assert.equal(
    states.some((state) => state.devices.some((device) => device.deviceId === "late")),
    false
  );
});

test("retry supersedes an old request and publishes only the new camera result", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const states = [];
  const listing = createCameraDeviceListing(
    () => (++calls === 1 ? first.promise : second.promise),
    (state) => states.push(state),
    10_000
  );
  listing.refresh();
  await settle();
  listing.refresh();
  await settle();
  second.resolve([microphone, camera("rgb", "RGB Camera")]);
  await settle();
  assert.equal(states.at(-1).status, "available");
  assert.deepEqual(
    states.at(-1).devices.map((device) => device.deviceId),
    ["rgb"]
  );
  first.resolve([camera("stale", "IR Camera")]);
  await settle();
  assert.deepEqual(
    states.at(-1).devices.map((device) => device.deviceId),
    ["rgb"]
  );
});

test("cancel rejects late publication after owner exit", async () => {
  const pending = deferred();
  const states = [];
  const listing = createCameraDeviceListing(
    () => pending.promise,
    (state) => states.push(state)
  );
  listing.refresh();
  await settle();
  listing.cancel();
  pending.resolve([camera("after-unmount")]);
  await settle();
  assert.deepEqual(
    states.map((state) => state.status),
    ["loading"]
  );
});

test("device errors and camera-free results are distinguishable", async () => {
  const errorStates = [];
  const failed = createCameraDeviceListing(
    async () => {
      throw new Error("portal unavailable");
    },
    (state) => errorStates.push(state)
  );
  failed.refresh();
  await settle();
  assert.equal(errorStates.at(-1).status, "unavailable");
  assert.match(errorStates.at(-1).error, /permission|unavailable/i);

  const emptyStates = [];
  const empty = createCameraDeviceListing(
    async () => [microphone],
    (state) => emptyStates.push(state)
  );
  empty.refresh();
  await settle();
  assert.deepEqual(emptyStates.at(-1), { status: "empty", devices: [], error: null });
});

test("listing preserves blank identifiers as observed camera facts", async () => {
  const states = [];
  const listing = createCameraDeviceListing(
    async () => [camera("", ""), camera("rgb", "RGB Camera")],
    (state) => states.push(state)
  );
  listing.refresh();
  await settle();
  assert.equal(states.at(-1).status, "available");
  assert.deepEqual(
    states.at(-1).devices.map((device) => device.deviceId),
    ["", "rgb"]
  );
});
