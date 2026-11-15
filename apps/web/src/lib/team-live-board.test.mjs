import assert from "node:assert/strict";
import { parseLiveBoard, startLiveBoardPolling } from "./team-live-board.ts";
const row = {
  uid: "team-a",
  name: "Alpha",
  rank: 1,
  score: 10,
  solved: 2,
  integration_passed: true,
  performance: { score: 1, median_ns: 100, iqr_ns: 2, revision: 4, pending: false },
};
const payload = (team = row) => ({ teams: [team], benchmark: { best_median_ns: 100 } });
assert.equal(parseLiveBoard(payload()).teams[0].performance.score, 1);
assert.equal(
  parseLiveBoard(payload({ ...row, performance: { ...row.performance, pending: true } })).teams[0]
    .performance.pending,
  true
);
assert.equal(parseLiveBoard({ teams: [row, row] }), null);
assert.equal(parseLiveBoard(payload({ ...row, score: Infinity })), null);
assert.equal(parseLiveBoard({ teams: Array(3001).fill(row) }), null);
assert.equal(
  parseLiveBoard(payload({ ...row, performance: { ...row.performance, pending: "yes" } })),
  null
);
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
function setup(request, isCurrent = () => true) {
  const timers = new Map(),
    states = [],
    calls = [];
  let seq = 0;
  const stop = startLiveBoardPolling({
    url: "https://example.test/board",
    headers: () => ({ Authorization: "test" }),
    onState: (s) => states.push(s),
    isCurrent,
    random: () => 0,
    request: async (...args) => {
      calls.push(args);
      return request(...args);
    },
    schedule: (fn, delay) => {
      const id = ++seq;
      timers.set(id, { fn, delay });
      return id;
    },
    cancel: (id) => timers.delete(id),
  });
  const tick = async () => {
    const [id, timer] = [...timers.entries()].sort((a, b) => a[1].delay - b[1].delay)[0];
    timers.delete(id);
    timer.fn();
    await flush();
  };
  return { stop, states, calls, timers, tick };
}
let count = 0;
const live = setup(async () =>
  ++count === 1
    ? new Response(JSON.stringify(payload()), { headers: { ETag: '"one"' } })
    : count === 2
      ? new Response(null, { status: 304 })
      : new Response(
          JSON.stringify(payload({ ...row, performance: { ...row.performance, score: 0.75 } })),
          { headers: { ETag: '"two"' } }
        )
);
await live.tick();
assert.equal(live.states.at(-1).status, "ready");
assert.equal([...live.timers.values()][0].delay, 5000);
await live.tick();
assert.equal(live.calls[1][1].headers["If-None-Match"], '"one"');
assert.equal(live.states.at(-1).board.teams[0].performance.score, 1);
await live.tick();
assert.equal(live.states.at(-1).board.teams[0].performance.score, 0.75);
live.stop();
assert.equal(live.timers.size, 0);
const denied = setup(async () => new Response(null, { status: 403 }));
await denied.tick();
assert.equal(denied.states.at(-1).status, "denied");
assert.equal(denied.states.at(-1).board, null);
assert.equal(denied.timers.size, 0);
const retry = setup(
  async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } })
);
await retry.tick();
assert.equal([...retry.timers.values()][0].delay, 120000);
retry.stop();
let release;
const pending = setup(
  () =>
    new Promise((r) => {
      release = r;
    })
);
await pending.tick();
assert.equal(pending.calls.length, 1);
assert.equal([...pending.timers.values()][0].delay, 8000);
pending.stop();
assert.equal(pending.calls[0][1].signal.aborted, true);
release(new Response(JSON.stringify(payload())));
await flush();
assert.equal(pending.states.length, 1);
assert.equal(pending.timers.size, 0);
let current = true,
  resolve;
const stale = setup(
  () =>
    new Promise((r) => {
      resolve = r;
    }),
  () => current
);
await stale.tick();
current = false;
resolve(new Response(JSON.stringify(payload())));
await flush();
assert.equal(stale.states.length, 1);
assert.equal(stale.timers.size, 0);
stale.stop();
const huge = setup(async () => new Response(" ".repeat(2_000_001)));
await huge.tick();
assert.equal(huge.states.at(-1).status, "retrying");
huge.stop();
console.log(
  "Live board parsing, conditional updates, timeout/stop and stale identity tests passed"
);

// Run the component's actual hooks/handlers with the polling owner stubbed.
const { readFileSync } = await import("node:fs");
const ts = (await import("typescript")).default;
const componentSource = readFileSync(
  new URL("../app/session/contest/components/TeamLiveBoard.tsx", import.meta.url),
  "utf8"
);
const slots = [],
  effects = [],
  pendingEffects = [],
  pollers = [];
let cursor = 0,
  dirty = false,
  epoch = 1,
  authListener;
