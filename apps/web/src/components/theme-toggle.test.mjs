import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const { outputText } = ts.transpileModule(
  readFileSync(new URL("./ThemeToggle.tsx", import.meta.url), "utf8"),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }
);
function harness() {
  let changes = 0,
    settling = false;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    document: { documentElement: { classList: { contains: () => settling } } },
    require(name) {
      if (name === "react") return { useState: () => [true, () => {}], useEffect: () => {} };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "@ams/shared-ui") return { IconButton: "button" };
      if (name === "@/lib/theme")
        return {
          useTheme: () => ({
            theme: "dark",
            toggle: () => {
              changes++;
              settling = true;
            },
          }),
        };
      throw Error(name);
    },
  };
  vm.runInNewContext(outputText, context);
  return {
    props: context.exports.ThemeToggle({}).props,
    changes: () => changes,
    settled: () => {
      settling = false;
    },
  };
}
test("theme pointer bursts change once, then a new settled click works", () => {
  const h = harness();
  h.props.onClick({ detail: 1 });
  h.props.onClick({ detail: 1 });
  assert.equal(h.changes(), 1);
  h.settled();
  h.props.onClick({ detail: 2 });
  h.props.onClick({ detail: 3 });
  assert.equal(h.changes(), 1, "native multi-click sequence does not reverse first change");
  h.props.onClick({ detail: 1 });
  assert.equal(h.changes(), 2);
});
test("keyboard and assistive activation work, held activation keys are consumed", () => {
  const h = harness();
  for (const key of ["Enter", " "]) {
    let prevented = 0;
    h.props.onKeyDown({ key, repeat: true, preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
    h.props.onKeyDown({ key, repeat: false, preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
  }
  let prevented = false;
  h.props.onKeyDown({
    key: "Tab",
    repeat: true,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  h.props.onClick({ detail: 0 });
  h.props.onClick({ detail: 0 });
  assert.equal(h.changes(), 1);
  h.settled();
  h.props.onClick({ detail: 0 });
  assert.equal(h.changes(), 2);
});
