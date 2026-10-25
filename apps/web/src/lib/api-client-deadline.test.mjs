import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./api-client.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness(respond) {
  const timers = new Map(),
    requests = [];
  const context = {
    exports: {},
    Error,
    AbortController,
    setTimeout(callback, ms) {
      const id = {};
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (input, init) => {
      requests.push(init);
      return respond(init.signal, requests.length);
    },
    require: (name) => (name === "./client-version" ? { CLIENT_VERSION: "9.9.9" } : {}),
  };
  vm.runInNewContext(outputText, context);
  return {
    ...context.exports,
    timers,
    requests,
    expire() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      timers.delete(id);
      timer.callback();
    },
  };
}
function stalledBody(signal, status = 200) {
  return {
    ok: status === 200,
    status,
    json: () =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
      }),
  };
}

test("headers do not clear deadline; aborting stalled JSON releases dedupe ownership", async () => {
  const h = harness((signal) => stalledBody(signal));
  const first = h.fetchJson("/session", { method: "POST" }, { retries: 0, timeoutMs: 123 });
  const failed = assert.rejects(first, /body aborted/);
  await flush();
  assert.equal([...h.timers.values()][0]?.ms, 123);
  h.expire();
  await failed;
  assert.equal(h.timers.size, 0);
  const second = h.fetchJson("/session", { method: "POST" }, { retries: 0 });
  const secondFailed = assert.rejects(second, /body aborted/);
  await flush();
  assert.equal(h.requests.length, 2, "retry invocation starts a new request");
  h.expire();
  await secondFailed;
});

test("stalled body retains the configured retry count and a fresh attempt deadline", async () => {
  const h = harness((signal) => stalledBody(signal));
  const pending = h.fetchJson("/contests", {}, { retries: 1, retryDelayMs: 0 });
  const failed = assert.rejects(pending, /body aborted/);
  await flush();
  h.expire();
  await flush();
  // The unchanged retry delay runs between the two attempt deadlines.
  assert.equal([...h.timers.values()][0]?.ms, 0);
  h.expire();
  await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].signal.aborted, false);
  h.expire();
  await failed;
  assert.equal(h.timers.size, 0);
});

test("successful body clears timer only after consumption", async () => {
  let finish;
  const h = harness(() => ({
    ok: true,
    json: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  }));
  const pending = h.fetchJson("/ok", {}, { retries: 0 });
  await flush();
  assert.equal(h.timers.size, 1);
  finish({ accepted: true });
  assert.deepEqual(await pending, { accepted: true });
  assert.equal(h.timers.size, 0);
});

test("every request carries the client version beside the caller's headers", async () => {
  const h = harness(() => ({ ok: true, json: async () => ({}) }));
  await h.fetchJson("/versioned", { headers: { Authorization: "Bearer t" } }, { retries: 0 });
  // Spread into this realm: the vm's objects have another Object prototype.
  assert.deepEqual(
    { ...h.requests[0].headers },
    {
      "X-AMS-Client-Version": "9.9.9",
      Authorization: "Bearer t",
    }
  );
});

test("malformed JSON clears deadline and preserves parse failure", async () => {
  const h = harness(() => ({
    ok: true,
    json: async () => {
      throw new Error("invalid JSON");
    },
  }));
  await assert.rejects(h.fetchJson("/invalid", {}, { retries: 0 }), /invalid JSON/);
  assert.equal(h.timers.size, 0);
});

test("session-binding body stays bounded and preserves the binding error without retries", async () => {
  let finish;
  const h = harness(() => ({
    ok: false,
    status: 403,
    json: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  }));
  const pending = h.fetchJson("/bound", {}, { retries: 2 });
  const failed = assert.rejects(
    pending,
    (error) => error instanceof h.SessionBindingError && error.code === "SESSION_DEVICE_MISMATCH"
  );
  await flush();
  assert.equal(h.timers.size, 1);
  finish({ code: "SESSION_DEVICE_MISMATCH", error: "Wrong device" });
  await failed;
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test("stalled 403 body aborts and retains existing generic HTTP failure handling", async () => {
  const h = harness((signal) => stalledBody(signal, 403));
  const pending = h.fetchJson("/bound", {}, { retries: 2 });
  const failed = assert.rejects(pending, /HTTP 403/);
  await flush();
  h.expire();
  await failed;
  assert.equal(h.requests.length, 1);
  assert.equal(h.timers.size, 0);
});
