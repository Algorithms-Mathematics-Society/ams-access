import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./Stage10_AudioVerification.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(
  source.slice(source.indexOf("    async function init()"), source.indexOf("    void init();")),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
function harness(os, permission = async () => {}) {
  const calls = [];
  const c = {
    cancelled: false,
    passTimer: null,
    waitTimer: null,
    completedRef: { current: false },
    retryQueuedRef: { current: true },
    cancelAttemptRef: { current: null },
    setWaitingForPermission() {},
    clearTimeout() {},
    DOMException,
    Error,
    Uint8Array,
    invoke: async (cmd) => {
      calls.push(cmd);
      return cmd === "get_platform" ? { os } : permission();
    },
    invokeStrict: async (cmd) => {
      calls.push(cmd);
      return permission();
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          calls.push("audio");
          return {};
        },
      },
    },
    stopMediaStream: () => calls.push("stop"),
    AudioContext: class {
      createMediaStreamSource() {
        return { connect() {} };
      }
      createAnalyser() {
        return { frequencyBinCount: 8 };
      }
      close() {
        return Promise.resolve();
      }
    },
    streamRef: { current: null },
    audioCtxRef: { current: null },
    analyserRef: { current: null },
    rafRef: { current: 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    setPhase: (p) => calls.push(p),
    setMissing() {},
    setUnanswered: (value) => calls.push(`unanswered:${value}`),
    setLevel() {},
    onPass() {},
  };
  vm.runInNewContext(code, c);
  return { c, calls, run: () => c.init() };
}
test("Mac waits for native permission before opening audio", async () => {
  let grant;
  const h = harness("macos", () => new Promise((r) => (grant = r)));
  const pending = h.run();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  assert.deepEqual(h.calls, ["get_platform", "request_macos_microphone_permission"]);
  grant();
  await pending;
  assert.deepEqual(h.calls, [
    "get_platform",
    "request_macos_microphone_permission",
    "audio",
    "pass",
  ]);
});
test("denial preserves optional failure and never acquires audio", async () => {
  const h = harness("macos", async () => {
    throw Error("denied");
  });
  await h.run();
  assert.ok(h.calls.includes("fail"));
  assert.ok(!h.calls.includes("audio"));
});
test("late permission after navigation does not open audio or advance", async () => {
  let grant;
  const h = harness("macos", () => new Promise((r) => (grant = r)));
  const pending = h.run();
  for (let n = 0; n < 8; n++) await Promise.resolve();
  h.c.cancelled = true;
  grant();
  await pending;
  assert.ok(!h.calls.includes("audio"));
  assert.ok(!h.calls.includes("pass"));
});
test("other platforms do not invoke native Mac permission", async () => {
  for (const os of ["windows", "linux", undefined]) {
    const h = harness(os);
    await h.run();
    assert.deepEqual(h.calls, ["get_platform", "audio", "pass"]);
  }
});

test("microphone meter reads analyser only at its UI sampling interval", async () => {
  const h = harness("linux");
  let reads = 0;
  let frame;
  let level = 0;
  h.c.AudioContext = class extends h.c.AudioContext {
    createAnalyser() {
      return {
        frequencyBinCount: 8,
        getByteFrequencyData(data) {
          reads += 1;
          data.fill(20);
        },
      };
    }
  };
  h.c.requestAnimationFrame = (callback) => {
    frame = callback;
    return 1;
  };
  h.c.setLevel = (update) => {
    level = update(level);
  };
  await h.run();
  for (const now of [0, 16, 32, 64, 100, 124]) frame(now);
  assert.equal(reads, 0);
  frame(125);
  assert.equal(reads, 1);
  assert.equal(level, 50);
  for (const now of [140, 180, 230, 249]) frame(now);
  assert.equal(reads, 1);
  frame(250);
  assert.equal(reads, 2);
  h.c.cancelled = true;
  frame(500);
  assert.equal(reads, 2, "a cancelled stage must stop sampling");
});

test("missing browser capture API reports failure without opening a microphone", async () => {
  const h = harness("linux");
  h.c.navigator.mediaDevices = undefined;
  await h.run();
  assert.ok(h.calls.includes("fail"));
  assert.ok(!h.calls.includes("audio"));
  assert.ok(!h.calls.includes("pass"));
});

test("missing microphone is distinguished from permission denial and a busy device", async () => {
  for (const name of ["NotFoundError", "NotAllowedError", "NotReadableError"]) {
    const h = harness("linux");
    let missing;
    h.c.setMissing = (value) => {
      missing = value;
    };
    h.c.navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException(name, name);
    };
    await h.run();
    assert.equal(missing, name === "NotFoundError");
    assert.ok(h.calls.includes("fail"));
    assert.ok(!h.calls.includes("pass"));
  }
});

