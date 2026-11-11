import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(
  new URL("./components/TeamIntegrationResult.tsx", import.meta.url),
  "utf8"
);
const out = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const module = { exports: {} };
const element = (type, props) => ({ type, props });
new Function("require", "module", "exports", out)(
  (name) =>
    name === "react/jsx-runtime"
      ? { jsx: element, jsxs: element }
      : name === "@/lib/team-vote"
        ? { integrationStatus: () => "Completed" }
        : new Proxy({}, { get: (_, p) => String(p) }),
  module,
  module.exports
);
function text(node) {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node !== "object") return String(node);
  return [node.props.label, node.props.description, node.props.children].map(text).join(" ");
}
const result = () => ({
  revision: 4,
  status: "completed",
  verdict: "AC",
  details: {
    integration_verdict: "AC",
    passed_count: 2,
    total_count: 2,
    project_failure: false,
    failing_parts: [],
    substitutions: [{ label: "3", reason: "not supplied" }],
    parts: [{ label: "3", verdict: "AC", passed_count: 2, total_count: 2, substituted: true }],
  },
});
test("a substituted AC is never rendered as a pass or credited integration", () => {
  const rendered = text(module.exports.TeamIntegrationResult({ result: result() }));
  assert.doesNotMatch(rendered, /\bAC\b/);
  assert.match(rendered, /scores nothing/);
  assert.match(rendered, /Not eligible for integration credit/);
  assert.match(rendered, /Substituted · no score/);
});
test("part verdicts and suite verdict are separate and project-wide failure avoids blame", () => {
  const r = result();
  r.details.substitutions = [];
  r.details.parts[0].substituted = false;
  r.details.integration_verdict = "WA";
  r.details.project_failure = true;
  r.details.failing_parts = ["3"];
  const rendered = text(module.exports.TeamIntegrationResult({ result: r }));
  assert.match(rendered, /AC · 2\/2 checks/);
  assert.match(rendered, /Suite verdict: WA/);
  assert.match(rendered, /no single part/);
  assert.doesNotMatch(rendered, /Check parts/);
});
test("missing detail does not advertise a passing summary", () => {
  const r = result();
  r.details = null;
  const rendered = text(module.exports.TeamIntegrationResult({ result: r }));
  assert.doesNotMatch(rendered, /\bAC\b/);
  assert.match(rendered, /pass cannot be confirmed/);
});
