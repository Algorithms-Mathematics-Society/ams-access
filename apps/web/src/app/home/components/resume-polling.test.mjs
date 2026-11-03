import test from "node:test";
import assert from "node:assert/strict";
import { mergeResumeRequestIntoSession, startResumePolling } from "./resume-polling.ts";

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const session = {
  id: "session",
  resume_request_id: "request",
  resume_request_status: "PENDING",
  resume_request_requested_at: "today",
  resume_request_review_note: null,
};

test("unchanged approval response preserves session identity; decision and note updates are retained", () => {
  assert.equal(
    mergeResumeRequestIntoSession(session, {
      id: "request",
      status: "PENDING",
      requested_at: "today",
      review_note: null,
    }),
    session
  );
  assert.equal(
    mergeResumeRequestIntoSession(session, { status: "APPROVED" }).resume_request_status,
    "APPROVED"
  );
  assert.equal(
    mergeResumeRequestIntoSession(session, { review_note: "Contact proctor" })
      .resume_request_review_note,
    "Contact proctor"
  );
});

test("first approval read is delayed and healthy reads use the fifteen-second floor", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const stop = startResumePolling(
    async () => {
      calls++;
    },
    () => 0
  );
  await settle();
  assert.equal(calls, 0);
  t.mock.timers.tick(14999);
  await settle();
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(15000);
  await settle();
  assert.equal(calls, 2);
  stop();
  t.mock.timers.tick(90000);
  await settle();
  assert.equal(calls, 2);
});

test("slow requests never overlap and disposal invalidates the outstanding response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0,
    complete,
    cancelled,
    applied = false;
  const stop = startResumePolling(
    async (isCancelled) => {
      calls++;
      cancelled = isCancelled;
      await new Promise((resolve) => {
        complete = resolve;
      });
      if (!isCancelled()) applied = true;
    },
    () => 0
  );
  t.mock.timers.tick(15000);
  await settle();
  t.mock.timers.tick(90000);
  await settle();
  assert.equal(calls, 1);
  stop();
  assert.equal(cancelled(), true);
  complete();
  await settle();
  assert.equal(applied, false);
});

test("503/429 server delay is respected, then success restores normal cadence", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const stop = startResumePolling(
    async () => {
      calls++;
      if (calls === 1) throw { status: 503, retryAfterSeconds: 40 };
    },
    () => 0
  );
  t.mock.timers.tick(15000);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(39999);
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls, 2);
  t.mock.timers.tick(15000);
  await settle();
  assert.equal(calls, 3);
  stop();
});

test("persistent failures back off with jitter and never queue missed requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const stop = startResumePolling(
    async () => {
      calls++;
      throw Error("offline");
    },
    () => 0.5
  );
  t.mock.timers.tick(17500);
  await settle();
  assert.equal(calls, 1);
  for (let i = 0; i < 5; i++) {
    const before = calls;
    t.mock.timers.tick(31499);
    await settle();
    assert.equal(calls, before);
    t.mock.timers.tick(1);
    await settle();
    assert.equal(calls, before + 1);
  }
  stop();
  t.mock.timers.tick(300000);
  await settle();
  assert.equal(calls, 6);
});

test("long Retry-After cannot overflow the timer into immediate requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const stop = startResumePolling(
    async () => {
      calls++;
      throw { retryAfterSeconds: 3_000_000 };
    },
    () => 0
  );
  t.mock.timers.tick(15000);
  await settle();
  t.mock.timers.tick(86_400_000);
  await settle();
  assert.equal(calls, 1);
  stop();
});

test("3000 pending clients spread initial reads across 15–20s without immediate duplicate reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const counts = Array(3000).fill(0);
  const stops = counts.map((_, i) =>
    startResumePolling(
      async () => {
        counts[i]++;
      },
      () => i / 3000
    )
  );
  await settle();
  assert(counts.every((n) => n === 0));
  t.mock.timers.tick(14999);
  await settle();
  assert(counts.every((n) => n === 0));
  t.mock.timers.tick(2501);
  await settle();
  const refreshed = counts.filter((n) => n === 1).length;
  assert(refreshed >= 1500 && refreshed < 1510);
  assert(counts.every((n) => n <= 1));
  t.mock.timers.tick(2500);
  await settle();
  assert(counts.every((n) => n === 1));
  stops.forEach((stop) => stop());
  t.mock.timers.tick(60_000);
  await settle();
  assert(
    counts.every((n) => n === 1),
    "disposal stops all pending timers"
  );
});
