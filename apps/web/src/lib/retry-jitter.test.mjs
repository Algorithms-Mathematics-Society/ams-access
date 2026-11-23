import { test } from "node:test";
import assert from "node:assert/strict";
import { jitteredDelayMs, retryAfterSeconds } from "./retry-jitter.ts";

const opts = (random, extra = {}) => ({ baseMs: 2000, capMs: 30_000, random, ...extra });

test("full jitter spans [floor, floor + window) and the window doubles up to the cap", () => {
  assert.equal(
    jitteredDelayMs(
      0,
      opts(() => 0)
    ),
    0
  );
  assert.equal(
    jitteredDelayMs(
      0,
      opts(() => 0.999)
    ),
    1998
  );
  assert.equal(
    jitteredDelayMs(
      2,
      opts(() => 0.5)
    ),
    4000
  );
  assert.equal(
    jitteredDelayMs(
      10,
      opts(() => 0.5)
    ),
    15_000
  );
  assert.equal(
    jitteredDelayMs(
      3,
      opts(() => 0.25, { floorMs: 10_000 })
    ),
    14_000
  );
});

test("out-of-range random values and negative attempts stay inside the window", () => {
  assert.equal(
    jitteredDelayMs(
      -4,
      opts(() => 7)
    ),
    2000
  );
  assert.equal(
    jitteredDelayMs(
      1,
      opts(() => -1, { floorMs: -5 })
    ),
    0
  );
});

test("a synchronized room is spread across the window, not bunched", () => {
  // 136 clients fail together; with a seeded generator their first retries
  // must cover the window rather than land within a few hundred milliseconds.
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const delays = Array.from({ length: 136 }, () =>
    jitteredDelayMs(1, opts(random, { floorMs: 2000 }))
  );
  assert.ok(Math.min(...delays) >= 2000 && Math.max(...delays) < 6000);
  assert.ok(Math.max(...delays) - Math.min(...delays) > 3000);
  const firstSecond = delays.filter((d) => d < 3000).length;
  assert.ok(
    firstSecond < 136 / 2,
    `only part of the room retries in the first second (${firstSecond})`
  );
});

test("Retry-After accepts delta seconds and HTTP dates, rejects the rest", () => {
  const h = (values) => new Headers(values);
  assert.equal(retryAfterSeconds(h({ "Retry-After": "5" })), 5);
  assert.equal(retryAfterSeconds(h({})), 0);
  assert.equal(retryAfterSeconds(h({ "Retry-After": "1.5" })), 0);
  assert.equal(retryAfterSeconds(h({ "Retry-After": "-3" })), 0);
  assert.equal(
    retryAfterSeconds(
      h({ "Retry-After": "Mon, 23 Nov 2026 10:00:30 GMT", Date: "Mon, 23 Nov 2026 10:00:00 GMT" })
    ),
    30
  );
  assert.equal(retryAfterSeconds(h({ "Retry-After": "Mon, 23 Nov 2026 10:00:30 GMT" })), 0);
});
