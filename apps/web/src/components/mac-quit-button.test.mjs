import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(
  readFileSync(new URL("./MacQuitButton.tsx", import.meta.url), "utf8"),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }
).outputText;
const flush = async () => {
  for (let n = 0; n < 8; n++) await Promise.resolve();
};
function harness(os, quit = async () => {}) {
  const states = [],
    refs = [],
    effects = [],
    calls = [];
  let index = 0,
    refIndex = 0,
    first = true;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(value) {
      const i = index++;
      if (first) states[i] = value;
      return [states[i], (v) => (states[i] = v)];
    },
    useRef(value) {
      const i = refIndex++;
      return (refs[i] ??= { current: value });
    },
    useEffect(f) {
      if (first) effects.push(f);
    },
  };
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@ams/api-client")
        return {
          invoke: async (cmd) => {
            calls.push(cmd);
            if (cmd === "get_platform") {
              if (os === null) throw Error("no bridge");
              return { os };
            }
            return quit();
          },
        };
      return { Button: "button", VStack: "stack", Text: "text" };
    },
  });
  return {
    calls,
    render() {
      index = refIndex = 0;
      const tree = exports.MacQuitButton();
      if (first) {
        first = false;
        for (const f of effects) f();
      }
      return tree;
    },
  };
}
test("visible only on native macOS, including offline signed-out state", async () => {
  for (const os of ["macos", "windows", "linux", null]) {
    const h = harness(os);
    assert.equal(h.render(), null);
    await flush();
    const tree = h.render();
    assert.equal(Boolean(tree), os === "macos");
    assert.deepEqual(h.calls, ["get_platform"]);
  }
});
test("double-click sends one native exit; refusal is readable and retryable", async () => {
  let reject;
  const h = harness("macos", () => new Promise((_, r) => (reject = r)));
  h.render();
  await flush();
  const click = h.render().props.children[0].props.onClick;
  const a = click(),
    b = click();
  assert.deepEqual(h.calls, ["get_platform", "quit_macos_when_idle"]);
  reject("Use the contest exit control");
  await Promise.all([a, b]);
  const tree = h.render();
  assert.equal(tree.props.children[1].props.role, "alert");
  assert.equal(tree.props.children[1].props.children, "Use the contest exit control");
  assert.equal(tree.props.children[0].props.isLoading, false);
});
