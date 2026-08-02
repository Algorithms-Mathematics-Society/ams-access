import test from "node:test";
import assert from "node:assert/strict";

import {
  ViolationQueue,
  isPermanentFailure,
  MAX_PENDING,
  STORAGE_KEY,
} from "./violation-queue-core.ts";

/** A Map-backed store that can be made to fail, like a full quota. */
class FakeStore {
  constructor() {
    this.map = new Map();
    this.failWrites = false;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.map.set(k, v);
  }
}

class ApiError extends Error {
  constructor(status) {
    super(`status ${status}`);
    this.status = status;
  }
}

function setup(send = async () => ({})) {
  const store = new FakeStore();
  return { store, queue: new ViolationQueue(store, send) };
}

function stored(store) {
  return JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
}

// ── durability ────────────────────────────────────────────────────────────

test("an event is persisted before any delivery is attempted", () => {
  const { store, queue } = setup();
  queue.enqueue({ kind: "vm_detected", severity: "critical" });

  assert.equal(queue.pendingCount(), 1);
  assert.equal(stored(store)[0].kind, "vm_detected");
});

test("enqueue stamps occurred_at so detection time is not lost in the queue", () => {
  const { store, queue } = setup();
  queue.enqueue({ kind: "focus_lost" });

  const at = stored(store)[0].occurred_at;
  assert.ok(at, "must carry a client timestamp");
  assert.ok(!Number.isNaN(Date.parse(at)));
});

test("an explicit occurred_at is preserved rather than overwritten", () => {
  const { store, queue } = setup();
  queue.enqueue({ kind: "focus_lost", occurred_at: "2026-01-01T00:00:00.000Z" });

  assert.equal(stored(store)[0].occurred_at, "2026-01-01T00:00:00.000Z");
});

// ── delivery ──────────────────────────────────────────────────────────────

test("a successful flush delivers and clears the queue", async () => {
  const sent = [];
  const { queue } = setup(async (batch) => sent.push(...batch));

  queue.enqueue({ kind: "vm_detected" });
  queue.enqueue({ kind: "focus_lost" });

  assert.equal(await queue.flush(), 2);
  assert.equal(queue.pendingCount(), 0);
  assert.deepEqual(
    sent.map((e) => e.kind),
    ["vm_detected", "focus_lost"],
  );
});

test("events stay queued when the network is down", async () => {
  const { queue } = setup(async () => {
    throw new Error("offline");
  });
  queue.enqueue({ kind: "network_lost" });

  assert.equal(await queue.flush(), 0);
  assert.equal(queue.pendingCount(), 1, "a failed delivery must not lose the event");
});

test("a queued event goes out once the network returns", async () => {
  let online = false;
  const sent = [];
  const { queue } = setup(async (batch) => {
    if (!online) throw new Error("offline");
    sent.push(...batch);
  });

  queue.enqueue({ kind: "screen_share_detected" });
  await queue.flush();
  assert.equal(queue.pendingCount(), 1);

  online = true;
  assert.equal(await queue.flush(), 1);
  assert.equal(queue.pendingCount(), 0);
  assert.equal(sent[0].kind, "screen_share_detected");
});

test("a 5xx keeps the events — the server may recover", async () => {
  const { queue } = setup(async () => {
    throw new ApiError(500);
  });
  queue.enqueue({ kind: "vm_detected" });

  await queue.flush();
  assert.equal(queue.pendingCount(), 1);
});

test("a 429 keeps the events — it means slow down, not give up", async () => {
  const { queue } = setup(async () => {
    throw new ApiError(429);
  });
  queue.enqueue({ kind: "vm_detected" });

  await queue.flush();
  assert.equal(queue.pendingCount(), 1);
});

test("a permanently rejected batch is dropped so it cannot block the queue", async () => {
  // A malformed event retried forever would stop every later violation from
  // ever being reported — the queue deadlocks behind one bad record.
  const { queue } = setup(async () => {
    throw new ApiError(422);
  });
  queue.enqueue({ kind: "malformed" });

  await queue.flush();
  assert.equal(queue.pendingCount(), 0, "the poison batch must not block later events");
});

