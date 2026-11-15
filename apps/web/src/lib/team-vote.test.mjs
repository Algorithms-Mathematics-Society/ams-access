import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTeamVote,
  voteRemainingMs,
  integrationStatus,
  integrationPartStatus,
} from "./team-vote.ts";

// Shapes mirror ams-api `services/team_board.py` (participant board) and
// `_integration_out`: Python `isoformat()` deadlines carry `+00:00`, the
// integration statuses it emits are queued, completed and failed, and
// `submitted_by` is only ever written as "vote" or "deadline" (a staff
// rejudge dispatches without touching it).
const completed = () => ({
  uid: "22222222-2222-2222-2222-222222222222",
  revision: 2,
  trigger: "vote",
  status: "completed",
  verdict: "WA",
  integration_verdict: "WA",
  passed_count: 3,
  total_count: 5,
  failing_parts: ["2"],
  project_failure: false,
  substitutions: [],
  fallbacks: {},
  parts: {
    1: {
      verdict: "AC",
      status: "completed",
      passed_count: 2,
      total_count: 2,
      origin: "submission",
    },
    2: {
      verdict: "WA",
      status: "completed",
      passed_count: 1,
      total_count: 3,
      origin: "submission",
    },
  },
  error: null,
});
const board = () => ({
  revision: 3,
  vote: { votes: 2, needed: 4, mine: true, deadline: "2026-12-01T12:00:00+00:00" },
  submitted_revision: 2,
  submitted_by: "vote",
  integration: null,
  last_result: completed(),
  fingerprint: "0123456789abcdef0123",
});

test("a realistic board projects to exactly the allowlisted vote fields", () => {
  const input = board();
  const before = structuredClone(input);
  assert.deepEqual(parseTeamVote(input), {
    revision: 3,
    votes: 2,
    needed: 4,
    mine: true,
    deadline: "2026-12-01T12:00:00+00:00",
    submitted_revision: 2,
    submitted_by: "vote",
    integration: null,
    last_result: {
      revision: 2,
      status: "completed",
      verdict: "WA",
      details: {
        parts: [
          { label: "1", substituted: false, verdict: "AC", passed_count: 2, total_count: 2 },
          { label: "2", substituted: false, verdict: "WA", passed_count: 1, total_count: 3 },
        ],
        substitutions: [],
        failing_parts: ["2"],
        project_failure: false,
        integration_verdict: "WA",
        passed_count: 3,
        total_count: 5,
      },
    },
  });
  assert.deepEqual(input, before, "parsing must not mutate the polled board");
});

test("a board before any submission keeps the vote and reports no results", () => {
  const input = board();
  Object.assign(input, { revision: 0, submitted_revision: null, submitted_by: null });
  input.last_result = null;
  input.vote.votes = 0;
  const vote = parseTeamVote(input);
  assert.equal(vote.revision, 0);
  assert.equal(vote.submitted_revision, null);
  assert.equal(vote.submitted_by, null);
  assert.equal(vote.integration, null);
  assert.equal(vote.last_result, null);
});

test("vote bounds accept every legal team size and full approval", () => {
  for (const needed of [1, 4, 5]) {
    const input = board();
    input.vote.needed = needed;
    input.vote.votes = needed;
    assert.equal(parseTeamVote(input)?.votes, needed, `needed=${needed}`);
  }
  const deadlineTrigger = board();
  deadlineTrigger.submitted_by = "deadline";
  deadlineTrigger.submitted_revision = deadlineTrigger.revision;
  assert.equal(parseTeamVote(deadlineTrigger)?.submitted_by, "deadline");
  const zulu = board();
  zulu.vote.deadline = "2026-12-01T12:00:00Z";
  assert.equal(parseTeamVote(zulu)?.deadline, "2026-12-01T12:00:00Z");
});

