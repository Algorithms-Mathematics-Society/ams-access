import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "page.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "emergencyExit")
    callback = node.initializer.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(callback);
const code = ts.transpile(`const action=${callback};`, { target: ts.ScriptTarget.ES2022 });
function harness({ pending = false, mediaFailure = false, outcome = "confirmed" } = {}) {
  const routes = [],
    errors = [],
    calls = [];
  let pendingNow = pending;
  const bindings = {
    exitInProgressRef: { current: false },
    setupLeavingRef: { current: false },
    setSetupLeaving() {},
    setExitingSetup() {},
    setExitError: (v) => errors.push(v),
    advanceController: {
      deactivate() {
        calls.push("stop-stages");
      },
    },
    stageRun: { stage: 1 },
    entryAttemptsRef: {
      current: {
        hasPendingWork: () => pendingNow,
        cancel() {
          calls.push("cancel");
        },
      },
    },
    hasPendingFullscreenWork: () => false,
    cameraSession: {
      release() {
        if (mediaFailure) throw Error("media");
      },
    },
    cameraStreamRef: { current: {} },
    setCameraStream() {},
    releaseDeviceControls: async () => {
      calls.push("release");
      pendingNow = false;
      return { outcome };
    },
    router: { push: (v) => routes.push(v) },
  };
  return {
    routes,
    errors,
    calls,
    run: new Function(...Object.keys(bindings), `${code}; return action;`)(
      ...Object.values(bindings)
    ),
  };
}
test("late acquisition settling during release requires a fresh restoration pass", async () => {
  const h = harness({ pending: true });
  await h.run();
  assert.deepEqual(h.routes, []);
  assert.match(h.errors.at(-1), /unverified/);
  await h.run();
  assert.deepEqual(h.routes, ["/home"]);
});
test("camera failure never skips independent release or claims success", async () => {
  const h = harness({ mediaFailure: true });
  await h.run();
  assert(h.calls.includes("release"));
  assert.deepEqual(h.routes, []);
});
test("unknown native restoration routes to recovery after cancelling setup", async () => {
  const h = harness({ outcome: "unknown" });
  await h.run();
  assert.deepEqual(h.calls, ["stop-stages", "cancel", "release"]);
  assert.deepEqual(h.routes, ["/home?restore=pending"]);
});
test("repeated exit clicks share one setup release", async () => {
  const h = harness();
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.calls.filter((x) => x === "release").length, 1);
  assert.deepEqual(h.routes, ["/home"]);
});
