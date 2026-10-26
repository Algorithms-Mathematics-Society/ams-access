import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("./TerminalPanel.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

function harness() {
  let selected = "all",
    deps,
    effect,
    tree;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useMemo: (fn) => fn(),
          useState: () => [
            selected,
            (value) => {
              selected = value;
            },
          ],
          useEffect(fn, next) {
            if (!deps || next.some((value, i) => value !== deps[i])) effect = fn;
            deps = next;
          },
        };
      if (name === "../custom-cases") return { sendable: () => [] };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(compiled, context);
  let props = {
    problemLabel: "A",
    runMode: "all",
    customCases: [],
    runViews: { all: {}, custom: {} },
    submissionsList: [],
    runProgressSteps: [],
    testResults: {},
    testResultFilter: "all",
  };
  function all(type, node = tree) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => all(type, child ?? null));
    return [...(node.type === type ? [node] : []), ...all(type, node.props?.children ?? null)];
  }
  return {
    render(next = {}) {
      props = { ...props, ...next };
      effect = undefined;
      tree = context.exports.TerminalPanel(props);
      effect?.();
      tree = context.exports.TerminalPanel(props);
    },
    choose(tab) {
      selected = tab;
    },
    tab: () => selected,
    results: () => all("ResultsPanel")[0]?.props,
    buttons: () => all("Button"),
  };
}

test("Run polls cannot replace a newer queued submission or steal output tabs", () => {
  const h = harness();
  const selection = { source: "submission" };
  h.render({
    resultSelection: selection,
    latestAttempt: { id: "submission", status: "QUEUED" },
    latestAttemptPending: true,
  });
  h.choose("custom");
  h.render();
  h.render({ runResult: { id: "run", status: "RUNNING" }, isRunning: true });
  assert.equal(h.tab(), "custom");
  h.choose("all");
  h.render();
  assert.equal(h.results().submitted, true);
  assert.equal(h.results().isRunning, true);
  h.choose("custom");
  h.render({
    latestAttempt: { id: "submission", status: "COMPLETED", final_verdict: "AC" },
    latestAttemptPending: false,
  });
  assert.equal(h.tab(), "custom");
  h.choose("all");
  h.render();
  assert.equal(h.results().verdict, "AC");
});

test("a new Run action selects Run, but an older submission completion cannot steal it", () => {
  const h = harness();
  h.render({
    resultSelection: { source: "run" },
    runViews: { all: { result: { status: "QUEUED" } }, custom: {} },
    latestAttempt: { id: "old", status: "RUNNING" },
  });
  h.render({ latestAttempt: { id: "old", status: "COMPLETED", final_verdict: "WA" } });
  assert.equal(h.results().submitted, false);
  assert.equal(h.results().verdict, "QUEUED");
});

test("Run errors and compiler output never leak into selected submission results", () => {
  const h = harness();
  h.render({
    resultSelection: { source: "submission" },
    runResult: { status: "CE", compile_output: "old error" },
    runViews: { all: { timedOut: true, error: "old error" }, custom: {} },
    latestAttempt: { id: "submission", status: "COMPLETED", final_verdict: "AC" },
  });
  assert.equal(h.results().error, null);
  assert.equal(h.results().compilerText, undefined);
  assert.equal(h.results().compilerIsError, false);
});

test("Check again rechecks the pane's attempt, not whichever mode ran last", () => {
  const h = harness();
  const modes = [];
  h.render({
    resultSelection: { source: "run" },
    runMode: "custom",
    runViews: { all: { timedOut: true, status: { label: "Still running" } }, custom: {} },
    onCheckRunAgain: (mode) => modes.push(mode),
  });
  h.choose("all");
  h.render();
  h.buttons()
    .find((button) => button.props.label === "Check again")
    .props.onClick();
  assert.deepEqual(modes, ["all"]);
});

test("compiler diagnostics belong to the selected Run pane", () => {
  const h = harness();
  h.render({
    resultSelection: { source: "run" },
    runMode: "custom",
    runResult: { status: "AC" },
    runViews: {
      all: { result: { status: "CE", compile_output: "sample compile error" } },
      custom: { result: { status: "AC" } },
    },
    onJumpToCompilerError: () => {},
  });
  h.choose("all");
  h.render();
  assert.equal(h.results().compilerText, "sample compile error");
  assert.equal(h.results().compilerIsError, true);
  assert.equal(h.results().onJumpToCompilerError, undefined);
  h.choose("custom");
  h.render();
  assert.equal(h.results().compilerText, undefined);
  assert.equal(h.results().compilerIsError, false);
});

test("each Run pane reports changes against its own source snapshot", () => {
  const h = harness();
  h.render({
    resultSelection: { source: "run" },
    runMode: "custom",
    runViews: {
      all: { result: { status: "AC" }, sourceChanged: true },
      custom: { result: { status: "AC" }, sourceChanged: false },
    },
  });
  assert.equal(h.results().stale, false);
  h.choose("all");
  h.render();
  assert.equal(h.results().stale, true);
});
