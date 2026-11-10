import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTeamLobby,
  countdownMs,
  createTeamLobbyController,
  classifyTeamRoundProbe,
  probeTeamRound,
} from "./team-lobby.ts";
const board = () => ({
  team: { uid: "team", number: 1, name: "Team 1" },
  members: [{ display_name: "Me", is_me: true, part_label: null, assigned_by: null }],
  parts: [
    {
      label: "1",
      problem_label: "P1",
      holder: null,
      holder_is_me: false,
      revision: null,
      submission_status: null,
      verdict: null,
    },
  ],
  phase: {
    name: "choosing",
    voice_open: true,
    selection_opens_at: "2026-01-01T00:00:00Z",
    claims_open_at: "2026-01-01T00:02:00Z",
    prompt: "Discuss",
    discussion_seconds: 120,
  },
  allocation: { locked: false, locks_at: "2026-01-01T00:03:00Z" },
  server_time: "2026-01-01T00:02:00Z",
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("projection rejects oversized/ambiguous membership and invalid dates", () => {
  assert.equal(parseTeamLobby(board()).parts[0].label, "1");
  assert.equal(
    "integration" in parseTeamLobby({ ...board(), integration: { large: "discard" } }),
    false
  );
  for (const alter of [
    (b) => (b.members = Array(6).fill(b.members[0])),
    (b) => b.members.push({ ...b.members[0] }),
    (b) => (b.server_time = "bad"),
    (b) => b.parts.push({ ...b.parts[0] }),
  ]) {
    const b = board();
    alter(b);
    assert.throws(() => parseTeamLobby(b));
  }
});
test("countdown uses server sample plus monotonic elapsed, never wall time", () => {
  assert.equal(countdownMs(board(), 1000, 21000), 40000);
  assert.equal(countdownMs(board(), 1000, 100000), 0);
});
test("claim is single flight and never optimistic; 409 refreshes holder and preserves detail", async () => {
  let release;
  let calls = [];
  let state;
  const fresh = board();
  fresh.parts[0].holder = "Other member";
  const controller = createTeamLobbyController({
    apiBase: "https://example.test",
    contestUid: "contest",
    headers: () => ({}),
    hidden: () => false,
    onState: (s) => (state = s),
    request: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) return Response.json(board(), { headers: { ETag: "v1" } });
      if (calls.length === 2) {
        await new Promise((r) => (release = r));
        return Response.json({ detail: "part already held" }, { status: 409 });
      }
      return Response.json(fresh);
    },
  });
  await flush();
  controller.claim("1");
  controller.claim("1");
  assert.equal(calls.length, 2);
  assert.equal(state.board.parts[0].holder, null);
  release();
  await flush();
  await flush();
  assert.equal(calls.length, 3);
  assert.equal(state.board.parts[0].holder, "Other member");
  assert.equal(state.error, "part already held");
  assert.equal(calls[1].init.body, '{"part_label":"1"}');
  controller.stop();
});
test("stop fences late async responses and aborts request", async () => {
  let resolve;
  let signal;
  let emissions = 0;
  const controller = createTeamLobbyController({
    apiBase: "",
    contestUid: "c",
    headers: () => ({}),
    hidden: () => false,
    onState: () => emissions++,
    request: (_url, init) => {
      signal = init.signal;
      return new Promise((r) => (resolve = r));
    },
  });
  controller.stop();
  assert.equal(signal.aborted, true);
  const count = emissions;
  resolve(Response.json(board()));
  await flush();
  assert.equal(emissions, count);
});
test("discussion cannot issue a claim and terminal auth clears board", async () => {
  let calls = 0,
    state;
  const b = board();
  b.phase.name = "discussion";
  const controller = createTeamLobbyController({
    apiBase: "",
    contestUid: "c",
    headers: () => ({}),
    hidden: () => true,
    onState: (s) => (state = s),
    request: async () =>
      ++calls === 1 ? Response.json(b) : Response.json({ detail: "Unauthorized" }, { status: 401 }),
  });
  await flush();
  controller.claim("1");
  assert.equal(calls, 1);
  controller.refresh();
  await flush();
  assert.equal(state.board, null);
  assert.equal(state.status, "error");
  controller.refresh();
  assert.equal(calls, 2);
  controller.stop();
});

test("visibility refresh overlapping a GET bypasses restored ETag and reanchors server time", async () => {
  let release;
  let count = 0;
  const headers = [];
  let state;
  const fresh = { ...board(), server_time: "2026-01-01T00:02:30Z" };
  const controller = createTeamLobbyController({
    apiBase: "https://example.test",
    contestUid: "contest",
    headers: () => ({}),
    hidden: () => true,
    onState: (value) => {
      state = value;
    },
    request: async (_, init) => {
      headers.push(init.headers);
      if (++count === 1) {
        await new Promise((resolve) => {
          release = resolve;
        });
        return Response.json(board(), { headers: { ETag: "stale-before-sleep" } });
      }
      return Response.json(fresh, { headers: { ETag: "fresh-after-sleep" } });
    },
  });
  controller.refresh();
  release();
  await flush();
  await flush();
  assert.equal(count, 2);
  assert.equal(headers[1]["If-None-Match"], undefined);
  assert.equal(state.board.server_time, fresh.server_time);
  assert.equal(countdownMs(state.board, state.sampledAt, state.sampledAt), 30000);
  controller.stop();
});

test("team round probe classifier: only the exact not-a-team-round 404 is solo", () => {
  const cases = [
    [404, { detail: "this contest is not a team round" }, "solo"],
    [200, board(), "team"],
    [404, { detail: "teams have not been published yet" }, "team"],
    [403, { detail: "you are not on a team in this round" }, "team"],
    [403, { detail: "this token is for another contest" }, "error"],
    [404, { detail: "contest not found" }, "error"],
    [404, null, "error"],
    [404, "this contest is not a team round", "error"],
    [404, { detail: "This contest is not a team round" }, "error"],
    [403, null, "error"],
    [401, { detail: "this contest is not a team round" }, "error"],
    [500, { detail: "this contest is not a team round" }, "error"],
    [503, null, "error"],
    [409, null, "error"],
  ];
  for (const [status, body, expected] of cases)
    assert.equal(
      classifyTeamRoundProbe(status, body),
      expected,
      `${status} ${JSON.stringify(body)}`
    );
});

test("team round probe issues one no-store GET with headers and signal, then classifies", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const reply = (status, body) => async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  const run = (request) =>
    probeTeamRound({
      apiBase: "https://api.example/",
      contestUid: "c 1",
      headers: { Authorization: "Bearer t", "X-Device-Id": "d" },
      signal,
      request,
    });
  assert.equal(await run(reply(404, { detail: "this contest is not a team round" })), "solo");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example/participant/contests/c%201/team");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(calls[0].init.headers, { Authorization: "Bearer t", "X-Device-Id": "d" });
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal("body" in calls[0].init, false);
  assert.equal(await run(reply(200, board())), "team");
  assert.equal(await run(reply(404, { detail: "teams have not been published yet" })), "team");
  assert.equal(await run(reply(502, null)), "error");
  assert.equal(await run(async () => new Response("not json", { status: 404 })), "error");
  assert.equal(
    await run(async () => {
      throw new TypeError("Load failed");
    }),
    "error"
  );
  assert.equal(
    await run(async () => {
      throw new DOMException("aborted", "AbortError");
    }),
    "error"
  );
  assert.equal(calls.length, 4);
});
