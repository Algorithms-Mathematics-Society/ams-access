import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./ContestsPanel.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const jsx = (type, props) => ({ type, props });
const context = {
  exports: {},
  require(name) {
    if (name === "react")
      return {
        memo: (fn) => fn,
        useState: (initial) => [initial(), () => {}],
        useEffect() {},
        useMemo: (fn) => fn(),
      };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "./utils") return { getContestEntryState: () => ({ phase: "upcoming" }) };
    if (name === "./home-contest-presentation") return { sortHomeContests: (contests) => contests };
    if (name === "@/lib/proctor-api") return { serverNow: () => 0 };
    return new Proxy({}, { get: (_, key) => key });
  },
};
vm.runInNewContext(code, context);
function all(node) {
  return !node || typeof node !== "object"
    ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
}
function render(props) {
  return all(
    context.exports.ContestsPanel({
      contests: [],
      loading: false,
      theme: "light",
      onPreflight() {},
      onSearchChange() {},
      ...props,
    })
  );
}
const contests = [{ id: "one", title: "Algorithms" }];
test("cached data plus failed refresh and search miss keeps stale notice and Clear search", () => {
  let search;
  const nodes = render({
    contests,
    error: "Refresh failed",
    searchQuery: "nothing",
    onSearchChange: (value) => {
      search = value;
    },
  });
  assert.equal(nodes.find((n) => n.type === "Banner").props.title, "Refresh failed");
  assert.match(nodes.find((n) => n.type === "Banner").props.description, /last available/);
  const empty = nodes.find((n) => n.type === "EmptyState");
  assert.equal(empty.props.title, "No matching contests");
  empty.props.actions.props.onClick();
  assert.equal(search, "");
  assert.ok(nodes.some((n) => n.props?.children === "0 of 1"));
});
test("cached matches remain visible with stale notice", () => {
  const nodes = render({ contests, error: "Refresh failed", searchQuery: "algo" });
  assert.ok(nodes.some((n) => n.type === "ActiveContestCard"));
  assert.ok(nodes.some((n) => n.type === "Banner"));
  assert.equal(
    nodes.some((n) => n.type === "EmptyState"),
    false
  );
});
test("source without data plus error shows unavailable, not a search miss", () => {
  const nodes = render({ error: "Refresh failed", searchQuery: "nothing" });
  assert.equal(nodes.find((n) => n.type === "Banner").props.title, "Contests unavailable");
  assert.equal(
    nodes.some((n) => n.type === "EmptyState"),
    false
  );
});
test("successful empty source and ordinary search miss retain distinct empty states", () => {
  assert.equal(render().find((n) => n.type === "EmptyState").props.title, "No contests yet");
  assert.equal(
    render({ contests, searchQuery: "nothing" }).find((n) => n.type === "EmptyState").props.title,
    "No matching contests"
  );
});
