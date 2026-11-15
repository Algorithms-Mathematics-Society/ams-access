import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("./EditorPanel.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

function harness({ geometry } = {}) {
  let layoutEffect, layoutDeps, layoutCleanup;
  const states = [];
  let index = 0,
    resets = 0,
    tree;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    ...(geometry
      ? {
          document: geometry.document,
          window: geometry.window,
          ResizeObserver: geometry.ResizeObserver,
        }
      : {}),
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useEffect() {},
          useLayoutEffect(fn, deps) {
            if (!layoutDeps || deps.some((value, i) => value !== layoutDeps[i])) layoutEffect = fn;
            layoutDeps = deps;
          },
          useState(initial) {
            const i = index++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (value) => {
                states[i] = typeof value === "function" ? value(states[i]) : value;
              },
            ];
          },
        };
      if (name === "next/dynamic") return { default: () => "EditorPane" };
      if (name.endsWith("editor-preferences"))
        return { DEFAULT_EDITOR_PREFERENCES: {}, EDITOR_FONT_SIZES: [] };
      if (name.endsWith("editor-pane")) return { CONTEST_EDITOR_THEMES: [] };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(compiled, context);
  let props = {
    sessionId: "session-A",
    currentQId: "A",
    activeFileId: "A:main",
    selectedLanguage: "C++23",
    readOnly: false,
    submitButton: {},
    handleResetCode: () => {
      resets++;
    },
  };
  function all(type, node = tree) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => all(type, child ?? null));
    return [...(node.type === type ? [node] : []), ...all(type, node.props?.children ?? null)];
  }
  const h = {
    render(next = {}) {
      props = { ...props, ...next };
      index = 0;
      tree = context.exports.EditorPanel(props);
    },
    layout() {
      if (!layoutEffect) return;
      layoutCleanup?.();
      layoutCleanup = layoutEffect();
      layoutEffect = undefined;
    },
    settingsTop: () =>
      all("Card").find((node) => node.props.id === "contest-editor-themes")?.props.style.top,
    open() {
      all("Button")
        .find((node) => node.props.label === "Reset code")
        .props.onClick();
      h.render();
    },
    dialog: () => all("AccessDialog").find((node) => node.props.labelId === "reset-code-dialog"),
    button: (label) => all("Button", h.dialog()).find((node) => node.props.label === label),
    get resets() {
      return resets;
    },
  };
  h.render();
  return h;
}

test("reset requires confirmation; Cancel and dismissal preserve code", () => {
  const h = harness();
  h.open();
  assert.equal(h.dialog().props.open, true);
  assert.equal(h.resets, 0);
  h.button("Cancel").props.onClick();
  h.render();
  assert.equal(h.dialog().props.open, false);
  h.open();
  h.dialog().props.onClose();
  h.render();
  assert.equal(h.resets, 0);
  h.open();
  h.button("Reset code").props.onClick();
  h.render();
  assert.equal(h.resets, 1);
  assert.equal(h.dialog().props.open, false);
});

for (const change of [
  { currentQId: "B" },
  { selectedLanguage: "Python3" },
  { sessionId: "session-B" },
  { activeFileId: "A:scratch" },
  { readOnly: true },
]) {
  test(`reset confirmation cannot apply after context changes: ${JSON.stringify(change)}`, () => {
    const h = harness();
    h.open();
    h.render(change);
    assert.equal(h.dialog().props.open, false);
    h.button("Reset code").props.onClick();
    assert.equal(h.resets, 0);
  });
}

test("settings geometry reads after render, follows ancestor movement and releases observers", () => {
  let bottom = 100,
    reads = 0,
    resize,
    disconnects = 0;
  const observed = [],
    listeners = new Map();
  const page = { matches: () => true, parentElement: null };
  const toolbar = { matches: () => false, parentElement: page };
  const trigger = {
    matches: () => false,
    parentElement: toolbar,
    getBoundingClientRect() {
      reads++;
      return { bottom };
    },
  };
  const h = harness({
    geometry: {
      document: { getElementById: () => trigger },
      window: {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name, fn) => {
          if (listeners.get(name) === fn) listeners.delete(name);
        },
      },
      ResizeObserver: class {
        constructor(fn) {
          resize = fn;
        }
        observe(node) {
          observed.push(node);
        }
        disconnect() {
          disconnects++;
        }
      },
    },
  });
  h.layout();
  h.render({ themeMenuOpen: true });
  assert.equal(reads, 0);
  h.layout();
  h.render();
  assert.equal(reads, 1);
  assert.match(h.settingsTop(), /100px/);
  assert.deepEqual(observed, [trigger, toolbar, page]);
  bottom = 140;
  resize();
  h.render();
  assert.match(h.settingsTop(), /140px/);
  bottom = 80;
  listeners.get("scroll")();
  h.render();
  assert.match(h.settingsTop(), /80px/);
  h.render({ themeMenuOpen: false });
  h.layout();
  assert.equal(disconnects, 1);
  assert.equal(listeners.size, 0);
});
