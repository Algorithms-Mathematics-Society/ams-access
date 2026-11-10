import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTeamLobby,
  countdownMs,
  createTeamLobbyController,
  classifyTeamRoundProbe,
  probeTeamRound,
  startTeamRoundProbeLoop,
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

// Runs a controller under a fake clock installed as the global timers, so a
// scheduled poll can be fired on demand instead of waited for.
async function withFakeTimers(body) {
  const clock = fakeClock();
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  try {
    return await body(clock);
  } finally {
    globalThis.setTimeout = real.setTimeout;
    globalThis.clearTimeout = real.clearTimeout;
  }
}
const wrongContest = () =>
  Response.json({ detail: "this token is for another contest" }, { status: 403 });

test("a wrong-contest 403 on the first GET is its own terminal status with no error", async () => {
  await withFakeTimers(async (clock) => {
    const calls = [];
    const states = [];
    const controller = createTeamLobbyController({
      apiBase: "",
      contestUid: "c",
      headers: () => ({}),
      hidden: () => false,
      random: () => 0,
      onState: (s) => states.push(s),
      request: async (url, init) => {
        calls.push(init.method);
        return wrongContest();
      },
    });
    await flush();
    await flush();
    const state = states.at(-1);
    assert.equal(state.status, "wrong-contest");
    assert.equal(state.board, null);
    assert.equal(state.error, null);
    assert.equal(state.pending, false);
    assert.ok(
      states.every((s) => s.status !== "error" && s.error === null),
      "no error status or text is ever emitted"
    );
    assert.deepEqual(clock.pending(), [], "no poll is scheduled");
    clock.advance(60000);
    controller.refresh();
    controller.claim("1");
    controller.release();
    await flush();
    await flush();
    assert.deepEqual(calls, ["GET"], "no further request is ever made");
    controller.stop();
  });
});

test("a wrong-contest 403 on claim is the same terminal status and stops polling", async () => {
  await withFakeTimers(async (clock) => {
    const calls = [];
    let state;
    const controller = createTeamLobbyController({
      apiBase: "",
      contestUid: "c",
      headers: () => ({}),
      hidden: () => false,
      random: () => 0,
      onState: (s) => (state = s),
      request: async (url, init) => {
        calls.push(init.method);
        return calls.length === 1 ? Response.json(board()) : wrongContest();
      },
    });
    await flush();
    assert.equal(state.status, "team");
    controller.claim("1");
    await flush();
    await flush();
    assert.equal(state.status, "wrong-contest");
    assert.equal(state.board, null);
    assert.equal(state.error, null);
    assert.equal(state.pending, false);
    assert.deepEqual(clock.pending(), [], "no poll is scheduled");
    clock.advance(60000);
    controller.refresh();
    await flush();
    assert.deepEqual(calls, ["GET", "POST"], "no further request is ever made");
    controller.stop();
  });
});

test("another 403 detail and a 401 on the first GET stay terminal errors with their detail", async () => {
  for (const [status, detail] of [
    [403, "you are not on a team in this round"],
    [403, "Forbidden"],
    [401, "Unauthorized"],
  ]) {
    await withFakeTimers(async (clock) => {
      let calls = 0;
      let state;
      const controller = createTeamLobbyController({
        apiBase: "",
        contestUid: "c",
        headers: () => ({}),
        hidden: () => false,
        random: () => 0,
        onState: (s) => (state = s),
        request: async () => {
          calls++;
          return Response.json({ detail }, { status });
        },
      });
      await flush();
      await flush();
      assert.equal(state.status, "error", `${status} ${detail}`);
      assert.equal(state.board, null);
      assert.equal(state.error, detail);
      assert.deepEqual(clock.pending(), [], "terminal: no poll is scheduled");
      clock.advance(60000);
      controller.refresh();
      await flush();
      assert.equal(calls, 1);
      controller.stop();
    });
  }
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
    // A definite refusal that proves nothing defers to the normal load.
    // A token issued for another contest: only signing in again can help.
    [403, { detail: "this token is for another contest" }, "wrong-contest"],
    [403, { detail: "this token is for a different contest" }, "defer"],
    [403, { detail: "This token is for another contest" }, "defer"],
    [403, "this token is for another contest", "defer"],
    [401, { detail: "this token is for another contest" }, "defer"],
    [404, { detail: "this token is for another contest" }, "defer"],
    [404, { detail: "contest not found" }, "defer"],
    [404, null, "defer"],
    [404, "this contest is not a team round", "defer"],
    [404, { detail: "This contest is not a team round" }, "defer"],
    [403, null, "defer"],
    [401, { detail: "this contest is not a team round" }, "defer"],
    [401, null, "defer"],
    [400, { detail: "bad request" }, "defer"],
    [409, null, "defer"],
    [410, null, "defer"],
    [422, null, "defer"],
    [499, null, "defer"],
    // Transient or unknown answers are retried, never treated as solo.
    [408, null, "error"],
    [408, { detail: "this contest is not a team round" }, "error"],
    [429, null, "error"],
    [500, { detail: "this contest is not a team round" }, "error"],
    [500, null, "error"],
    [502, null, "error"],
    [503, null, "error"],
    [504, null, "error"],
    [204, null, "error"],
    [302, null, "error"],
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
  assert.equal(await run(reply(401, { detail: "Unauthorized" })), "defer");
  assert.equal(
    await run(reply(403, { detail: "this token is for another contest" })),
    "wrong-contest"
  );
  assert.equal(await run(reply(403, { detail: "forbidden" })), "defer");
  assert.equal(await run(reply(404, { detail: "contest not found" })), "defer");
  assert.equal(await run(reply(400, null)), "defer");
  assert.equal(await run(reply(408, null)), "error");
  assert.equal(await run(reply(429, null)), "error");
  assert.equal(await run(reply(502, null)), "error");
  assert.equal(await run(async () => new Response("not json", { status: 404 })), "defer");
  assert.equal(await run(async () => new Response("not json", { status: 503 })), "error");
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
  assert.equal(calls.length, 11);
});

