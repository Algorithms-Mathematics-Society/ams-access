import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function harness(token = true) {
  const version = deferred(),
    contests = deferred(),
    states = [],
    routes = [],
    cleanup = [];
  let index = 0,
    effect,
    calls = 0;
  // Like Storage: items are the own enumerable keys, methods are not.
  const store = Object.defineProperties(
    {
      ams_display_name: "Ada Lovelace",
      ams_participant_token: "token",
      ams_active_contest: "contest-A",
      ams_device_id: "device",
      ams_theme: "dark",
      "ams_contest_answer_buffer:session-A:p1": "draft",
    },
    {
      getItem: { value: (key) => store[key] ?? null },
      removeItem: { value: (key) => delete store[key] },
    }
  );
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    localStorage: store,
    process: { env: { NEXT_PUBLIC_APP_VERSION: "4.1.0" } },
    require(name) {
      if (name === "react")
        return {
          useState: (initial) => {
            const i = index++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (value) => {
                states[i] = value;
              },
            ];
          },
          useEffect: (fn) => {
            effect = fn;
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "next/navigation")
        return {
          useRouter: () => ({
            replace: (path) => routes.push(path),
            push: (path) => routes.push(path),
          }),
        };
      if (name.endsWith("client-update"))
        return {
          fetchClientVersion: () => version.promise,
          minorUpgradeAvailable: (_, latest) => latest !== "4.1.0",
        };
      if (name.endsWith("proctor-api"))
        return {
          currentToken: () => token,
          listContests: () => {
            calls++;
            return contests.promise;
          },
          logout: () => cleanup.push("logout"),
        };
      if (name.endsWith("api-client"))
        return {
          clearQueryCache: () => cleanup.push("cache"),
          invoke: (command, args) => {
            cleanup.push([command, args.sessionId]);
            return Promise.resolve();
          },
        };
      if (name.endsWith("storage-keys"))
        return {
          STORAGE_KEYS: {
            DISPLAY_NAME: "ams_display_name",
            DEVICE_ID: "ams_device_id",
            THEME: "ams_theme",
          },
        };
      if (name.endsWith("answer-buffer"))
        return { isBufferKey: (key) => key.startsWith("ams_contest_answer_buffer:") };
      if (name.endsWith("api-base")) return { resolveApiBase: () => "fixture" };
      return new Proxy({}, { get: (_, key) => (key === "default" ? name : key) });
    },
  };
  vm.runInNewContext(code, context);
  return {
    version,
    contests,
    routes,
    calls: () => calls,
    store,
    cleanup,
    mount: () => effect(),
    render: () => {
      index = 0;
      return context.exports.default();
    },
  };
}
function find(node, label) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, label);
      if (hit) return hit;
    }
    return null;
  }
  if (node.props?.label === label) return node;
  return find(node.props?.children, label);
}
function status(tree, label) {
  assert.equal(tree.type, "StartupAnimation");
  assert.equal(tree.props.children.props.role, "status");
  assert.equal(tree.props.children.props.children.type, "RouteLoadingShell");
  assert.equal(tree.props.children.props.children.props.label, label);
}
test("startup has visible status while version and token gates wait, then while routing", async () => {
  const h = harness();
  status(h.render(), "Checking your access…");
  h.mount();
  assert.equal(h.calls(), 0);
  h.version.resolve({ latest: "4.1.0" });
  await flush();
  status(h.render(), "Checking your access…");
  assert.equal(h.calls(), 1);
  h.contests.resolve([]);
  await flush();
  // A valid token asks whose it is before opening anyone's workspace.
  assert.match(JSON.stringify(h.render()), /Continue as Ada Lovelace\?/);
  assert.deepEqual(h.routes, []);
  find(h.render(), "Continue").props.onClick();
  status(h.render(), "Opening your workspace…");
  assert.deepEqual(h.routes, ["/home"]);
});
test("not you signs the previous candidate out and keeps their drafts and the device", async () => {
  const h = harness();
  h.render();
  h.mount();
  h.version.resolve(null);
  h.contests.resolve([]);
  await flush();
  find(h.render(), "Not you? Sign out").props.onClick();
  assert.equal(h.render().props.children.type, "./WelcomeScreen");
  assert.deepEqual(h.routes, []);
  assert.deepEqual(h.cleanup, ["logout", "cache", ["configure_event_stream", null]]);
  assert.deepEqual(Object.keys(h.store), [
    "ams_device_id",
    "ams_theme",
    "ams_contest_answer_buffer:session-A:p1",
  ]);
});
test("required update takes precedence over token and welcome", async () => {
  const h = harness();
  h.render();
  h.mount();
  h.version.resolve({ latest: "4.2.0", download_url: "fixture" });
  await flush();
  assert.equal(h.render().type, "UpdateRequiredDialog");
  assert.equal(h.calls(), 0);
  assert.deepEqual(h.routes, []);
});
test("no token reveals welcome only after version gate", async () => {
  const h = harness(false);
  status(h.render(), "Checking your access…");
  h.mount();
  h.version.resolve(null);
  await flush();
  assert.equal(h.render().props.children.type, "./WelcomeScreen");
  assert.equal(h.calls(), 0);
});
