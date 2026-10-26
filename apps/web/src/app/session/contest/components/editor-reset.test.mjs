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

function harness() {
  const states = [];
  let index = 0,
    resets = 0,
    tree;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useEffect() {},
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
      if (name.endsWith("editor-preferences")) return { DEFAULT_EDITOR_PREFERENCES: {} };
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
    open() {
      all("Button")
        .find((node) => node.props.label === "Reset code")
        .props.onClick();
      h.render();
    },
    dialog: () => all("AccessDialog")[0],
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
