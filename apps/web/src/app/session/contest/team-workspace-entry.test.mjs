import test from "node:test";
import assert from "node:assert/strict";
import {
  assignedWorkspaceLabel,
  teamWorkspaceAllowed,
  workspaceAlreadyLoaded,
  teamWorkspaceLabels,
  teamPartAccess,
  teamSubmissionBlock,
  finishReviewQuestions,
} from "./team-workspace-entry.ts";
const state = (phase = "locked", locked = true) => ({
  status: "team",
  board: {
    phase: { name: phase },
    allocation: { locked },
    parts: [
      { problem_label: "B", holder: "Same name", holder_is_me: false },
      { problem_label: "A", holder: "Same name", holder_is_me: true },
    ],
  },
});
test("only server locked identity mapping enables explicit workspace entry", () => {
  assert.equal(assignedWorkspaceLabel(state()), "A");
  assert.equal(teamWorkspaceAllowed(state(), false), false);
  assert.equal(teamWorkspaceAllowed(state(), true), true);
  for (const phase of ["waiting", "discussion", "choosing"])
    assert.equal(teamWorkspaceAllowed(state(phase), true), false);
  assert.equal(teamWorkspaceAllowed(state("locked", false), true), false);
});
test("missing, ambiguous, unavailable and unpublished allocations stay outside editor", () => {
  const missing = state();
  missing.board.parts[1].holder_is_me = false;
  assert.equal(assignedWorkspaceLabel(missing), null);
  const duplicate = state();
  duplicate.board.parts[0].holder_is_me = true;
  assert.equal(assignedWorkspaceLabel(duplicate), null);
  for (const status of ["loading", "unpublished"])
    assert.equal(teamWorkspaceAllowed({ ...state(), status }, true), false);
  // A transient poll failure keeps the last good board: an entered member keeps the workspace.
  assert.equal(assignedWorkspaceLabel({ ...state(), status: "error" }), "A");
  assert.equal(teamWorkspaceAllowed({ ...state(), status: "error" }, true), true);
  assert.equal(teamWorkspaceAllowed({ ...state(), status: "error" }, false), false);
  assert.equal(teamWorkspaceAllowed({ status: "error", board: null }, true), false);
  assert.equal(assignedWorkspaceLabel({ status: "error", board: null }), null);
  assert.equal(teamWorkspaceAllowed({ ...state("waiting"), status: "error" }, true), false);
  assert.equal(teamWorkspaceAllowed({ ...state("locked", false), status: "error" }, true), false);
  assert.equal(teamWorkspaceAllowed({ status: "solo", board: null }, false), true);
});

test("same authorized locked assignment recovers without reinstalling drafts or releasing assets", () => {
  const loaded = { contestId: "contest", sessionId: "session", generation: 1, label: "A" };
  const files = [{ content: "live edit that failed device storage" }];
  let releases = 0;
  const recover = (identity) => {
    if (workspaceAlreadyLoaded(loaded, identity)) return;
    files[0].content = "older server draft";
    releases += 1;
  };
  recover({ ...loaded });
  assert.equal(files[0].content, "live edit that failed device storage");
  assert.equal(releases, 0);
  for (const change of [
    { contestId: "other" },
    { sessionId: "other" },
    { generation: 2 },
    { label: "B" },
  ])
    assert.equal(workspaceAlreadyLoaded(loaded, { ...loaded, ...change }), false);
  assert.equal(workspaceAlreadyLoaded(null, loaded), false);
});

test("published locked parts load only the assigned part and reject ambiguous labels", () => {
  assert.deepEqual(teamWorkspaceLabels(state()), ["A"]);
  assert.deepEqual(teamWorkspaceLabels({ ...state(), status: "error" }), ["A"]);
  assert.deepEqual(teamWorkspaceLabels({ ...state(), status: "denied" }), []);
  assert.deepEqual(teamWorkspaceLabels(state("choosing", false)), []);
  const bad = state();
  bad.board.parts[0].problem_label = "A";
  assert.deepEqual(teamWorkspaceLabels(bad), []);
});

test("duplicate holder names never grant editing or scoring permission", () => {
  const live = state();
  live.sampledAt = 100;
  live.board.server_time = "2026-11-11T10:00:00Z";
  live.board.submission = { deadline: "2026-11-11T10:01:00Z", submitted_revision: null };
  assert.deepEqual(teamPartAccess(live, "A"), { editable: true, label: "Your part" });
  assert.deepEqual(teamPartAccess(live, "B"), { editable: false, label: "Held by Same name" });
  assert.equal(teamSubmissionBlock(live, "B", 100), "Held by Same name");
  assert.equal(teamSubmissionBlock(live, "A", 100), null);
  assert.equal(teamSubmissionBlock(live, "A", 60100), "The team submission deadline has passed.");
  live.board.submission.revision = 7;
  live.board.submission.submitted_revision = 7;
  assert.equal(
    teamSubmissionBlock(live, "A", 100),
    null,
    "a submitted integration does not prevent a new part revision before deadline"
  );
  live.board.submission.submitted_revision = 6;
  assert.equal(teamSubmissionBlock(live, "A", 100), null);
  delete live.board.submission;
  assert.match(teamSubmissionBlock(live, "A", 100), /status unavailable/);
  assert.equal(teamPartAccess({ ...live, status: "denied", board: null }, "A").editable, false);
});

