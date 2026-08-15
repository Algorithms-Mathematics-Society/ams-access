import assert from "node:assert/strict";
import test from "node:test";

import { createCameraSession, isTrackUsable } from "./camera-session.ts";

function makeTrack(kind) {
  const handlers = {};
  return {
    kind,
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
    addEventListener(name, fn) {
      (handlers[name] ??= []).push(fn);
    },
    /** Simulate the device disappearing. */
    end() {
      this.readyState = "ended";
      for (const fn of handlers.ended ?? []) fn();
    },
  };
}

function makeDeps() {
  const opens = [];
  const deviceListeners = [];
  const tracks = { video: [], audio: [] };
  const deps = {
    opens,
    tracks,
    fireDeviceChange() {
      for (const fn of deviceListeners) fn();
    },
    /** Set to an Error to make the next getUserMedia reject. */
    failWith: null,
    mediaDevices: {
      async getUserMedia(constraints) {
        opens.push(constraints);
        if (deps.failWith) throw deps.failWith;
        const kind = constraints.audio ? "audio" : "video";
        const track = makeTrack(kind);
        tracks[kind].push(track);
        return {
          getVideoTracks: () => (kind === "video" ? [track] : []),
          getAudioTracks: () => (kind === "audio" ? [track] : []),
        };
      },
      addEventListener(name, fn) {
        if (name === "devicechange") deviceListeners.push(fn);
      },
      removeEventListener(name, fn) {
        const i = deviceListeners.indexOf(fn);
        if (i >= 0) deviceListeners.splice(i, 1);
      },
    },
    createStream: (t) => ({ tracks: t }),
  };
  return deps;
}

test("a live track is usable and an ended one is not", () => {
  assert.equal(isTrackUsable({ readyState: "live" }), true);
  assert.equal(isTrackUsable({ readyState: "ended" }), false);
  assert.equal(isTrackUsable(undefined), false);
});

test("the camera is opened once and reused across the route change", async () => {
  // The whole point. Onboarding opens it, the contest room asks again, and
  // the device is never re-opened — which is what used to fail on webcams
  // that are slow to hand the handle back.
  const deps = makeDeps();
  const session = createCameraSession(deps);

  await session.ensure();
  await session.ensure();

  assert.equal(deps.opens.length, 1);
});

test("asking for audio later adds a track without reopening the camera", async () => {
  // Onboarding wants video only — the microphone has its own stage, with its
  // own prompt, later on. The contest room wants both. Merging the two into
  // one getUserMedia would move the microphone permission prompt forward.
  const deps = makeDeps();
  const session = createCameraSession(deps);

  await session.ensure();
  const stream = await session.ensure({ audio: true });

  assert.equal(deps.opens.length, 2);
  assert.ok(deps.opens[0].video, "the first open is the camera");
  assert.equal(deps.opens[0].audio, undefined, "the camera open must not ask for the microphone");
  assert.equal(deps.opens[1].audio, true, "the second open is the microphone alone");
  assert.equal(stream.tracks.length, 2);
  assert.equal(deps.tracks.video.length, 1, "the camera was not reopened");
});

test("a refused microphone does not cost the candidate their camera", async () => {
  // The microphone stage warns rather than blocks, so a denied prompt here
  // must leave the video stream intact.
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure();

  deps.failWith = new Error("NotAllowedError");
  const stream = await session.ensure({ audio: true });

  assert.equal(stream.tracks.length, 1);
  assert.equal(session.status(), "live");
});

test("an unplugged camera is reported as lost", async () => {
  // Nothing handled `ended` before, so a webcam pulled out mid-scan left the
  // candidate staring at a preview that would never produce another frame.
  const deps = makeDeps();
  const session = createCameraSession(deps);
  const seen = [];
  session.subscribe((s) => seen.push(s));

  await session.ensure();
  deps.tracks.video[0].end();

  assert.deepEqual(seen, ["live", "lost"]);
  assert.equal(session.status(), "lost");
});

test("a lost camera reports no current stream", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure();
  assert.notEqual(session.current(), null);

  deps.tracks.video[0].end();
  assert.equal(session.current(), null);
});

test("ensure() reopens the device after a loss", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure();
  deps.tracks.video[0].end();

  await session.ensure();

  assert.equal(deps.tracks.video.length, 2);
  assert.equal(session.status(), "live");
});

test("a device list change notices a track that died quietly", async () => {
  // A track can stay nominally "live" while its device is gone, so the
  // devicechange event is the more reliable signal of the two.
  const deps = makeDeps();
  const session = createCameraSession(deps);
  const seen = [];
  session.subscribe((s) => seen.push(s));
  await session.ensure();

  deps.tracks.video[0].readyState = "ended"; // died without firing `ended`
  deps.fireDeviceChange();

  assert.equal(session.status(), "lost");
  assert.deepEqual(seen, ["live", "lost"]);
});

test("current() never triggers a permission prompt", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);

  assert.equal(session.current(), null);
  assert.equal(deps.opens.length, 0);
});

test("release stops every track and detaches the device listener", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure({ audio: true });

  session.release();

  assert.equal(deps.tracks.video[0].stopped, true);
  assert.equal(deps.tracks.audio[0].stopped, true);
  assert.equal(session.status(), "idle");
  assert.equal(session.current(), null);
});

test("a throwing subscriber does not stop the others hearing about a loss", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  session.subscribe(() => {
    throw new Error("badly behaved panel");
  });
  const seen = [];
  session.subscribe((s) => seen.push(s));

  await session.ensure();
  deps.tracks.video[0].end();

  assert.deepEqual(seen, ["live", "lost"]);
});

test("unsubscribing stops delivery", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  const seen = [];
  const off = session.subscribe((s) => seen.push(s));

  await session.ensure();
  off();
  deps.tracks.video[0].end();

  assert.deepEqual(seen, ["live"]);
});

test("with no mediaDevices at all, ensure fails rather than hanging", async () => {
  const session = createCameraSession({ mediaDevices: null, createStream: (t) => ({ tracks: t }) });
  await assert.rejects(() => session.ensure(), /not available/i);
});