test("an unanswered macOS prompt stays distinct from a denial and does not capture", async () => {
  const h = harness("macos", async () => {
    throw Error("microphone permission unanswered");
  });
  await h.run();
  assert.ok(h.calls.includes("unanswered:true"));
  assert.ok(h.calls.includes("fail"));
  assert.ok(!h.calls.includes("audio"));
});

test("a late microphone grant after navigation is stopped before analyser startup", async () => {
  const h = harness("linux");
  let resolveCapture;
  const stream = { synthetic: true };
  const stopped = [];
  h.c.navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      resolveCapture = resolve;
    });
  h.c.stopMediaStream = (value) => stopped.push(value);
  h.c.AudioContext = class {
    constructor() {
      assert.fail("late capture must not start analysis");
    }
  };
  const pending = h.run();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  h.c.cancelled = true;
  resolveCapture(stream);
  await pending;
  assert.deepEqual(stopped, [stream]);
  assert.ok(!h.calls.includes("pass"));
});

test("an analyser startup failure releases capture and its AudioContext before showing recovery", async () => {
  const h = harness("linux");
  let stopped = 0,
    closed = 0;
  h.c.stopMediaStream = (stream) => {
    if (stream) stopped++;
  };
  h.c.AudioContext = class {
    createMediaStreamSource() {
      throw Error("Synthetic analyser startup failure");
    }
    close() {
      closed++;
      return Promise.resolve();
    }
  };
  await h.run();
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  assert.equal(h.c.streamRef.current, null);
  assert.equal(h.c.audioCtxRef.current, null);
  assert.ok(h.calls.includes("fail"));
  assert.ok(!h.calls.includes("pass"));
});

function mountAudioEffect(h) {
  const ast = ts.createSourceFile(
    "Stage10.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("async function init()")
    )
      effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect, "execute the real acquisition effect, including its cleanup closure");
  vm.runInNewContext(
    ts.transpileModule(`const cleanupAudioEffect = (${effect.getText(ast)})();`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + "\nglobalThis.cleanupAudioEffect = cleanupAudioEffect;",
    h.c
  );
  return h.c.cleanupAudioEffect;
}

test("actual audio effect cleanup cancels progression and stops owned capture and animation", async () => {
  const h = harness("linux");
  let advance,
    stopped = 0,
    closed = 0,
    cancelledFrame,
    cancelledTimer,
    passes = 0;
  h.c.setTimeout = (callback, delay) => {
    if (delay === 15_000) return 8;
    assert.equal(delay, 3500);
    advance = callback;
    return 7;
  };
  h.c.clearTimeout = (id) => {
    cancelledTimer = id;
  };
  h.c.cancelAnimationFrame = (id) => {
    cancelledFrame = id;
  };
  h.c.stopMediaStream = (stream) => {
    if (stream) stopped++;
  };
  h.c.onPass = () => {
    passes++;
  };
  h.c.AudioContext = class extends h.c.AudioContext {
    close() {
      closed++;
      return Promise.resolve();
    }
  };
  const cleanup = mountAudioEffect(h);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.ok(h.calls.includes("pass"));
  cleanup();
  assert.equal(cancelledTimer, 7);
  assert.equal(cancelledFrame, 1);
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  advance();
  assert.equal(passes, 0, "an already queued completion cannot advance after cleanup");
});

test("actual effect cleanup during a pending prompt disposes its eventual stream", async () => {
  const h = harness("linux");
  let resolveCapture;
  const stopped = [];
  const stream = { synthetic: true };
  h.c.clearTimeout = () => {};
  h.c.stopMediaStream = (value) => {
    if (value) stopped.push(value);
  };
  h.c.navigator.mediaDevices.getUserMedia = () =>
    new Promise((resolve) => {
      resolveCapture = resolve;
    });
  const cleanup = mountAudioEffect(h);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.ok(resolveCapture);
  assert.ok(!h.calls.includes("pass"));
  cleanup();
  resolveCapture(stream);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(stopped, [stream]);
  assert.equal(h.c.audioCtxRef.current, null);
  assert.ok(!h.calls.includes("pass"));
});

