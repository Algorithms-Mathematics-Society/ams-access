import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { voteRemainingMs } from "../../../lib/team-vote.ts";

function harness(file, exported) {
  const source = readFileSync(new URL(`./components/${file}.tsx`, import.meta.url), "utf8");
  const values = [],
    effects = [],
    pending = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function(
    "require",
    "exports",
    "performance",
    "setInterval",
    "clearInterval",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )(
    (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useState(initial) {
            const index = cursor++;
            if (!(index in values))
              values[index] = typeof initial === "function" ? initial() : initial;
            return [
              values[index],
              (value) => {
                values[index] = typeof value === "function" ? value(values[index]) : value;
              },
            ];
          },
          useEffect(fn, deps) {
            const index = cursor++;
            if (!effects[index] || deps.some((v, i) => !Object.is(v, effects[index][i]))) {
              effects[index] = deps;
              pending.push(fn);
            }
          },
        };
      if (name === "next/dynamic") return { default: () => "TeamResultsView" };
      if (name === "@/lib/team-vote")
        return {
          voteRemainingMs,
          integrationStatus: () => "Completed",
          integrationPartStatus: () => "Verdict pending",
        };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
    exports,
    { now: () => 0 },
    () => 1,
    () => {}
  );
  return (props) => {
    cursor = 0;
    exports[exported](props);
    pending.splice(0).forEach((fn) => fn());
    cursor = 0;
    return exports[exported](props);
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || tree === false) return "";
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}
const state = () => ({
  status: "team",
  sampledAt: 0,
  pending: false,
  error: null,
  board: {
    team: { uid: "team" },
    server_time: "2026-01-01T00:00:00Z",
    allocation: { locked: true },
    parts: [{ label: "A", problem_label: "A", holder_is_me: true, revision: 2 }],
    submission: {
      revision: 4,
      votes: 2,
      needed: 3,
      mine: false,
      deadline: "2026-01-01T00:01:00Z",
      submitted_revision: null,
      submitted_by: null,
      integration: null,
      last_result: null,
    },
  },
});

test("Team progress opens one section row, keeps revision inside, and preserves section access", () => {
  const render = harness("TeamWorkspacePanel", "default");
  const props = { state: state(), contestUid: "contest", suspended: false };
  let tree = render(props);
  const toolbar = nodes(tree).find((n) => n.type === "Button");
  assert.equal(toolbar.props.label, "Team progress");
  toolbar.props.onClick();
  tree = render(props);
  const sections = nodes(tree).find((n) => n.props?.["aria-label"] === "Team sections");
  assert.deepEqual(
    sections.props.children.map((n) => n.props.label),
    ["Progress", "Integration", "Live board", "Benchmarks"]
  );
  assert.match(text(tree), /Your submissions: open Attempts below the editor/);
  for (const [index, section] of [
    [1, "integration"],
    [2, "live"],
    [3, "benchmarks"],
  ]) {
    sections.props.children[index].props.onClick();
    tree = render(props);
    assert.equal(nodes(tree).find((n) => n.type === "TeamResultsView").props.section, section);
  }
  assert.equal(
    nodes(render({ ...props, suspended: true })).some((n) => n.type === "AccessDialog"),
    false
  );
});

test("approvals use the displayed revision and expose own state without individual teammate votes", () => {
  const render = harness("TeamVotePanel", "TeamVotePanel");
  const s = state(),
    calls = [];
  const props = {
    state: s,
    onApprove: (r) => calls.push(["approve", r]),
    onWithdraw: (r) => calls.push(["withdraw", r]),
  };
  let tree = render(props);
  assert.match(text(tree).replaceAll(/\s+/g, " "), /Revision 4 · 2 \/ 3 approvals/);
  assert.match(text(tree), /You have not approved this revision/);
  nodes(tree)
    .find((n) => n.type === "Button")
    .props.onClick();
  s.board.submission.mine = true;
  tree = render(props);
  assert.match(text(tree), /You approved this revision/);
  const withdraw = nodes(tree).find((n) => n.type === "Button");
  assert.equal(withdraw.props.label, "Withdraw approval");
  withdraw.props.onClick();
  assert.deepEqual(calls, [
    ["approve", 4],
    ["withdraw", 4],
  ]);
  s.board.submission.revision = 5;
  assert.match(text(render(props)), /approvals on the previous revision no longer count/);
});

test("unsafe vote states stay disabled and expiry waits for server confirmation", () => {
  const render = harness("TeamVotePanel", "TeamVotePanel");
  for (const patch of [
    (s) => {
      s.pending = true;
    },
    (s) => {
      s.status = "error";
      s.error = "Vote could not be saved";
    },
    (s) => {
      s.board.allocation.locked = false;
    },
    (s) => {
      s.board.submission.revision = 0;
    },
    (s) => {
      s.board.submission.submitted_revision = 4;
    },
    (s) => {
      s.board.submission.deadline = s.board.server_time;
    },
  ]) {
    const s = state();
    patch(s);
    const tree = render({ state: s });
    assert.equal(nodes(tree).find((n) => n.type === "Button").props.isDisabled, true);
    if (s.error)
      assert.ok(nodes(tree).some((n) => n.props?.role === "alert" && text(n) === s.error));
    if (s.board.submission.deadline === s.board.server_time)
      assert.match(text(tree), /Deadline reached. Waiting for server confirmation/);
  }
  assert.equal(
    nodes(render({ state: state(), suspended: true })).find((n) => n.type === "Button").props
      .isDisabled,
    true
  );
  assert.match(text(render({ state: { board: null } })), /unavailable/);
});
