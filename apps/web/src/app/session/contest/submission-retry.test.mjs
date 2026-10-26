import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { attemptLimitError } from "./attempt-limits.ts";

const client = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const start = client.indexOf("  async function handleSubmitSolution()");
const end = client.indexOf("  // Exit teardown:", start);
assert.ok(start >= 0 && end > start);
const draftStart = client.indexOf("  function activeDraftSnapshot()");
const draftEnd = client.indexOf("  // `casesOverride`", draftStart);
assert.ok(draftStart >= 0 && draftEnd > draftStart);
const handler = ts.transpileModule(client.slice(draftStart, draftEnd) + client.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(shared = { accepted: new Map(), posts: [], store: new Map(), nextKey: 0 }) {
  const { accepted, posts } = shared;
  const state = {
    questions: [{ id: "A" }, { id: "B" }],
    activeQ: 0,
    sessionId: "session-1",
    editorFiles: [{ id: "main", content: "answer one" }],
    activeFileId: "main",
    selectedLanguage: "cpp17",
    latestActiveDraftRef: { current: null },
    submitInFlightRef: { current: false },
    exitInFlightRef: { current: false },
    submitKeyRef: { current: null },
    acknowledgedSubmitKeysRef: { current: {} },
    toLanguageId: (value) => value,
    attemptLimitError,
    newIdempotencyKey: () => `key-${++shared.nextKey}`,
    localStorage: {
      getItem: (key) => shared.store.get(key) ?? null,
      setItem: (key, value) => shared.store.set(key, String(value)),
      removeItem: (key) => shared.store.delete(key),
    },
    setIsSubmitting: () => {},
    setSubmissionError: (error) => {
      state.error = error;
    },
    setSubmittedSources: (update) => {
      state.sources = update(state.sources ?? {});
    },
    ProctorApiError: class extends Error {},
    fetchSubmissions: async () => {},
    loseResponse: true,
    submitSolution: async (sessionId, payload) => {
      posts.push({ sessionId, ...payload });
      const existing = accepted.get(payload.idempotencyKey);
      if (existing) return existing;
      const created = { uid: `attempt-${accepted.size + 1}`, ...payload };
      accepted.set(payload.idempotencyKey, created);
      if (state.loseResponse) {
        state.loseResponse = false;
        throw new Error("Response lost");
      }
      return created;
    },
  };
  // Recreate the render's closure while keeping React-like refs across calls.
  const submit = () =>
    new Function(...Object.keys(state), `${handler}; return handleSubmitSolution();`)(
      ...Object.values(state)
    );
  return { state, posts, accepted, submit, shared };
}

test("accepted submission with a lost response retries the same key without duplicating", async () => {
  const f = fixture();
  await f.submit();
  assert.equal(f.state.error, "Response lost");
  await f.submit();
  assert.equal(f.posts[0].idempotencyKey, f.posts[1].idempotencyKey);
  assert.equal(f.accepted.size, 1);
  assert.equal(f.state.submitKeyRef.current, null);
  assert.match(f.state.error, /Confirmed an earlier submission request/);
  await f.submit();
  assert.equal(f.accepted.size, 2, "a new acknowledged click is a new attempt");
});

test("accepted submission with a lost response survives a remount without a second attempt", async () => {
  const first = fixture();
  await first.submit();
  assert.equal(first.accepted.size, 1);
  const resumed = fixture(first.shared);
  resumed.state.loseResponse = false;
  await resumed.submit();
  assert.equal(resumed.posts[0].idempotencyKey, resumed.posts[1].idempotencyKey);
  assert.equal(resumed.accepted.size, 1);
  assert.match(resumed.state.error, /Confirmed an earlier submission request/);
});

test("a remount into another session cannot reuse the previous session's retry key", async () => {
  const first = fixture();
  await first.submit();
  const otherSession = fixture(first.shared);
  otherSession.state.sessionId = "session-2";
  otherSession.state.loseResponse = false;
  await otherSession.submit();
  assert.notEqual(first.posts[0].idempotencyKey, first.posts[1].idempotencyKey);
  assert.equal(first.accepted.size, 2);
});

test("unavailable local storage blocks the POST before an unrepeatable attempt is accepted", async () => {
  const f = fixture();
  f.state.localStorage.setItem = () => {
    throw new Error("quota");
  };
  await f.submit();
  assert.equal(f.posts.length, 0);
  assert.match(f.state.error, /Could not save the submission retry record/);
});

test("an unreadable pending retry record blocks POST even when writing is available", async () => {
  const first = fixture();
  await first.submit();
  const resumed = fixture(first.shared);
  resumed.state.localStorage.getItem = () => {
    throw new Error("read blocked");
  };
  await resumed.submit();
  assert.equal(resumed.posts.length, 1);
  assert.equal(resumed.accepted.size, 1);
  assert.match(resumed.state.error, /Could not read the submission retry record/);
});

test("failed retry-record deletion leaves an acknowledged tombstone and preserves new clicks", async () => {
  const f = fixture();
  f.state.loseResponse = false;
  f.state.localStorage.removeItem = () => {
    throw new Error("blocked");
  };
  await f.submit();
  assert.equal(f.state.error, null);
  assert.deepEqual(JSON.parse(f.shared.store.get("ams_pending_submission:session-1:A")), {
    acknowledged: true,
  });
  await f.submit();
  assert.notEqual(f.posts[0].idempotencyKey, f.posts[1].idempotencyKey);
  assert.equal(f.accepted.size, 2);

  const resumed = fixture(f.shared);
  resumed.state.loseResponse = false;
  resumed.state.localStorage.removeItem = f.state.localStorage.removeItem;
  await resumed.submit();
  assert.equal(f.accepted.size, 3, "an acknowledged record must not suppress a new click");
  assert.notEqual(f.posts[1].idempotencyKey, f.posts[2].idempotencyKey);
});

test("if deletion and tombstone both fail, restart conservatively replays the old attempt", async () => {
  const first = fixture();
  first.state.loseResponse = false;
  first.state.localStorage.removeItem = () => {
    throw new Error("blocked");
  };
  const submit = first.state.submitSolution;
  first.state.submitSolution = async (...args) => {
    const result = await submit(...args);
    first.state.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    return result;
  };
  await first.submit();
  assert.match(first.state.error, /Submission accepted, but this device could not clear/);

  const resumed = fixture(first.shared);
  resumed.state.loseResponse = false;
  await resumed.submit();
  assert.equal(resumed.accepted.size, 1);
  assert.equal(resumed.posts[0].idempotencyKey, resumed.posts[1].idempotencyKey);
  assert.match(resumed.state.error, /Confirmed an earlier submission request/);
});

test("failed cleanup on A, then B, still permits a new same-source A attempt", async () => {
  const f = fixture();
  f.state.loseResponse = false;
  f.state.localStorage.removeItem = () => {
    throw new Error("blocked");
  };
  await f.submit();
  f.state.activeQ = 1;
  await f.submit();
  f.state.activeQ = 0;
  await f.submit();
  assert.equal(f.accepted.size, 3);
  assert.notEqual(f.posts[0].idempotencyKey, f.posts[2].idempotencyKey);
});

for (const dimension of ["source", "problem", "language", "session"]) {
  test(`a changed ${dimension} cannot be discarded as the previous submission's retry`, async () => {
    const f = fixture();
    await f.submit();
    if (dimension === "source") f.state.editorFiles = [{ id: "main", content: "answer two" }];
    if (dimension === "problem") f.state.activeQ = 1;
    if (dimension === "language") f.state.selectedLanguage = "python3";
    if (dimension === "session") f.state.sessionId = "session-2";
    await f.submit();
    assert.notEqual(f.posts[0].idempotencyKey, f.posts[1].idempotencyKey);
    assert.equal(f.accepted.size, 2);
    assert.deepEqual(f.state.sources["attempt-2"], {
      source: f.posts[1].source,
      language: f.posts[1].language,
    });
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("rapid double submit is blocked and captured payload survives navigation during POST", async () => {
  const f = fixture();
  const gate = deferred();
  const original = f.state.submitSolution;
  f.state.loseResponse = false;
  f.state.submitSolution = async (...args) => {
    await gate.promise;
    return original(...args);
  };
  const pending = f.submit();
  f.state.activeQ = 1;
  f.state.editorFiles = [{ id: "main", content: "different answer" }];
  await f.submit();
  gate.resolve();
  await pending;
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].problemLabel, "A");
  assert.equal(f.posts[0].source, "answer one");
});

test("history refresh does not hold acceptance guard or clear a newer POST guard", async () => {
  const f = fixture();
  f.state.loseResponse = false;
  const history = deferred();
  const secondPost = deferred();
  f.state.fetchSubmissions = () => history.promise;
  const first = f.submit();
  await Promise.resolve();
  assert.equal(f.state.submitInFlightRef.current, false);
  const original = f.state.submitSolution;
  f.state.submitSolution = async (...args) => {
    await secondPost.promise;
    return original(...args);
  };
  const second = f.submit();
  assert.equal(f.state.submitInFlightRef.current, true);
  history.resolve();
  await first;
  assert.equal(f.state.submitInFlightRef.current, true);
  secondPost.resolve();
  await second;
  assert.equal(f.state.submitInFlightRef.current, false);
});

test("a finishing session cannot start another submission", async () => {
  const f = fixture();
  f.state.exitInFlightRef.current = true;
  await f.submit();
  assert.equal(f.posts.length, 0);
});

test("a failed final Run poll cannot time out the next problem", async () => {
  const start = client.indexOf("  async function pollRun(");
  const end = client.indexOf("\n  // Status-only re-poll", start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(client.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let rejectRun;
  let polls = 0;
  const writes = [];
  const context = {
    runVisitRef: { current: 1 },
    setTimeout: (callback) => callback(),
    getRun: () => {
      polls++;
      return new Promise((_resolve, reject) => {
        rejectRun = reject;
      });
    },
    setIsRunning: (value) => writes.push(["running", value]),
    patchRun: (mode, value) => writes.push([mode, value]),
  };
  const poll = new Function(...Object.keys(context), `${code}; return pollRun;`)(
    ...Object.values(context)
  );
  const pending = poll("all", "session", "attempt", 1, [0]);
  await Promise.resolve();
  assert.equal(polls, 1);
  context.runVisitRef.current = 2; // switchQuestion invalidates the old run
  rejectRun(new Error("connection lost"));
  await pending;
  assert.deepEqual(writes, []);
});
