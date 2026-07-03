import test from "node:test";
import assert from "node:assert/strict";

import { createSaveCoordinator } from "./save-coordinator.ts";

// Deferred promise helper — lets a test control exactly when a mock doSave()
// "network call" resolves, so overlap can be constructed deterministically
// without any real timers, Date.now(), or Math.random() (unavailable in this
// harness).
function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// The coordinator's coalesced follow-up is chained via `.catch().then()`,
// which takes a few extra microtask turns beyond a single `await` to actually
// invoke doSave() again. Rather than hard-code a tick count (fragile against
// implementation changes), poll a condition across bounded microtask turns —
// deterministic (a turn counter, not a timer) and no Date.now()/Math.random().
async function waitUntil(conditionFn, maxTurns = 50) {
  for (let i = 0; i < maxTurns; i++) {
    if (conditionFn()) return;
    await Promise.resolve();
  }
  throw new Error(`waitUntil: condition not met within ${maxTurns} microtask turns`);
}

test("SAFETY serialization: doSave is never invoked while a previous doSave is still in flight", async () => {
  let insideDoSave = false;
  let concurrent = 0;
  let maxConcurrent = 0;
  const deferreds = [];

  function doSave() {
    assert.equal(
      insideDoSave,
      false,
      "a second doSave started while the first was still in flight — overlapping network writes"
    );
    insideDoSave = true;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    const d = createDeferred();
    deferreds.push(d);
    return d.promise.finally(() => {
      insideDoSave = false;
      concurrent -= 1;
    });
  }

  const request = createSaveCoordinator(doSave);

  // Fire 6 overlapping requests before anything resolves (simulates fast
  // keystrokes racing an in-flight autosave, plus an await-caller).
  const p1 = request();
  const p2 = request();
  const p3 = request();
  const p4 = request();
  const p5 = request();
  const p6 = request();

  assert.equal(deferreds.length, 1, "only the first request should start a doSave immediately");

  deferreds[0].resolve(true);
  await p1;
  await waitUntil(() => deferreds.length === 2);

  assert.equal(deferreds.length, 2, "the coalesced requests share exactly one follow-up doSave");
  deferreds[1].resolve(true);
  await Promise.all([p2, p3, p4, p5, p6]);

  assert.equal(maxConcurrent, 1, "at most one doSave must ever be in flight at a time");
});

test("SAFETY coalescing: K requests arriving during one in-flight save trigger exactly ONE follow-up doSave, not K", async () => {
  const deferreds = [];
  function doSave() {
    const d = createDeferred();
    deferreds.push(d);
    return d.promise;
  }

  const request = createSaveCoordinator(doSave);

  const first = request();
  const K = 5;
  const followUps = Array.from({ length: K }, () => request());

  assert.equal(
    deferreds.length,
    1,
    "the K coalesced requests must not each start their own doSave"
  );

  deferreds[0].resolve(true);
  await first;
  await waitUntil(() => deferreds.length === 2);

  // The single coalesced follow-up doSave should have started by now.
  assert.equal(
    deferreds.length,
    2,
    `expected doSave to run exactly twice total (original + ONE follow-up for ${K} coalesced requests), not ${K + 1}`
  );

  deferreds[1].resolve(true);
  const results = await Promise.all(followUps);
  assert.deepEqual(results, Array(K).fill(true));
});

test("SAFETY freshness: a request never resolves with content from a doSave that started before it arrived", async () => {
  // contentVersion simulates "the latest typed content" (editorFiles/etc in the
  // real app). A real doSave reads it LIVE at call time, so a fresh doSave
  // started after an edit always captures that edit. A counter (not
  // Date.now()) sequences events deterministically.
  let contentVersion = 0;
  const versionObservedByDoSave = [];
  const deferreds = [];

  function doSave() {
    const versionAtStart = contentVersion; // "reads live state" at call time
    versionObservedByDoSave.push(versionAtStart);
    const d = createDeferred();
    deferreds.push(d);
    return d.promise.then(() => versionAtStart);
  }

  const request = createSaveCoordinator(doSave);

  contentVersion = 1;
  const r1 = request(); // starts doSave immediately; observes version 1

  contentVersion = 2; // candidate types more while r1's save is in flight
  const versionAtR2Arrival = contentVersion;
  const r2 = request(); // must coalesce — must NOT resolve with the stale version 1

  contentVersion = 3; // and more typing before the coalesced follow-up actually runs
  const r3 = request(); // shares the same coalesced follow-up as r2

  deferreds[0].resolve();
  await r1;
  await waitUntil(() => versionObservedByDoSave.length === 2);

  assert.equal(
    versionObservedByDoSave.length,
    2,
    "exactly one follow-up doSave should have started to satisfy r2 and r3"
  );
  const followUpVersion = versionObservedByDoSave[1];
  assert.ok(
    followUpVersion >= versionAtR2Arrival,
    `follow-up doSave observed version ${followUpVersion}, which is older than the version (${versionAtR2Arrival}) present when r2 arrived — a stale save`
  );

  deferreds[1].resolve();
  const [v2, v3] = await Promise.all([r2, r3]);
  assert.equal(v2, followUpVersion);
  assert.equal(v3, followUpVersion);
  assert.equal(
    v2,
    3,
    "the follow-up must capture the LATEST content (version 3), not an older one"
  );
});

test("result propagation: the boolean doSave resolves with reaches the awaiting request()", async () => {
  const results = [true, false, true];
  let i = 0;
  function doSave() {
    return Promise.resolve(results[i++]);
  }
  const request = createSaveCoordinator(doSave);

  // Sequential (non-overlapping) calls: each request() waits for the previous
  // to fully settle before issuing the next, so each gets its own doSave call.
  assert.equal(await request(), true);
  assert.equal(await request(), false);
  assert.equal(await request(), true);
});

test("the coordinator resets cleanly: after settling, a fresh request starts a brand-new doSave", async () => {
  let calls = 0;
  function doSave() {
    calls += 1;
    return Promise.resolve(true);
  }
  const request = createSaveCoordinator(doSave);
  assert.equal(await request(), true);
  assert.equal(await request(), true);
  assert.equal(
    calls,
    2,
    "a request issued after everything has settled must trigger its own doSave"
  );
});

test("a rejected in-flight doSave does not sink the coalesced follow-up", async () => {
  let call = 0;
  function doSave() {
    call += 1;
    if (call === 1) return Promise.reject(new Error("network blip"));
    return Promise.resolve(true);
  }
  const request = createSaveCoordinator(doSave);

  const p1 = request().catch(() => "rejected");
  const p2 = request(); // coalesced follow-up must still run despite p1 rejecting

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "rejected");
  assert.equal(r2, true);
  assert.equal(call, 2, "the follow-up doSave must still run after a rejected in-flight save");
});
