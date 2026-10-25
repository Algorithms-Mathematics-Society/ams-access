import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function functionSource(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `${name} must remain an actual contest handler`);
  return found;
}

const handlers = ts.transpileModule(
  [
    "handleLanguageChange",
    "handleCodeChange",
    "activeDraftSnapshot",
    "writeLocalAnswerBuffer",
    "doSave",
    "handleSave",
    "triggerRun",
    "handleSubmitSolution",
  ]
    .map(functionSource)
    .join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;

let committedSnapshot;
function findCommit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useLayoutEffect" &&
    node.arguments[0]?.getText(ast).includes("latestActiveDraftRef.current =")
  ) {
    committedSnapshot = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, findCommit);
}
findCommit(ast);
assert.ok(
  committedSnapshot,
  "the committed editor must update the draft snapshot in a layout effect"
);
const commitSnapshot = ts.transpileModule(`const commit = ${committedSnapshot};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture() {
  const entries = new Map();
  const retryEntries = new Map();
  const pending = [];
  const files = [
    { id: "A:main", name: "main.cpp", content: "old" },
    { id: "A:scratch", name: "scratch.cpp", content: "notes" },
  ];
  const state = {
    questions: [{ id: "A" }],
    activeQ: 0,
    sessionId: "session-1",
    questionFiles: { A: files },
    questionActiveFile: { A: "A:main" },
    editorFiles: files,
    activeFileId: "A:main",
    selectedLanguage: "C++23",
    latestActiveDraftRef: {
      current: {
        sessionId: "session-1",
        questionId: "A",
        fileId: "A:main",
        source: "old",
        language: "cpp23",
        files,
      },
    },
    unsavedOnDeviceRef: { current: [] },
    draftRevisionsRef: { current: {} },
    setQuestionFiles: (update) => pending.push(update),
    setHasUnsavedChanges: () => {},
    setUnsavedOnDevice: () => {},
    setSavedAnswers: () => {},
    writeAnswerBuffer: (store, sessionId, questionId, answer) => {
      entries.set(`${sessionId}:${questionId}`, structuredClone(answer));
      return true;
    },
    toLanguageId: (value) => (value === "Python 3" ? "python3" : "cpp23"),
    normalizeLanguageLabel: (value) => value,
    questionFileName: (_question, language) => (language === "Python 3" ? "main.py" : "main.cpp"),
    isPristineStarter: () => false,
    defaultStarterFor: () => "starter",
    setSelectedLanguage: () => {},
    isRunning: false,
    runInFlightRef: { current: false },
    runVisitRef: { current: 0 },
    setRunMode: () => {},
    setIsRunning: () => {},
    resetRunPanelState: () => {},
    setSubmitError: () => {},
    setRunSourceSnapshot: (value) => (state.runSourceSnapshot = value),
    runAgainstSamples: async (_session, payload) => {
      state.runPayload = payload;
      return { uid: "run-1" };
    },
    patchRun: () => {},
    pollRun: async () => {},
    ProctorApiError: class extends Error {},
    submitInFlightRef: { current: false },
    exitInFlightRef: { current: false },
    submitKeyRef: { current: null },
    acknowledgedSubmitKeysRef: { current: {} },
    setIsSubmitting: () => {},
    setSubmissionError: () => {},
    newIdempotencyKey: () => "submit-1",
    submitSolution: async (_session, payload) => {
      state.submitPayload = payload;
      return { uid: "submission-1" };
    },
    setSubmittedSources: () => {},
    fetchSubmissions: async () => {},
    localStorage: {
      getItem: (key) => retryEntries.get(key) ?? null,
      setItem: (key, value) => retryEntries.set(key, String(value)),
      removeItem: (key) => retryEntries.delete(key),
    },
  };
  const api = new Function(
    ...Object.keys(state),
    `${handlers}; return { handleLanguageChange, handleCodeChange, handleSave, writeLocalAnswerBuffer, triggerRun, handleSubmitSolution };`
  )(...Object.values(state));
  return {
    api,
    entries,
    state,
    commit: () =>
      new Function(
        ...Object.keys(state),
        "currentQId",
        "currentCode",
        `${commitSnapshot}; commit();`
      )(
        ...Object.values(state),
        "A",
        state.editorFiles.find((file) => file.id === state.activeFileId)?.content ?? ""
      ),
    flush: () =>
      pending.splice(0).forEach((update) => (state.questionFiles = update(state.questionFiles))),
  };
}

test("each edit reaches the local buffer before React commits, preserving scratch tabs", async () => {
  const { api, entries, flush } = fixture();
  api.handleCodeChange("first");
  api.handleCodeChange("second");
  const draft = entries.get("session-1:A");
  assert.equal(draft.files.find((file) => file.id === "A:main")?.content, "second");
  assert.equal(draft.files.find((file) => file.id === "A:scratch")?.content, "notes");
  await api.handleSave();
  assert.equal(entries.get("session-1:A").files[0].content, "second");
  flush();
  assert.equal(api.writeLocalAnswerBuffer(), true); // stale redirect closure
  assert.equal(entries.get("session-1:A").files[0].content, "second");
});

test("an immediate language switch keeps the last uncommitted edit and every tab", async () => {
  const { api, entries } = fixture();
  api.handleCodeChange("latest code");
  api.handleLanguageChange("Python 3");
  api.handleCodeChange("latest code plus one");
  const draft = entries.get("session-1:A");
  assert.equal(draft.language, "python3");
  assert.deepEqual(
    draft.files.map(({ name, content }) => ({ name, content })),
    [
      { name: "main.py", content: "latest code plus one" },
      { name: "scratch.cpp", content: "notes" },
    ]
  );
  await api.handleSave();
  assert.equal(entries.get("session-1:A").files[0].content, "latest code plus one");
});

test("a committed scratch-tab change replaces the immediate snapshot before later saves", () => {
  const { api, entries, state, commit, flush } = fixture();
  api.handleCodeChange("new main");
  flush();
  state.questionFiles.A = state.questionFiles.A.map((file) =>
    file.id === "A:scratch" ? { ...file, content: "new scratch" } : file
  );
  state.questionActiveFile.A = "A:scratch";
  state.editorFiles = state.questionFiles.A;
  state.activeFileId = "A:scratch";
  commit();
  api.writeLocalAnswerBuffer(); // old render's writer must use the committed snapshot
  assert.equal(entries.get("session-1:A").activeFileId, "A:scratch");
  assert.deepEqual(
    entries.get("session-1:A").files.map((file) => file.content),
    ["new main", "new scratch"]
  );
});

test("Run and Submit send the latest edit before React commits it", async () => {
  const { api, state } = fixture();
  api.handleLanguageChange("Python 3");
  api.handleCodeChange("fresh solution");
  await api.triggerRun();
  await api.handleSubmitSolution();
  assert.equal(state.runPayload.source, "fresh solution");
  assert.equal(state.runPayload.language, "python3");
  assert.equal(state.runSourceSnapshot.source, "fresh solution");
  assert.equal(state.runSourceSnapshot.filename, "main.py");
  assert.equal(state.submitPayload.source, "fresh solution");
  assert.equal(state.submitPayload.language, "python3");
});

test("a snapshot from another session cannot be written under this session", () => {
  const { api, entries, state } = fixture();
  state.latestActiveDraftRef.current.sessionId = "previous-session";
  state.latestActiveDraftRef.current.files = [{ id: "A:main", name: "main.cpp", content: "other" }];
  api.writeLocalAnswerBuffer();
  assert.equal(entries.get("session-1:A").files[0].content, "old");
});
