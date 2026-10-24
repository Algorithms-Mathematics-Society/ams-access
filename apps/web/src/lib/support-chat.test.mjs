import test from "node:test";
import assert from "node:assert/strict";
import {
  newSupportAccess,
  parseSupportReceipt,
  mergeSupportMessages,
  supportRequest,
} from "./support-chat.ts";

const access = { uid: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64) };

test("capabilities use independent cryptographic tokens and UUIDs", () => {
  const a = newSupportAccess(),
    b = newSupportAccess();
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.match(a.uid, /^[a-f0-9-]{36}$/);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.uid, b.uid);
});

test("receipt recovery accepts capabilities and rejects corrupt or mismatched data", () => {
  assert.deepEqual(parseSupportReceipt(JSON.stringify({ access })), { access });
  for (const value of [
    null,
    "",
    "garbage",
    "null",
    "[]",
    "{}",
    JSON.stringify({ access: { ...access, token: "short" } }),
    JSON.stringify({ access, pendingStart: { ...access, uid: "another", body: "Issue" } }),
    JSON.stringify({ access, pendingMessage: { uid: "id", body: 123 } }),
  ])
    assert.equal(parseSupportReceipt(value), null);
  const pending = {
    access,
    pendingMessage: { uid: "22222222-2222-4222-8222-222222222222", body: "Please help" },
  };
  assert.deepEqual(parseSupportReceipt(JSON.stringify(pending)), pending);
});

test("history merging preserves existing order and removes repeated messages within pages", () => {
  const a = { uid: "a", body: "First" },
    b = { uid: "b", body: "Second" };
  assert.deepEqual(mergeSupportMessages([a], [a, b, b]), [a, b]);
  assert.deepEqual(mergeSupportMessages([], [a, a]), [a]);
});

test("request sends only its support capability and never caches private replies", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ uid: access.uid }) };
  });
  await supportRequest("https://example.test", "/support/conversations", undefined, {
    name: "Candidate",
  });
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.method, "POST");
  await supportRequest("https://example.test", `/support/conversations/${access.uid}`, access);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${access.token}`);
  assert.equal(calls[1].init.cache, "no-store");
  assert.equal(calls[1].init.method, "GET");
});

test("timeout remains armed until JSON body completes and always clears afterward", async (t) => {
  let fire,
    cleared = false,
    signal,
    finish;
  t.mock.method(globalThis, "setTimeout", (fn) => {
    fire = fn;
    return 42;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => {
    assert.equal(id, 42);
    cleared = true;
  });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal;
    return {
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    };
  });
  const request = supportRequest("https://example.test", "/support/conversations", access);
  await Promise.resolve();
  assert.equal(cleared, false);
  fire();
  assert.equal(signal.aborted, true);
  finish({ uid: access.uid });
  assert.deepEqual(await request, { uid: access.uid });
  assert.equal(cleared, true);
});

for (const failure of ["network", "timeout", "body-timeout"])
  test(`${failure} is an unconfirmed delivery and never auto-retries`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (failure === "network") throw new TypeError("Failed to fetch");
      const error = new Error("Aborted");
      error.name = "AbortError";
      if (failure === "timeout") throw error;
      return {
        ok: true,
        json: async () => {
          throw error;
        },
      };
    });
    await assert.rejects(
      supportRequest("https://example.test", "/support/conversations", access, {}),
      /Delivery is not confirmed/
    );
    assert.equal(calls, 1);
  });

test("server validation and rate limits expose actionable errors", async (t) => {
  let status = 400;
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status,
    json: async () => ({ detail: "Enter the organization code provided by your organizer." }),
  }));
  await assert.rejects(
    supportRequest("https://example.test", "/support/conversations"),
    /organization code/
  );
  status = 429;
  await assert.rejects(
    supportRequest("https://example.test", "/support/conversations"),
    /Wait a minute/
  );
});

test("recovery rejects malformed UUIDs, incomplete pending forms and conflicting operations", () => {
  const start = {
    ...access,
    email: "candidate@example.test",
    phone: "+919999999999",
    name: "Candidate",
    category: "LOGIN",
    body: "Cannot sign in",
    organization: "",
  };
  assert.deepEqual(parseSupportReceipt(JSON.stringify({ access, pendingStart: start })), {
    access,
    pendingStart: start,
  });
  const invalid = [
    { access: { ...access, uid: "-".repeat(36) } },
    { access, pendingMessage: { uid: "not-a-uuid", body: "hello" } },
    { access, pendingMessage: { uid: access.uid, body: " " } },
    { access, pendingMessage: { uid: access.uid, body: "x".repeat(4001) } },
    { access, pendingStart: { ...start, phone: undefined } },
    { access, pendingStart: { ...start, category: "UNKNOWN" } },
    { access, pendingStart: { ...start, body: " " } },
    { access, pendingStart: start, pendingMessage: { uid: access.uid, body: "hello" } },
  ];
  for (const receipt of invalid) assert.equal(parseSupportReceipt(JSON.stringify(receipt)), null);
});
