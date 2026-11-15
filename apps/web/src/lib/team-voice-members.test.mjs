import test from "node:test";
import assert from "node:assert/strict";
import { voiceMemberRows } from "./team-voice-members.ts";
const team = {
  members: [
    { member_uid: "me", display_name: "Same", is_me: true },
    { member_uid: "a", display_name: "Same", is_me: false },
    { member_uid: "b", display_name: "Same", is_me: false },
  ],
};
const snapshot = {
  status: "connected",
  muted: true,
  peers: [{ memberUid: "a", displayName: "Same", muted: false, speaking: true, volume: 0.6 }],
};
test("duplicate names join only on IDs; each roster member appears once", () => {
  const rows = voiceMemberRows(team, snapshot);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.status),
    ["muted", "speaking", "not in voice"]
  );
  assert.equal(rows[1].peer.memberUid, "a");
  assert.equal(rows[2].peer, undefined);
  assert.equal(voiceMemberRows(team, { ...snapshot, muted: false })[0].status, "in voice");
});
test("peer leaves, mutes or stops speaking without duplicated rows", () => {
  assert.equal(voiceMemberRows(team, { ...snapshot, peers: [] })[1].status, "not in voice");
  assert.equal(
    voiceMemberRows(team, { ...snapshot, peers: [{ ...snapshot.peers[0], muted: true }] })[1]
      .status,
    "muted"
  );
  assert.equal(
    voiceMemberRows(team, { ...snapshot, peers: [{ ...snapshot.peers[0], speaking: false }] })[1]
      .status,
    "in voice"
  );
});
test("legacy IDs and disconnected signaling do not invent remote presence", () => {
  const legacy = { members: team.members.map(({ member_uid, ...member }) => member) };
  assert.equal(voiceMemberRows(legacy, snapshot)[1].status, "voice status unavailable");
  for (const [state, status] of [
    [null, "join voice to see"],
    [{ ...snapshot, status: "reconnecting" }, "connecting…"],
    [{ ...snapshot, status: "closed" }, "voice ended"],
  ]) {
    const rows = voiceMemberRows(team, state);
    assert.equal(rows[1].status, status);
    assert.equal(rows[1].peer, undefined);
  }
});