// Deterministic timers for the probe loop: nothing fires until advanced.
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const scheduled = [];
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn, ms });
      scheduled.push(ms);
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    pending: () => [...timers.values()].map((t) => t.ms).sort((a, b) => a - b),
    scheduled,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}
// A probe whose replies the test controls. Like probeTeamRound, an abort
// resolves "error" instead of throwing.
function fakeProbe() {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const probe = (signal) =>
    new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const call = {
        signal,
        settled: false,
        resolve: (value) => {
          if (call.settled) return;
          call.settled = true;
          inFlight -= 1;
          resolve(value);
        },
      };
      signal.addEventListener("abort", () => call.resolve("error"));
      calls.push(call);
    });
  return { probe, calls, maxInFlight: () => maxInFlight, inFlight: () => inFlight };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function startLoop({ round = 0, random = () => 0, isCurrent = () => true } = {}) {
  const clock = fakeClock();
  const fake = fakeProbe();
  const results = [];
  const stop = startTeamRoundProbeLoop({
    probe: fake.probe,
    round,
    isCurrent,
    onResult: (result) => results.push(result),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random,
  });
  return { clock, fake, results, stop };
}

test("probe loop: round 0 probes immediately and delivers a definite result once", async () => {
  const { clock, fake, results } = startLoop();
  assert.equal(fake.calls.length, 1, "first probe is synchronous on round 0");
  assert.deepEqual(clock.pending(), [8000], "only the per-request abort timer is armed");
  fake.calls[0].resolve("solo");
  await settle();
  assert.deepEqual(results, ["solo"]);
  assert.deepEqual(clock.pending(), [], "the abort timer is cleared when the request settles");
  assert.equal(fake.calls[0].signal.aborted, false);
  clock.advance(60_000);
  assert.equal(fake.calls.length, 1, "a definite result ends the loop");
  for (const result of ["team", "defer", "wrong-contest"]) {
    const loop = startLoop();
    loop.fake.calls[0].resolve(result);
    await settle();
    assert.deepEqual(loop.results, [result]);
    assert.deepEqual(loop.clock.pending(), []);
  }
});

test("probe loop: a later round waits min(2000 * 2^(round-1), 15000) plus jitter first", async () => {
  const expected = [
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [4, 15_000],
    [5, 15_000],
    [9, 15_000],
  ];
  for (const [round, base] of expected) {
    const { clock, fake } = startLoop({ round, random: () => 0.4567 });
    const delay = base + 456;
    assert.equal(fake.calls.length, 0, `round ${round}: nothing is sent before the delay`);
    assert.deepEqual(clock.pending(), [delay], `round ${round}: delay`);
    clock.advance(delay - 1);
    assert.equal(fake.calls.length, 0);
    clock.advance(1);
    assert.equal(fake.calls.length, 1, `round ${round}: probes once the delay elapses`);
    assert.deepEqual(clock.pending(), [8000]);
  }
});

