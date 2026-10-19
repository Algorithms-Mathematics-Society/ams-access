import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
