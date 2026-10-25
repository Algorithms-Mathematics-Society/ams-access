import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./api-client.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// Run the actual module with controlled promises and hook subscriptions. No
// network or DOM is needed to observe cache data, errors and notifications.
function harness(path) {
  const requests = [];
  let rendering;
  function request() {
    const pending = deferred();
    requests.push(pending);
    return pending.promise;
  }
  const react = {
    useCallback: (callback) => callback,
    useRef: (current) => ({ current }),
    useEffect: (effect) => rendering.effects.push(effect),
    useState(initial) {
      const hook = rendering;
      const index = hook.states.length;
      hook.states.push(typeof initial === "function" ? initial() : initial);
      return [
        hook.states[index],
        (value) => {
          hook.states[index] = value;
          if (index === 0) hook.notifications += 1;
        },
      ];
    },
  };
  const context = {
    exports: {},
    Error,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: () => request() }),
    require(name) {
      if (name === "react") return react;
      if (name === "./abort-timeout") return {};
      if (name === "./client-version") return { CLIENT_VERSION: "test" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(outputText, context);
  const api = context.exports;
  function hook(enabled = false, subscribe = false) {
    rendering = { states: [], effects: [], notifications: 0 };
    const instance = rendering;
    instance.query = api.useApiQuery("shared", request, { enabled, retries: 0 });
    if (subscribe) instance.cleanup = instance.effects[0]();
    return instance;
  }
  const owner = hook(true);
  return {
    requests,
    clear: api.clearQueryCache,
    observe: () => hook(false, true),
    snapshot: () => hook().states[0],
    start:
      path === "fetchJson"
        ? () => api.fetchJson("/contests", {}, { dedupeKey: "shared", retries: 0 })
        : () => owner.query.mutate(),
  };
}

// fetchJson awaits response headers before invoking json().
async function settleHeaders() {
  await new Promise((resolve) => setImmediate(resolve));
}

for (const path of ["fetchJson", "useApiQuery"]) {
  for (const outcome of ["success", "error"]) {
    test(`${path}: late ${outcome} after clear cannot recreate data/error or notify listeners`, async () => {
      const h = harness(path);
      const listener = h.observe();
      const pending = h.start();
      const error = new Error("candidate A failed");
      const settled = outcome === "error" ? assert.rejects(pending, error) : pending;
      await settleHeaders();
      h.clear();
      const notifications = listener.notifications;
      if (outcome === "success") h.requests[0].resolve("candidate A");
      else h.requests[0].reject(error);
      const result = await settled;
      if (outcome === "success") assert.equal(result, "candidate A", "direct caller still settles");
      assert.equal(h.snapshot(), undefined);
      assert.equal(listener.notifications, notifications);
      listener.cleanup();
    });

    for (const replacementSettlesFirst of [false, true]) {
      test(`${path}: late ${outcome} cannot overwrite ${replacementSettlesFirst ? "completed" : "pending"} replacement`, async () => {
        const h = harness(path);
        const listener = h.observe();
        const old = h.start();
        const error = new Error("candidate A failed");
        const oldSettled = outcome === "error" ? assert.rejects(old, error) : old;
        await settleHeaders();
        h.clear();
        const current = h.start();
        await settleHeaders();
        assert.equal(h.requests.length, 2);
        if (replacementSettlesFirst) {
          h.requests[1].resolve("candidate B");
          await current;
        }
        const notifications = listener.notifications;
        if (outcome === "success") h.requests[0].resolve("candidate A");
        else h.requests[0].reject(error);
        await oldSettled;
        assert.equal(listener.notifications, notifications, "old settlement must not publish");
        assert.equal(h.snapshot()?.error, undefined);
        if (!replacementSettlesFirst) {
          assert.ok(h.snapshot()?.promise, "replacement must retain pending ownership");
          const deduped = h.start();
          await settleHeaders();
          assert.equal(h.requests.length, 2, "new caller dedupes against replacement");
          h.requests[1].resolve("candidate B");
          assert.equal(await deduped, "candidate B");
          await current;
        }
        assert.equal(h.snapshot()?.data, "candidate B");
        assert.equal(listener.states[0]?.data, "candidate B");
        listener.cleanup();
      });
    }
  }

  test(`${path}: normal requests dedupe, publish success and preserve data on refresh failure`, async () => {
    const h = harness(path);
    const listener = h.observe();
    const first = h.start();
    const second = h.start();
    await settleHeaders();
    assert.equal(h.requests.length, 1);
    const beforeSuccess = listener.notifications;
    h.requests[0].resolve("current contests");
    assert.equal(await first, "current contests");
    assert.equal(await second, "current contests");
    assert.equal(listener.notifications, beforeSuccess + 1);
    assert.equal(listener.states[0]?.data, "current contests");
    const refresh = h.start();
    const error = new Error("offline");
    const rejected = assert.rejects(refresh, error);
    await settleHeaders();
    assert.equal(h.requests.length, 2);
    const beforeFailure = listener.notifications;
    h.requests[1].reject(error);
    await rejected;
    assert.equal(listener.notifications, beforeFailure + 1);
    assert.equal(h.snapshot()?.data, "current contests");
    assert.equal(h.snapshot()?.error, error);
    assert.equal(h.snapshot()?.promise, undefined);
    listener.cleanup();
  });
}
