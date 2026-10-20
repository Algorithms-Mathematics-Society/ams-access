import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./StartupAnimation.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

// Exercise the real component's effects without adding a DOM/test-renderer dependency.
function harness(reduced = false) {
  let states = [],
    refs = [],
    effects = [],
    stateIndex = 0,
    refIndex = 0;
  const timers = new Map();
  const listeners = new Set();
  const media = {
    matches: reduced,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const document = { activeElement: null };
  const react = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [
        states[i],
        (value) => {
          states[i] = value;
        },
      ];
    },
    useRef(initial) {
      return (refs[refIndex++] ??= { current: initial });
    },
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
  };
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    document,
    window: {
      matchMedia: () => media,
      setTimeout: (callback, delay) => {
        const id = {};
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name.endsWith(".css")) return { default: {} };
      return {
        Button: "button",
        VStack: "stack",
        Text: "text",
        AccessMark: "mark",
        AccessWordmark: "wordmark",
      };
    },
  };
  vm.runInNewContext(outputText, context);
  return {
    timers,
    listeners,
    media,
    document,
    render(fresh = false) {
      if (fresh) {
        states = [];
        refs = [];
      }
      stateIndex = refIndex = 0;
      effects = [];
      return context.exports.StartupAnimation({ children: "Welcome" }).props.children;
    },
    effect: () => effects[0](),
  };
}

test("reduced motion goes directly to Welcome without starting a timer", () => {
  const h = harness(true);
  h.render();
  h.effect();
  const [content, intro] = h.render();
  assert.equal(intro, false);
  assert.equal(content.props.inert, false);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test("a missing animationend cannot block Welcome, and navigation does not replay", () => {
  const h = harness();
  h.render();
  const cleanup = h.effect();
  assert.equal(h.render()[0].props.inert, true);
  const timer = [...h.timers.values()][0];
  assert.ok(timer.delay <= 2500, "startup must have a bounded escape deadline");
  timer.callback();
  assert.equal(h.render()[1], false);
  cleanup();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.render(true)[1], false, "returning to Welcome must not replay the intro");
});

test("skip dismisses the intro and restores keyboard focus to the entry action", () => {
  const h = harness();
  h.render();
  const cleanup = h.effect();
  const [content, intro] = h.render();
  let focused = false;
  content.props.ref.current = {
    querySelector: () => ({
      focus: () => {
        focused = true;
      },
    }),
  };
  intro.props.ref.current = { contains: () => true };
  const skip = intro.props.children.find((child) => child.props.label === "Skip intro");
  skip.props.onClick();
  const [revealed, removed] = h.render();
  h.effect();
  assert.equal(removed, false);
  assert.equal(revealed.props.inert, false);
  assert.equal(focused, true);
  cleanup();
});

test("enabling reduced motion during playback dismisses the intro", () => {
  const h = harness();
  h.render();
  const cleanup = h.effect();
  h.media.matches = true;
  for (const listener of h.listeners) listener();
  assert.equal(h.render()[1], false);
  cleanup();
});

test("Strict Mode effect cleanup and replay leave one working deadline", () => {
  const h = harness();
  h.render();
  h.effect()();
  const cleanup = h.effect();
  assert.equal(h.timers.size, 1);
  assert.equal(h.listeners.size, 1);
  [...h.timers.values()][0].callback();
  assert.equal(h.render()[1], false);
  cleanup();
});

test("child animation completion does not prematurely end the startup sequence", () => {
  const h = harness();
  let [, intro] = h.render();
  intro.props.onAnimationEnd({ target: {}, currentTarget: {} });
  assert.ok(h.render()[1]);
  const overlay = {};
  intro.props.onAnimationEnd({ target: overlay, currentTarget: overlay });
  assert.equal(h.render()[1], false);
});
