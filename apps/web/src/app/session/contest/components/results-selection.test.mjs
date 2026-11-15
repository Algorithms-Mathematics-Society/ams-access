import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { candidateCheckFailed, resultSummary } from "../result-summary.ts";
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
  let selected, dependencies, effect, tree;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return {
          useMemo: (fn) => fn(),
          useState: (initial) => [
            (selected ??= initial),
            (value) => {
              selected = typeof value === "function" ? value(selected) : value;
            },
          ],
          useEffect: (fn, next) => {
            if (!dependencies || next.some((value, index) => value !== dependencies[index]))
              effect = fn;
            dependencies = next;
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "../result-summary") return { candidateCheckFailed, resultSummary };
      if (name === "../sample-join")
        return { sampleOrdinals: () => [], exampleFor: () => undefined };
      if (name === "../family-summary") return { GATE_KIND: "symbolic" };
      return {};
    },
  };
  vm.runInNewContext(outputText, context);
  return {
    choose: (index) => {
      selected = index;
    },
    strip() {
      const visit = (node) => {
        if (!node || typeof node !== "object") return undefined;
        if (Array.isArray(node)) return node.map(visit).find(Boolean);
        return node.props?.role === "tablist" ? node : visit(node.props?.children);
      };
      return visit(tree)?.props;
    },
    render(tests, isRunning = true) {
      effect = undefined;
      tree = context.exports.ResultsPanel({ tests, isRunning, emptyHint: "", verdict: "WA" });
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

test("case arrows focus and reveal only the case strip; refreshed results do not move focus", () => {
  const h = harness();
  const tests = rows();
  h.render(tests, false);
  h.choose(0);
  h.render(tests, false);
  const focused = [];
  const chips = Array.from({ length: tests.length }, (_, index) => ({
    focus(options) {
      focused.push({ index, preventScroll: options.preventScroll });
    },
    getBoundingClientRect: () => ({
      left: 100 + index * 100 - strip.scrollLeft,
      right: 200 + index * 100 - strip.scrollLeft,
    }),
  }));
  const strip = {
    scrollLeft: 0,
    clientLeft: 0,
    clientWidth: 150,
    getBoundingClientRect: () => ({ left: 100 }),
    querySelectorAll: () => chips,
  };
  let prevented = 0;
  const key = (key) =>
    h.strip().onKeyDown({
      key,
      currentTarget: strip,
      preventDefault() {
        prevented++;
      },
    });
  key("ArrowRight");
  assert.equal(h.render(tests, false), 1);
  assert.equal(strip.scrollLeft, 50);
  assert.deepEqual(focused, [{ index: 1, preventScroll: true }]);
  key("ArrowLeft");
  assert.equal(h.render(tests, false), 0);
  assert.equal(strip.scrollLeft, 0);
  key("ArrowLeft");
  assert.equal(h.render(tests, false), 0);
  assert.equal(strip.scrollLeft, 0);
  const focusCount = focused.length;
  h.render(rows(), false);
  assert.equal(focused.length, focusCount);
  assert.equal(prevented, 3);
});
