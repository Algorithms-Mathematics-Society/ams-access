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
    routes = [];
  let index = 0,
    effect,
    calls = 0;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
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
        };
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
    mount: () => effect(),
    render: () => {
      index = 0;
      return context.exports.default();
    },
  };
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
  status(h.render(), "Opening your workspace…");
  assert.deepEqual(h.routes, ["/home"]);
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
