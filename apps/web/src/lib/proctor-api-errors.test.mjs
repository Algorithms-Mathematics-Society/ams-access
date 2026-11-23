import test from "node:test";
import assert from "node:assert/strict";
import { getSession, heartbeat, ProctorApiError, setToken } from "./proctor-api.ts";

async function failWith(t, status, body, headers = {}) {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(body), { status, headers })
  );
  try {
    await getSession("s1");
  } catch (error) {
    assert(error instanceof ProctorApiError);
    return error;
  }
  assert.fail("expected a ProctorApiError");
}

test("a FastAPI validation error reads as its first message", async (t) => {
  const error = await failWith(t, 422, {
    detail: [
      { loc: ["body", "source"], msg: "String should have at least 1 character", type: "x" },
    ],
  });
  assert.equal(error.status, 422);
  assert.equal(error.message, "String should have at least 1 character");
});

test("a 500 keeps the server's request id as a reference", async (t) => {
  const error = await failWith(t, 500, {
    error: "internal server error",
    request_id: "ab12cd34-0000-0000-0000-000000000000",
  });
  assert.equal(error.message, "Something went wrong on the server (ref ab12cd34).");
  assert.equal(error.detail.request_id, "ab12cd34-0000-0000-0000-000000000000");
});

test("a plain string detail still passes through", async (t) => {
  const error = await failWith(t, 409, { detail: "session is submitted" });
  assert.equal(error.message, "session is submitted");
});

test("heartbeat sends the persisted device ID and reads the handoff response", async (t) => {
  const values = new Map([["ams_device_id", "device-before-handoff"]]);
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  t.after(() => {
    setToken(null);
    if (storage) Object.defineProperty(globalThis, "localStorage", storage);
    else delete globalThis.localStorage;
  });
  setToken("participant-token");
  const message = "This exam session continued on another device.";
  const code = "SESSION_DEVICE_MISMATCH";
  const request = t.mock.method(globalThis, "fetch", async () =>
    Response.json({ detail: { code, error: message } }, { status: 409 })
  );
  await assert.rejects(() => heartbeat("s1"), { status: 409, code, message });
  assert.equal(request.mock.calls[0].arguments[1].headers["X-Device-Id"], "device-before-handoff");
});

test("overload request references preserve Retry-After for login and approval recovery", async (t) => {
  const error = await failWith(
    t,
    503,
    {
      error: "temporarily unavailable",
      request_id: "ab12cd34-rest",
    },
    { "Retry-After": "20" }
  );
  assert.equal(error.status, 503);
  assert.equal(error.retryAfterSeconds, 20);
  assert.equal(error.detail.request_id, "ab12cd34-rest");
  assert.match(error.message, /ref ab12cd34/);
});

for (const invalid of [0, -5, "later", null]) {
  test(`invalid body retry hint ${JSON.stringify(invalid)} cannot erase the server header`, async (t) => {
    const error = await failWith(
      t,
      429,
      {
        detail: { error: "Wait", retry_after: invalid },
      },
      { "Retry-After": "20" }
    );
    assert.equal(error.retryAfterSeconds, 20);
  });
}

test("nonfinite and negative retry hints cannot create a runaway countdown", () => {
  for (const retry_after of [Infinity, NaN, -1, "5", null]) {
    assert.equal(new ProctorApiError("Wait", 429, "", { retry_after }).retryAfterSeconds, 0);
  }
});
