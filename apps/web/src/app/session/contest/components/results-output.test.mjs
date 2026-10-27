import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as summary from "../result-summary.ts";
import * as output from "../execution-output.ts";
import * as language from "../rule-language.ts";
import { GATE_KIND } from "../family-summary.ts";
const source = readFileSync(new URL("./ResultsPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const jsx = (type, props) => typeof type === "function" ? type(props) : props?.children;
const context = { exports: {}, require(name) {
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
  if (name === "../result-summary") return summary;
  if (name === "../execution-output") return output;
  if (name === "../rule-language") return language;
  if (name === "../family-summary") return { GATE_KIND };
  return {};
} };
vm.runInNewContext(compiled + "\nexports.detail = CaseDetail;", context);
const render = (row) => JSON.stringify(context.exports.detail({ row }));
test("ordinary sample output is rendered including an explicit empty string", () => {
  assert.match(render({ input: "1", stdout_text: "hello\n", verdict: "AC" }), /hello/);
  const empty = render({ input: "1", stdout_text: "", verdict: "WA" });
  assert.match(empty, /empty output/);
  assert.doesNotMatch(empty, /not included/);
});
test("missing output stays distinct from empty and hidden cases", () => {
  assert.match(render({ input: "1", verdict: "WA" }), /not included/);
  const hidden = render({ verdict: "WA" });
  assert.match(hidden, /Only the verdict/);
  assert.doesNotMatch(hidden, /empty output/);
});
test("failed behavior checks retain their diagnostic and stderr", () => {
  const view = render({ kind: "behavior", verdict: "WA", label: "boundary", checker_message: "expected 7 but got 8", stderr_text: "diagnostic stderr" });
  assert.match(view, /expected 7 but got 8/);
  assert.match(view, /diagnostic stderr/);
});
