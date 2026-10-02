import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ensureNetworkHelper } from "./network-helper.ts";

const BUSY = "Device checks are busy. Retry shortly.";
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function harness(statuses, { os = "linux", installError, platformError } = {}) {
  const calls = [], progress = [], controller = new AbortController();
  const invoke = async (command) => {
    calls.push(command);
    if (command === "get_platform") {
      if (platformError) throw platformError;
      return os === null ? null : { os };
    }
    if (command === "install_network_helper") {
      if (installError) throw installError;
      return null; // Tauri unit return is not the helper's status.
    }
    assert.equal(command, "network_helper_running");
    assert.ok(statuses.length, "Unexpected additional helper status probe");
    const status = statuses.shift();
    if (status instanceof Error || typeof status === "string") throw status;
    return status;
  };
  const options = { invoke, signal: controller.signal, onProgress: value => progress.push(value) };
  return { calls, progress, controller, invoke, options, run: () => ensureNetworkHelper(options) };
}

test("busy then ready retries without administrator installation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([BUSY, true]), pending = h.run();
  await settle();
  assert.equal(h.calls.length, 2);
  t.mock.timers.tick(250);
  assert.equal(await pending, true);
  assert.deepEqual(h.calls, ["get_platform", "network_helper_running", "network_helper_running"]);
  assert.equal(h.progress.at(-1).phase, "pass");
});

test("persistent busy stops after three probes with a warning and no install", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([new Error(BUSY), BUSY, BUSY]), pending = h.run();
  await settle(); t.mock.timers.tick(250); await settle(); t.mock.timers.tick(500);
  assert.equal(await pending, false);
  assert.equal(h.calls.filter(command => command === "network_helper_running").length, 3);
  assert.ok(!h.calls.includes("install_network_helper"));
  assert.match(h.progress.at(-1).message, /still busy/);
});

for (const status of [new Error("IPC disconnected"), null, undefined, 0, "unexpected error", { running: false }]) {
  test(`failed or malformed status (${String(status)}) never authorizes installation`, async () => {
    const h = harness([status]);
    assert.equal(await h.run(), false);
    assert.deepEqual(h.calls, ["get_platform", "network_helper_running"]);
    assert.equal(h.progress.at(-1).phase, "warn");
  });
}

test("an explicit missing status installs once and verifies readiness", async () => {
  const h = harness([false, true], { os: "macos" });
  assert.equal(await h.run(), true);
  assert.deepEqual(h.calls, ["get_platform", "network_helper_running", "install_network_helper", "network_helper_running"]);
});

test("a post-install busy response retries verification without reinstalling", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([false, BUSY, true]), pending = h.run();
  await settle(); t.mock.timers.tick(250);
  assert.equal(await pending, true);
  assert.equal(h.calls.filter(command => command === "install_network_helper").length, 1);
});

test("failed verification after installation remains a warning", async () => {
  const h = harness([false, new Error("bridge closed")]);
  assert.equal(await h.run(), false);
  assert.equal(h.progress.at(-1).phase, "warn");
  assert.equal(h.calls.filter(command => command === "install_network_helper").length, 1);
});

test("cancelled administrator approval keeps its explanatory warning", async () => {
  const h = harness([false], { installError: new Error("admin_auth_cancelled") });
  assert.equal(await h.run(), false);
  assert.match(h.progress.at(-1).message, /approval was cancelled/);
  assert.equal(h.calls.filter(command => command === "network_helper_running").length, 1);
});

test("platform lookup failure cannot report the helper ready", async () => {
  for (const options of [{ platformError: new Error("IPC disconnected") }, { os: null }, { os: "unknown" }]) {
    const h = harness([], options);
    assert.equal(await h.run(), false);
    assert.deepEqual(h.calls, ["get_platform"]);
  }
});

test("Windows skips the Unix helper without invoking installer or status", async () => {
  const h = harness([], { os: "windows" });
  assert.equal(await h.run(), true);
  assert.deepEqual(h.calls, ["get_platform"]);
});

test("leaving during a retry cancels later probes, installation and progress", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([BUSY, false]), pending = h.run();
  await settle();
  const progressCount = h.progress.length;
  h.controller.abort();
  assert.equal(await pending, false);
  t.mock.timers.tick(1000);
  assert.deepEqual(h.calls, ["get_platform", "network_helper_running"]);
  assert.equal(h.progress.length, progressCount);
});

test("leaving while a status probe is pending prevents a late false from installing", async () => {
  let resolve;
  const h = harness([new Promise(done => { resolve = done; })]), pending = h.run();
  await settle(); h.controller.abort(); resolve(false);
  assert.equal(await pending, false);
  assert.ok(!h.calls.includes("install_network_helper"));
});

// Exercise the actual stage effect as well as the workflow: it must use the
// strict bridge, propagate warning status and cancel its advance callback.
const require = createRequire(import.meta.url), ts = require("typescript");
const source = readFileSync(new URL("./components/stages/Stage11_NetworkValidation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Stage11.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Stage11_NetworkValidation");
const effect = component.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect");
assert(effect, "Must exercise the real stage effect");
const program = ts.transpileModule(`const effect = ${effect.expression.arguments[0].getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function stageHarness(h) {
  const phases = [], advances = [];
  const context = {
    window: { __TAURI__: {} }, ensureNetworkHelper,
    invokeStrict: h.invoke,
    invoke: async command => {
      assert.equal(command, "check_network_stability", "Helper checks must use the strict bridge");
      return { reachable: true, latency_ms: 10, quality: "excellent" };
    },
    withNullableTimeout: promise => promise,
    getNetworkProbeHost: () => "example.invalid",
    isGatingRelaxed: () => false,
    setLatency: () => {}, setQuality: () => {}, setPhase: value => phases.push(value),
    setHelperPhase: () => {}, setHelperMessage: () => {},
    onPass: () => advances.push("pass"), onWarn: () => advances.push("warn"),
  };
  const start = new Function(...Object.keys(context), `${program}; return effect;`)(...Object.values(context));
  return { phases, advances, start };
}

test("actual onboarding effect warns on persistent busy without requesting installation", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([BUSY, BUSY, BUSY]), stage = stageHarness(h), cleanup = stage.start();
  await settle(); t.mock.timers.tick(250); await settle(); t.mock.timers.tick(500); await settle();
  assert.deepEqual(stage.phases, ["warn"]);
  t.mock.timers.tick(1400);
  assert.deepEqual(stage.advances, ["warn"]);
  assert.ok(!h.calls.includes("install_network_helper"));
  cleanup();
});

test("actual stage cleanup cancels a pending advance", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness([true]), stage = stageHarness(h), cleanup = stage.start();
  await settle(); assert.deepEqual(stage.phases, ["pass"]);
  cleanup(); t.mock.timers.tick(1400);
  assert.deepEqual(stage.advances, []);
});


test("supported older WebKit signals need no throwIfAborted method", async () => {
  const h = harness([true]);
  Object.defineProperty(h.controller.signal, "throwIfAborted", { value: undefined });
  assert.equal(await h.run(), true);
});
