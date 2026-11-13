import { test } from "node:test";
import assert from "node:assert/strict";
import { createLinuxVoiceBackend, probeLinuxVoice } from "./team-voice-native.ts";

test("runtime probe gates native backend and events stay in the current session", async () => {
  const previous = globalThis.window;
  let listener;
  const commands = [];
  let unlistened = 0;
  globalThis.window = { __TAURI__: {
    core: { async invoke(command, args) {
      commands.push({ command, args });
      if (command === "linux_voice_probe") return { available: true, backend: "gstreamer", version: "1" };
      if (command === "linux_voice_start") return { session: "s1" };
      return {};
    } },
    event: { async listen(_name, callback) { listener = callback; return () => { unlistened++; }; } },
  } };
  try {
    assert.equal(await probeLinuxVoice(), true);
    const events = [];
    const backend = createLinuxVoiceBackend();
    assert.equal(await backend.start((event) => events.push(event)), "s1");
    listener({ payload: { v: 1, event: "ended", session: "stale" } });
    listener({ payload: { v: 1, event: "state", session: "s1", peer: "p", state: "connected" } });
    assert.equal(events.length, 1);
    await backend.call({ op: "mute", session: "s1", muted: true });
    assert.equal(commands.at(-1).command, "linux_voice_call");
    backend.stop();
    assert.equal(unlistened, 1);
    await Promise.resolve();
    assert.equal(commands.at(-1).command, "linux_voice_stop");
    await assert.rejects(backend.call({ op: "mute", session: "s1", muted: false }));
  } finally {
    globalThis.window = previous;
  }
});

test("an early fatal event rejects startup and stops its helper", async () => {
  const previous = globalThis.window;
  let listener;
  const commands = [];
  globalThis.window = { __TAURI__: {
    core: { async invoke(command) {
      commands.push(command);
      if (command === "linux_voice_start") {
        listener({ payload: { v: 1, event: "ended", session: "early" } });
        return { session: "early" };
      }
      return {};
    } },
    event: { async listen(_name, callback) { listener = callback; return () => {}; } },
  } };
  let backend;
  try {
    const events = [];
    backend = createLinuxVoiceBackend();
    await assert.rejects(backend.start((event) => events.push(event)), /stopped during startup/);
    assert.deepEqual(events, []);
    assert.deepEqual(commands, ["linux_voice_start", "linux_voice_stop"]);
    backend.stop();
  } finally {
    globalThis.window = previous;
  }
});

