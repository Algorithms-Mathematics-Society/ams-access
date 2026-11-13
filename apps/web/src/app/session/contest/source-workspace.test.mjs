import test from "node:test";
import assert from "node:assert/strict";
import {
  sourcePathError,
  sourceWorkspaceError,
  workspaceFromFiles,
  workspaceFingerprint,
} from "./source-workspace.ts";
import { chooseRestore } from "./answer-buffer.ts";
import { draftBackup, restoreDraftWorkspace } from "./draft-workspace.ts";

const initial = workspaceFromFiles(
  [
    { name: "src/main.cpp", content: '#include "helpers.hpp"\nint main() { return answer(); }' },
    { name: "include/helpers.hpp", content: "int answer();" },
    { name: "src/helpers.cpp", content: "int answer() { return 42; }" },
  ],
  "src/main.cpp"
);

test("whole source set includes all translation units and no headers", () => {
  assert.deepEqual(initial.compilation_units, ["src/main.cpp", "src/helpers.cpp"]);
  assert.equal(sourceWorkspaceError(initial), null);
  assert.ok(workspaceFingerprint("cpp", initial).includes("helpers.hpp"));
});

test("paths, duplicate names, size bounds, and entrypoint are rejected before POST", () => {
  for (const path of [
    "/main.cpp",
    "../main.cpp",
    "src//main.cpp",
    "src\\main.cpp",
    "src/a.txt",
    "src/./main.cpp",
    "CON.cpp",
    "aux.hpp",
    "src/a b.cpp",
    "src/a:main.cpp",
    ".hidden.cpp",
    "src/main..cpp.",
  ])
    assert.ok(sourcePathError(path), path);
  assert.match(
    sourceWorkspaceError({ ...initial, entrypoint: "include/helpers.hpp" }),
    /entrypoint/i
  );
  assert.match(
    sourceWorkspaceError({
      ...initial,
      source_files: [...initial.source_files, { path: "SRC/MAIN.CPP", content: "" }],
    }),
    /duplicate/i
  );
  assert.match(
    sourceWorkspaceError({
      ...initial,
      source_files: [...initial.source_files, { path: "src/main.cpp/header.hpp", content: "" }],
    }),
    /folder/i
  );
  assert.match(
    sourceWorkspaceError({
      ...initial,
      source_files: [{ path: "main.cpp", content: "é".repeat(131073) }],
      entrypoint: "main.cpp",
      compilation_units: ["main.cpp"],
    }),
    /256,000 bytes/i
  );
  assert.match(
    sourceWorkspaceError({ ...initial, compilation_units: ["src/main.cpp"] }),
    /compilation units/i
  );
});

test("multi-file local recovery and server backup retain every source and entrypoint", () => {
  const files = initial.source_files.map((file) => ({
    id: `A:source:${file.path}`,
    name: file.path,
    content: file.content,
  }));
  const buffered = {
    language: "cpp",
    files,
    activeFileId: files[1].id,
    entrypoint: initial.entrypoint,
    savedAtMs: 1,
    revision: 4,
  };
  const server = {
    language: "cpp",
    source: "",
    source_files: initial.source_files,
    entrypoint: initial.entrypoint,
    compilation_units: initial.compilation_units,
    client_revision: 4,
  };
  assert.equal(chooseRestore(buffered, server), "same");
  const backup = draftBackup(buffered, undefined, true);
  assert.deepEqual(backup.sourceFiles, initial.source_files);
  assert.deepEqual(backup.compilationUnits, initial.compilation_units);
  assert.equal(draftBackup(buffered, backup.fingerprint, true), null);
  assert.equal(
    draftBackup(
      { ...buffered, files: [{ id: "bad", name: "../bad.cpp", content: "x" }] },
      undefined,
      true
    ),
    null,
    "invalid local buffers must not send a rejected PUT every backup interval"
  );
  assert.equal(restoreDraftWorkspace("A", "main.cpp", buffered, server).activeFileId, files[1].id);
  const newer = restoreDraftWorkspace("A", "main.cpp", buffered, {
    ...server,
    source_files: [{ path: "main.cpp", content: "new" }],
    entrypoint: "main.cpp",
    client_revision: 5,
  });
  assert.deepEqual(
    newer.files.map((file) => [file.name, file.content]),
    [["main.cpp", "new"]]
  );
  assert.equal(newer.entrypoint, "main.cpp");
});

test("draft backup preserves deliberately emptied files and exact byte limit", () => {
  const buffered = {
    language: "cpp",
    entrypoint: "main.cpp",
    activeFileId: "main",
    files: [{ id: "main", name: "main.cpp", content: "" }],
    savedAtMs: 1,
    revision: 2,
  };
  const backup = draftBackup(buffered, "old snapshot", true);
  assert.deepEqual(backup.sourceFiles, [{ path: "main.cpp", content: "" }]);
  for (const [size, valid] of [
    [256000, true],
    [256001, false],
  ]) {
    const workspace = workspaceFromFiles(
      [{ name: "main.cpp", content: "x".repeat(size) }],
      "main.cpp"
    );
    assert.equal(sourceWorkspaceError(workspace) === null, valid);
  }
});
