import assert from "node:assert/strict";
import test from "node:test";
import { readResumeSetup, canReuseFaceScan, RESUME_SETUP_MAX_AGE_MS } from "./resume-setup.ts";

const context = { sessionId: "s", contestId: "c", deviceId: "d" };
const saved = { ...context, cameraId: "camera", passedAt: 1000 };

test("recent setup is bound to the session, contest, device and camera", () => {
  assert.deepEqual(readResumeSetup(JSON.stringify(saved), context, 2000), saved);
  for (const field of Object.keys(context)) {
    assert.equal(
      readResumeSetup(JSON.stringify(saved), { ...context, [field]: "other" }, 2000),
      null
    );
  }
  assert.equal(canReuseFaceScan(saved, "camera", 2000), true);
  assert.equal(canReuseFaceScan(saved, "different", 2000), false);
  assert.equal(canReuseFaceScan(null, "camera", 2000), false);
});

test("expired, future, malformed and incomplete checkpoints run full setup", () => {
  for (const raw of [
    null,
    "bad",
    "{}",
    "null",
    JSON.stringify({ ...saved, cameraId: "" }),
    JSON.stringify({ ...saved, passedAt: "1000" }),
  ]) {
    assert.equal(readResumeSetup(raw, context, 2000), null);
  }
  for (const now of [999, 1000 + RESUME_SETUP_MAX_AGE_MS]) {
    assert.equal(readResumeSetup(JSON.stringify(saved), context, now), null);
    assert.equal(canReuseFaceScan(saved, "camera", now), false);
  }
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let advance;
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(ast) === "onAdvance")
    advance = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert(advance);
const program = ts.transpileModule(`return (${advance.getText(ast)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test("the stage transition reuses only the face scan and still runs fresh presence", () => {
  for (const [checkpoint, delivering, cameraId, next, expected] of [
    [saved, true, "camera", 7, 8],
    [saved, false, "camera", 7, 7],
    [saved, true, "other", 7, 7],
    [null, true, "camera", 7, 7],
    [saved, true, "camera", 2, 2],
    [saved, true, "camera", 10, 10],
  ]) {
    let stage,
      results = {},
      reused = false;
    const track = { getSettings: () => ({ deviceId: cameraId }) };
    const context = {
      resumeSetupRef: { current: checkpoint },
      cameraStreamRef: { current: { getVideoTracks: () => [track] } },
      passedFaceRef: { current: null },
      canReuseFaceScan: (value, id) => canReuseFaceScan(value, id, 2000),
      isTrackDelivering: () => delivering,
      setResults: (update) => {
        results = update(results);
      },
      setReusedFaceScan: (value) => {
        reused = value;
      },
      setCurrentStage: (value) => {
        stage = value;
      },
      setTransitioning: () => {},
    };
    new Function(...Object.keys(context), program)(...Object.values(context))(next);
    assert.equal(stage, expected);
    assert.equal(reused, expected === 8);
    assert.deepEqual(results, expected === 8 ? { 7: "pass" } : {});
  }
});
