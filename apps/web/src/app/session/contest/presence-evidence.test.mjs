import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENCE_EVIDENCE_MAX_MS,
  PRESENCE_EVIDENCE_MIN_MS,
  nextPresenceEvidenceDelay,
  presenceUnavailableEvent,
} from "./presence-evidence.ts";

test("no-stream evidence cadence stays within the presence sampling window", () => {
  assert.equal(nextPresenceEvidenceDelay(0), PRESENCE_EVIDENCE_MIN_MS);
  assert.equal(nextPresenceEvidenceDelay(0.5), 60_000);
  assert.equal(nextPresenceEvidenceDelay(1), PRESENCE_EVIDENCE_MAX_MS);
  assert.equal(nextPresenceEvidenceDelay(-10), PRESENCE_EVIDENCE_MIN_MS);
  assert.equal(nextPresenceEvidenceDelay(10), PRESENCE_EVIDENCE_MAX_MS);
  assert.equal(nextPresenceEvidenceDelay(Number.NaN), 60_000);
});

test("no-stream evidence states the missing measurement without claiming a face result", () => {
  const event = presenceUnavailableEvent("contest-a");
  assert.deepEqual(event, {
    kind: "presence_unavailable",
    detail: "periodic presence check unavailable: no camera stream",
    payload: { contest_id: "contest-a", reason: "no_camera_stream" },
  });
  assert.equal("faces" in event.payload, false);
  assert.equal("thumbnail" in event.payload, false);
});