test("an untrustworthy vote projection is rejected as a whole", () => {
  for (const value of [null, undefined, "board", 7, [], [board()]])
    assert.equal(parseTeamVote(value), null, `top-level ${JSON.stringify(value)}`);
  const cases = {
    "missing vote": (b) => delete b.vote,
    "vote is an array": (b) => (b.vote = []),
    "fractional revision": (b) => (b.revision = 1.5),
    "string revision": (b) => (b.revision = "3"),
    "negative revision": (b) => (b.revision = -1),
    "unsafe revision": (b) => (b.revision = Number.MAX_SAFE_INTEGER + 1),
    "missing votes": (b) => delete b.vote.votes,
    "negative votes": (b) => (b.vote.votes = -1),
    "more votes than members": (b) => (b.vote.votes = 5),
    "zero needed": (b) => Object.assign(b.vote, { needed: 0, votes: 0 }),
    "six needed": (b) => Object.assign(b.vote, { needed: 6, votes: 0 }),
    "string mine": (b) => (b.vote.mine = "true"),
    "missing mine": (b) => delete b.vote.mine,
    "missing deadline": (b) => delete b.vote.deadline,
    "numeric deadline": (b) => (b.vote.deadline = 1764590400000),
    "unparseable deadline": (b) => (b.vote.deadline = "soon"),
    "missing submitted_revision": (b) => delete b.submitted_revision,
    "future submitted_revision": (b) => (b.submitted_revision = b.revision + 1),
    "negative submitted_revision": (b) => (b.submitted_revision = -1),
    "missing submitted_by": (b) => delete b.submitted_by,
    "unknown submitted_by": (b) => (b.submitted_by = "staff"),
    "rejudge submitted_by": (b) => (b.submitted_by = "rejudge"),
  };
  for (const [name, change] of Object.entries(cases)) {
    const input = board();
    change(input);
    assert.equal(parseTeamVote(input), null, name);
  }
});