test("stop runs immediately while an RPC stalls and the next start waits for both", async () => {
  const previous = globalThis.window;
  const commands = [];
  let releaseCall;
  let starts = 0;
  globalThis.window = { __TAURI__: {
    core: { async invoke(command) {
      commands.push(command);
      if (command === "linux_voice_start") return { session: `s${++starts}` };
      if (command === "linux_voice_call") await new Promise((resolve) => { releaseCall = resolve; });
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const first = createLinuxVoiceBackend();
    await first.start(() => {});
    const inFlight = first.call({ op: "mute", session: "s1", muted: true });
    await Promise.resolve();
    first.stop();
    const second = createLinuxVoiceBackend();
    const next = second.start(() => {});
    await Promise.resolve();
    assert.deepEqual(commands, ["linux_voice_start", "linux_voice_call", "linux_voice_stop"]);
    releaseCall();
    await inFlight;
    assert.equal(await next, "s2");
    assert.deepEqual(commands, ["linux_voice_start", "linux_voice_call", "linux_voice_stop", "linux_voice_start"]);
    second.stop();
  } finally {
    globalThis.window = previous;
  }
});

test("calls are serialized, stats coalesce, and stop rejects queued work", async () => {
  const previous = globalThis.window;
  let release;
  let calls = 0;
  globalThis.window = { __TAURI__: {
    core: { async invoke(command) {
      if (command === "linux_voice_start") return { session: "s2" };
      if (command === "linux_voice_call") {
        calls++;
        if (calls === 1) await new Promise((resolve) => { release = resolve; });
        return {};
      }
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const backend = createLinuxVoiceBackend();
    await backend.start(() => {});
    const first = backend.call({ op: "mute", session: "s2", muted: true });
    await Promise.resolve();
    const queued = backend.call({ op: "mute", session: "s2", muted: false });
    assert.equal(await backend.stats("p"), null);
    assert.equal(calls, 1);
    backend.stop();
    release();
    await first;
    await assert.rejects(queued);
    assert.equal(calls, 1);
  } finally {
    globalThis.window = previous;
  }
});

test("native IPC queue has a fixed 32-request limit", async () => {
  const previous = globalThis.window;
  let release;
  globalThis.window = { __TAURI__: {
    core: { async invoke(command) {
      if (command === "linux_voice_start") return { session: "bounded" };
      if (command === "linux_voice_call") await new Promise((resolve) => { release = resolve; });
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const backend = createLinuxVoiceBackend();
    await backend.start(() => {});
    const calls = Array.from({ length: 32 }, () =>
      backend.call({ op: "mute", session: "bounded", muted: true }));
    await Promise.resolve();
    await assert.rejects(backend.call({ op: "mute", session: "bounded", muted: true }), /queue full/);
    backend.stop();
    release();
    const results = await Promise.allSettled(calls);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  } finally {
    globalThis.window = previous;
  }
});

test("local lease heartbeat coalesces, stops cleanly, and ends on renewal failure", async () => {
  const previousWindow = globalThis.window;
  const previousSetInterval = globalThis.setInterval;
  const previousClearInterval = globalThis.clearInterval;
  let tick;
  let cleared = false;
  let rejectRenewal;
  let backend;
  const ops = [];
  globalThis.setInterval = (callback, ms) => {
    assert.equal(ms, 5_000);
    tick = callback;
    return 99;
  };
  globalThis.clearInterval = (id) => {
    assert.equal(id, 99);
    cleared = true;
  };
  globalThis.window = { __TAURI__: {
    core: { async invoke(command, args) {
      if (command === "linux_voice_start") return { session: "lease" };
      if (command === "linux_voice_call") {
        ops.push(args.request.op);
        if (args.request.op === "keepalive")
          return new Promise((_resolve, reject) => { rejectRenewal = reject; });
      }
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const events = [];
    backend = createLinuxVoiceBackend();
    await backend.start((event) => events.push(event));
    tick();
    await Promise.resolve();
    tick();
    await Promise.resolve();
    assert.deepEqual(ops, ["keepalive"]);
    rejectRenewal(new Error("lease rejected"));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(events.map((event) => event.event), ["ended"]);
    backend.stop();
    assert.equal(cleared, true);
    tick();
    await Promise.resolve();
    assert.deepEqual(ops, ["keepalive"]);
  } finally {
    backend?.stop();
    globalThis.window = previousWindow;
    globalThis.setInterval = previousSetInterval;
    globalThis.clearInterval = previousClearInterval;
  }
});

test("a replacement start waits for the previous stop acknowledgement", async () => {
  const previous = globalThis.window;
  let finishStop;
  let starts = 0;
  let stops = 0;
  globalThis.window = { __TAURI__: {
    core: { async invoke(command) {
      if (command === "linux_voice_start") return { session: `s${++starts}` };
      if (command === "linux_voice_stop" && ++stops === 1)
        await new Promise((resolve) => { finishStop = resolve; });
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const first = createLinuxVoiceBackend();
    await first.start(() => {});
    first.stop();
    const second = createLinuxVoiceBackend();
    const replacement = second.start(() => {});
    await Promise.resolve();
    assert.equal(starts, 1);
    finishStop();
    assert.equal(await replacement, "s2");
    second.stop();
  } finally {
    globalThis.window = previous;
  }
});

test("queued work for a replaced peer cannot reach its new incarnation", async () => {
  const previous = globalThis.window;
  let release;
  const ops = [];
  globalThis.window = { __TAURI__: {
    core: { async invoke(command, args) {
      if (command === "linux_voice_start") return { session: "s3" };
      if (command === "linux_voice_call") {
        ops.push(args.request.op);
        if (args.request.op === "mute") await new Promise((resolve) => { release = resolve; });
      }
      return {};
    } },
    event: { async listen() { return () => {}; } },
  } };
  try {
    const backend = createLinuxVoiceBackend();
    await backend.start(() => {});
    const blocking = backend.call({ op: "mute", session: "s3", muted: true });
    await Promise.resolve();
    const old = backend.call({ op: "volume", session: "s3", peer: "p", volume: 0.2 });
    const closing = backend.call({ op: "peer_close", session: "s3", peer: "p" });
    const fresh = backend.call({ op: "peer_create", session: "s3", peer: "p", ice_servers: [], expires_at: 1 });
    release();
    await blocking;
    await assert.rejects(old);
    await closing;
    await fresh;
    assert.deepEqual(ops, ["mute", "peer_close", "peer_create"]);
    backend.stop();
  } finally {
    globalThis.window = previous;
  }
});
