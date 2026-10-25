import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReport,
  boundedJson,
  responseTime,
  isCurrent,
  EMPTY_STATUS,
  relevant,
} from "./service-status.ts";
import { ServiceStatusReader } from "./service-status-reader.ts";
const base = () => ({
  schema_version: 1,
  revision: 1,
  issued_at: "2026-10-25T09:00:00Z",
  valid_until: "2026-10-25T09:15:00Z",
  incidents: [
    {
      id: "login-1",
      state: "investigating",
      components: ["sign_in"],
      platforms: ["macos"],
      title: "Sign-in delays",
      message: "Some candidates cannot sign in.",
      candidate_action: "Wait before retrying.",
      updated_at: "2026-10-25T09:00:00Z",
      next_update_at: "2026-10-25T09:10:00Z",
    },
  ],
});
const response = (body = base(), headers = {}) =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      date: "Sun, 25 Oct 2026 09:01:00 GMT",
      ...headers,
    },
  });
test("schema rejects unsupported, malformed, unbounded and temporally inconsistent payloads", () => {
  assert.equal(parseReport(base()).revision, 1);
  for (const mutate of [
    (v) => (v.schema_version = 2),
    (v) => (v.revision = -1),
    (v) => (v.incidents = Array(6).fill(v.incidents[0])),
    (v) => (v.valid_until = "2026-10-25T09:16:00Z"),
    (v) => (v.issued_at = "2026-02-30T09:00:00Z"),
    (v) => (v.incidents[0].title = "<script>"),
    (v) => (v.incidents[0].message = "x".repeat(601)),
    (v) => (v.incidents[0].platforms = ["all", "linux"]),
    (v) => delete v.incidents[0].next_update_at,
    (v) => (v.incidents[0].next_update_at = "2026-10-25T10:00:00Z"),
  ]) {
    const v = base();
    mutate(v);
    assert.throws(() => parseReport(v));
  }
});
test("scope is component/platform specific, unknown platform cannot exclude reports", () => {
  assert.equal(relevant(base(), ["judging"], "macos").length, 0);
  assert.equal(relevant(base(), ["sign_in"], "windows").length, 0);
  assert.equal(relevant(base(), ["sign_in"], "unknown").length, 1);
});
test("freshness uses response Date/Age and monotonic elapsed; never local clock", () => {
  const time = responseTime(response().headers);
  const s = { ...EMPTY_STATUS, report: base(), serverTime: time, receivedAt: 100, now: 100 };
  assert.equal(isCurrent(s), true);
  assert.equal(isCurrent({ ...s, now: 840100 }), false);
  for (const patch of [{ failed: true }, { offline: true }, { serverTime: null }])
    assert.equal(isCurrent({ ...s, ...patch }), false);
  assert.equal(responseTime(new Headers()), null);
  assert.equal(responseTime(new Headers({ date: "bad" })), null);
  assert.equal(responseTime(response(base(), { age: "bad" }).headers), null);
  assert.equal(responseTime(response(base(), { age: "60" }).headers), time + 60000);
});
test("body limit applies to streamed bytes, not just Content-Length", async () => {
  assert.deepEqual(await boundedJson(response()), base());
  await assert.rejects(() =>
    boundedJson(new Response("<html>", { headers: { "content-type": "text/html" } }))
  );
  await assert.rejects(() =>
    boundedJson(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(16385));
            c.close();
          },
        }),
        { headers: { "content-type": "application/json" } }
      )
    )
  );
});
function harness(fetcher = async () => response()) {
  let now = 0,
    visible = true,
    online = true,
    id = 0;
  const timers = new Map();
  const requests = [];
  const env = {
    now: () => now,
    random: () => 0.5,
    visible: () => visible,
    online: () => online,
    fetch: (...args) => {
      requests.push(args);
      return fetcher(...args);
    },
    setTimer: (fn, ms) => {
      const key = ++id;
      timers.set(key, { fn, at: now + ms });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
  };
  const reader = new ServiceStatusReader("https://api.amsaccess.com/client/status", env);
  return {
    reader,
    requests,
    timers,
    setTime: (v) => (now = v),
    setVisible: (v) => (visible = v),
    setOnline: (v) => (online = v),
    async tick(ms) {
      now += ms;
      for (const [key, t] of [...timers])
        if (t.at <= now) {
          timers.delete(key);
          t.fn();
        }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}
test("multiple subscribers, manual clicks and local failures share one credential-free request", async () => {
  const h = harness();
  const a = h.reader.subscribe(() => {}),
    b = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  assert.equal(h.requests.length, 1);
  const options = h.requests[0][1];
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, undefined);
  for (let i = 0; i < 10; i++) {
    h.reader.localFailure();
    void h.reader.check();
  }
  assert.equal(h.requests.length, 1);
  a();
  b();
  assert.equal(h.timers.size, 0);
});
test("hidden and offline suppress polling; remount preserves cooldown", async () => {
  const h = harness();
  let stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  stop();
  stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  assert.equal(h.requests.length, 1);
  h.setVisible(false);
  h.reader.wake();
  await h.tick(300000);
  assert.equal(h.requests.length, 1);
  h.setVisible(true);
  h.setOnline(false);
  h.reader.wake();
  await h.tick(300000);
  assert.equal(h.requests.length, 1);
  assert.equal(h.reader.snapshot().offline, true);
  h.setOnline(true);
  h.reader.wake();
  await h.tick(2000);
  await h.reader.check();
  assert.equal(h.requests.length, 2);
  stop();
});
test("failed refresh keeps last known report and backs off despite manual retries", async () => {
  let fail = false;
  const h = harness(async () => {
    if (fail) throw Error("offline");
    return response();
  });
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  fail = true;
  h.setTime(130000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().failed, true);
  assert.equal(h.reader.snapshot().report.revision, 1);
  assert.equal(isCurrent(h.reader.snapshot()), false);
  h.setTime(165000);
  h.reader.localFailure();
  await h.reader.check();
  assert.equal(h.requests.length, 2);
  stop();
});
test("304 requires cache and rollback cannot replace a newer report", async () => {
  let mode = "304";
  const h = harness(async () =>
    mode === "304"
      ? new Response(null, { status: 304, headers: { date: "Sun, 25 Oct 2026 09:20:00 GMT" } })
      : response({ ...base(), revision: Number(mode) })
  );
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().failed, true);
  mode = "2";
  h.setTime(130000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().report.revision, 2);
  mode = "1";
  h.setTime(260000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().report.revision, 2);
  assert.equal(h.reader.snapshot().failed, true);
  mode = "304";
  h.setTime(400000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().failed, false);
  assert.equal(isCurrent(h.reader.snapshot()), false);
  stop();
});
test("deadline covers stalled response body and rejects late results", async () => {
  const h = harness(
    async () =>
      new Response(new ReadableStream({ start() {} }), {
        headers: { "content-type": "application/json" },
      })
  );
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.tick(4000);
  assert.equal(h.reader.snapshot().failed, true);
  assert.equal(h.reader.snapshot().checking, false);
  stop();
});

test("foreground preserves exact authority expiry before the next poll", async () => {
  const doc = base();
  doc.valid_until = "2026-10-25T09:01:40Z";
  doc.incidents[0].next_update_at = "2026-10-25T09:01:30Z";
  const h = harness(async () => response(doc));
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  assert.equal(isCurrent(h.reader.snapshot()), true);
  h.setTime(10000);
  h.setVisible(false);
  h.reader.wake();
  h.setTime(20000);
  h.setVisible(true);
  h.reader.wake();
  await h.tick(21000);
  assert.equal(h.requests.length, 1);
  assert.equal(isCurrent(h.reader.snapshot()), false);
  stop();
});

test("aborted remount and manual retry schedule cooldown, never a hot loop", async () => {
  const h = harness(() => new Promise(() => {}));
  let stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  stop();
  stop = h.reader.subscribe(() => {});
  await h.reader.check();
  const scheduled = [...h.timers.values()].map((t) => t.at);
  assert.ok(scheduled.some((at) => at >= 31000));
  assert.equal(
    scheduled.some((at) => at < 5000),
    false
  );
  stop();
});

test("trusted status-time header avoids duplicate server Date ambiguity", () => {
  const headers = new Headers({
    date: "Sun, 25 Oct 2026 09:01:00 GMT, Sun, 25 Oct 2026 09:01:00 GMT",
    "x-ams-status-time": "Sun, 25 Oct 2026 09:01:00 GMT",
    age: "30",
  });
  assert.equal(responseTime(headers), Date.parse("2026-10-25T09:01:30Z"));
});
test("cached clock rollback cannot resurrect an expired publication", async () => {
  let late = true;
  const h = harness(async () =>
    response(base(), {
      date: late ? "Sun, 25 Oct 2026 09:16:00 GMT" : "Sun, 25 Oct 2026 09:01:00 GMT",
    })
  );
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  assert.equal(isCurrent(h.reader.snapshot()), false);
  late = false;
  h.setTime(130000);
  await h.reader.check();
  assert.equal(isCurrent(h.reader.snapshot()), false);
  stop();
});
test("HTTP-date Retry-After prevents early requests within bounded backoff", async () => {
  const h = harness(
    async () =>
      new Response(null, {
        status: 503,
        headers: {
          date: "Sun, 25 Oct 2026 09:00:00 GMT",
          "retry-after": "Sun, 25 Oct 2026 09:04:00 GMT",
        },
      })
  );
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  h.setTime(130000);
  h.reader.localFailure();
  await h.reader.check();
  assert.equal(h.requests.length, 1);
  h.setTime(242000);
  await h.reader.check();
  assert.equal(h.requests.length, 2);
  stop();
});

test("missing response clock cannot erase the trusted monotonic floor", async () => {
  let mode = 0;
  const h = harness(async () => {
    const r = response(base(), {
      date: mode === 0 ? "Sun, 25 Oct 2026 09:20:00 GMT" : "Sun, 25 Oct 2026 09:01:00 GMT",
    });
    if (mode === 1) r.headers.delete("date");
    return r;
  });
  const stop = h.reader.subscribe(() => {});
  await h.tick(1000);
  await h.reader.check();
  assert.equal(isCurrent(h.reader.snapshot()), false);
  mode = 1;
  h.setTime(130000);
  await h.reader.check();
  assert.equal(h.reader.snapshot().serverTime, null);
  mode = 2;
  h.setTime(260000);
  await h.reader.check();
  assert.equal(isCurrent(h.reader.snapshot()), false);
  stop();
});