test("Finish review includes only owned team work while solo keeps every question", () => {
  const questions = [
    { id: "A", title: "Own" },
    { id: "B", title: "Teammate" },
  ];
  assert.deepEqual(finishReviewQuestions(questions, state()), [questions[0]]);
  assert.deepEqual(finishReviewQuestions(questions, { ...state(), status: "error" }), [
    questions[0],
  ]);
  assert.deepEqual(finishReviewQuestions(questions, { status: "denied", board: null }), []);
  assert.equal(finishReviewQuestions(questions, null), questions);
  assert.equal(finishReviewQuestions(questions, { status: "solo", board: null }), questions);
});

// Render the lobby's public controls and execute only its entry effect. Media and
// contest authorization stay owned by the shell, and no real timer/network starts.
async function renderReadyLobby({
  phase = "choosing",
  locked = false,
  supports = true,
  own = true,
  canEnter = true,
  futureStart = false,
} = {}) {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  const exports = {},
    effects = [];
  let enters = 0,
    readies = 0;
  const jsx = (type, props) => ({ type, props });
  new Function(
    "require",
    "exports",
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
  )((name) => {
    if (name === "react")
      return {
        useEffect: (callback) => effects.push(callback),
        useState: (v) => [typeof v === "function" ? v() : v, () => {}],
      };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@/lib/team-lobby")
      return {
        countdownMs: () => (phase === "locked" ? null : 60000),
        contestStartRemaining: () => (futureStart ? 60000 : 0),
      };
    return Object.fromEntries(
      ["VStack", "HStack", "Heading", "Token", "Text", "List", "ListItem", "Button"].map((n) => [
        n,
        n,
      ])
    );
  }, exports);
  const board = {
    team: { name: "Team" },
    phase: { name: phase, starts_at: "2026-01-01T00:00:00Z" },
    allocation: { locked },
    readiness_supported: supports,
    readiness: { ready: 0, needed: 1, mine: false, can_ready: true },
    members: [{ display_name: "Me", is_me: true, ready: false, part_label: own ? "A" : null }],
    parts: [{ label: "A", problem_label: "A", holder: own ? "Me" : null, holder_is_me: own }],
  };
  const tree = exports.TeamLobby({
    state: { status: "team", sampledAt: 0, pending: false, board },
    contestUid: "contest",
    canEnter,
    onClaim() {},
    onRelease() {},
    onReady: () => readies++,
    onEnter: () => enters++,
  });
  effects.at(-1)();
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    for (const child of [node.props?.children, node.props?.endContent].flat(Infinity)) visit(child);
  };
  visit(tree);
  return {
    tree,
    nodes,
    board,
    get enters() {
      return enters;
    },
    get readies() {
      return readies;
    },
  };
}

test("choosing offers Ready for an assigned part and never enters before the board locks", async () => {
  const selected = await renderReadyLobby();
  const ready = selected.nodes.find((n) => n.type === "Button" && n.props.label === "Ready");
  assert.equal(ready.props.isDisabled, false);
  ready.props.onClick();
  assert.equal(selected.readies, 1);
  assert.equal(selected.enters, 0);
  assert.equal(
    selected.nodes.some((n) => n.props?.label === "Go to your part"),
    false
  );
  for (const patch of [{ own: false }, { canEnter: false }]) {
    const lobby = await renderReadyLobby(patch);
    assert.equal(
      lobby.nodes.find((n) => n.type === "Button" && n.props.label === "Ready").props.isDisabled,
      true
    );
    assert.equal(lobby.enters, 0);
  }
});

test("server locked assignments autoenter only after schedule and shell security gates permit", async () => {
  const patch = { phase: "locked", locked: true };
  assert.equal((await renderReadyLobby(patch)).enters, 1);
  for (const blocked of [
    { canEnter: false },
    { futureStart: true },
    { own: false },
    { locked: false },
  ]) {
    assert.equal((await renderReadyLobby({ ...patch, ...blocked })).enters, 0);
  }
  const oldServer = await renderReadyLobby({ ...patch, supports: false });
  assert.equal(oldServer.enters, 0);
  const legacyEntry = oldServer.nodes.find(
    (n) => n.type === "Button" && n.props.label === "Go to your part"
  );
  assert.equal(
    legacyEntry.props.isDisabled,
    false,
    "older API retains a usable explicit entry path"
  );
});

test("automatic lobby entry preserves setup, expiry and overlay fences and exposes the shared theme control", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
  const gate = source.match(/const canEnterTeamPart =([\s\S]*?);/)[1];
  for (const fence of [
    "entryReady",
    "!editorLocked",
    "!criticalOverlayActive",
    "!networkOverlayActive",
    "!leaveConfirm",
    "!submitConfirm",
    "!showSupportChat",
    "!showSupportModal",
    "!showMediaToggleWarning",
    "!pendingRedirect",
  ])
    assert.ok(gate.includes(fence), fence);
  assert.match(source, /canEnter=\{canEnterTeamPart\}/);
  assert.match(source, /if \(canEnterTeamPart\) setEnteredTeamPart\(true\)/);
  assert.match(source, /aria-label="Lobby actions">\s*<ThemeToggle \/>/);
});
