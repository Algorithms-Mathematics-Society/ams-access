import { test } from "node:test";
import assert from "node:assert/strict";
import { createTeamVoiceSession } from "./team-voice-engine.ts";
const turn = {
  ice_servers: [{ urls: ["turn:relay.test:3478"], username: "u", credential: "c" }],
  expires_at: 3600,
};
function harness(extra = {}) {
  let now = 0,
    next = 0;
  const timers = new Map(),
    sockets = [],
    pcs = [],
    tracks = [];
  function track() {
    const t = {
      kind: "audio",
      enabled: true,
      stops: 0,
      stop() {
        this.stops++;
      },
    };
    tracks.push(t);
    return t;
  }
  const stream = (ts) => ({
    getTracks: () => ts,
    getAudioTracks: () => ts.filter((t) => t.kind === "audio"),
  });
  class PC {
    signalingState = "stable";
    connectionState = "new";
    remoteDescription = null;
    localDescription = null;
    candidates = [];
    configs = [];
    closed = false;
    constructor(config) {
      this.configs.push(config);
      pcs.push(this);
    }
    addTrack() {
      return {
        getParameters: () => ({}),
        setParameters: async (p) => {
          this.parameters = p;
        },
      };
    }
    async setLocalDescription() {
      this.localDescription = {
        type: this.remoteDescription?.type === "offer" ? "answer" : "offer",
        sdp: "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        toJSON() {
          return { type: this.type, sdp: this.sdp };
        },
      };
    }
    async setRemoteDescription(value) {
      this.remoteDescription = value;
      this.signalingState = value.type === "offer" ? "have-remote-offer" : "stable";
    }
    async addIceCandidate(value) {
      this.candidates.push(value);
    }
    setConfiguration(config) {
      this.configs.push(config);
    }
    async getStats() {
      return new Map();
    }
    close() {
      this.closed = true;
    }
  }
  const deps = {
    socket(url) {
      const s = {
        url,
        readyState: 1,
        bufferedAmount: 0,
        sent: [],
        send(raw) {
          this.sent.push(JSON.parse(raw));
          if (JSON.parse(raw).type === "ping" && this.autoPong)
            this.onmessage?.({ data: '{\"type\":\"pong\"}' });
        },
        close() {
          this.closed = true;
        },
      };
      sockets.push(s);
      return s;
    },
    rtc: (config) => new PC(config),
    audio: () => ({ play: async () => {}, pause() {}, setSinkId: async () => {} }),
    stream,
    now: () => now,
    random: () => 0,
    timeout(cb, ms) {
      const id = ++next;
      timers.set(id, { cb, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch: async () => ({ ok: true, json: async () => turn }),
  };
  const session = createTeamVoiceSession({
    contestUid: "contest",
    apiBase: "https://api.test",
    token: "secret",
    acquireMicrophone: async () => stream([track()]),
    deps,
    ...extra,
  });
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  async function tick(ms) {
    const end = now + ms;
    while (true) {
      const first = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      now = first[1].at;
      timers.delete(first[0]);
      first[1].cb();
      await flush();
    }
    now = end;
    await flush();
  }
  function message(value) {
    sockets.at(-1).onmessage?.({ data: JSON.stringify(value) });
  }
  async function welcome(me = "a", count = 1) {
    await session.start();
    message({
      type: "welcome",
      me,
      peers: Array.from({ length: count }, (_, i) => ({
        member_uid: `peer${i}`,
        display_name: "Peer",
      })),
      ...turn,
    });
    await flush();
  }
  return { session, timers, sockets, pcs, tracks, stream, track, message, welcome, tick, flush };
}
test("relay only, four peers, audio bitrate and immediate owned mute cleanup", async () => {
  const h = harness();
  await h.welcome("a", 9);
  assert.equal(h.pcs.length, 4);
  assert.equal(h.session.getSnapshot().peers.length, 4);
  for (const pc of h.pcs) {
    assert.equal(pc.configs[0].iceTransportPolicy, "relay");
    assert.equal(pc.parameters.encodings[0].maxBitrate, 32000);
  }
  assert.equal(h.tracks[0].enabled, false);
  h.session.setMuted(false);
  assert.equal(h.tracks[0].enabled, true);
  h.session.setMemberVolume("peer0", 0.3);
  assert.equal(h.session.getSnapshot().peers[0].volume, 0.3);
  h.session.stop();
  assert.equal(h.tracks[0].stops, 1);
  assert.equal(h.timers.size, 0);
  assert.ok(h.pcs.every((pc) => pc.closed));
});
test("missing TURN cannot silently enable direct traffic", async () => {
  const h = harness();
  await h.session.start();
  h.message({
    type: "welcome",
    me: "a",
    peers: [],
    ice_servers: [{ urls: "stun:example.test" }],
    expires_at: 3600,
  });
  assert.equal(h.session.getSnapshot().status, "unavailable");
  assert.equal(h.timers.size, 0);
});
test("replacement event and every application 44xx close are terminal", async () => {
  for (const code of [4401, 4403, 4410, 4411, 4499]) {
    const h = harness();
    await h.welcome();
    h.sockets[0].onclose({ code });
    await h.tick(100000);
    assert.equal(h.sockets.length, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.session.getSnapshot().status, code === 4411 ? "replaced" : "closed");
  }
  const h = harness();
  await h.welcome();
  h.message({ type: "replaced" });
  await h.tick(100000);
  assert.equal(h.session.getSnapshot().status, "replaced");
  assert.equal(h.sockets.length, 1);
});
test("late owned acquisition is stopped after exit without resurrecting socket", async () => {
  let resolve;
  const h = harness({
    acquireMicrophone: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const starting = h.session.start();
  await h.flush();
  h.session.stop();
  const track = h.track();
  resolve(h.stream([track]));
  await starting;
  assert.equal(track.stops, 1);
  assert.equal(h.sockets.length, 0);
});
test("permission denial is unavailable and cleans timers", async () => {
  const h = harness({
    acquireMicrophone: async () => {
      throw new Error("denied");
    },
  });
  await h.session.start();
  assert.equal(h.session.getSnapshot().status, "unavailable");
  assert.equal(h.timers.size, 0);
});
test("finite reconnect budget and jittered bounded delays", async () => {
  const h = harness();
  await h.welcome();
  for (let i = 0; i < 6; i++) {
    h.sockets.at(-1).onclose({ code: 1006 });
    await h.tick(Math.min(30000, 1000 * 2 ** i) * 0.8);
    h.message({ type: "welcome", me: "a", peers: [], ...turn });
    await h.flush();
  }
  h.sockets.at(-1).onclose({ code: 1006 });
  assert.equal(h.session.getSnapshot().status, "unavailable");
  assert.equal(h.sockets.length, 7);
  assert.equal(h.timers.size, 0);
});
test("glare ignores impolite collision; polite peer accepts offer", async () => {
  for (const me of ["a", "z"]) {
    const h = harness();
    await h.welcome(me);
    h.pcs[0].signalingState = "have-local-offer";
    h.message({
      type: "signal",
      from: "peer0",
      kind: "offer",
      data: { type: "offer", sdp: "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
    });
    await h.flush();
    assert.equal(Boolean(h.pcs[0].remoteDescription), me === "a");
    h.session.stop();
  }
});
test("malformed and excessive ICE/SDP cannot grow candidate queue or peers", async () => {
  const h = harness();
  await h.welcome();
  h.message({
    type: "signal",
    from: "unknown",
    kind: "offer",
    data: { type: "offer", sdp: "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
  });
  h.message({
    type: "signal",
    from: "peer0",
    kind: "offer",
    data: { type: "answer", sdp: "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
  });
  h.message({
    type: "signal",
    from: "peer0",
    kind: "offer",
    data: { type: "offer", sdp: "x".repeat(50000) },
  });
  for (let i = 0; i < 200; i++)
    h.message({
      type: "signal",
      from: "peer0",
      kind: "ice",
      data: { candidate: "candidate:test" },
    });
  await h.flush();
  h.message({
    type: "signal",
    from: "peer0",
    kind: "offer",
    data: { type: "offer", sdp: "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" },
  });
  await h.flush();
  assert.ok(h.pcs[0].candidates.length <= 64);
  assert.equal(h.pcs.length, 1);
  h.session.stop();
});
test("contest capped credentials remain usable until expiry without refresh polling", async () => {
  let calls = 0;
  const h = harness({
    refreshCredentials: async () => {
      calls++;
      return turn;
    },
  });
  await h.welcome();
  h.sockets[0].autoPong = true;
  await h.tick(3540000);
  assert.equal(calls, 1);
  assert.equal(h.session.getSnapshot().status, "connected");
  await h.tick(60000);
  assert.equal(h.session.getSnapshot().status, "unavailable");
  assert.equal(h.timers.size, 0);
});
test("heartbeat every25 seconds and missing pong causes finite reconnect", async () => {
  const h = harness();
  await h.welcome();
  await h.tick(25000);
  assert.ok(h.sockets[0].sent.some((m) => m.type === "ping"));
  await h.tick(51000);
  assert.equal(h.sockets.length, 2);
  h.session.stop();
});

test("peer-joined replaces an existing member connection without a peer-left", async () => {
  const h = harness();
  await h.welcome();
  const old = h.pcs[0];
  h.message({ type: "peer-joined", member_uid: "peer0", display_name: "Peer again" });
  await h.flush();
  assert.equal(old.closed, true);
  assert.equal(h.pcs.length, 2);
  assert.equal(h.session.getSnapshot().peers.length, 1);
  h.session.stop();
});

test("rejects video, data and multiple audio sections before RTC allocation", async () => {
  const h = harness();
  await h.welcome();
  for (const sdp of [
    "m=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  ])
    h.message({ type: "signal", from: "peer0", kind: "offer", data: { type: "offer", sdp } });
  await h.flush();
  assert.equal(h.pcs[0].remoteDescription, null);
  h.session.stop();
});

test("global signaling pacer bounds four-peer ICE bursts below server rate", async () => {
  const h = harness();
  await h.welcome("a", 4);
  for (const pc of h.pcs)
    for (let i = 0; i < 100; i++)
      pc.onicecandidate({ candidate: { toJSON: () => ({ candidate: "candidate:relay" }) } });
  await h.tick(1000);
  assert.ok(h.sockets[0].sent.length <= 11);
  await h.tick(14000);
  assert.ok(h.sockets[0].sent.length <= 129);
  h.session.stop();
  assert.equal(h.timers.size, 0);
});
test("microphone timeout releases a late owned clone", async () => {
  let resolve;
  const h = harness({
    acquireMicrophone: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const starting = h.session.start();
  await h.flush();
  await h.tick(10000);
  assert.equal(h.session.getSnapshot().status, "unavailable");
  const track = h.track();
  resolve(h.stream([track]));
  await starting;
  assert.equal(track.stops, 1);
  assert.equal(h.sockets.length, 0);
});

test("owned microphone ending surfaces unavailable and releases the session", async () => {
  const h = harness();
  await h.welcome();
  h.tracks[0].onended();
  assert.equal(h.session.getSnapshot().status, "unavailable");
  assert.equal(h.tracks[0].onended, null);
  assert.equal(h.timers.size, 0);
  assert.equal(h.pcs[0].closed, true);
});

test("queued SDP and ICE cannot reach a replacement with the same member uid", async () => {
  const h = harness();
  await h.welcome();
  const old = h.pcs[0];
  old.onicecandidate({ candidate: { toJSON: () => ({ candidate: "obsolete-ice" }) } });
  old.onnegotiationneeded();
  await h.flush();
  assert.equal(h.sockets[0].sent.filter((m) => m.type === "signal").length, 0);
  h.message({ type: "peer-joined", member_uid: "peer0", display_name: "Replacement" });
  await h.flush();
  h.pcs[1].onicecandidate({ candidate: { toJSON: () => ({ candidate: "replacement-ice" }) } });
  await h.tick(500);
  const signals = h.sockets[0].sent.filter((m) => m.type === "signal");
  assert.deepEqual(
    signals.map((m) => m.data.candidate),
    ["replacement-ice"]
  );
  assert.equal(old.closed, true);
  assert.equal(h.pcs[1].closed, false);
  h.session.stop();
});
