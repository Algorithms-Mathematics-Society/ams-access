import assert from "node:assert/strict";
import test from "node:test";

import { createCameraSession, isTrackDelivering, isTrackUsable } from "./camera-session.ts";

function makeTrack(kind) {
  const handlers = {};
  return {
    kind,
    readyState: "live",
    muted: false,
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
    /** Claimed by another app, lid closed, privacy shutter: still "live". */
    mute() {
      this.muted = true;
      for (const fn of handlers.mute ?? []) fn();
    },
    unmute() {
      this.muted = false;
      for (const fn of handlers.unmute ?? []) fn();
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
    deviceListeners,
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
          getTracks: () => [track],
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function controlledDeps() {
  const deps = makeDeps();
  const grants = [];
  deps.mediaDevices.getUserMedia = (constraints) => {
    deps.opens.push(constraints);
    const grant = deferred();
    grants.push(grant);
    return grant.promise;
  };
  return { deps, grants };
}

function granted(...tracks) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
  };
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

test("concurrent callers share the video open in either order", async () => {
  for (const audioFirst of [false, true]) {
    const { deps, grants } = controlledDeps();
    const session = createCameraSession(deps);
    const first = session.ensure({ audio: audioFirst });
    const second = session.ensure({ audio: !audioFirst });
    assert.equal(deps.opens.length, 1);
    assert.equal(deps.opens[0].audio, undefined);
    const video = makeTrack("video");
    grants[0].resolve(granted(video));
    await new Promise(setImmediate);
    assert.equal(deps.opens.length, 2, "only the audio caller requests a microphone");
    assert.equal(deps.opens[1].audio, true);
    const audio = makeTrack("audio");
    grants[1].resolve(granted(audio));
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(one.tracks, audioFirst ? [video, audio] : [video]);
    assert.deepEqual(two.tracks, audioFirst ? [video] : [video, audio]);
    assert.equal(video.stopped, false);
  }
});

test("concurrent audio callers share one microphone open", async () => {
  const { deps, grants } = controlledDeps();
  const session = createCameraSession(deps);
  const video = makeTrack("video");

  const first = session.ensure({ audio: true });
  const second = session.ensure({ audio: true });
  grants[0].resolve(granted(video));
  await new Promise(setImmediate);
  assert.equal(deps.opens.length, 2);
  const audio = makeTrack("audio");
  grants[1].resolve(granted(audio));
  const streams = await Promise.all([first, second]);
  assert.deepEqual(
    streams.map((stream) => stream.tracks),
    [
      [video, audio],
      [video, audio],
    ]
  );
  assert.equal(deps.opens.length, 2);
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

test("release before video grant stops old tracks without disturbing a new open", async () => {
  for (const oldFirst of [false, true]) {
    const { deps, grants } = controlledDeps();
    const session = createCameraSession(deps);
    const old = session.ensure();
    session.release();
    const next = session.ensure();
    assert.equal(deps.opens.length, 2);
    assert.equal(deps.deviceListeners.length, 1);
    const stale = makeTrack("video");
    const extra = makeTrack("audio");
    const fresh = makeTrack("video");
    if (oldFirst) grants[0].resolve(granted(stale, extra));
    else grants[1].resolve(granted(fresh));
    if (oldFirst) grants[1].resolve(granted(fresh));
    else grants[0].resolve(granted(stale, extra));
    await assert.rejects(old, /released/);
    assert.deepEqual((await next).tracks, [fresh]);
    assert.equal(stale.stopped, true);
    assert.equal(extra.stopped, true);
    assert.equal(fresh.stopped, false);
    assert.deepEqual(session.current().tracks, [fresh]);
    session.release();
    assert.equal(deps.deviceListeners.length, 0);
  }
});

test("release before audio grant stops it without affecting a new generation", async () => {
  for (const oldFirst of [false, true]) {
    const { deps, grants } = controlledDeps();
    const session = createCameraSession(deps);
    const first = session.ensure({ audio: true });
    const oldVideo = makeTrack("video");
    grants[0].resolve(granted(oldVideo));
    await new Promise(setImmediate);
    session.release();
    const next = session.ensure({ audio: true });
    const newVideo = makeTrack("video");
    grants[2].resolve(granted(newVideo));
    await new Promise(setImmediate);
    const oldAudio = makeTrack("audio");
    const newAudio = makeTrack("audio");
    if (oldFirst) grants[1].resolve(granted(oldAudio));
    else grants[3].resolve(granted(newAudio));
    if (oldFirst) grants[3].resolve(granted(newAudio));
    else grants[1].resolve(granted(oldAudio));
    await assert.rejects(first, /released/);
    assert.deepEqual((await next).tracks, [newVideo, newAudio]);
    assert.equal(oldVideo.stopped, true);
    assert.equal(oldAudio.stopped, true);
    assert.equal(newAudio.stopped, false);
  }
});

test("failed opens can be retried, including advisory audio", async () => {
  const { deps, grants } = controlledDeps();
  const session = createCameraSession(deps);
  const first = session.ensure();
  const second = session.ensure();
  grants[0].reject(new Error("NotReadableError"));
  await assert.rejects(first, /NotReadableError/);
  await assert.rejects(second, /NotReadableError/);
  const retry = session.ensure({ audio: true });
  const video = makeTrack("video");
  grants[1].resolve(granted(video));
  await new Promise(setImmediate);
  grants[2].reject(new Error("NotAllowedError"));
  assert.deepEqual((await retry).tracks, [video]);
  const audioRetry = session.ensure({ audio: true });
  const audio = makeTrack("audio");
  grants[3].resolve(granted(audio));
  assert.deepEqual((await audioRetry).tracks, [video, audio]);
  assert.equal(deps.opens.length, 4);
});

test("missing tracks and unexpected tracks are stopped", async () => {
  const { deps, grants } = controlledDeps();
  const session = createCameraSession(deps);
  const first = session.ensure();
  const unexpected = makeTrack("audio");
  grants[0].resolve(granted(unexpected));
  await assert.rejects(first, /without a video track/);
  assert.equal(unexpected.stopped, true);
  const retry = session.ensure({ audio: true });
  const video = makeTrack("video");
  const extra = makeTrack("video");
  grants[1].resolve(granted(video, extra));
  await new Promise(setImmediate);
  const wrong = makeTrack("video");
  grants[2].resolve(granted(wrong));
  assert.deepEqual((await retry).tracks, [video]);
  assert.equal(extra.stopped, true);
  assert.equal(wrong.stopped, true);
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

// ── #113: replug, and a camera that stops delivering ──────────────────────

test("a muted track is not a working camera", () => {
  // `readyState` alone said yes to this, which is the whole bug: the device
  // was claimed by another application and every check agreed it was fine.
  assert.equal(isTrackUsable({ readyState: "live", muted: true }), true);
  assert.equal(isTrackDelivering({ readyState: "live", muted: true }), false);
  assert.equal(isTrackDelivering({ readyState: "live", muted: false }), true);
  assert.equal(isTrackDelivering({ readyState: "ended", muted: false }), false);
  assert.equal(isTrackDelivering(undefined), false);
});

test("muting the camera is announced as a loss, and unmuting as a recovery", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  const seen = [];
  session.subscribe((status) => seen.push(status));

  await session.ensure();
  assert.equal(session.status(), "live");

  deps.tracks.video[0].mute();
  assert.equal(session.status(), "lost", "a frozen picture is not a healthy camera");
  assert.equal(session.current(), null, "nothing should be handed out while muted");

  deps.tracks.video[0].unmute();
  assert.equal(session.status(), "live");
  assert.deepEqual(seen, ["live", "lost", "live"]);
});

test("replugging the camera brings monitoring back without a reload", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure();

  // Unplugged. The track ends and is cleared, which is what left the old
  // `reassess` with nothing to look at.
  deps.tracks.video[0].end();
  assert.equal(session.status(), "lost");

  // Plugged back in: the device list changes.
  deps.fireDeviceChange();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(session.status(), "live", "the camera came back on its own");
  assert.equal(deps.opens.length, 2, "exactly one reopen, not a storm");
});

test("a device change while the camera is still absent leaves it lost", async () => {
  const deps = makeDeps();
  const session = createCameraSession(deps);
  await session.ensure();
  deps.tracks.video[0].end();

  deps.failWith = new Error("NotFoundError");
  deps.fireDeviceChange();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(session.status(), "lost", "a failed reopen changes nothing");
});
