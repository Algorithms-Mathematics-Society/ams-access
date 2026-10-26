import test from "node:test";
import assert from "node:assert/strict";
import { getSession, ProctorApiError } from "./proctor-api.ts";

async function failWith(t, status, body) {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
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