test("probe loop: an error retries at 2 s, 4 s, 8 s, then 15 s, each plus jitter", async () => {
  const { clock, fake, results } = startLoop({ random: () => 0.999 });
  const retries = [2000, 4000, 8000, 15_000, 15_000, 15_000];
  for (let i = 0; i < retries.length; i++) {
    fake.calls[i].resolve("error");
    await settle();
    const delay = retries[i] + 999;
    assert.deepEqual(clock.pending(), [delay], `retry ${i + 1} is scheduled alone`);
    clock.advance(delay - 1);
    assert.equal(fake.calls.length, i + 1, `retry ${i + 1} waits its full delay`);
    clock.advance(1);
    assert.equal(fake.calls.length, i + 2);
  }
  fake.calls.at(-1).resolve("solo");
  await settle();
  assert.deepEqual(results, ["solo"], "errors are never delivered");
  assert.equal(fake.maxInFlight(), 1, "never two probes in flight");
});

test("probe loop: jitter is floor(random() * 1000)", async () => {
  for (const [random, jitter] of [
    [0, 0],
    [0.0009, 0],
    [0.5, 500],
    [0.9999, 999],
  ]) {
    const { clock, fake } = startLoop({ random: () => random });
    fake.calls[0].resolve("error");
    await settle();
    assert.deepEqual(clock.pending(), [2000 + jitter]);
  }
});

test("probe loop: the 8 s abort fires on a hung request, then the loop retries", async () => {
  const { clock, fake, results } = startLoop();
  clock.advance(7999);
  assert.equal(fake.calls[0].signal.aborted, false);
  clock.advance(1);
  assert.equal(fake.calls[0].signal.aborted, true, "the request is aborted at 8 s");
  await settle();
  assert.deepEqual(results, []);
  assert.deepEqual(clock.pending(), [2000], "the abort is an error and is retried");
  clock.advance(2000);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].signal.aborted, false, "each request has its own controller");
  assert.equal(fake.maxInFlight(), 1);
});

test("probe loop: never starts a second request while one is in flight", async () => {
  const { clock, fake } = startLoop({ random: () => 0.5 });
  // Time passes with the request hung just short of its abort: nothing new is sent.
  clock.advance(7000);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.inFlight(), 1);
  fake.calls[0].resolve("error");
  await settle();
  clock.advance(2500);
  assert.equal(fake.calls.length, 2);
  clock.advance(7999);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.maxInFlight(), 1);
});

test("probe loop: stop() cancels a pending delay and aborts an in-flight request", async () => {
  const delayed = startLoop({ round: 2 });
  delayed.stop();
  assert.deepEqual(delayed.clock.pending(), [], "the pending delay is cancelled");
  delayed.clock.advance(60_000);
  assert.equal(delayed.fake.calls.length, 0, "no probe is sent after stop()");

  const retrying = startLoop();
  retrying.fake.calls[0].resolve("error");
  await settle();
  retrying.stop();
  assert.deepEqual(retrying.clock.pending(), [], "a pending retry is cancelled");
  retrying.clock.advance(60_000);
  assert.equal(retrying.fake.calls.length, 1);

  const inFlight = startLoop();
  inFlight.stop();
  assert.equal(inFlight.fake.calls[0].signal.aborted, true, "stop() aborts the request");
  await settle();
  assert.deepEqual(inFlight.results, []);
  assert.deepEqual(inFlight.clock.pending(), [], "no retry follows an abort by stop()");
  inFlight.clock.advance(60_000);
  assert.equal(inFlight.fake.calls.length, 1);
});

test("probe loop: a result arriving after stop() is dropped", async () => {
  const clock = fakeClock();
  const results = [];
  let release;
  // A probe that ignores the abort and answers late.
  const stop = startTeamRoundProbeLoop({
    probe: () => new Promise((resolve) => (release = resolve)),
    round: 0,
    isCurrent: () => true,
    onResult: (result) => results.push(result),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: () => 0,
  });
  stop();
  release("solo");
  await settle();
  assert.deepEqual(results, []);
  assert.deepEqual(clock.pending(), []);
});

test("probe loop: a result for a changed identity is dropped and not retried", async () => {
  for (const result of ["solo", "team", "defer", "error"]) {
    let current = true;
    const { clock, fake, results } = startLoop({ isCurrent: () => current });
    current = false;
    fake.calls[0].resolve(result);
    await settle();
    assert.deepEqual(results, [], `${result}: not delivered`);
    assert.deepEqual(clock.pending(), [], `${result}: nothing is scheduled`);
    clock.advance(60_000);
    assert.equal(fake.calls.length, 1);
  }
});
