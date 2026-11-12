import { strict as assert } from "node:assert";
import {
  parseBenchmarks,
  benchmarkStatus,
  benchmarkTrend,
  readBoundedResponse,
} from "./team-benchmarks.ts";
const run = {
  uid: "11111111-1111-1111-1111-111111111111",
  revision: 3,
  status: "ok",
  median_ns: 100,
  iqr_ns: 5,
  repetitions: 7,
  instructions: 400,
  has_profile: true,
  parts_profile: [{ owner: "1", share: 0.5, top_symbols: [["foo", 40]] }],
};
const parsed = parseBenchmarks([run]);
assert.equal(parsed[0].parts[0].symbols[0][0], "foo");
assert.equal(parsed[0].iqr, 5);
const pendingRuns = parseBenchmarks([{ ...run, status: "noisy", pending_remeasurement: true }]);
assert.match(benchmarkStatus(pendingRuns[0]), /not a regression/);
assert.equal(benchmarkTrend(pendingRuns).length, 0);
assert.equal(benchmarkTrend(parsed).length, 1);
assert.throws(() => parseBenchmarks([run, run]));
assert.throws(() => parseBenchmarks([{ ...run, uid: "../../secret" }]));
assert.deepEqual(
  parseBenchmarks([{ ...run, parts_profile: [{ owner: "x", share: Infinity }] }])[0].parts,
  []
);
assert.equal((await readBoundedResponse(new Response("abc"), 3)).length, 3);
await assert.rejects(readBoundedResponse(new Response("abcd"), 3), /too large/);
console.log("benchmark parsing, pending trend and stream limits pass");

// Execute the component's real effects and handlers with controlled browser IO.
const { readFileSync } = await import("node:fs");
const ts = (await import("typescript")).default;
const helpers = await import("./team-benchmarks.ts");
const source = readFileSync(
  new URL("../app/session/contest/components/TeamBenchmarks.tsx", import.meta.url),
  "utf8"
);
const slots = [],
  effects = [],
  pending = [],
  requests = [],
  revoked = [];
let cursor = 0,
  epoch = 1,
  authListener,
  resolveRequest;
const react = {
  useState(initial) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [
      slots[i],
      (v) => {
        slots[i] = v;
      },
    ];
  },
  useRef(initial) {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (!effects[i] || deps.some((v, j) => !Object.is(v, effects[i].deps[j])))
      pending.push(() => {
        effects[i]?.cleanup?.();
        effects[i] = { deps, cleanup: fn() };
      });
  },
};
const ex = {};
new Function(
  "require",
  "exports",
  "fetch",
  "setTimeout",
  "clearTimeout",
  "URL",
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
)(
  (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime")
      return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name.includes("team-benchmarks")) return helpers;
    if (name.includes("candidate-auth"))
      return {
        authHeaders: () => ({ Authorization: "Bearer test" }),
        participantToken: () => String(epoch),
      };
    if (name.includes("proctor-api"))
      return {
        authGeneration: () => epoch,
        subscribeAuthChanges: (fn) => {
          authListener = fn;
          return () => {};
        },
      };
    if (name.includes("api-base")) return { resolveApiBase: () => "/api" };
    return new Proxy({}, { get: (_, key) => String(key) });
  },
  ex,
  (url, options) => {
    requests.push({ url, ...options });
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  },
  () => 1,
  () => {},
  { createObjectURL: () => "blob:test", revokeObjectURL: (url) => revoked.push(url) }
);
const render = (visible) => {
  cursor = 0;
  const result = ex.TeamBenchmarks({ contestUid: "contest", visible });
  while (pending.length) pending.shift()();
  return result;
};
render(false);
assert.equal(requests.length, 0);
render(true);
assert.equal(requests.length, 1);
assert.equal(requests[0].headers.Authorization, "Bearer test");
render(true);
assert.equal(requests.length, 1, "renders do not start more requests");
epoch++;
const resolveStale = resolveRequest;
authListener();
assert.equal(requests[0].signal.aborted, true, "sign out aborts request");
assert.equal(requests.length, 2, "a new sign-in reloads the visible history");
resolveStale(new Response(JSON.stringify([run])));
await new Promise((r) => setImmediate(r));
assert.deepEqual(slots[0], [], "stale authenticated response is discarded");
render(false);
assert.equal(requests[1].signal.aborted, true, "hidden view aborts request");
render(true);
assert.equal(requests.length, 3);
render(false);
assert.equal(requests[2].signal.aborted, true, "hidden view aborts request");
assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/);
assert.match(source, /<img[\s\S]*?src=\{profile.url\}/);
render(true);
resolveRequest(new Response(JSON.stringify([run])));
await new Promise((r) => setImmediate(r));
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [
    node,
    ...(Array.isArray(node.props?.children) ? node.props.children : [node.props?.children])
      .flat(Infinity)
      .flatMap(nodes),
    ...nodes(node.props?.description),
  ];
}
let tree = render(true);
const view = nodes(tree).find((n) => n.props?.label === "View flamegraph for revision 3");
assert.ok(view);
view.props.onClick();
resolveRequest(
  new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>', {
    headers: { "content-type": "image/svg+xml" },
  })
);
await new Promise((r) => setImmediate(r));
tree = render(true);
assert.equal(nodes(tree).find((n) => n.type === "img").props.src, "blob:test");
nodes(tree)
  .find((n) => n.props?.label === "Close flamegraph")
  .props.onClick();
assert.ok(revoked.includes("blob:test"), "close revokes image URL");
