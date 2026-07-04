import test, { mock } from "node:test";
import assert from "node:assert/strict";

import { createAbortTimeout } from "./abort-timeout.ts";

test("signal aborts after the timeout elapses", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { signal } = createAbortTimeout(10_000);
    assert.equal(signal.aborted, false); // not yet
    mock.timers.tick(10_000);
    assert.equal(signal.aborted, true); // fired
  } finally {
    mock.timers.reset();
  }
});

test("clear() cancels the pending abort", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { signal, clear } = createAbortTimeout(10_000);
    clear();
    mock.timers.tick(10_000);
    assert.equal(signal.aborted, false); // cleared → never aborts
  } finally {
    mock.timers.reset();
  }
});
