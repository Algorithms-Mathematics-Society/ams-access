import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

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

function fixture() {
  let key = 0;
  const accepted = new Map();
  const posts = [];
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
    toLanguageId: (value) => value,
    newIdempotencyKey: () => `key-${++key}`,
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
  return { state, posts, accepted, submit };
}

test("accepted submission with a lost response retries the same key without duplicating", async () => {
  const f = fixture();
  await f.submit();
  assert.equal(f.state.error, "Response lost");
  await f.submit();
  assert.equal(f.posts[0].idempotencyKey, f.posts[1].idempotencyKey);
  assert.equal(f.accepted.size, 1);
  assert.equal(f.state.submitKeyRef.current, null);
  assert.equal(f.state.error, null);
  await f.submit();
  assert.equal(f.accepted.size, 2, "a new acknowledged click is a new attempt");
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
