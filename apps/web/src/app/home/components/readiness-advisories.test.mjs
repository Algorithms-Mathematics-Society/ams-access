import test from "node:test";
import assert from "node:assert/strict";
import { advisoryReportChecks } from "./readiness-advisories.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";
const report = {
  decision: "allowed_with_warnings",
  checks: [
    { kind: "camera", outcome: "pass" },
    { kind: "external_display", outcome: "warn", detail: "A second display is connected" },
    { kind: "clock_integrity", outcome: "unknown", detail: null },
    { kind: "remote_server", outcome: "warn", detail: "Remote sharing is enabled" },
  ],
  optional_checks: [{ kind: "microphone", outcome: "unknown" }],
};
test("all named policy warnings, including unknown checks outside the fixed six, are returned", () => {
  assert.deepEqual(
    advisoryReportChecks(report).map((c) => c.kind),
    ["external_display", "clock_integrity", "remote_server"]
  );
  assert.deepEqual(
    advisoryReportChecks({ ...report, decision: "blocked" }),
    report.optional_checks
  );
  assert.deepEqual(advisoryReportChecks(null), []);
});
test("the actual readiness widget renders each report warning and its detail", () => {
  const exports = {};
  const element = (type, props, ...children) => ({ type, props: { ...props, children } });
  const js = ts.transpileModule(
    readFileSync(new URL("./ReadinessPanel.tsx", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        jsxFactory: "element",
      },
    }
  ).outputText;
  new Function("require", "exports", "element", js)(
    (name) => {
      if (name === "react") return { memo: (v) => v };
      if (name === "./readiness-advisories") return { advisoryReportChecks };
      if (name === "./utils")
        return { readinessCheckCopy: (kind) => ({ label: kind, fail: "Review this check" }) };
      return new Proxy({}, { get: (_, key) => key });
    },
    exports,
    element
  );
  const tree = exports.ReadinessWidget({
    readiness: {},
    report,
    theme: "dark",
    onSettingsRedirect() {},
  });
  const nodes = (n) =>
    Array.isArray(n)
      ? n.flatMap(nodes)
      : n && typeof n === "object"
        ? [n, ...nodes(n.props?.children)]
        : [];
  const rows = nodes(tree).filter((n) => n.type === "ListItem");
  assert.deepEqual(
    rows.map((n) => n.props.label),
    ["external_display", "clock_integrity", "remote_server"]
  );
  assert.equal(rows[0].props.description, "A second display is connected");
  assert.equal(rows[1].props.description, "Not verified on this device");
});
