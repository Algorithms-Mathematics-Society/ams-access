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

function harness() {
  const requests = [];
  const contestRequests = [];
  const redirects = [];
  const intervals = [];
  const retryBeatRef = { current: () => {} };
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
    heartbeat: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    getContest: () => new Promise((resolve, reject) => contestRequests.push({ resolve, reject })),
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
    Date,
  };
  return {
    requests,
    contestRequests,
    redirects,
    intervals,
    ProctorApiError,
    retryBeatRef,
    state,
    start(browserOnline) {
      const scope = { ...bindings, browserOnline };
      return new Function(...Object.keys(scope), `${effectJs}; return effect();`)(
        ...Object.values(scope)
      );
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
const practiceLive = () => ({ ...live(), ends_at: null });

test("practice publication refreshes the sheet without remounting or replacing it offline", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive());
  await flush();
  assert.equal(h.contestRequests.length, 1);
  h.contestRequests[0].resolve({ uid: "contest-A", reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 1);

  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive());
  await flush();
  h.contestRequests[1].reject(new Error("offline"));
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 1);
  assert.equal(h.state.heartbeat.consecutiveFailures, 0);

  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive());
  await flush();
  h.contestRequests[2].resolve({ uid: "contest-A", reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stop();
});

test("older or wrong-contest practice responses cannot replace the current sheet", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive());
  await flush();
  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive());
  await flush();
  h.contestRequests[1].resolve({ uid: "contest-A", reference_sheet: { revision: 2 } });
  await flush();
  h.contestRequests[0].resolve({ uid: "contest-A", reference_sheet: { revision: 1 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);

  h.retryBeatRef.current();
  h.requests[2].resolve(practiceLive());
  await flush();
  h.contestRequests[2].resolve({ uid: "contest-B", reference_sheet: { revision: 3 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 2);
  stop();
});

test("late practice responses cannot change another contest or an unmounted room", async () => {
  const h = harness();
  const stop = h.start(true);
  h.requests[0].resolve(practiceLive());
  await flush();
  h.state.contest = { id: "contest-B", reference_sheet: { revision: 7 } };
  h.contestRequests[0].resolve({ uid: "contest-A", reference_sheet: { revision: 2 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 7);

  h.retryBeatRef.current();
  h.requests[1].resolve(practiceLive());
  await flush();
  stop();
  h.contestRequests[1].resolve({ uid: "contest-A", reference_sheet: { revision: 3 } });
  await flush();
  assert.equal(h.state.contest.reference_sheet.revision, 7);
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
  stale.requests[0].resolve(practiceLive());
  await flush();
  stale.retryBeatRef.current();
  stale.requests[1].resolve(practiceLive());
  await flush();
  stale.contestRequests[0].reject(new stale.ProctorApiError(401));
  await flush();
  assert.deepEqual(stale.redirects, []);
  stopStale();

  const current = harness();
  const stopCurrent = current.start(true);
  current.requests[0].resolve(practiceLive());
  await flush();
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
