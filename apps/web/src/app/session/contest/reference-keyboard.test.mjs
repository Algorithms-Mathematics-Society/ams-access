import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("./components/ReferencePanel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "ReferencePanel.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const callbacks = new Map();
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ["go", "back", "onSearchKey"].includes(node.name.getText(ast))
  )
    callbacks.set(node.name.getText(ast), node.initializer.arguments[0]);
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0].getText(ast).includes("selectedHitRef.current")
  )
    callbacks.set("reveal", node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(ast);
function callback(name, dependencies) {
  assert.ok(callbacks.has(name), name);
  const js = ts.transpileModule(`const handler = ${callbacks.get(name).getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${js}; return handler;`)(
    ...Object.values(dependencies)
  );
}

test("reference navigation resets search and focuses the article without moving the outer page", () => {
  let path = "home",
    history = [],
    query = "vector",
    hits = ["vector"],
    cursor = 4;
  const focus = [];
  const deps = {
    setPath: (value) => {
      path = typeof value === "function" ? value(path) : value;
    },
    setHistory: (value) => {
      history = value(history);
    },
    setQuery: (value) => {
      query = value;
    },
    setHits: (value) => {
      hits = value;
    },
    setCursor: (value) => {
      cursor = value;
    },
    scrollRef: { current: { focus: (options) => focus.push(options) } },
  };
  callback("go", deps)("vector");
  assert.deepEqual(
    { path, history, query, hits, cursor },
    {
      path: "vector",
      history: ["home"],
      query: "",
      hits: [],
      cursor: 0,
    }
  );
  callback("back", deps)();
  assert.equal(path, "home");
  assert.deepEqual(focus, [{ preventScroll: true }, { preventScroll: true }]);
});

test("arrow navigation stays in search; Enter opens the selected result", () => {
  let cursor = 0,
    opened,
    prevented = 0;
  const hits = [{ path: "vector" }, { path: "vector/insert" }];
  const press = (key) =>
    callback("onSearchKey", {
      cursor,
      hits,
      query: "vector",
      setCursor: (update) => {
        cursor = update(cursor);
      },
      go: (path) => {
        opened = path;
      },
      onClose() {},
      setQuery() {},
      setHits() {},
    })({
      key,
      preventDefault() {
        prevented++;
      },
    });
  press("ArrowUp");
  assert.equal(cursor, 1);
  press("ArrowDown");
  assert.equal(cursor, 0);
  press("ArrowDown");
  press("Enter");
  assert.equal(opened, "vector/insert");
  assert.equal(prevented, 4);
});

test("selection follows the visible result without centering or scrolling sideways", () => {
  let options;
  callback("reveal", {
    selectedHitRef: {
      current: {
        scrollIntoView: (value) => {
          options = value;
        },
      },
    },
  })();
  assert.deepEqual(options, { block: "nearest", inline: "nearest" });
  callback("reveal", { selectedHitRef: { current: null } })();
});
