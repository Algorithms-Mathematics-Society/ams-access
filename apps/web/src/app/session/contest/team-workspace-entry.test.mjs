import test from "node:test";
import assert from "node:assert/strict";
import {
  assignedWorkspaceLabel,
  teamWorkspaceAllowed,
  workspaceAlreadyLoaded,
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
