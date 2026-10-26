import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function handler(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, name);
  return found;
}
const start = source.indexOf("  const runQuestionKey =");
const end = source.indexOf("  const [questionCustomCases", start);
assert.ok(start >= 0 && end > start);
const lifecycleStart = source.indexOf("  // Leaving the session cancels");
const lifecycleEnd = source.indexOf("  // PRIMARY", lifecycleStart);
const compiled = ts.transpileModule(
  `function render(sessionId, activeQ) {
  ${source.slice(start, end)}
  ${source.slice(lifecycleStart, lifecycleEnd)}
  const currentQId = questions[activeQ].id;
  ${["resetRunPanelState", "switchQuestion", "triggerRun", "pollRun", "recheckRun", "runSourceChanged"].map(handler).join("\n")}
  return { triggerRun, switchQuestion, recheckRun, runSlices, runMode, isRunning, runningQuestionKey, runSourceSnapshot, runSourceChanged };
}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function harness() {
  const slots = [],
    posts = [],
    polls = [],
    timers = [];
  let cursor = 0,
    selected = 0,
    previousSession,
    cleanup;
  const context = {
    questions: [{ id: "A" }, { id: "B" }],
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useCallback: (callback) => callback,
    useEffect(effect, [session]) {
      if (previousSession === session) return;
      cleanup?.();
      previousSession = session;
      cleanup = effect();
    },
    runVisitRef: { current: 0 },
    runInFlightRef: { current: false },
    setResultSelections() {},
    editorFiles: [{ id: "main", content: "answer" }],
    activeFileId: "main",
    activeFile: { name: "main.cpp" },
    currentCode: "answer",
    toLanguageId: () => "cpp17",
    attemptLimitError: () => null,
    editorLocked: false,
    toWire: (value) => value,
    customCases: [],
    setActiveQ: (value) => {
      selected = value;
    },
    setHasUnsavedChanges() {},
    loadQuestion() {},
    selectedLanguage: "C++17",
    setSubmitError() {},
    activeDraftSnapshot: () => ({ fileId: "main", source: "answer", language: "cpp17", files: [] }),
    handleSave: async () => {},
    runAgainstSamples: (session, payload) => {
      const gate = deferred();
      posts.push({ session, payload, ...gate });
      return gate.promise;
    },
    getRun: (session, id) => {
      const gate = deferred();
      polls.push({ session, id, ...gate });
      return gate.promise;
    },
    setTimeout: (callback) => {
      timers.push(callback);
    },
    toAttemptRecords: (attempts) => attempts,
    normalizeAttemptForRunResult: (attempt) => attempt,
    isPendingSubmissionStatus: (status) => ["QUEUED", "RUNNING"].includes(status),
    setTestResults() {},
    ProctorApiError: class extends Error {},
  };
  vm.runInNewContext(compiled, context);
  return {
    context,
    posts,
    polls,
    timers,
    render(session = "session") {
      cursor = 0;
      return context.render(session, selected);
    },
    unmount: () => cleanup(),
    tick: async () => {
      assert.ok(timers.length);
      timers.shift()();
      await flush();
    },
  };
}

test("switching questions during Run POST preserves its queued status and result on return", async () => {
  const h = harness();
  h.render();
  const startRun = h.render().triggerRun;
  const pending = startRun();
  await flush();
  assert.equal(h.posts.length, 1);
  h.render().switchQuestion(1);
  await h.render().triggerRun();
  assert.equal(h.posts.length, 1, "navigation must not open a duplicate Run window");
  h.posts[0].resolve({ uid: "run-A" });
  await flush();
  await startRun();
  assert.equal(h.posts.length, 1, "an old click callback cannot overlap the active poll");
  assert.equal(h.render().runSlices.all.result, null, "B cannot display A's queued attempt");
  h.render().switchQuestion(0);
  assert.equal(h.render().runSlices.all.result.status, "QUEUED");
  h.render().switchQuestion(1);
  await h.tick();
  h.polls[0].resolve({ id: "run-A", status: "AC", testcases: [] });
  await pending;
  assert.equal(h.render().runSlices.all.result, null);
  h.render().switchQuestion(0);
  assert.equal(h.render().runSlices.all.result.status, "AC");
  assert.equal(h.render().runSourceSnapshot.questionId, "A");
});

test("navigation during draft save still sends the captured question's Run", async () => {
  const h = harness();
  h.render();
  const save = deferred();
  h.context.handleSave = () => save.promise;
  const pending = h.render().triggerRun();
  h.render().switchQuestion(1);
  save.resolve();
  await flush();
  assert.equal(h.posts[0].payload.problemLabel, "A");
  h.posts[0].resolve({ uid: "run-A" });
  await flush();
  await h.tick();
  h.polls[0].resolve({ id: "run-A", status: "AC" });
  await pending;
});

test("Check again polls the selected output kind and rejects repeated clicks", async () => {
  const h = harness();
  h.render();
  const pending = h.render().triggerRun();
  await flush();
  h.posts[0].resolve({ uid: "samples-A" });
  await flush();
  for (let index = 0; index < 22; index++) {
    await h.tick();
    h.polls[index].resolve({ id: "samples-A", status: "QUEUED" });
    await flush();
  }
  await pending;
  assert.equal(h.render().runSlices.all.timedOut, true);
  const custom = h.render().triggerRun(true);
  await flush();
  h.posts[1].resolve({ uid: "custom-A" });
  await flush();
  await h.tick();
  h.polls.at(-1).resolve({ id: "custom-A", status: "WA" });
  await custom;
  const view = h.render();
  view.recheckRun("all");
  view.recheckRun("all");
  assert.equal(h.timers.length, 1);
  await h.tick();
  assert.equal(h.polls.at(-1).id, "samples-A");
  h.polls.at(-1).resolve({ id: "samples-A", status: "AC" });
  await flush();
  assert.equal(h.render().runSlices.all.result.status, "AC");
  assert.equal(h.render().runSlices.custom.result.status, "WA");
  assert.equal(h.posts.length, 2);
});

test("session change and unmount discard old Run responses", async () => {
  for (const leave of ["session", "unmount"]) {
    const h = harness();
    h.render();
    const pending = h.render().triggerRun();
    await flush();
    if (leave === "session") h.render("other");
    else h.unmount();
    h.posts[0].resolve({ uid: "old" });
    await pending;
    assert.equal(h.timers.length, 0);
    if (leave === "session") assert.equal(h.render("other").runSlices.all.result, null);
  }
});

test("sample and custom results retain their own source snapshots and stale warnings", async () => {
  const h = harness();
  h.render();
  const samples = h.render().triggerRun();
  await flush();
  h.posts[0].resolve({ uid: "samples-A" });
  await flush();
  await h.tick();
  h.polls[0].resolve({ id: "samples-A", status: "CE" });
  await samples;
  h.context.currentCode = "edited";
  h.context.activeDraftSnapshot = () => ({
    fileId: "main",
    source: "edited",
    language: "cpp17",
    files: [],
  });
  const custom = h.render().triggerRun(true);
  await flush();
  h.posts[1].resolve({ uid: "custom-A" });
  await flush();
  await h.tick();
  h.polls[1].resolve({ id: "custom-A", status: "CE" });
  await custom;
  assert.equal(h.render().runSourceChanged("all"), true);
  assert.equal(h.render().runSourceChanged("custom"), false);
  assert.equal(h.render().runSourceSnapshot.source, "edited");
  h.render().recheckRun("all");
  assert.equal(
    h.render().runSourceSnapshot.source,
    "answer",
    "rechecking cannot relabel old compiler diagnostics as current code"
  );
  await h.tick();
  h.polls[2].resolve({ id: "samples-A", status: "CE" });
  await flush();
  assert.equal(h.render().runSourceChanged("all"), true);
  assert.equal(h.render().runSourceChanged("custom"), false);
});

test("3000 client lifecycles keep navigation request-free and Run polling bounded", async () => {
  let posts = 0,
    polls = 0;
  for (let client = 0; client < 3000; client++) {
    const h = harness();
    h.render();
    const pending = h.render().triggerRun();
    await flush();
    h.render().switchQuestion(1);
    await h.render().triggerRun();
    h.posts[0].resolve({ uid: `run-${client}` });
    await flush();
    for (let index = 0; index < 22; index++) {
      h.render().switchQuestion(index % 2);
      assert.equal(h.timers.length, 1, "navigation cannot create another polling chain");
      await h.tick();
      assert.equal(h.polls.length, index + 1);
      h.polls[index].resolve({ id: `run-${client}`, status: "QUEUED" });
      await flush();
    }
    await pending;
    h.render().switchQuestion(0);
    assert.equal(h.render().runSlices.all.timedOut, true);
    assert.equal(h.timers.length, 0, "polling stops at the budget until explicit Check again");
    posts += h.posts.length;
    polls += h.polls.length;
    h.unmount();
  }
  assert.equal(posts, 3000);
  assert.equal(polls, 66000);
});
