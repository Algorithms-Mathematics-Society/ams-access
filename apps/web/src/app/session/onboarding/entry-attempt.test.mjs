import assert from "node:assert/strict";
import test from "node:test";

import {
  EntryCancelledError,
  EntryTimeoutError,
  createEntryAttemptController,
  entryMediaFacts,
  refreshEntryValue,
} from "./entry-attempt.ts";

function fakeClock() {
  let nextId = 0;
  const timers = new Map();
  return {
    clock: {
      setTimeout(callback, ms) {
        const id = ++nextId;
        timers.set(id, { callback, ms });
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    fireNext() {
      const next = timers.entries().next().value;
      assert.ok(next, "expected a pending deadline");
      const [id, timer] = next;
      timers.delete(id);
      timer.callback();
      return timer.ms;
    },
    size() {
      return timers.size;
    },
  };
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

test("attempt ownership requires activation and permits one active generation", () => {
  const controller = createEntryAttemptController();
  assert.equal(controller.begin(), null);
  controller.activate();
  const first = controller.begin();
  assert.equal(first, 1);
  assert.equal(controller.begin(), null);
  assert.equal(controller.current(first), true);
  controller.commit(first);
  controller.finish(first);
  assert.equal(controller.current(first), false);
  assert.equal(controller.begin(), 2);
});

test("deadline rejects UI wait while retaining the pending native key until actual settlement", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  const native = deferred();
  controller.activate();
  const attempt = controller.begin();
  const first = controller.run(
    attempt,
    "native scan",
    () => native.promise,
    8_000,
    "scan timed out"
  );
  await Promise.resolve();
  assert.equal(time.fireNext(), 8_000);
  await assert.rejects(
    first,
    (error) => error instanceof EntryTimeoutError && error.message === "scan timed out"
  );
  await assert.rejects(
    controller.run(attempt, "native scan", async () => "overlap", 8_000, "timeout"),
    /previous native scan is still finishing/
  );

  native.resolve("late result");
  await native.promise;
  await Promise.resolve();
  assert.equal(
    await controller.run(attempt, "native scan", async () => "fresh result", 8_000, "timeout"),
    "fresh result"
  );
  assert.equal(time.size(), 0);
});

test("cancellation rejects immediately and a late native result cannot regain ownership", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  const native = deferred();
  controller.activate();
  const attempt = controller.begin();
  const run = controller.run(attempt, "enumeration", () => native.promise, 2_000, "timeout");
  await Promise.resolve();
  controller.cancel();
  await assert.rejects(run, EntryCancelledError);
  assert.equal(controller.current(attempt), false);
  assert.equal(time.size(), 0);
  native.resolve(["late"]);
  await native.promise;
  await Promise.resolve();
  await assert.rejects(
    controller.run(attempt, "enumeration", async () => [], 2_000, "timeout"),
    EntryCancelledError
  );
});

test("operation failures propagate while owned and clear their deadline", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  controller.activate();
  const attempt = controller.begin();
  await assert.rejects(
    controller.run(
      attempt,
      "enumeration",
      async () => {
        throw new Error("media API failed");
      },
      2_000,
      "timeout"
    ),
    /media API failed/
  );
  assert.equal(time.size(), 0);
});

test("advisory timeout preserves entry ownership and cleans up a late success after cancellation", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  const native = deferred();
  const cleaned = [];
  controller.activate();
  const attempt = controller.begin();
  const run = controller.runAdvisory(
    attempt,
    "network lockdown",
    () => native.promise,
    8_000,
    "network lockdown timed out",
    () => cleaned.push("cleanup")
  );
  await Promise.resolve();
  assert.equal(time.fireNext(), 8_000);
  const outcome = await run;
  assert.equal(outcome.status, "timed_out");
  assert.match(outcome.error.message, /timed out/);
  assert.equal(controller.current(attempt), true);
  controller.cancel();
  await Promise.resolve();
  assert.deepEqual(cleaned, ["cleanup"], "cancellation invalidates native work immediately");
  native.resolve(true);
  await native.promise;
  await Promise.resolve();
  assert.deepEqual(cleaned, ["cleanup"], "late settlement does not clean up twice");
});

test("failed entry cleans late advisory success while committed entry transfers ownership", async () => {
  for (const committed of [false, true]) {
    const time = fakeClock();
    const controller = createEntryAttemptController(time.clock);
    const native = deferred();
    const cleaned = [];
    controller.activate();
    const attempt = controller.begin();
    const run = controller.runAdvisory(
      attempt,
      "network lockdown",
      () => native.promise,
      8_000,
      "slow",
      () => cleaned.push("cleanup")
    );
    await Promise.resolve();
    time.fireNext();
    await run;
    if (committed) controller.commit(attempt);
    controller.finish(attempt);
    native.resolve(true);
    await native.promise;
    await Promise.resolve();
    assert.deepEqual(cleaned, committed ? [] : ["cleanup"]);
  }
});

