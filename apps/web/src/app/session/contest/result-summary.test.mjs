import { test } from "node:test";
import assert from "node:assert/strict";
import { resultSummary, candidateCheckFailed } from "./result-summary.ts";
import { outputText } from "./execution-output.ts";
import { contestTimestamp, clockDifferenceMessage } from "./contest-information.ts";

test("missing/unknown aggregate verdict never invents acceptance or wrong answer", () => {
  for (const verdict of [null, undefined, "", "COMPLETED", "new-status"]) {
    const view = resultSummary(verdict);
    assert.equal(view.title, "Overall verdict unavailable");
    assert.equal(view.tone, "unknown");
  }
});
test("worker failures remain distinct from candidate runtime and compile failures", () => {
  for (const code of ["SE", "IE", "FAILED"]) {
    assert.equal(resultSummary(code).tone, "unknown");
    assert.match(resultSummary(code).explanation, /not a verdict that your code is wrong/);
    assert.equal(candidateCheckFailed(code), false);
  }
  for (const code of ["RE", "CE", "WA", "TLE", "MLE", "OLE"]) {
    assert.equal(resultSummary(code).tone, "failure");
    assert.equal(candidateCheckFailed(code), true);
  }
  assert.match(resultSummary("RE").explanation, /Passed checks do not override/);
});
test("known aggregate verdict and pending states retain their meaning", () => {
  assert.equal(resultSummary("AC").tone, "success");
  for (const code of ["QUEUED", "RUNNING", "PENDING"])
    assert.equal(resultSummary(code).tone, "unknown");
  assert.equal(resultSummary(null, true).title, "Compile error");
});
test("unavailable output is not represented as actual empty stdout", () => {
  assert.equal(outputText(undefined), "Not provided by the judge");
  assert.equal(outputText(null), "Not provided by the judge");
  assert.equal(outputText(""), "(empty output)");
  assert.equal(outputText("0"), "0");
});
test("schedule is explicit UTC across offset inputs and malformed values", () => {
  assert.equal(contestTimestamp("2026-10-24T14:00:00+05:30"), "2026-10-24 08:30 UTC");
  assert.equal(contestTimestamp("invalid"), "Not provided");
  assert.equal(contestTimestamp(null), "Not provided");
});
test("clock warning requires verified server time and meaningful skew", () => {
  assert.equal(clockDifferenceMessage(false, 0, 120000), null);
  assert.equal(clockDifferenceMessage(true, 1000, 59000), null);
  assert.match(clockDifferenceMessage(true, 1000, 61000), /server time/);
  assert.match(clockDifferenceMessage(true, 100000, 0), /does not extend/);
});

// Render the actual panel to an element tree; no browser/native effects needed.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const panelJs = ts.transpileModule(
  readFileSync(new URL("./components/ResultsPanel.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }
).outputText;
function renderedPanel(props) {
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return {
          useState: (value) => [value, () => {}],
          useMemo: (fn) => fn(),
          useEffect: () => {},
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "../result-summary") return { resultSummary, candidateCheckFailed };
      if (name === "../sample-join") return { sampleOrdinals: () => [], exampleFor: () => null };
      if (name === "../family-summary") return { GATE_KIND: "symbolic" };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  };
  vm.runInNewContext(panelJs, context);
  const tree = context.exports.ResultsPanel({
    tests: [],
    emptyHint: "Nothing submitted",
    ...props,
  });
  function text(node) {
    if (node == null || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(text).join(" ");
    if (typeof node === "object") return text(node.props?.children);
    return String(node);
  }
  return text(tree);
}
test("actual panel keeps zero-row judge failures visible", () => {
  const text = renderedPanel({ verdict: "FAILED" });
  assert.match(text, /Judging could not be completed/);
  assert.doesNotMatch(text, /Nothing submitted/);
});
test("actual panel does not derive overall success or failure from testcase subsets", () => {
  for (const verdict of ["AC", "WA"]) {
    const text = renderedPanel({ tests: [{ verdict, kind: "io" }] });
    assert.match(text, /Overall verdict unavailable/);
    assert.doesNotMatch(text, /Accepted|Wrong answer/);
  }
});
test("actual panel does not blame a broken source rule for an infrastructure error", () => {
  const text = renderedPanel({
    verdict: "SE",
    tests: [{ verdict: "SE", kind: "symbolic", label: "Rule" }],
  });
  assert.match(text, /Judging could not be completed/);
  assert.doesNotMatch(text, /A source rule was broken/);
});
