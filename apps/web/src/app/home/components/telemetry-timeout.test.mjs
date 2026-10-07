import test from "node:test";
import assert from "node:assert/strict";
import { TELEMETRY_TIMEOUT_MS, withTelemetryTimeout } from "./telemetry-timeout.ts";

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("a native scan lasting longer than the old six-second UI limit can finish", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish;
  const snapshot = { network: { reachable: true } };
  const request = withTelemetryTimeout(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  t.mock.timers.tick(10_000);
  finish(snapshot);
  assert.equal(await request, snapshot);
});

test("native error details are preserved instead of becoming an empty result", async () => {
  await assert.rejects(
    withTelemetryTimeout(Promise.reject(new Error("Device checks are busy"))),
    /Device checks are busy/
  );
  await assert.rejects(
    withTelemetryTimeout(Promise.reject("native registry query failed")),
    (error) => error === "native registry query failed"
  );
});

test("a stalled native scan times out without an unhandled late rejection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fail;
  const request = withTelemetryTimeout(
    new Promise((_, reject) => {
      fail = reject;
    })
  );
  const rejected = assert.rejects(request, /Native telemetry scan timed out/);
  t.mock.timers.tick(TELEMETRY_TIMEOUT_MS);
  await rejected;
  fail(new Error("late native failure"));
  await settle();
});
