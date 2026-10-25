import { test } from "node:test";
import assert from "node:assert/strict";
import { supportDiagnostics } from "./support-diagnostics.ts";
test("automatic context excludes credentials, identifiers, arbitrary errors and nested logs", () => {
  const data = supportDiagnostics({
    source: "resume_flow",
    resume_status: "PENDING",
    password: "ABCD-EFGH-IJKL",
    token: "Bearer private",
    session: "private-id",
    diagnostics: { camera: "secret" },
    problem: "private server error",
    email: "person@example.test",
  });
  assert.deepEqual(data, { source: "resume_flow", resume_status: "PENDING" });
});
test("even allowed keys cannot smuggle arbitrary strings or personal check labels", () => {
  assert.deepEqual(
    supportDiagnostics({
      source: "private",
      issue: "Bearer private",
      resume_status: "private",
      checks: { "name@example.test": "pass", secret: "token" },
    }),
    { check_counts: { pass: 1 } }
  );
});
test("valid device category remains useful; check counts are bounded", () => {
  const input = {
    source: "resolve_modal",
    issue: "camera",
    checks: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, "fail"])),
  };
  assert.deepEqual(supportDiagnostics(input), {
    source: "resolve_modal",
    issue: "camera",
    check_counts: { fail: 32 },
  });
  assert.deepEqual(supportDiagnostics(undefined), {});
});

test("actual ResolveModal category keys survive without arbitrary diagnostic strings", () => {
  for (const issue of ["mic", "restrictedApps", "vm"])
    assert.deepEqual(
      supportDiagnostics({ source: "resolve_modal", issue, problem: "private raw detail" }),
      { source: "resolve_modal", issue }
    );
});
