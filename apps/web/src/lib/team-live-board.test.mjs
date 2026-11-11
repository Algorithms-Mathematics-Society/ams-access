import assert from "node:assert/strict";
import { parseLiveBoard, startLiveBoardPolling } from "./team-live-board.ts";
const row = {
  uid: "team-a",
  name: "Alpha",
  rank: 1,
  score: 10,
  solved: 2,
  integration_passed: true,
  performance: { score: 1, median_ns: 100, iqr_ns: 2, revision: 4, pending: false },
};
const payload = (team = row) => ({ teams: [team], benchmark: { best_median_ns: 100 } });
assert.equal(parseLiveBoard(payload()).teams[0].performance.score, 1);
assert.equal(
  parseLiveBoard(payload({ ...row, performance: { ...row.performance, pending: true } })).teams[0]
    .performance.pending,
  true
);
assert.equal(parseLiveBoard({ teams: [row, row] }), null);
assert.equal(parseLiveBoard(payload({ ...row, score: Infinity })), null);
assert.equal(parseLiveBoard({ teams: Array(3001).fill(row) }), null);
assert.equal(
  parseLiveBoard(payload({ ...row, performance: { ...row.performance, pending: "yes" } })),
  null
);
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
function setup(request, isCurrent = () => true) {
  const timers = new Map(),
    states = [],
    calls = [];
  let seq = 0;
  const stop = startLiveBoardPolling({
    url: "https://example.test/board",
    headers: () => ({ Authorization: "test" }),
    onState: (s) => states.push(s),
    isCurrent,
    random: () => 0,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    schedule: (fn, delay) => {
      const id = ++seq;
      timers.set(id, { fn, delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  const tick = async () => {
    const [id, timer] = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)[0];
    timers.delete(id);
    timer.fn();
    await flush();
  };
  return { stop, states, calls, timers, tick };
}
let count = 0;
const live = setup(async () =>
  ++count === 1
    ? new Response(JSON.stringify(payload()), { headers: { ETag: '"one"' } })
    : count === 2
      ? new Response(null, { status: 304 })
      : new Response(
          JSON.stringify(payload({ ...row, performance: { ...row.performance, score: 0.75 } })),
          { headers: { ETag: '"two"' } }
        )
);
await live.tick();
assert.equal(live.states.at(-1).status, "ready");
assert.equal([...live.timers.values()][0].delay, 5000);
await live.tick();
assert.equal(live.calls[1][1].headers["If-None-Match"], '"one"');
assert.equal(live.states.at(-1).board.teams[0].performance.score, 1);
await live.tick();
assert.equal(live.states.at(-1).board.teams[0].performance.score, 0.75);
live.stop();
assert.equal(live.timers.size, 0);
const denied = setup(async () => new Response(null, { status: 403 }));
await denied.tick();
assert.equal(denied.states.at(-1).status, "denied");
assert.equal(denied.states.at(-1).board, null);
assert.equal(denied.timers.size, 0);
const retry = setup(
  async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } })
);
await retry.tick();
assert.equal([...retry.timers.values()][0].delay, 120000);
retry.stop();
let release;
const pending = setup(
  () =>
    new Promise((r) => {
      release = r;
    })
);
await pending.tick();
assert.equal(pending.calls.length, 1);
assert.equal([...pending.timers.values()][0].delay, 8000);
pending.stop();
assert.equal(pending.calls[0][1].signal.aborted, true);
release(new Response(JSON.stringify(payload())));
await flush();
assert.equal(pending.states.length, 1);
assert.equal(pending.timers.size, 0);
let current = true,
  resolve;
const stale = setup(
  () =>
    new Promise((r) => {
      resolve = r;
    }),
  () => current
);
await stale.tick();
current = false;
resolve(new Response(JSON.stringify(payload())));
await flush();
assert.equal(stale.states.length, 1);
assert.equal(stale.timers.size, 0);
stale.stop();
const huge = setup(async () => new Response(" ".repeat(2_000_001)));
await huge.tick();
assert.equal(huge.states.at(-1).status, "retrying");
huge.stop();
console.log(
  "Live board parsing, conditional updates, timeout/stop and stale identity tests passed"
);
