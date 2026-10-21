import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function findScheduler() {
  let schedule;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "scheduleRetry") {
      schedule = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(schedule, "actual contest scheduleRetry helper must exist");
  return schedule;
}

test("preview failure replacing the synchronous lost retry leaves one pending timer", () => {
  const timers = new Map();
  const cleared = [];
  let nextId = 1;
  const setTimeout = (callback, delay) => {
    const id = nextId++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = (id) => {
    cleared.push(id);
    timers.delete(id);
  };
  const state = { cancelled: false, retryTimer: null };
  const typed = findScheduler().getText(ast);
  const transpiled = ts.transpileModule("const scheduler = " + typed + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const actual = transpiled
    .match(/const scheduler = ([\s\S]*);/)[1]
    .replaceAll("retryTimer", "state.retryTimer")
    .replaceAll("cancelled", "state.cancelled");
  const scheduleRetry = new Function(
    "state",
    "setTimeout",
    "clearTimeout",
    "return (" + actual + ");"
  )(state, setTimeout, clearTimeout);

  scheduleRetry(() => {}, 1500);
  const lostTimer = state.retryTimer;
  scheduleRetry(() => {}, 700);

  assert.deepEqual(cleared, [lostTimer]);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 700);
});

test("all camera-effect retry delays route through the actual single scheduler", () => {
  const delays = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "scheduleRetry" &&
      node.arguments.length === 2 &&
      ts.isNumericLiteral(node.arguments[1])
    )
      delays.push(Number(node.arguments[1].text));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const delay of [150, 700, 900, 1500]) assert.ok(delays.includes(delay), String(delay));

  const start = source.indexOf("let acquiring = false;", source.indexOf("if (loading) return"));
  const cameraEffect = source.slice(start, source.indexOf("return () => {", start));
  const directTimers = [...cameraEffect.matchAll(/retryTimer\s*=\s*setTimeout/g)];
  assert.equal(directTimers.length, 1, "only scheduleRetry may assign a retry timer");
});