// ── concurrency ───────────────────────────────────────────────────────────

test("events enqueued during a flush are not lost", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const { store, queue } = setup(async () => gate);
  queue.enqueue({ kind: "first" });

  const inFlight = queue.flush();
  // A detector fires while the request is outstanding.
  queue.enqueue({ kind: "during" });
  release();
  await inFlight;

  assert.equal(queue.pendingCount(), 1, "the event added mid-flight must survive");
  assert.equal(stored(store)[0].kind, "during");
});

test("overlapping flushes do not send the same events twice", async () => {
  let calls = 0;
  const { queue } = setup(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
  });
  queue.enqueue({ kind: "vm_detected" });

  await Promise.all([queue.flush(), queue.flush(), queue.flush()]);

  assert.equal(calls, 1, "concurrent flushes must collapse into one");
});

// ── limits and hostile storage ────────────────────────────────────────────

test("the queue is capped, dropping oldest first", () => {
  const { store, queue } = setup();
  for (let i = 0; i < MAX_PENDING + 100; i += 1) queue.enqueue({ kind: `event-${i}` });

  assert.equal(queue.pendingCount(), MAX_PENDING, "an unbounded queue could exhaust storage");

  const rows = stored(store);
  assert.equal(rows.at(-1).kind, `event-${MAX_PENDING + 99}`, "keep the most recent");
  assert.equal(rows[0].kind, "event-100", "drop the oldest");
});

test("a batch larger than the cap is delivered across several flushes", async () => {
  const batches = [];
  const { queue } = setup(async (batch) => batches.push(batch.length));
  for (let i = 0; i < 450; i += 1) queue.enqueue({ kind: `e${i}` });

  await queue.flush();
  await queue.flush();
  await queue.flush();

  assert.deepEqual(batches, [200, 200, 50]);
  assert.equal(queue.pendingCount(), 0);
});

test("corrupt storage does not wedge the queue permanently", () => {
  const { store, queue } = setup();
  store.map.set(STORAGE_KEY, "{not json");

  assert.equal(queue.pendingCount(), 0);
  queue.enqueue({ kind: "recovered" });
  assert.equal(queue.pendingCount(), 1);
});

test("a non-array in storage is treated as empty rather than trusted", () => {
  const { store, queue } = setup();
  store.map.set(STORAGE_KEY, '{"kind":"not-an-array"}');
  assert.equal(queue.pendingCount(), 0);
});

test("a storage write failure does not throw into the detector", () => {
  const { store, queue } = setup();
  store.failWrites = true;

  // Called from inside a violation handler; throwing here would take down
  // whatever detected the violation.
  assert.doesNotThrow(() => queue.enqueue({ kind: "vm_detected" }));
});

test("flushing an empty queue touches no network", async () => {
  let called = false;
  const { queue } = setup(async () => {
    called = true;
  });

  assert.equal(await queue.flush(), 0);
  assert.equal(called, false);
});

// ── failure classification ────────────────────────────────────────────────

test("only 4xx-except-429 is treated as permanent", () => {
  assert.equal(isPermanentFailure(new ApiError(400)), true);
  assert.equal(isPermanentFailure(new ApiError(422)), true);
  assert.equal(isPermanentFailure(new ApiError(429)), false);
  assert.equal(isPermanentFailure(new ApiError(500)), false);
  assert.equal(isPermanentFailure(new ApiError(503)), false);
});

test("an error with no status is retryable", () => {
  // A network failure has no HTTP status at all, and losing events to one is
  // exactly the case this queue exists to prevent.
  assert.equal(isPermanentFailure(new Error("fetch failed")), false);
  assert.equal(isPermanentFailure(null), false);
  assert.equal(isPermanentFailure(undefined), false);
});
