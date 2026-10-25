import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let heartbeatEffect;
let heartbeatDependencies;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("await heartbeat(sessionId)")
  ) {
    heartbeatEffect = node.arguments[0];
    heartbeatDependencies = node.arguments[1]?.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(heartbeatEffect, "contest heartbeat effect must exist");
assert.match(heartbeatDependencies, /\bcontestId\b/, "contest change must cancel old refreshes");
const effectJs = ts.transpileModule(`const effect = ${heartbeatEffect.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(random = 0.5) {
  const requests = [];
  const contestRequests = [];
  const redirects = [];
  const intervals = [];
  const timers = [];
  const retryBeatRef = { current: () => {} };
  const referenceRevisionRef = { current: 0 };
  const referenceFetchInFlightRef = { current: false };
  const activeContestIdRef = { current: "contest-A" };
  class ProctorApiError extends Error {
    constructor(status) {
      super(`HTTP ${status}`);
      this.status = status;
    }
  }
  const state = {
    browserOnline: false,
    heartbeat: { consecutiveFailures: 3, lastOkAtMs: null },
    phase: null,
    ended: null,
    bell: true,
    contest: { id: "contest-A", end_at: null, reference_sheet: null },
  };
  const set = (key) => (update) => {
    state[key] = typeof update === "function" ? update(state[key]) : update;
  };
  const bindings = {
    sessionId: "session-A",
    contestId: "contest-A",
    retryBeatRef,
    referenceRevisionRef,
    referenceFetchInFlightRef,
    activeContestIdRef,
    heartbeat: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    getPublishedReferenceSheet: () =>
      new Promise((resolve, reject) => contestRequests.push({ resolve, reject })),
    readReferenceSheet: (sheet) => sheet ?? null,
    onHeartbeatSuccess: (_previous, now) => ({ consecutiveFailures: 0, lastOkAtMs: now }),
    onHeartbeatFailure: (previous) => ({
      ...previous,
      consecutiveFailures: previous.consecutiveFailures + 1,
    }),
    setHeartbeatState: set("heartbeat"),
    setBrowserOnline: set("browserOnline"),
    setContestPhase: set("phase"),
    setClockSynced: () => {},
    setContest: set("contest"),
    setBellRung: set("bell"),
    setSessionEnded: set("ended"),
    isBell: () => false,
    serverNow: () => Date.now(),
    handleContestExpiry: () => assert.fail("live contest must not expire"),
    redirectAfterRelease: (destination) => redirects.push(destination),
    ProctorApiError,
    setInterval: (callback, period) => {
      intervals.push({ callback, period });
      return intervals.length;
    },
    clearInterval: () => {},
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cancelled = true;
    },
    Math: { random: () => random, floor: Math.floor },
    Date,
  };
  return {
    requests,
    contestRequests,
    redirects,
    intervals,
    timers,
    referenceRevisionRef,
    referenceFetchInFlightRef,
    activeContestIdRef,
    ProctorApiError,
    retryBeatRef,
    state,
    start(browserOnline) {
      const scope = { ...bindings, browserOnline, contest: state.contest };
      return new Function(...Object.keys(scope), `${effectJs}; return effect();`)(
        ...Object.values(scope)
      );
    },
    runTimers() {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.callback();
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const live = (status = "active") => ({
  phase: "coding",
  ends_at: "2030-01-01T12:00:00Z",
  status,
});
const practiceLive = (revision) => ({
  ...live(),
  ends_at: null,
  ...(revision === undefined ? {} : { reference_revision: revision }),
});

test("unchanged practice revision sends no reference request", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(0));
  await flush();
  assert.equal(h.contestRequests.length, 0);
  stop();
});

test("entry preload suppresses another GET and old API keeps the preloaded copy", async () => {
  const h = harness();
  h.referenceRevisionRef.current = 4;
  h.state.contest.reference_sheet = { revision: 4 };
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(4));
  await flush();
  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive());
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 0);
  assert.equal(h.state.contest.reference_sheet.revision, 4);
  stop();
});

test("unpublishing revision zero removes the old sheet only after a valid response", async () => {
  const h = harness();
  h.referenceRevisionRef.current = 4;
  h.state.contest.reference_sheet = { revision: 4 };
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(0));
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 4);
  h.runTimers();
  h.contestRequests[0].resolve({ revision: 0, reference_sheet: null });
  await flush();
  assert.equal(h.state.contest.reference_sheet, null);
  assert.equal(h.referenceRevisionRef.current, 0);
  stop();
});

test("changed revision retry while timer is pending schedules only one GET", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(2));
  await flush();
  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive(2));
  await flush();
  assert.equal(h.timers.filter((timer) => !timer.cancelled).length, 1);
  h.runTimers();
  assert.equal(h.contestRequests.length, 1);
  stop();
});

test("many Retry clicks during a pending GET do not queue more reference fetches", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  for (let i = 1; i <= 20; i++) {
    h.retryBeatRef.current();
    h.requests[i].resolve(practiceLive(2));
    await flush();
  }
  assert.equal(h.timers.length, 0);
  assert.equal(h.contestRequests.length, 1);
  h.contestRequests[0].resolve({ revision: 1, reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.contestRequests.length, 1);
  h.retryBeatRef.current();
  h.requests[21].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 2);
  stop();
});

test("termination and unmount cancel pending reference refresh", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.retryBeatRef.current();
  h.requests[1].resolve({ ...practiceLive(1), status: "terminated" });
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 0);
  stop();
});

test("practice publication refreshes the sheet without remounting or replacing it offline", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  assert.equal(h.contestRequests.length, 0, "changed revision waits for the staggered timer");
  h.runTimers();
  assert.equal(h.contestRequests.length, 1);
  h.contestRequests[0].resolve({ revision: 1, reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 1);
  assert.equal(h.referenceRevisionRef.current, 1);

  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1, "unchanged revision makes no request");

  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  h.contestRequests[1].reject(new Error("offline"));
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 1);
  assert.equal(h.state.heartbeat.consecutiveFailures, 0);

  h.retryBeatRef.current();
  h.requests[3].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  h.contestRequests[2].resolve({ revision: 2, reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stop();
});

test("publish during an in-flight fetch does not overlap or install stale revision", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1);
  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1, "one in-flight request per client");
  h.contestRequests[0].resolve({ revision: 1, reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet, null);

  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  h.contestRequests[1].resolve({ revision: 2, reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stop();
});

test("new revision retries on the next heartbeat after an old fetch times out", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1);
  h.contestRequests[0].reject(new Error("timeout"));
  await flush();
  assert.equal(h.contestRequests.length, 1);
  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 2);
  h.contestRequests[1].resolve({ revision: 2, reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stop();
});

test("new heartbeat effect does not overlap an old reference GET and can retry", async () => {
  const h = harness();
  const stopOld = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1);
  stopOld();
  const stopNew = h.start(true);
  h.requests[1].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 1, "old request must finish before the new one starts");
  h.contestRequests[0].resolve({ revision: 1, reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.contestRequests.length, 1);
  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  assert.equal(h.contestRequests.length, 2);
  h.contestRequests[1].resolve({ revision: 2, reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stopNew();
});

test("3000 changed revisions use staggered callbacks with deterministic offsets", async () => {
  const clients = Array.from({ length: 3000 }, (_, i) => harness(i / 3000));
  const stops = clients.map((client) => client.start(true));
  for (const client of clients) client.requests[0].resolve(practiceLive(1));
  await flush();
  const buckets = Array(10).fill(0);
  for (const client of clients) {
    assert.equal(client.contestRequests.length, 0);
    assert.equal(client.timers.length, 1);
    const delay = client.timers[0].delay;
    assert(delay >= 0 && delay < 10_000);
    buckets[Math.floor(delay / 1000)]++;
    client.runTimers();
    assert.equal(client.contestRequests.length, 1);
  }
  assert.equal(
    buckets.reduce((sum, count) => sum + count, 0),
    3000
  );
  assert(Math.max(...buckets) <= 301, `peak simulated second: ${Math.max(...buckets)}`);
  for (const stop of stops) stop();
});

test("3000 unchanged revision heartbeats schedule no extra GET", async () => {
  const clients = Array.from({ length: 3000 }, () => harness());
  const stops = clients.map((client) => client.start(true));
  for (const client of clients) client.requests[0].resolve(practiceLive(0));
  await flush();
  assert.equal(
    clients.reduce((sum, client) => sum + client.contestRequests.length, 0),
    0
  );
  assert.equal(
    clients.reduce((sum, client) => sum + client.timers.length, 0),
    0
  );
  for (const stop of stops) stop();
});

test("late practice response cannot change an unmounted room", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(2));
  await flush();
  h.runTimers();
  stop();
  h.contestRequests[0].resolve({ revision: 2, reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet, null);
  assert.equal(h.referenceRevisionRef.current, 0);
});

test("contest switch discards the old room response and its 401", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive(1));
  await flush();
  h.runTimers();
  h.activeContestIdRef.current = "contest-B";
  h.state.contest = { id: "contest-B", reference_sheet: { revision: 7 } };
  h.contestRequests[0].resolve({ revision: 1, reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.referenceRevisionRef.current, 0);
  assert.equal(h.state.contest.reference_sheet.revision, 7);
  stop();

  const auth = harness();
  const stopAuth = auth.start(true);
  auth.requests[0].resolve(practiceLive(1));
  await flush();
  auth.runTimers();
  auth.activeContestIdRef.current = "contest-B";
  auth.contestRequests[0].reject(new auth.ProctorApiError(401));
  await flush();
  assert.deepEqual(auth.redirects, []);
  stopAuth();
});

test("timed contests do not fetch another reference sheet on heartbeat", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(live());
  await flush();
  assert.equal(h.contestRequests.length, 0);
  stop();
});

test("current practice metadata 401 releases, but a stale 401 does not", async () => {
  const stale = harness();
  const stopStale = stale.start(true);
  stale.requests[0].resolve(practiceLive(1));
  await flush();
  stale.runTimers();
  stale.retryBeatRef.current();
  stale.requests[1].resolve(practiceLive(1));
  await flush();
  stale.contestRequests[0].reject(new stale.ProctorApiError(401));
  await flush();
  assert.deepEqual(stale.redirects, []);
  stopStale();

  const current = harness();
  const stopCurrent = current.start(true);
  current.requests[0].resolve(practiceLive(1));
  await flush();
  current.runTimers();
  current.contestRequests[0].reject(new current.ProctorApiError(401));
  await flush();
  assert.deepEqual(current.redirects, ["/login"]);
  stopCurrent();
});

test("manual Retry accepts an authoritative heartbeat while navigator stays offline", async () => {
  const h = harness();
  const stopOnline = h.start(true);
  assert.equal(h.requests.length, 1);
  stopOnline();
  const stopOffline = h.start(false);
  h.retryBeatRef.current();
  assert.equal(h.requests.length, 2, "Retry must make a fresh heartbeat request");
  h.requests[1].resolve(live());
  await flush();
  assert.equal(h.state.browserOnline, true);
  assert.equal(h.state.heartbeat.consecutiveFailures, 0);
  assert.equal(h.state.phase, "coding");
  assert.equal(h.state.bell, false);

  h.requests[0].resolve(live("terminated"));
  await flush();
  assert.equal(h.state.ended, null, "pre-disconnect response must remain stale");
  stopOffline?.();
  h.retryBeatRef.current();
  assert.equal(h.requests.length, 2, "unmounted Retry must not send another heartbeat");
});

test("an older manual Retry cannot overwrite newer authoritative session state", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(live());
  await flush();
  h.retryBeatRef.current();
  h.retryBeatRef.current();
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(live());
  await flush();
  h.requests[1].resolve(live("terminated"));
  await flush();
  assert.equal(h.state.ended, null);
  stop();
});

test("offline heartbeat polls once a minute until the server confirms reconnection", async () => {
  const h = harness();
  const stop = h.start(false);
  assert.equal(h.requests.length, 0, "offline setup should not start an immediate request");
  assert.equal(h.intervals[0]?.period, 60_000);
  h.intervals[0].callback();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(live());
  await flush();
  assert.equal(h.state.browserOnline, true);
  stop();
});

test("a pending older 401 still releases after a newer transport failure", async () => {
  const h = harness();
  const stop = h.start(true);
  h.retryBeatRef.current();
  h.requests[1].reject(new Error("network lost"));
  await flush();
  h.requests[0].reject(new h.ProctorApiError(401));
  await flush();
  assert.deepEqual(h.redirects, ["/login"]);
  stop();
});

test("an older 401 cannot undo a newer accepted heartbeat", async () => {
  const h = harness();
  const stop = h.start(true);
  h.retryBeatRef.current();
  h.requests[1].resolve(live());
  await flush();
  h.requests[0].reject(new h.ProctorApiError(401));
  await flush();
  assert.deepEqual(h.redirects, []);
  stop();
});