test("a malformed integration summary is dropped without hiding the vote", () => {
  const cases = {
    "string revision": (r) => (r.revision = "2"),
    "missing status": (r) => delete r.status,
    "overlong status": (r) => (r.status = "x".repeat(65)),
    "numeric verdict": (r) => (r.verdict = 1),
    "missing verdict": (r) => delete r.verdict,
    "overlong verdict": (r) => (r.verdict = "x".repeat(65)),
  };
  for (const field of ["integration", "last_result"]) {
    for (const [name, change] of Object.entries(cases)) {
      const input = board();
      input[field] = completed();
      change(input[field]);
      const vote = parseTeamVote(input);
      assert.notEqual(vote, null, `${field}: ${name} must not reject the vote`);
      assert.equal(vote[field], null, `${field}: ${name}`);
    }
    for (const value of [[completed()], "completed", 2]) {
      const input = board();
      input[field] = value;
      assert.equal(parseTeamVote(input)?.[field], null, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test("a queued integration keeps its status and the API's zero count defaults", () => {
  const input = board();
  // submit_revision() records the submitted revision with the queued run.
  input.submitted_revision = input.revision;
  input.integration = {
    ...completed(),
    revision: 3,
    status: "queued",
    verdict: null,
    integration_verdict: null,
    passed_count: 0,
    total_count: 0,
    failing_parts: [],
    fallbacks: { 2: "reference" },
    parts: {},
  };
  const { integration } = parseTeamVote(input);
  assert.equal(integration.status, "queued");
  assert.equal(integration.verdict, null);
  assert.deepEqual(integration.details.parts, []);
  assert.equal(integration.details.passed_count, 0);
  assert.equal(integration.details.total_count, 0);
});

test("incomplete or oversized result details fail closed to no details", () => {
  const cases = {
    "missing project_failure": (r) => delete r.project_failure,
    "string project_failure": (r) => (r.project_failure = "false"),
    "missing failing_parts": (r) => delete r.failing_parts,
    "null failing_parts": (r) => (r.failing_parts = null),
    "six failing_parts": (r) => (r.failing_parts = ["1", "2", "3", "4", "5", "6"]),
    "empty failing label": (r) => (r.failing_parts = [""]),
    "overlong failing label": (r) => (r.failing_parts = ["x".repeat(65)]),
    "numeric failing label": (r) => (r.failing_parts = [2]),
    "null substitutions": (r) => (r.substitutions = null),
    "six substitutions": (r) =>
      (r.substitutions = Array.from({ length: 6 }, (_, i) => ({
        label: String(i),
        reason: "missing",
      }))),
    "substitution without label": (r) => (r.substitutions = [{ reason: "missing" }]),
    "substitution without reason": (r) => (r.substitutions = [{ label: "1" }]),
    "overlong substitution reason": (r) =>
      (r.substitutions = [{ label: "1", reason: "x".repeat(401) }]),
    "parts as array": (r) => (r.parts = [{ verdict: "AC" }]),
    "six parts": (r) =>
      (r.parts = Object.fromEntries(
        ["1", "2", "3", "4", "5", "6"].map((l) => [l, { verdict: "AC", origin: "submission" }])
      )),
    "missing parts": (r) => delete r.parts,
    "non-object part": (r) => (r.parts = { 1: "AC" }),
    "overlong part label": (r) => (r.parts = { ["x".repeat(65)]: { verdict: "AC" } }),
  };
  for (const [name, change] of Object.entries(cases)) {
    const input = board();
    change(input.last_result);
    const { last_result } = parseTeamVote(input);
    assert.notEqual(last_result, null, `${name} keeps the summary`);
    assert.equal(last_result.details, null, name);
    assert.equal(integrationPartStatus(last_result, "1"), "Result details unavailable", name);
  }
});

test("detail limits accept values exactly at their bounds", () => {
  const input = board();
  const label = "x".repeat(64);
  Object.assign(input.last_result, {
    failing_parts: ["1", "2", "3", "4", label],
    substitutions: [{ label, reason: "r".repeat(400), origin: "reference" }],
    parts: Object.fromEntries(["1", "2", "3", "4", label].map((l) => [l, { verdict: "AC" }])),
  });
  const { details } = parseTeamVote(input).last_result;
  assert.equal(details.parts.length, 5);
  assert.equal(details.substitutions[0].reason.length, 400);
  assert.equal(
    integrationPartStatus(parseTeamVote(input).last_result, label),
    "Substituted · no score"
  );
});

test("a part with a non-submission origin is treated as substituted", () => {
  const origins = {
    reference: { substituted: true, reference: true },
    fallback: { substituted: true, reference: false },
    submission: { substituted: false },
    absent: { substituted: false },
  };
  for (const [origin, expected] of Object.entries(origins)) {
    const input = board();
    const part = { verdict: "AC", passed_count: 2, total_count: 2 };
    if (origin !== "absent") part.origin = origin;
    input.last_result.parts = { 1: part };
    const { details } = parseTeamVote(input).last_result;
    assert.equal(details.parts[0].substituted, expected.substituted, `origin ${origin}`);
    if (expected.substituted) {
      assert.deepEqual(details.substitutions, [
        { label: "1", reason: "not supplied by your team", reference: expected.reference },
      ]);
      assert.equal(
        integrationPartStatus(parseTeamVote(input).last_result, "1"),
        "Substituted · no score"
      );
    } else {
      assert.deepEqual(details.substitutions, [], `origin ${origin}`);
      assert.equal(integrationPartStatus(parseTeamVote(input).last_result, "1"), "AC");
    }
  }
});

test("substitution follows the server's scoring rule for every origin and flag value", () => {
  // Expected values come from running ams-api `team_board.substituted()`, which
  // decides whether a part earns its score. It uses Python truthiness, so null,
  // "", 0, false, [] and {} all count as "not substituted" there.
  const serverRule = [
    [{}, false],
    [{ origin: null }, false],
    [{ origin: "" }, false],
    [{ origin: 0 }, false],
    [{ origin: false }, false],
    [{ origin: [] }, false],
    [{ origin: {} }, false],
    [{ origin: "submission" }, false],
    [{ origin: "reference" }, true],
    [{ origin: "fallback" }, true],
    [{ origin: "submission", substituted: null }, false],
    [{ origin: "submission", substituted: false }, false],
    [{ origin: "submission", substituted: 0 }, false],
    [{ origin: "submission", substituted: "" }, false],
    [{ origin: "submission", substituted: [] }, false],
    [{ origin: "submission", substituted: {} }, false],
    [{ origin: "submission", substituted: true }, true],
    [{ origin: "submission", substituted: 1 }, true],
    [{ origin: "submission", substituted: "reference" }, true],
    [{ origin: null, substituted: true }, true],
    [{ origin: null, substituted: "reference" }, true],
    [{ origin: "", substituted: 1 }, true],
    [{ origin: [], substituted: "reference" }, true],
  ];
  for (const [fields, substituted] of serverRule) {
    const input = board();
    input.last_result.parts = { 1: { verdict: "AC", passed_count: 2, total_count: 2, ...fields } };
    const result = parseTeamVote(input).last_result;
    const name = JSON.stringify(fields);
    assert.equal(result.details.parts[0].substituted, substituted, name);
    assert.equal(result.details.substitutions.length, substituted ? 1 : 0, name);
    assert.equal(
      integrationPartStatus(result, "1"),
      substituted ? "Substituted · no score" : "AC",
      name
    );
  }
});

test("the substituted flag marks a part even when its origin says submission", () => {
  const flags = {
    // The shape the worker reports for a reference stand-in (ams-api tests/team_helpers.py).
    "worker reference": [{ origin: "reference", substituted: "reference" }, true],
    "reference flag without origin": [{ substituted: "reference" }, true],
    "true flag on a submission": [{ origin: "submission", substituted: true }, false],
  };
  for (const [name, [flag, reference]] of Object.entries(flags)) {
    const input = board();
    input.last_result.parts = { 1: { verdict: "AC", passed_count: 2, total_count: 2, ...flag } };
    const { details } = parseTeamVote(input).last_result;
    assert.equal(details.parts[0].substituted, true, name);
    assert.deepEqual(
      details.substitutions,
      [{ label: "1", reason: "not supplied by your team", reference }],
      name
    );
    assert.equal(
      integrationPartStatus(parseTeamVote(input).last_result, "1"),
      "Substituted · no score",
      name
    );
  }
});

test("a listed substitution is kept once and only a reference origin is marked reference", () => {
  const input = board();
  input.last_result.substitutions = [
    { label: "1", reason: "not submitted", origin: "reference" },
    { label: "2", reason: "did not compile", origin: "fallback" },
  ];
  input.last_result.parts = {
    1: { verdict: "AC", origin: "reference" },
    2: { verdict: "AC", origin: "fallback" },
  };
  const { details } = parseTeamVote(input).last_result;
  assert.deepEqual(details.substitutions, [
    { label: "1", reason: "not submitted", reference: true },
    { label: "2", reason: "did not compile", reference: false },
  ]);
  assert.deepEqual(
    details.parts.map((p) => p.substituted),
    [true, true]
  );
});

test("unusable counts and verdicts become null instead of rejecting the result", () => {
  const input = board();
  Object.assign(input.last_result, {
    passed_count: -1,
    total_count: 2.5,
    integration_verdict: "",
  });
  input.last_result.parts = {
    1: { verdict: "", passed_count: "2", total_count: null, origin: "submission" },
    2: { verdict: "x".repeat(65), passed_count: Number.NaN, origin: "submission" },
  };
  const result = parseTeamVote(input).last_result;
  assert.equal(result.details.passed_count, null);
  assert.equal(result.details.total_count, null);
  assert.equal(result.details.integration_verdict, null);
  for (const part of result.details.parts) {
    assert.equal(part.verdict, null);
    assert.equal(part.passed_count, null);
    assert.equal(part.total_count, null);
  }
});

test("vote time remaining follows the server clock, not the local one", () => {
  const vote = parseTeamVote(board());
  const sampledAt = 1_000_000;
  const tenMinutes = 10 * 60_000;
  const serverTime = new Date(Date.parse(vote.deadline) - tenMinutes).toISOString();
  assert.equal(voteRemainingMs(vote, serverTime, sampledAt, sampledAt), tenMinutes);
  assert.equal(
    voteRemainingMs(vote, serverTime, sampledAt, sampledAt + 60_000),
    tenMinutes - 60_000
  );
  // A local clock stepped backwards must never add time to the vote.
  assert.equal(voteRemainingMs(vote, serverTime, sampledAt, sampledAt - 60_000), tenMinutes);
  // server_time is Python isoformat(): microseconds and a +00:00 offset.
  assert.equal(
    voteRemainingMs(vote, "2026-12-01T11:50:00.250000+00:00", sampledAt, sampledAt),
    tenMinutes - 250
  );
  assert.equal(
    voteRemainingMs(vote, "2026-12-01T11:50:00.250Z", sampledAt, sampledAt),
    tenMinutes - 250
  );
});

test("vote time remaining stops at zero once the server deadline passes", () => {
  const vote = parseTeamVote(board());
  const sampledAt = 5_000;
  assert.equal(voteRemainingMs(vote, vote.deadline, sampledAt, sampledAt), 0);
  const late = new Date(Date.parse(vote.deadline) + 60_000).toISOString();
  assert.equal(voteRemainingMs(vote, late, sampledAt, sampledAt), 0);
  const early = new Date(Date.parse(vote.deadline) - 1_000).toISOString();
  assert.equal(voteRemainingMs(vote, early, sampledAt, sampledAt + 3_600_000), 0);
});

test("integration status wording maps API and tolerated statuses without overclaiming", () => {
  const summary = (status) => ({ revision: 1, status, verdict: null, details: null });
  const expected = {
    // The API emits queued, completed and failed; the rest are client tolerance.
    queued: "Queued",
    pending: "Queued",
    running: "Running",
    judging: "Running",
    completed: "Completed",
    failed: "Could not complete",
    "": "Awaiting result",
    cancelled: "Awaiting result",
    COMPLETED: "Awaiting result",
  };
  for (const [status, text] of Object.entries(expected))
    assert.equal(integrationStatus(summary(status)), text, `status ${JSON.stringify(status)}`);
});

test("part status explains missing results without implying a pass", () => {
  assert.equal(integrationPartStatus(null, "1"), "No result yet");
  assert.equal(integrationPartStatus(undefined, "1"), "No result yet");
  const noDetails = { revision: 1, status: "completed", verdict: "AC", details: null };
  assert.equal(integrationPartStatus(noDetails, "1"), "Result details unavailable");
  const result = parseTeamVote(board()).last_result;
  assert.equal(integrationPartStatus(result, "1"), "AC");
  assert.equal(integrationPartStatus(result, "2"), "WA");
  assert.equal(integrationPartStatus(result, "9"), "Result details unavailable");
  // A substitution listed for a part that also reports AC is never shown as AC.
  const input = board();
  input.last_result.substitutions = [{ label: "1", reason: "not submitted", origin: "reference" }];
  assert.equal(
    integrationPartStatus(parseTeamVote(input).last_result, "1"),
    "Substituted · no score"
  );
  // The listed substitution wins on its own, even if the part entry disagrees.
  const contradictory = {
    revision: 1,
    status: "completed",
    verdict: "AC",
    details: {
      parts: [{ label: "1", substituted: false, verdict: "AC", passed_count: 2, total_count: 2 }],
      substitutions: [{ label: "1", reason: "not submitted", reference: true }],
      failing_parts: [],
      project_failure: false,
      integration_verdict: "AC",
      passed_count: 2,
      total_count: 2,
    },
  };
  assert.equal(integrationPartStatus(contradictory, "1"), "Substituted · no score");
  // And a part flagged substituted is never shown with its verdict, even if unlisted.
  contradictory.details.parts[0].substituted = true;
  contradictory.details.substitutions = [];
  assert.equal(integrationPartStatus(contradictory, "1"), "Substituted · no score");
});
