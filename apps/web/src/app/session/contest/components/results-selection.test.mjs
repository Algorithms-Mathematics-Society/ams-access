import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { mergeAttemptTestResults } from "../attempt-adapter.ts";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./ResultsPanel.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
);
// Observe the real panel's selection effect, using its loading branch to avoid
// unrelated rendering. This also covers selection changes as results arrive.
function harness() {
  let selected, dependencies, effect;
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return {
          useMemo: (fn) => fn(),
          useState: (initial) => [
            (selected ??= initial),
            (value) => {
              selected = value;
            },
          ],
          useEffect: (fn, next) => {
            if (!dependencies || next.some((value, index) => value !== dependencies[index]))
              effect = fn;
            dependencies = next;
          },
        };
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (name === "../sample-join") return { sampleOrdinals: () => [] };
      if (name === "../family-summary") return { GATE_KIND: "symbolic" };
      return {};
    },
  };
  vm.runInNewContext(outputText, context);
  return {
    choose: (index) => {
      selected = index;
    },
    render(tests) {
      effect = undefined;
      context.exports.ResultsPanel({ tests, isRunning: true, emptyHint: "" });
      effect?.();
      return selected;
    },
  };
}
const rows = () =>
  Array.from({ length: 5 }, (_, index) => ({
    testcase_no: index + 1,
    verdict: index === 1 ? "WA" : "AC",
  }));

test("equivalent list refresh preserves the candidate's selected case", () => {
  const h = harness(),
    cached = { a: rows() };
  assert.equal(h.render(cached.a), 1);
  h.choose(4);
  const refreshed = mergeAttemptTestResults(cached, [{ id: "a", testcases: rows() }]);
  assert.equal(h.render(refreshed.a), 4);
});

test("switching attempts initializes selection even with equivalent cases", () => {
  const h = harness(),
    cached = { a: rows() };
  h.render(cached.a);
  h.choose(4);
  const refreshed = mergeAttemptTestResults(cached, [{ id: "b", testcases: rows() }]);
  assert.equal(h.render(refreshed.b), 1);
});

test("shorter results and pending-to-terminal results initialize a valid case", () => {
  const h = harness(),
    cached = { a: rows() };
  h.render(cached.a);
  h.choose(4);
  const shortened = mergeAttemptTestResults(cached, [{ id: "a", testcases: rows().slice(0, 1) }]);
  assert.equal(h.render(shortened.a), 0);
  assert.equal(h.render([]), 0);
  assert.equal(h.render(rows()), 1);
});
