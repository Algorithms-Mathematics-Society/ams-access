import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { voteRemainingMs, shownIntegration } from "../../../lib/team-vote.ts";

function harness(file, exported, browser = { addEventListener() {}, removeEventListener() {} }) {
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
    "window",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )(
    (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useRef(initial) {
            const index = cursor++;
            return (values[index] ??= { current: initial });
          },
          useCallback(fn) {
            return fn;
          },
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
      if (name === "../escape-ownership") return { acquireOrdinaryEscape: () => () => {} };
      if (name === "next/dynamic") return { default: () => "TeamResultsView" };
      if (name === "@/lib/team-vote")
        return {
          voteRemainingMs,
          shownIntegration,
          integrationStatus: () => "Completed",
          integrationPartStatus: () => "Verdict pending",
        };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
    exports,
    { now: () => 0 },
    () => 1,
    () => {},
    browser
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
  assert.equal(nodes(tree).find((n) => n.type === "Button").props.label, "Approve revision 4");
  assert.doesNotMatch(text(tree), /You have not approved this revision/);
  nodes(tree)
    .find((n) => n.type === "Button")
    .props.onClick();
  s.board.submission.mine = true;
  tree = render(props);
  assert.doesNotMatch(text(tree), /You approved this revision/);
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
    if (s.board.submission.revision === 0) {
      assert.doesNotMatch(text(tree), /Nothing to submit yet/);
      assert.equal(
        nodes(tree).find((n) => n.type === "Button").props.tooltip,
        "Submit your part before approving a team revision."
      );
    }
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

test("team progress handles Escape without restoring focus into a suspended workspace", () => {
  let key;
  const browser = {
    addEventListener: (name, fn) => {
      key = fn;
    },
    removeEventListener() {},
  };
  const render = harness("TeamWorkspacePanel", "default", browser);
  const props = { state: state(), contestUid: "contest", suspended: false };
  nodes(render(props))
    .find((n) => n.type === "Button")
    .props.onClick();
  const dialog = nodes(render(props)).find((n) => n.type === "AccessDialog");
  let prevented = false;
  key({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(
    nodes(render(props)).some((n) => n.type === "AccessDialog"),
    false
  );
  assert.equal(dialog.props.shouldRestoreFocus(), true);
  render({ ...props, suspended: true });
  assert.equal(dialog.props.shouldRestoreFocus(), false);
});

test("approval deadlines distinguish hours from minutes at the hour boundary", () => {
  for (const [seconds, expected] of [
    [59, "0:59"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [7800, "2:10:00"],
  ]) {
    const s = state();
    s.board.submission.deadline = new Date(
      Date.parse(s.board.server_time) + seconds * 1000
    ).toISOString();
    const render = harness("TeamVotePanel", "TeamVotePanel");
    assert.ok(text(render({ state: s })).includes(`Deadline in ${expected}`));
  }
});

test("submitted revisions do not invent a reason when the server omits it", () => {
  for (const [reason, expected] of [
    [null, "Revision 4 submitted ."],
    ["vote", "Revision 4 submitted by vote ."],
    ["deadline", "Revision 4 submitted at the deadline ."],
  ]) {
    const s = state();
    s.board.submission.submitted_revision = 4;
    s.board.submission.submitted_by = reason;
    const render = harness("TeamVotePanel", "TeamVotePanel");
    const status = nodes(render({ state: s })).find(
      (n) => n.props?.role === "status" && text(n).includes("submitted")
    );
    assert.equal(text(status).replaceAll(/\s+/g, " ").trim(), expected);
  }
});

test("server-confirmed current submission stops showing a pending deadline", () => {
  const s = state();
  s.board.submission.deadline = s.board.server_time;
  s.board.submission.submitted_revision = 4;
  s.board.submission.submitted_by = "deadline";
  const render = harness("TeamVotePanel", "TeamVotePanel");
  assert.doesNotMatch(text(render({ state: s })), /Waiting for server confirmation|Deadline in/);
  s.board.submission.revision = 5;
  assert.match(text(render({ state: s })), /Waiting for server confirmation/);
});
