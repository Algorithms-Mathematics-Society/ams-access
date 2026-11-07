import test from "node:test";
import assert from "node:assert/strict";
import {
  readVoiceTeam,
  readVoiceCredentials,
  voicePollDelay,
  pollVoiceTeam,
  acquireVoiceMicrophone,
  TeamVoiceApiError,
  resumeVoiceAfterPollFailure,
} from "./team-voice-api.ts";
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const team = {
  team: { uid: "team", name: "Team" },
  members: [],
  phase: { voice_open: true, name: "running" },
};

test("team reads distinguish solo, unpublished, unknown404 and preserve conditional auth headers", async () => {
  let init;
  const read = (response, etag) =>
    readVoiceTeam(
      "https://api.test/",
      "contest/id",
      { Authorization: "Bearer private" },
      new AbortController().signal,
      etag,
      async (url, options) => {
        assert.equal(url, "https://api.test/participant/contests/contest%2Fid/team");
        init = options;
        return response;
      }
    );
  assert.deepEqual(
    await read(Response.json({ detail: "this contest is not a team round" }, { status: 404 })),
    { kind: "solo" }
  );
  assert.deepEqual(
    await read(Response.json({ detail: "teams have not been published yet" }, { status: 404 })),
    { kind: "unpublished" }
  );
  await assert.rejects(
    read(Response.json({ detail: "contest not found" }, { status: 404 })),
    /404/
  );
  assert.deepEqual(await read(new Response(null, { status: 304 }), '"revision"'), {
    kind: "unchanged",
  });
  assert.equal(init.headers["If-None-Match"], '"revision"');
  assert.equal(init.headers.Authorization, "Bearer private");
  assert.equal(init.cache, "no-store");
  assert.equal((await read(Response.json(team, { headers: { ETag: '"next"' } }))).etag, '"next"');
});

test("visible polls jitter between3 and5 seconds; hidden polls back off to15 seconds", () => {
  assert.equal(
    voicePollDelay(false, () => 0),
    3000
  );
  assert.equal(
    voicePollDelay(false, () => 1),
    5000
  );
  assert.equal(voicePollDelay(true), 15000);
});

test("polling never overlaps and solo classification ends requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let resolveRead,
    calls = 0;
  const received = [];
  const stop = pollVoiceTeam({
    read: () => {
      calls++;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    onRead: (result) => received.push(result),
    onError: () => assert.fail("unexpected error"),
    hidden: () => false,
    random: () => 0,
  });
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls, 1);
  resolveRead({ kind: "solo" });
  await flush();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(received.length, 1);
  stop();
});

test("unpublished teams keep polling; ETag304 keeps snapshot and failures force a full refresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const tags = [],
    received = [];
  let calls = 0;
  const results = [
    { kind: "unpublished" },
    { kind: "team", team, etag: "tag" },
    { kind: "unchanged" },
    new Error("offline"),
    { kind: "team", team, etag: "next" },
  ];
  const stop = pollVoiceTeam({
    read: async (_signal, etag) => {
      tags.push(etag);
      const next = results[calls++];
      if (next instanceof Error) throw next;
      return next;
    },
    onRead: (result) => received.push(result),
    onError: () => {},
    hidden: () => true,
  });
  await flush();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(15000);
    await flush();
  }
  assert.deepEqual(tags, [null, null, "tag", "tag", null]);
  assert.equal(received[0].kind, "unpublished");
  stop();
});

test("stop aborts pending HTTP and discards late responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal, resolveRead;
  const stop = pollVoiceTeam({
    read: (value) => {
      signal = value;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    },
    onRead: () => assert.fail("stale response"),
    onError: () => assert.fail("stale error"),
    hidden: () => false,
  });
  stop();
  assert.equal(signal.aborted, true);
  resolveRead({ kind: "team", team, etag: null });
  await flush();
  t.mock.timers.tick(60000);
  await flush();
});

test("credentials use supplied current auth headers and abort signal without token URL", async () => {
  const controller = new AbortController();
  const value = await readVoiceCredentials(
    "https://api.test",
    "contest",
    { Authorization: "Bearer private", "X-AMS-Client-Version": "5" },
    controller.signal,
    async (url, init) => {
      assert.equal(url.includes("private"), false);
      assert.equal(init.headers["X-AMS-Client-Version"], "5");
      assert.equal(init.signal, controller.signal);
      return Response.json({ ice_servers: [], expires_at: 100 });
    }
  );
  assert.equal(value.expires_at, 100);
});

test("shared microphone is cloned; fallback explicitly requests audio without camera", async (t) => {
  const originalMediaStream = globalThis.MediaStream;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  t.after(() => {
    globalThis.MediaStream = originalMediaStream;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
  });
  let originalStops = 0,
    cloneStops = 0;
  const clone = {
    stop() {
      cloneStops++;
    },
  };
  let cloned = 0;
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  const owned = await acquireVoiceMicrophone({
    getAudioTracks: () => [
      {
        readyState: "live",
        enabled: false,
        stop: () => {
          originalStops++;
        },
        clone: () => {
          cloned++;
          return clone;
        },
      },
    ],
  });
  assert.deepEqual(owned.tracks, [clone]);
  assert.equal(cloned, 1);
  owned.tracks.forEach((track) => track.stop());
  assert.equal(originalStops, 0);
  assert.equal(cloneStops, 1);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (constraints) => {
          assert.equal(constraints.video, false);
          assert.equal(constraints.audio.echoCancellation, true);
          return "owned audio";
        },
      },
    },
  });
  assert.equal(await acquireVoiceMicrophone(null), "owned audio");
});

test("poll failures preserve only a previously active connection intent and auth failures are terminal", async (t) => {
  assert.equal(resumeVoiceAfterPollFailure(false, "connected", new Error("offline")), true);
  assert.equal(resumeVoiceAfterPollFailure(true, undefined, new Error("still offline")), true);
  for (const status of ["closed", "replaced", "unavailable", "idle", undefined])
    assert.equal(resumeVoiceAfterPollFailure(false, status, new Error("offline")), false);
  assert.equal(resumeVoiceAfterPollFailure(true, "connected", new TeamVoiceApiError(401)), false);
  assert.equal(resumeVoiceAfterPollFailure(true, "connected", new TeamVoiceApiError(403)), false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0,
    errors = 0;
  const stop = pollVoiceTeam({
    read: async () => {
      calls++;
      throw new TeamVoiceApiError(401);
    },
    onRead: () => assert.fail(),
    onError: () => {
      errors++;
    },
    hidden: () => false,
  });
  await flush();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(errors, 1);
  stop();
});
