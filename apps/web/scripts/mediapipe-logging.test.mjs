import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { patchMediaPipeLogging } from "./mediapipe-logging.mjs";

test("routes only the exact CPU delegate startup notice to info", () => {
  const info = [];
  const errors = [];
  const error = (...args) => errors.push(args);
  const console = { info: (...args) => info.push(args), error };
  const context = vm.createContext({ console });
  vm.runInContext(patchMediaPipeLogging("var err = console.error.bind(console);"), context);
  const notice = "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.";
  context.err(notice);
  assert.deepEqual(info, [[notice]]);
  assert.deepEqual(errors, []);

  const failure = new Error("Inference failed");
  for (const args of [[failure], ["WASM failed"], [notice, failure], [`${notice} ERROR`]]) {
    context.err(...args);
    assert.deepEqual(errors.at(-1), args);
  }
  assert.equal(info.length, 1);
  assert.equal(console.error, error, "does not replace global console.error");
});

test("requires a single known loader stderr hook rather than silently changing an unknown runtime", () => {
  assert.throws(() => patchMediaPipeLogging("var err = changedLogger;"), /hook changed/);
  assert.throws(
    () =>
      patchMediaPipeLogging(
        "var err = console.error.bind(console);\nvar err = console.error.bind(console);"
      ),
    /hook changed/
  );
});
