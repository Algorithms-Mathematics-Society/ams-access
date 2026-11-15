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

test("pending integration explains when details appear", () => {
  const r = result();
  r.status = "running";
  r.details = null;
  const rendered = text(module.exports.TeamIntegrationResult({ result: r }));
  assert.match(rendered, /after judging finishes/);
  assert.doesNotMatch(rendered, /pass cannot be confirmed/);
});

const viewSource = readFileSync(
  new URL("./components/TeamResultsView.tsx", import.meta.url),
  "utf8"
);
const viewOut = ts.transpileModule(viewSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const viewModule = { exports: {} };
new Function("require", "module", "exports", viewOut)(
  (name) =>
    name === "react/jsx-runtime"
      ? { jsx: element, jsxs: element }
      : name === "next/dynamic"
        ? { default: () => "DynamicSection" }
        : name === "./TeamIntegrationResult"
          ? { TeamIntegrationResult: "IntegrationResult" }
          : new Proxy({}, { get: (_, p) => String(p) }),
  viewModule,
  viewModule.exports
);
function integrationRevisions(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(integrationRevisions);
  if (node.type === "IntegrationResult") return [node.props.result?.revision ?? null];
  return integrationRevisions(node.props.children);
}
test("integration view retains current judging and distinct previous result", () => {
  const render = (integration, last_result) =>
    integrationRevisions(
      viewModule.exports.default({
        contestUid: "contest",
        board: { team: { uid: "team" }, submission: { integration, last_result } },
      })
    );
  const previous = result(),
    current = { ...result(), revision: 5, status: "running" };
  assert.deepEqual(render(current, previous), [5, 4]);
  assert.deepEqual(render(previous, previous), [4]);
  assert.deepEqual(render(null, previous), [4]);
  assert.deepEqual(render(null, null), [null]);
});
test("parent navigation selects live board and benchmark views", () => {
  for (const section of ["live", "benchmarks"]) {
    const tree = viewModule.exports.default({
      contestUid: "contest",
      board: { team: { uid: "team" } },
      section,
    });
    assert.deepEqual(integrationRevisions(tree), []);
    const children = tree.props.children.filter(Boolean);
    assert.equal(children.length, 1);
    assert.equal(children[0].props.visible, true);
    assert.equal(children[0].props.contestUid, "contest");
  }
});
