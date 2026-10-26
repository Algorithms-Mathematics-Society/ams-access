import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";

// Render the actual TSX with Node; resolve app aliases without a Next server.
const source = readFileSync(new URL("./ContestCalendar.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
});
const javascript = outputText.replace(
  /from "([^"]+)"/g,
  (_, specifier) =>
    `from ${JSON.stringify(
      specifier === "@/lib/date-time-format"
        ? new URL("../../../lib/date-time-format.ts", import.meta.url).href
        : specifier === "@/lib/proctor-api"
          ? new URL("../../../lib/proctor-api.ts", import.meta.url).href
          : import.meta.resolve(specifier)
    )}`
);
const { ContestCalendar } = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);

test("calendar server markup does not depend on the server locale or timezone", (t) => {
  t.mock.method(Intl, "DateTimeFormat", function () {
    throw Error("Device-local dates must not be formatted during server rendering");
  });
  const html = renderToString(
    createElement(ContestCalendar, {
      contests: [],
      loading: true,
      onSelectContest() {},
    })
  );
  assert.match(html, /Loading calendar/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /data-date|Starting /);
});

test("calendar today and next contest follow server time when device clock differs", () => {
  const ast = ts.createSourceFile(
    "ContestCalendar.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const functions = ast.statements.filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ["localDateKey", "LocalContestCalendar"].includes(node.name?.text)
  );
  assert.equal(functions.length, 2);
  const code = ts.transpileModule(functions.map((node) => node.getText(ast)).join("\n"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  let serverTime = new Date(2000, 0, 2, 12).getTime();
  let selected;
  let stateIndex = 0;
  const state = [];
  const context = {
    exports: {},
    require: () => ({ jsx, jsxs: jsx }),
    serverNow: () => serverTime,
    useState(initial) {
      const index = stateIndex++;
      if (index >= state.length) state[index] = typeof initial === "function" ? initial() : initial;
      return [
        state[index],
        (value) => {
          state[index] = value;
          if (index === 0) selected = value;
        },
      ];
    },
    useMemo: (fn) => fn(),
    useEffect() {},
    dateTimeFormatter: () => ({ format: () => "date" }),
  };
  for (const name of [
    "Calendar",
    "Card",
    "Button",
    "HStack",
    "VStack",
    "Heading",
    "Text",
    "List",
    "ListItem",
    "VisuallyHidden",
    "Icon",
  ])
    context[name] = name;
  vm.runInNewContext(`${code}\nthis.renderLocal = LocalContestCalendar;`, context);
  const tree = context.renderLocal({
    contests: [{ id: "next", title: "Next", start_at: new Date(2000, 0, 3, 12).toISOString() }],
    loading: false,
    onSelectContest() {},
  });
  const all = (node) =>
    !node || typeof node !== "object"
      ? []
      : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
  const nodes = all(tree);
  assert.equal(nodes.find((node) => node.type === "Calendar").props.value, "2000-01-02");
  assert.ok(nodes.some((node) => node.props?.label === "Show next contest"));
  nodes.find((node) => node.props?.label === "Today").props.onClick();
  assert.equal(selected, "2000-01-02");
  // A late server-clock anchor updates the default date, but not an explicit choice.
  state[0] = null;
  serverTime = new Date(2000, 0, 4, 12).getTime();
  stateIndex = 0;
  const rerendered = all(
    context.renderLocal({ contests: [], loading: false, onSelectContest() {} })
  );
  const calendar = rerendered.find((node) => node.type === "Calendar");
  assert.equal(calendar.props.value, "2000-01-04");
  calendar.props.onChange("2000-01-01");
  serverTime = new Date(2000, 0, 5, 12).getTime();
  stateIndex = 0;
  const chosen = all(context.renderLocal({ contests: [], loading: false, onSelectContest() {} }));
  assert.equal(chosen.find((node) => node.type === "Calendar").props.value, "2000-01-01");
});