test("committed advisory ownership survives late settlement and route cancellation in either order", async () => {
  for (const cancelBeforeSettlement of [false, true]) {
    const time = fakeClock();
    const controller = createEntryAttemptController(time.clock);
    const native = deferred();
    const cleaned = [];
    controller.activate();
    const attempt = controller.begin();
    const run = controller.runAdvisory(
      attempt,
      "network lockdown",
      () => native.promise,
      8_000,
      "slow",
      () => cleaned.push("cleanup"),
      true
    );
    await Promise.resolve();
    time.fireNext();
    await run;
    controller.commit(attempt);
    controller.finish(attempt);
    if (cancelBeforeSettlement) controller.cancel();
    native.resolve(true);
    await native.promise;
    await Promise.resolve();
    if (!cancelBeforeSettlement) controller.cancel();
    assert.deepEqual(cleaned, []);
  }
});

test("late-settlement cleanup mode keeps the key pending until cleanup completes", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  const native = deferred();
  const cleanupOne = deferred();
  const cleanupTwo = deferred();
  let cleanups = 0;
  let freshStarts = 0;
  controller.activate();
  const firstAttempt = controller.begin();
  const run = controller.runAdvisory(
    firstAttempt,
    "network lockdown",
    () => native.promise,
    8_000,
    "slow",
    () => {
      cleanups += 1;
      return cleanups === 1 ? cleanupOne.promise : cleanupTwo.promise;
    },
    true
  );
  await Promise.resolve();
  time.fireNext();
  await run;
  controller.finish(firstAttempt);
  assert.equal(cleanups, 1, "cancellation disables immediately");

  const retryAttempt = controller.begin();
  const pendingRetry = await controller.runAdvisory(
    retryAttempt,
    "network lockdown",
    async () => {
      freshStarts += 1;
      return true;
    },
    8_000,
    "slow"
  );
  assert.equal(pendingRetry.status, "timed_out");
  assert.equal(freshStarts, 0);

  native.resolve(true);
  await native.promise;
  await Promise.resolve();
  cleanupOne.resolve();
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  assert.equal(cleanups, 2, "late settlement disables again after the first disable");
  cleanupTwo.resolve();
  for (let index = 0; index < 20; index += 1) await Promise.resolve();

  const fresh = await controller.runAdvisory(
    retryAttempt,
    "network lockdown",
    async () => {
      freshStarts += 1;
      return true;
    },
    8_000,
    "slow"
  );
  assert.deepEqual(fresh, { status: "completed", value: true });
  assert.equal(freshStarts, 1);
});

test("cancelled advisory invalidates native work even when its promise never settles", async () => {
  const time = fakeClock();
  const controller = createEntryAttemptController(time.clock);
  const native = deferred();
  let cleanups = 0;
  controller.activate();
  const attempt = controller.begin();
  const run = controller.runAdvisory(
    attempt,
    "network lockdown",
    () => native.promise,
    8_000,
    "slow",
    () => {
      cleanups += 1;
    }
  );
  await Promise.resolve();
  time.fireNext();
  await run;
  controller.finish(attempt);
  assert.equal(cleanups, 1);
});

test("rejected advisory immediately invalidates possibly partial native work", async () => {
  const controller = createEntryAttemptController();
  let cleanups = 0;
  controller.activate();
  const attempt = controller.begin();
  const result = await controller.runAdvisory(
    attempt,
    "network lockdown",
    async () => {
      throw new Error("partial apply");
    },
    8_000,
    "slow",
    () => {
      cleanups += 1;
    }
  );
  assert.equal(result.status, "failed");
  assert.equal(cleanups, 1);
});

test("failed entry releases an advisory resource that completed before later failure", async () => {
  const controller = createEntryAttemptController();
  const cleaned = [];
  controller.activate();
  const attempt = controller.begin();
  const result = await controller.runAdvisory(
    attempt,
    "network lockdown",
    async () => true,
    8_000,
    "slow",
    () => cleaned.push("cleanup")
  );
  assert.deepEqual(result, { status: "completed", value: true });
  controller.finish(attempt);
  assert.deepEqual(cleaned, ["cleanup"]);
});

test("advisory refresh preserves cached entry value on failure or timeout", async () => {
  const cached = [{ kind: "camera", action: "waive" }];
  assert.equal(
    await refreshEntryValue(cached, async () => ({
      status: "failed",
      error: new Error("offline"),
    })),
    cached
  );
  assert.equal(
    await refreshEntryValue(cached, async () => ({
      status: "timed_out",
      error: new EntryTimeoutError("slow"),
    })),
    cached
  );
  const fresh = [{ kind: "external_display", action: "waive" }];
  assert.equal(
    await refreshEntryValue(cached, async () => ({ status: "completed", value: fresh })),
    fresh
  );
});

test("media facts require delivered camera frames and preserve unknown enumeration", () => {
  assert.deepEqual(
    entryMediaFacts({ cameraDelivering: true, cameraAttempted: true, devices: [] }),
    { cameraAvailable: true, microphoneAvailable: false }
  );
  assert.deepEqual(
    entryMediaFacts({
      cameraDelivering: false,
      cameraAttempted: true,
      devices: [{ kind: "videoinput" }, { kind: "audioinput" }],
    }),
    { cameraAvailable: false, microphoneAvailable: true },
    "enumerated camera hardware must not turn a failed camera attempt into a pass"
  );
  assert.deepEqual(
    entryMediaFacts({ cameraDelivering: false, cameraAttempted: false, devices: null }),
    { cameraAvailable: null, microphoneAvailable: null }
  );
});
