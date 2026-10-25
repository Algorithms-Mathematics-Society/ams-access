import test from "node:test";
import assert from "node:assert/strict";
import { getContest, latestResumeRequest, ProctorApiError } from "./proctor-api.ts";
import { startResumePolling } from "../app/home/components/resume-polling.ts";
const settle = async () => {
  for (let i = 0; i < 16; i++) await Promise.resolve();
};

test("stalled response body times out and the next resume polling tick can retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0;
  const errors = [],
    decisions = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    calls++;
    if (calls > 1) return new Response(JSON.stringify({ uid: "request", status: "APPROVED" }));
    return {
      ok: true,
      text: () =>
        new Promise((_, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        }),
    };
  });
  const stop = startResumePolling(async () => {
    try {
      decisions.push(await latestResumeRequest("session"));
    } catch (error) {
      errors.push(error);
    }
  });
  await settle();
  assert.equal(calls, 1);
  for (let i = 0; i < 7; i++) {
    t.mock.timers.tick(3000);
    await settle();
  }
  assert.equal(errors.length, 1);
  assert(errors[0] instanceof ProctorApiError);
  assert.equal(errors[0].code, "TIMEOUT");
  t.mock.timers.tick(3000);
  await settle();
  assert(calls >= 2);
  assert.equal(decisions.at(-1).status, "APPROVED");
  stop();
});

test("HTTP errors retain their status and successful bodies clear the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    signal = options.signal;
    return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  });
  await assert.rejects(
    latestResumeRequest("session"),
    (error) => error.status === 404 && error.message === "Not found"
  );
  t.mock.timers.tick(20_000);
  assert.equal(signal.aborted, false);
});

test("503 Retry-After header survives a plain-text server error", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ detail: "The exam server is busy." }), {
        status: 503,
        headers: { "Retry-After": "5" },
      })
  );
  await assert.rejects(
    latestResumeRequest("session"),
    (error) =>
      error instanceof ProctorApiError &&
      error.status === 503 &&
      error.message === "The exam server is busy." &&
      error.retryAfterSeconds === 5
  );
});

test("Retry-After HTTP date uses the server Date, while structured wait keeps precedence", async (t) => {
  let response = new Response(JSON.stringify({ detail: "Busy" }), {
    status: 503,
    headers: {
      Date: "Sun, 06 Nov 1994 08:49:37 GMT",
      "Retry-After": "Sun, 06 Nov 1994 08:49:42 GMT",
    },
  });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(latestResumeRequest("session"), (error) => error.retryAfterSeconds === 5);
  response = new Response(JSON.stringify({ detail: { error: "Slow down", retry_after: 7 } }), {
    status: 429,
    headers: { "Retry-After": "5" },
  });
  await assert.rejects(latestResumeRequest("session"), (error) => error.retryAfterSeconds === 7);
});

test("malformed numeric Retry-After cannot become a future HTTP date", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ detail: "Busy" }), {
        status: 503,
        headers: { Date: "Sun, 06 Nov 1994 08:49:37 GMT", "Retry-After": "-5" },
      })
  );
  await assert.rejects(latestResumeRequest("session"), (error) => error.retryAfterSeconds === 0);
});

test("HTTP-date Retry-After without an exposed server Date does not trust device time", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ detail: "Busy" }), {
        status: 503,
        headers: { "Retry-After": "Sun, 06 Nov 2094 08:49:42 GMT" },
      })
  );
  await assert.rejects(latestResumeRequest("session"), (error) => error.retryAfterSeconds === 0);
});

test("contest metadata reads opt out of reference text without changing workspace defaults", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ uid: "contest", reference_sheet: null }));
  });
  await getContest("contest/id");
  await getContest("contest/id", { includeReference: true });
  await getContest("contest/id", { includeReference: false });
  assert(urls[0].endsWith("/participant/contests/contest%2Fid"));
  assert.equal(urls[1], urls[0]);
  assert.equal(urls[2], `${urls[0]}?include_reference=false`);
});
