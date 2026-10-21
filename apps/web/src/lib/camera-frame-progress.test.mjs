import assert from "node:assert/strict";
import test from "node:test";
import { watchCameraFrameProgress } from "./camera-frame-progress.ts";

function fixture() {
  let now = 0;
  let tick = () => {};
  let cleared = false;
  const track = { muted: false, readyState: "live" };
  const video = {
    currentTime: 0,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    srcObject: { getVideoTracks: () => [track] },
  };
  const seen = [];
  const stop = watchCameraFrameProgress(video, (value) => seen.push(value), {
    now: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 7;
    },
    clearInterval: (timer) => {
      assert.equal(timer, 7);
      cleared = true;
    },
  });
  return {
    video,
    track,
    seen,
    advance(ms) {
      now += ms;
      tick();
    },
    stop,
    wasCleared: () => cleared,
  };
}

test("warns after five seconds without a decoded frame", () => {
  const f = fixture();
  f.advance(4999);
  assert.deepEqual(f.seen, []);
  f.advance(1);
  assert.deepEqual(f.seen, [true]);
});

test("decoded currentTime progress clears a sustained stall", () => {
  const f = fixture();
  f.advance(5000);
  f.video.readyState = 2;
  f.video.videoWidth = 640;
  f.video.videoHeight = 480;
  f.video.currentTime = 0.1;
  f.advance(500);
  assert.deepEqual(f.seen, [true, false]);
});

test("dimensions without advancing currentTime remain stalled", () => {
  const f = fixture();
  f.video.readyState = 2;
  f.video.videoWidth = 640;
  f.video.videoHeight = 480;
  f.advance(5000);
  assert.deepEqual(f.seen, [true]);
});

test("muted tracks do not count as frame progress", () => {
  const f = fixture();
  f.video.readyState = 2;
  f.video.videoWidth = 640;
  f.video.videoHeight = 480;
  f.track.muted = true;
  f.video.currentTime = 1;
  f.advance(5000);
  assert.deepEqual(f.seen, [true]);
});

test("cleanup cancels the watcher", () => {
  const f = fixture();
  f.stop();
  assert.equal(f.wasCleared(), true);
});
