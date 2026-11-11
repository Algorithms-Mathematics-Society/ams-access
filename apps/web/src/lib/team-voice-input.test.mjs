import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoiceInputMeter, createVoiceAutoJoinGate } from "./team-voice-input.ts";
test("automatic join occurs once across polls, failures and leave until identity reset", () => {
  const gate = createVoiceAutoJoinGate();
  assert.equal(gate.take(false), false);
  assert.equal(gate.take(true), true);
  for (let i = 0; i < 100; i++) assert.equal(gate.take(true), false);
  assert.equal(gate.take(false), false);
  assert.equal(gate.take(true), false);
  gate.reset();
  assert.equal(gate.take(true), true);
});
test("meter samples local enabled clone without enabling transmitted track, and cleans up", () => {
  const previousContext = globalThis.AudioContext,
    previousStream = globalThis.MediaStream;
  let stopped = 0,
    closed = 0,
    disconnected = 0,
    connectedTo;
  const clone = {
    enabled: false,
    stop() {
      stopped++;
    },
  };
  const transmitted = { enabled: false, clone: () => clone };
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(samples) {
      samples.fill(0.1);
    },
    disconnect() {
      disconnected++;
    },
  };
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
    getAudioTracks() {
      return this.tracks;
    }
    getTracks() {
      return this.tracks;
    }
  };
  globalThis.AudioContext = class {
    state = "running";
    createMediaStreamSource(stream) {
      assert.equal(stream.getTracks()[0], clone);
      return {
        connect(target) {
          connectedTo = target;
        },
        disconnect() {
          disconnected++;
        },
      };
    }
    createAnalyser() {
      return analyser;
    }
    close() {
      closed++;
      return Promise.resolve();
    }
    resume() {
      return Promise.resolve();
    }
  };
  try {
    const meter = createVoiceInputMeter({ getAudioTracks: () => [transmitted] });
    assert.equal(transmitted.enabled, false);
    assert.equal(clone.enabled, true);
    assert.equal(connectedTo, analyser);
    assert.ok(meter.read() > 0.09);
    meter.stop();
    assert.equal(stopped, 1);
    assert.equal(closed, 1);
    assert.equal(disconnected, 2);
  } finally {
    globalThis.AudioContext = previousContext;
    globalThis.MediaStream = previousStream;
  }
});
