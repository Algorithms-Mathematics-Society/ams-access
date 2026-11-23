import test from "node:test";
import assert from "node:assert/strict";
import { firstCompilerError, canNavigateDiagnostic } from "./compiler-diagnostics.ts";

test("parses GCC/Clang and javac errors, skipping earlier warnings", () => {
  assert.deepEqual(
    firstCompilerError(
      "main.cpp:1:1: warning: unused\n/build/main.cpp:2:3: error: expected semicolon"
    ),
    { filename: "/build/main.cpp", line: 2, column: 3, message: "expected semicolon" }
  );
  assert.deepEqual(firstCompilerError("Main.java:4: error: cannot find symbol"), {
    filename: "Main.java",
    line: 4,
    column: undefined,
    message: "cannot find symbol",
  });
});
test("parses Python syntax location, not unrelated runtime frames", () => {
  assert.deepEqual(
    firstCompilerError('  File "main.py", line 3\n    if x\nSyntaxError: expected colon'),
    { filename: "main.py", line: 3, message: "SyntaxError: expected colon" }
  );
  assert.equal(firstCompilerError('File "main.py", line 3\nValueError: wrong value'), null);
});
test("unsupported output and warnings retain raw-only presentation", () => {
  for (const output of [
    "",
    "unknown compiler failure",
    "main.cpp:2:1: warning: unused",
    "main.cpp:0:1: error: invalid",
    "system.hpp:2:1: error: missing",
  ])
    assert.equal(firstCompilerError(output), null);
});
const source = {
  questionId: "A",
  fileId: "A:main",
  filename: "main.cpp",
  source: "int main() {\nreturn 0;\n}",
  language: "cpp17",
};
const diagnostic = { filename: "/tmp/main.cpp", line: 2, column: 3, message: "example" };
test("navigation requires exact problem, file, language, and source snapshot", () => {
  assert.equal(canNavigateDiagnostic(diagnostic, source, source), true);
  assert.equal(canNavigateDiagnostic(diagnostic, null, source), false);
  for (const key of ["questionId", "fileId", "filename", "source", "language"])
    assert.equal(
      canNavigateDiagnostic(diagnostic, source, { ...source, [key]: "different" }),
      false,
      key
    );
});
test("unknown file mappings and invalid source positions cannot navigate", () => {
  for (const patch of [
    { filename: "judge.cpp" },
    { line: 99 },
    { line: 0 },
    { line: 1.5 },
    { column: 99 },
    { column: 0 },
  ])
    assert.equal(canNavigateDiagnostic({ ...diagnostic, ...patch }, source, source), false);
});

test("single-file C++ runs can navigate the worker's staged submission", () => {
  const current = { ...source, filename: "A.cpp" };
  const staged = {
    ...diagnostic,
    filename: "/var/lib/cxxprobe-worker/workspaces/job/submission.cpp",
  };
  assert.equal(canNavigateDiagnostic(staged, current, current), true);
  assert.equal(
    canNavigateDiagnostic({ ...staged, filename: "submission.cpp" }, current, current),
    true
  );
  assert.equal(
    canNavigateDiagnostic(
      {
        ...staged,
        filename: "/var/lib/cxxprobe-worker/workspaces/job/package/checker/submission.cpp",
      },
      current,
      current
    ),
    false
  );
  assert.equal(canNavigateDiagnostic(staged, current, { ...current, source: "edited" }), false);
  const sameName = { ...current, filename: "submission.cpp" };
  assert.equal(
    canNavigateDiagnostic(
      {
        ...staged,
        filename: "/var/lib/cxxprobe-worker/workspaces/job/package/checker/submission.cpp",
      },
      sameName,
      sameName
    ),
    false
  );
  const python = { ...current, language: "python3", filename: "A.py" };
  assert.equal(canNavigateDiagnostic(staged, python, python), false);
});

test("workspace diagnostics use the exact staged relative path", () => {
  const current = { ...source, filename: "main.cpp", workspaceFingerprint: "bundle" };
  const staged = "/var/lib/cxxprobe-worker/workspaces/job/submission-files";
  assert.equal(
    canNavigateDiagnostic({ ...diagnostic, filename: staged + "/main.cpp" }, current, current),
    true
  );
  for (const filename of [
    staged + "/nested/main.cpp",
    "/elsewhere/main.cpp",
    "/worker/submission.cpp",
  ]) {
    assert.equal(canNavigateDiagnostic({ ...diagnostic, filename }, current, current), false);
  }
  const nested = { ...current, filename: "nested/main.cpp" };
  assert.equal(
    canNavigateDiagnostic({ ...diagnostic, filename: "./nested/main.cpp" }, nested, nested),
    true
  );
});