function pendingHarness(os = "linux", permission) {
  const h = harness(os, permission);
  const timers = new Map();
  const stopped = [];
  const waiting = [];
  const warnings = [];
  let captureResolve,
    captures = 0,
    sequence = 0,
    passes = 0;
  h.c.setTimeout = (callback, delay) => {
    timers.set(++sequence, { callback, delay });
    return sequence;
  };
  h.c.clearTimeout = (id) => timers.delete(id);
  h.c.setWaitingForPermission = (value) => waiting.push(value);
  h.c.onWarn = (detail) => warnings.push(detail);
  h.c.onPass = () => {
    passes++;
  };
  h.c.stopMediaStream = (stream) => {
    if (stream) stopped.push(stream);
  };
  h.c.navigator.mediaDevices.getUserMedia = () => {
    captures++;
    return new Promise((resolve) => {
      captureResolve = resolve;
    });
  };
  const ast = ts.createSourceFile(
    "Stage10.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let continueFunction;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "continueWithWarning")
      continueFunction = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(continueFunction);
  vm.runInNewContext(
    ts.transpileModule(continueFunction.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    h.c
  );
  const drain = async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve();
  };
  return {
    ...h,
    timers,
    stopped,
    waiting,
    warnings,
    drain,
    captures: () => captures,
    passes: () => passes,
    grant: (stream) => captureResolve(stream),
    showPending() {
      const entry = [...timers].find(([, timer]) => timer.delay === 15_000);
      assert.ok(entry, "presentation deadline exists while awaiting access");
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test("pending microphone guidance does not retry capture or invent a denied/pass result", async () => {
  const h = pendingHarness();
  const cleanup = mountAudioEffect(h);
  await h.drain();
  h.showPending();
  assert.equal(h.waiting.at(-1), true);
  assert.equal(h.captures(), 1);
  assert.ok(!h.calls.includes("fail"));
  assert.ok(!h.calls.includes("pass"));
  assert.equal(h.warnings.length, 0);
  h.grant({ synthetic: true });
  await h.drain();
  assert.equal(h.waiting.at(-1), false);
  assert.ok(h.calls.includes("pass"), "same request may still succeed while user waits");
  assert.equal(h.captures(), 1);
  cleanup();
});

test("pending warning continuation is single-shot and stops a late grant before stage unmount", async () => {
  const h = pendingHarness();
  const cleanup = mountAudioEffect(h);
  await h.drain();
  h.showPending();
  const warning =
    "Microphone access has not been confirmed. Continuing records this warning; contest entry requirements still apply.";
  h.c.continueWithWarning(warning);
  h.c.continueWithWarning(warning);
  assert.deepEqual(h.warnings, [warning]);
  assert.equal(h.passes(), 0);
  const stream = { synthetic: true };
  h.grant(stream);
  await h.drain();
  assert.deepEqual(h.stopped, [stream]);
  assert.ok(!h.calls.includes("pass"));
  assert.equal(h.c.audioCtxRef.current, null);
  assert.equal(h.timers.size, 0);
  cleanup();
});

test("continuing during pending native permission prevents a later microphone request", async () => {
  let grantNative;
  const h = pendingHarness(
    "macos",
    () =>
      new Promise((resolve) => {
        grantNative = resolve;
      })
  );
  const cleanup = mountAudioEffect(h);
  await h.drain();
  h.showPending();
  h.c.continueWithWarning("Microphone access has not been confirmed.");
  grantNative();
  await h.drain();
  assert.equal(h.captures(), 0);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.passes(), 0);
  cleanup();
});

test("failed microphone retry handler suppresses duplicate clicks before React commits", () => {
  const ast = ts.createSourceFile(
    "Stage10.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let retry;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "Button") {
      const attrs = node.attributes.properties;
      if (
        attrs.some(
          (attr) =>
            attr.name?.getText(ast) === "label" && attr.initializer?.text === "Try microphone again"
        )
      ) {
        retry = attrs.find((attr) => attr.name?.getText(ast) === "onClick").initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(retry);
  let retries = 0,
    cancelled = 0;
  const context = {
    retryQueuedRef: { current: false },
    completedRef: { current: false },
    cancelAttemptRef: {
      current: () => {
        cancelled++;
      },
    },
    setWaitingForPermission() {},
    setPhase() {},
    setLevel() {},
    setRetryKey: (update) => {
      retries = update(retries);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(`const retry = ${retry.getText(ast)}; retry(); retry();`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context
  );
  assert.equal(retries, 1);
  assert.equal(cancelled, 1);
});

test("rendered pending recovery offers honest warning continuation without a second capture action", () => {
  const initial = [false, false, false, 0, "checking", 0, true];
  let cursor = 0;
  const output = {},
    warnings = [];
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return {
        useState: () => [initial[cursor++], () => {}],
        useRef: (value) => ({ current: value }),
        useEffect() {},
      };
    if (name === "react/jsx-runtime")
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
      };
    return new Proxy({}, { get: (_, key) => String(key) });
  }, output);
  const tree = output.Stage10_AudioVerification({
    onPass() {
      assert.fail("pending is not a pass");
    },
    onWarn: (detail) => warnings.push(detail),
  });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props?.children)];
  }
  const rendered = nodes(tree);
  assert.ok(
    rendered.some(
      (node) =>
        node.props?.label === "Still waiting for microphone access" &&
        node.props.status === "checking"
    )
  );
  assert.ok(!rendered.some((node) => node.props?.label === "Try microphone again"));
  const action = rendered.find((node) => node.props?.label === "Continue with warning");
  assert.ok(action);
  action.props.onClick();
  action.props.onClick();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /has not been confirmed/);
  assert.match(warnings[0], /entry requirements still apply/);
});