// Execute the actual owning effect so late-loader cleanup cannot drift from production.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const clientSource = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const effectStart = clientSource.indexOf(
  "  useEffect(() => {",
  clientSource.indexOf("// ── Periodic presence verification")
);
const effectEnding = "  }, [cameraStream, contestId]);";
const effectEnd = clientSource.indexOf(effectEnding, effectStart);
assert.ok(effectStart >= 0 && effectEnd > effectStart);
const presenceEffect = ts.transpileModule(
  clientSource.slice(effectStart, effectEnd + effectEnding.length),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const flushPresence = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function mountPresenceEffect(pendingKind, sessionIdRef = { current: "synthetic-session" }) {
  let resolveLoader, rejectLoader, cleanup, tick;
  const pending = new Promise((resolve, reject) => {
    resolveLoader = resolve;
    rejectLoader = reject;
  });
  const calls = {
    dispose: 0,
    close: 0,
    sample: 0,
    objectSample: 0,
    scheduled: 0,
    events: [],
    queued: [],
  };
  const face = {
    dispose() {
      calls.dispose++;
    },
  };
  const object = {
    close() {
      calls.close++;
    },
  };
  vm.runInNewContext(presenceEffect, {
    useEffect(fn) {
      cleanup = fn();
    },
    cameraStream: {},
    contestId: "synthetic",
    cameraEnabledRef: { current: true },
    document: {
      createElement(tag) {
        return tag === "video"
          ? { play: async () => {}, srcObject: null, videoWidth: 128, videoHeight: 128 }
          : { getContext: () => ({ drawImage() {} }), toDataURL: () => null };
      },
    },
    keepPlaying() {},
    PRESENCE_SAMPLE_MS: 5000,
    ANOMALY_STREAK: 3,
    setTimeout(fn) {
      tick = fn;
      calls.scheduled++;
      return 1;
    },
    clearTimeout() {},
    window: {
      __TAURI__: {
        core: {
          invoke: async (_command, event) => {
            calls.events.push(event);
          },
        },
      },
    },
    console: { info() {} },
    sessionIdRef,
    enqueueViolation(session, event) {
      calls.queued.push({ session, event });
    },
    setObjectHint() {},
    setPresenceStatus() {},
    setFramingHint() {},
    loadPresenceDetector: () => (pendingKind === "presence" ? pending : Promise.resolve(face)),
    loadObjectDetector: () => (pendingKind === "object" ? pending : Promise.resolve(object)),
    samplePresence: async () => {
      calls.sample++;
      return null;
    },
    drawForObjects: () => true,
    sampleObjects: () => {
      calls.objectSample++;
      return null;
    },
  });
  return {
    calls,
    tick: () => tick(),
    cleanup: () => cleanup(),
    resolve: () => resolveLoader(pendingKind === "presence" ? face : object),
    reject: () => rejectLoader(new Error("synthetic model load failure")),
  };
}

for (const kind of ["presence", "object"]) {
  test(`${kind} model resolving after cleanup is disposed once without further sampling`, async () => {
    const h = mountPresenceEffect(kind);
    h.tick();
    await flushPresence();
    h.cleanup();
    const sampled = h.calls.sample;
    const scheduled = h.calls.scheduled;
    h.resolve();
    await flushPresence();
    assert.equal(h.calls.dispose, 1);
    assert.equal(h.calls.close, kind === "object" ? 1 : 0);
    assert.equal(h.calls.sample, sampled);
    assert.equal(h.calls.objectSample, 0);
    assert.equal(h.calls.scheduled, scheduled);
  });
}

test("loaded models remain owned until normal effect cleanup", async () => {
  const h = mountPresenceEffect(null);
  h.tick();
  await flushPresence();
  assert.equal(h.calls.sample, 1);
  assert.equal(h.calls.objectSample, 1);
  assert.equal(h.calls.dispose, 0);
  assert.equal(h.calls.close, 0);
  h.cleanup();
  assert.equal(h.calls.dispose, 1);
  assert.equal(h.calls.close, 1);
});

for (const kind of ["presence", "object"]) {
  test(`${kind} late rejection after stream replacement cannot log an obsolete failure`, async () => {
    const sessionIdRef = { current: "old-session" };
    const old = mountPresenceEffect(kind, sessionIdRef);
    old.tick();
    await flushPresence();
    old.cleanup();
    sessionIdRef.current = "replacement-session";
    const replacement = mountPresenceEffect(null, sessionIdRef);
    replacement.tick();
    await flushPresence();
    const scheduled = old.calls.scheduled;
    old.reject();
    await flushPresence();
    assert.equal(old.calls.events.length, 0);
    assert.equal(old.calls.queued.length, 0);
    assert.equal(replacement.calls.queued.length, 0);
    assert.equal(old.calls.scheduled, scheduled);
    assert.equal(replacement.calls.sample, 1);
    assert.equal(replacement.calls.dispose, 0);
    replacement.cleanup();
  });
  test(`${kind} active load rejection logs once without unbounded retry`, async () => {
    const h = mountPresenceEffect(kind);
    h.tick();
    await flushPresence();
    h.reject();
    await flushPresence();
    assert.equal(h.calls.events.length, 1);
    assert.equal(h.calls.queued.length, 1);
    assert.equal(h.calls.queued[0].session, "synthetic-session");
    assert.equal(
      h.calls.queued[0].event.kind,
      kind === "presence" ? "presence_monitor_unavailable" : "object_monitor_unavailable"
    );
    assert.equal(h.calls.queued[0].event.severity, "info");
    h.tick();
    await flushPresence();
    assert.equal(h.calls.events.length, 1);
    assert.equal(h.calls.queued.length, 1);
    assert.equal(h.calls.queued[0].session, "synthetic-session");
    assert.equal(
      h.calls.queued[0].event.kind,
      kind === "presence" ? "presence_monitor_unavailable" : "object_monitor_unavailable"
    );
    assert.equal(h.calls.queued[0].event.severity, "info");
    h.cleanup();
  });
  test(`${kind} late success after stream replacement releases only obsolete models`, async () => {
    const sessionIdRef = { current: "old-session" };
    const old = mountPresenceEffect(kind, sessionIdRef);
    old.tick();
    await flushPresence();
    old.cleanup();
    sessionIdRef.current = "replacement-session";
    const replacement = mountPresenceEffect(null, sessionIdRef);
    replacement.tick();
    await flushPresence();
    old.resolve();
    await flushPresence();
    assert.equal(old.calls.dispose, 1);
    assert.equal(old.calls.close, kind === "object" ? 1 : 0);
    assert.equal(replacement.calls.dispose, 0);
    assert.equal(replacement.calls.close, 0);
    replacement.tick();
    await flushPresence();
    assert.equal(replacement.calls.sample, 2);
    replacement.cleanup();
    assert.equal(replacement.calls.dispose, 1);
    assert.equal(replacement.calls.close, 1);
  });
}
