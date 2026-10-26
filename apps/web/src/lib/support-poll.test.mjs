import test from "node:test";
import assert from "node:assert/strict";
import { startSupportPolling, SupportRequestError, supportRetryAfterMs } from "./support-poll.ts";
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function fake(random = 0.5) {
  const timers = new Map(),
    handlers = new Map();
  let now = 0,
    serial = 0;
  const events = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => {
      if (handlers.get(name) === fn) handlers.delete(name);
    },
  };
  const document = { hidden: false, ...events };
  return {
    document,
    timers,
    handlers,
    runtime: {
      document,
      window: events,
      now: () => now,
      random: () => random,
      setTimeout: (fn, ms) => {
        const id = ++serial;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    fire() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      timers.delete(id);
      now += timer.ms;
      timer.fn();
      return timer.ms;
    },
  };
}
test("one in-flight read survives repeated focus events and stop aborts it", async () => {
  const clock = fake();
  let calls = 0,
    signal,
    finish;
  const stop = startSupportPolling(
    (s) => {
      calls++;
      signal = s;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    {},
    clock.runtime
  );
  for (let i = 0; i < 20; i++) clock.handlers.get("focus")();
  assert.equal(calls, 1);
  assert.equal(clock.timers.size, 0);
  stop();
  assert.equal(signal.aborted, true);
  finish();
  await flush();
  assert.equal(clock.timers.size, 0);
  assert.equal(clock.handlers.size, 0);
});
test("healthy reads jitter within budget and hidden dialogs issue no reads", async () => {
  const clock = fake();
  let calls = 0;
  const stop = startSupportPolling(
    async () => {
      calls++;
    },
    {},
    clock.runtime
  );
  await flush();
  assert.equal(clock.fire(), 10000);
  await flush();
  assert.equal(calls, 2);
  clock.document.hidden = true;
  clock.handlers.get("visibilitychange")();
  assert.equal(clock.timers.size, 0);
  clock.document.hidden = false;
  clock.handlers.get("visibilitychange")();
  assert.equal(clock.fire(), 1000);
  await flush();
  assert.equal(calls, 3);
  stop();
});
test("Retry-After survives online/focus wakeups and failures back off", async () => {
  const clock = fake();
  let calls = 0;
  const stop = startSupportPolling(
    async () => {
      calls++;
      throw new SupportRequestError("Busy", 429, 60000);
    },
    {},
    clock.runtime
  );
  await flush();
  clock.handlers.get("focus")();
  clock.handlers.get("online")();
  assert.equal(clock.fire(), 60000);
  await flush();
  assert.equal(calls, 2);
  stop();
});
test("permanent authorization/not-found errors stop until an explicit new poller", async () => {
  for (const status of [401, 403, 404]) {
    const clock = fake();
    const stop = startSupportPolling(
      async () => {
        throw new SupportRequestError("Unavailable", status);
      },
      {},
      clock.runtime
    );
    await flush();
    clock.handlers.get("focus")();
    assert.equal(clock.timers.size, 0);
    stop();
  }
});
test("a thousand visible chats spread their next read without multiplying pollers", async () => {
  const fleet = Array.from({ length: 1000 }, (_, i) => fake(i / 1000));
  let calls = 0;
  const stops = fleet.map((clock) =>
    startSupportPolling(
      async () => {
        calls++;
      },
      {},
      clock.runtime
    )
  );
  await flush();
  assert.equal(calls, 1000);
  const delays = fleet.map((clock) => {
    assert.equal(clock.timers.size, 1);
    return [...clock.timers.values()][0].ms;
  });
  assert.ok(delays.every((ms) => ms >= 8000 && ms <= 12000));
  assert.equal(new Set(delays).size, 1000);
  stops.forEach((stop) => stop());
  assert.ok(fleet.every((clock) => clock.timers.size === 0));
});
test("cooldowns accept seconds or HTTP dates and reject malformed values", () => {
  assert.equal(supportRetryAfterMs("60", 0), 60000);
  assert.equal(supportRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", 0), 10000);
  for (const value of [null, "invalid", "-1"]) assert.equal(supportRetryAfterMs(value, 0), 0);
});
