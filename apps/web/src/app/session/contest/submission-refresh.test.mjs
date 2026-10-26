import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
// Exercise the actual local hooks without mounting unrelated native effects.
const start = source.indexOf("  const submissionRefreshRef = useRef<");
const end = source.indexOf("\n  /**", start);
assert.ok(start >= 0 && end > start);
const { outputText } = ts.transpileModule(
  `function render(sessionId, activeQ, questions) {${source.slice(start, end)}\nreturn fetchSubmissions;}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
);
function harness() {
  const ref = { current: null },
    requests = [],
    writes = [],
    errors = [];
  let cleanup, effect, previousSession;
  const state = {
    loading: false,
    history: "loading",
    attempts: [],
    results: { run: ["independent"] },
  };
  const set = (key) => (value) => {
    state[key] = typeof value === "function" ? value(state[key]) : value;
    writes.push(key);
  };
  const context = {
    Promise,
    useRef: () => ref,
    useCallback: (fn) => fn,
    useEffect: (nextEffect, [session]) => {
      if (previousSession === session) return;
      cleanup?.();
      effect = nextEffect;
      cleanup = effect();
      previousSession = session;
    },
    setLoadingSubmissions: set("loading"),
    setSubmissionHistoryStatus: set("history"),
    setAllSubmissionsList: set("attempts"),
    setTestResults: set("results"),
    listMySubmissions: (session) =>
      new Promise((resolve, reject) => requests.push({ session, resolve, reject })),
    toAttemptRecords: (records) => records,
    mergeAttemptTestResults: (previous, attempts) => ({
      ...previous,
      ...Object.fromEntries(attempts.map((a) => [a.id, a.testcases])),
    }),
    console: { error: (...args) => errors.push(args) },
  };
  vm.runInNewContext(outputText, context);
  return {
    state,
    requests,
    writes,
    errors,
    owner: () => ref.current,
    render: (session = "A", activeQ = 0, questions = [{ id: "A" }, { id: "B" }]) =>
      context.render(session, activeQ, questions),
    unmount: () => cleanup?.(),
    replay: () => {
      cleanup?.();
      cleanup = effect();
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const attempt = (status) => [{ id: "attempt", status, testcases: [status] }];

test("slow refresh and rapid question switches share one subsequent GET", async () => {
  const h = harness(),
    first = h.render()();
  await flush();
  const next = h.render("A", 1)();
  assert.equal(h.render("A", 0)(), next);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(attempt("RUNNING"));
  await first;
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.state.loading, true);
  h.requests[1].resolve(attempt("ACCEPTED"));
  await next;
  assert.equal(h.state.attempts[0].status, "ACCEPTED");
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.state.results.run, ["independent"]);
});

test("post-submit waits for a fresh GET but not subsequent polling", async () => {
  const h = harness(),
    refresh = h.render(),
    first = refresh();
  await flush();
  let submitted = false;
  const postSubmit = refresh().then(() => {
    submitted = true;
  });
  h.requests[0].resolve(attempt("RUNNING"));
  await first;
  await flush();
  assert.equal(submitted, false);
  const laterPoll = refresh();
  h.requests[1].resolve(attempt("ACCEPTED"));
  await postSubmit;
  await flush();
  assert.equal(submitted, true);
  assert.equal(h.requests.length, 3);
  assert.equal(h.state.loading, true);
  h.requests[2].resolve(attempt("ACCEPTED"));
  await laterPoll;
  assert.equal(h.state.loading, false);
});

for (const fail of [false, true]) {
  test(`session change ignores old ${fail ? "failure" : "success"}, finally and queue`, async () => {
    const h = harness(),
      oldRefresh = h.render(),
      old = oldRefresh(),
      queued = oldRefresh();
    await flush();
    const current = h.render("B")();
    await flush();
    const count = h.writes.length;
    if (fail) h.requests[0].reject(new Error("old failure"));
    else h.requests[0].resolve(attempt("RUNNING"));
    await Promise.all([old, queued, oldRefresh()]);
    assert.equal(h.writes.length, count);
    assert.equal(h.errors.length, 0);
    assert.equal(h.requests.length, 2);
    assert.equal(h.state.loading, true);
    h.requests[1].resolve(attempt("ACCEPTED"));
    await current;
    assert.equal(h.state.attempts[0].status, "ACCEPTED");
  });
}

test("unmount discards late failure and queued refresh", async () => {
  const h = harness(),
    refresh = h.render(),
    first = refresh(),
    queued = refresh();
  await flush();
  h.unmount();
  const count = h.writes.length;
  h.requests[0].reject(new Error("late failure"));
  await Promise.all([first, queued, refresh()]);
  assert.equal(h.writes.length, count);
  assert.equal(h.errors.length, 0);
  assert.equal(h.requests.length, 1);
});

test("effect replay before dispatch skips old GET and permits new owner", async () => {
  const h = harness(),
    refresh = h.render(),
    old = refresh();
  h.replay();
  const current = refresh();
  await old;
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.loading, true);
  h.requests[0].resolve(attempt("ACCEPTED"));
  await current;
  assert.equal(h.state.loading, false);
});

test("queued ownership survives the completion-to-follow-up microtask gap", async () => {
  const h = harness(),
    refresh = h.render(),
    first = refresh();
  await flush();
  // The reaction attached before queueing runs after the old GET settles but
  // before the follow-up reaction starts. It must join that follow-up.
  let intervening;
  const gap = first.then(() => {
    intervening = refresh();
  });
  const queued = refresh();
  h.requests[0].resolve(attempt("RUNNING"));
  await gap;
  await flush();
  assert.equal(intervening, queued);
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(attempt("ACCEPTED"));
  await queued;
});

test("failures settle loading, preserve available history, and allow queued recovery", async () => {
  const h = harness(),
    refresh = h.render();
  let first = refresh();
  await flush();
  h.requests[0].reject(new Error("offline"));
  await first;
  assert.equal(h.state.history, "unavailable");
  assert.equal(h.state.loading, false);
  first = refresh();
  await flush();
  h.requests[1].resolve(attempt("ACCEPTED"));
  await first;
  first = refresh();
  const queued = refresh();
  await flush();
  h.requests[2].reject(new Error("offline again"));
  await first;
  await flush();
  assert.equal(h.state.history, "stale");
  assert.equal(h.state.attempts[0].status, "ACCEPTED");
  assert.equal(h.state.loading, true);
  h.requests[3].resolve(attempt("ACCEPTED"));
  await queued;
  assert.equal(h.state.history, "available");
  assert.equal(h.state.loading, false);
});

test("missing session or active question does not fetch", async () => {
  const h = harness();
  await h.render(null)();
  await h.render("A", 0, [])();
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});

test("an older history response cannot erase an accepted POST receipt", async () => {
  const h = harness();
  const refresh = h.render();
  const pending = refresh();
  await flush();
  // The POST finishes while this earlier GET is still on the wire.
  const receipt = { id: "new-attempt", status: "QUEUED", testcases: [] };
  // Obtain the owner through the test's useRef so this is the real refresh path.
  h.owner().accepted.set(receipt.id, receipt);
  h.requests[0].resolve([]);
  await pending;
  assert.equal(h.state.attempts[0].id, receipt.id);
  const next = refresh();
  await flush();
  h.requests[1].resolve([{ ...receipt, status: "COMPLETED" }]);
  await next;
  assert.equal(h.state.attempts.length, 1);
  assert.equal(h.state.attempts[0].status, "COMPLETED");
  assert.equal(h.owner().accepted.size, 0);
});