const react = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [
      slots[i],
      (update) => {
        const next = typeof update === "function" ? update(slots[i]) : update;
        if (!Object.is(next, slots[i])) {
          slots[i] = next;
          dirty = true;
        }
      },
    ];
  },
  useRef(initial) {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useEffect(callback, deps) {
    const i = cursor++;
    if (!effects[i] || deps.some((value, index) => !Object.is(value, effects[i].deps[index]))) {
      pendingEffects.push(() => {
        effects[i]?.cleanup?.();
        effects[i] = { deps, cleanup: callback() };
      });
    }
  },
};
const output = {};
const browser = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
new Function(
  "require",
  "exports",
  "document",
  ts.transpileModule(componentSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
)(
  (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
      };
    if (name.includes("team-live-board"))
      return {
        startLiveBoardPolling(options) {
          const poller = { ...options, stopped: false };
          pollers.push(poller);
          return () => {
            poller.stopped = true;
          };
        },
      };
    if (name.includes("candidate-auth")) return { authHeaders: () => ({}) };
    if (name.includes("proctor-api"))
      return {
        authGeneration: () => epoch,
        subscribeAuthChanges: (callback) => {
          authListener = callback;
          return () => {};
        },
      };
    if (name.includes("api-base")) return { resolveApiBase: () => "/api" };
    return new Proxy({}, { get: (_, key) => String(key) });
  },
  output,
  browser
);
let props = { contestUid: "first", ownTeamUid: "team-2700", visible: true };
function renderBoard() {
  let tree;
  for (let attempt = 0; attempt < 10; attempt++) {
    dirty = false;
    cursor = 0;
    tree = output.default(props);
    while (pendingEffects.length) pendingEffects.shift()();
    if (!dirty) return tree;
  }
  assert.fail("component did not settle");
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
function inspectBoard() {
  const tree = nodes(renderBoard());
  return {
    rows: tree.filter((node) => node.type === "ListItem"),
    pagination: tree.find((node) => node.type === "Pagination"),
    jump: tree.find((node) => node.type === "Button" && node.props.label === "Show your team"),
  };
}
const largeBoard = parseLiveBoard({
  teams: Array.from({ length: 3000 }, (_, index) => ({
    ...row,
    uid: `team-${index}`,
    name: `Team ${index}`,
    rank: index + 1,
  })),
});
assert.ok(largeBoard);
renderBoard();
assert.equal(pollers.length, 1);
pollers[0].onState({ board: largeBoard, status: "ready" });
let shown = inspectBoard();
assert.equal(shown.rows.length, 50);
assert.equal(shown.pagination.props.page, 1);
assert.equal(shown.pagination.props.totalItems, 3000);
const currentState = slots[0];
dirty = false;
pollers[0].onState({ board: largeBoard, status: "ready" });
assert.equal(slots[0], currentState, "unchanged 304 state must preserve React state identity");
assert.equal(dirty, false);
pollers[0].onState({ board: largeBoard, status: "retrying" });
assert.notEqual(slots[0], currentState, "status changes still render against unchanged data");
shown.jump.props.onClick();
shown = inspectBoard();
assert.equal(shown.pagination.props.page, 55);
assert.ok(shown.rows[0].props.label.props.children.includes("Your team"));
assert.ok(shown.jump, "jump control stays mounted on the own-team page");
assert.equal(pollers.length, 1, "local page changes must not restart polling");
shown.pagination.props.onChange(60);
assert.equal(inspectBoard().pagination.props.page, 60);
pollers[0].onState({
  board: { ...largeBoard, teams: largeBoard.teams.slice(0, 51) },
  status: "ready",
});
shown = inspectBoard();
assert.equal(shown.pagination.props.page, 2);
assert.equal(shown.rows.length, 1);
pollers[0].onState({ board: largeBoard, status: "ready" });
assert.equal(inspectBoard().pagination.props.page, 2, "shrunk page is persisted when rows return");
props = { ...props, contestUid: "second" };
assert.equal(inspectBoard().rows.length, 0);
assert.equal(pollers[0].stopped, true);
assert.equal(pollers[0].isCurrent(), false);
assert.equal(pollers.length, 2);
pollers[1].onState({ board: largeBoard, status: "ready" });
shown = inspectBoard();
assert.equal(shown.pagination.props.page, 1, "new contest resets page");
shown.jump.props.onClick();
assert.equal(inspectBoard().pagination.props.page, 55);
epoch++;
authListener();
shown = inspectBoard();
assert.equal(shown.rows.length, 0);
assert.equal(shown.pagination, undefined);
assert.equal(slots[0].status, "denied");
assert.equal(slots[1], 1, "auth change resets local page");
assert.equal(pollers[1].stopped, true);
assert.equal(pollers[1].isCurrent(), false);
props = { ...props, visible: false };
assert.equal(renderBoard(), null);
assert.equal(pollers.length, 2, "hidden board does not start another request owner");
console.log("Live board bounded rendering, own-team jump, identity bailout and auth reset pass");
