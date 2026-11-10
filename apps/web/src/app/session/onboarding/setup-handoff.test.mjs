import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { workspaceAlreadyLoaded } from "../contest/team-workspace-entry.ts";
import { SETUP_ATTEMPT_KEY } from "./setup-authorization.ts";
import {
  SETUP_HANDOFF_KEY,
  markSetupHandoff,
  readSetupHandoff,
  clearSetupHandoff,
  createSetupHandoffValidator,
} from "./setup-handoff.ts";

const handoff = {
  contestId: "contest",
  sessionId: "session",
  entryAttemptId: "10000000-0000-4000-8000-000000000001",
};
const echo = {
  uid: "session",
  contest_uid: "contest",
  status: "active",
  entry_attempt_id: handoff.entryAttemptId,
};
function storage() {
  const values = new Map([
    [SETUP_ATTEMPT_KEY, JSON.stringify({ contestId: "contest", id: handoff.entryAttemptId })],
  ]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("early session creation is not a handoff; final completion survives same-window refresh", () => {
  const saved = storage();
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  markSetupHandoff(saved, handoff);
  assert.deepEqual(readSetupHandoff(saved, "contest", "session"), handoff);
  assert.deepEqual(readSetupHandoff(saved, "contest", "session"), handoff);
  assert.equal(readSetupHandoff(saved, "other", "session"), null);
  assert.equal(readSetupHandoff(saved, "contest", "other"), null);
  saved.setItem(
    SETUP_ATTEMPT_KEY,
    JSON.stringify({ contestId: "contest", id: "10000000-0000-4000-8000-000000000002" })
  );
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  assert.throws(() => markSetupHandoff(saved, handoff), /changed/);
});

test("malformed, unavailable and missing setup storage fail closed", () => {
  const saved = storage();
  for (const raw of ["bad", "null", "{}", JSON.stringify({ ...handoff, entryAttemptId: "bad" })]) {
    saved.setItem(SETUP_HANDOFF_KEY, raw);
    assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  }
  markSetupHandoff(saved, handoff);
  saved.removeItem(SETUP_ATTEMPT_KEY);
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  assert.throws(() => markSetupHandoff(saved, handoff));
  saved.getItem = () => {
    throw Error("blocked");
  };
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
});

test("failed clears revoke same-window reuse; only successful final marking restores it", () => {
  const saved = storage();
  markSetupHandoff(saved, handoff);
  saved.removeItem = () => {
    throw Error("blocked");
  };
  clearSetupHandoff(saved);
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  const write = saved.setItem;
  saved.setItem = () => {
    throw Error("blocked");
  };
  assert.throws(() => markSetupHandoff(saved, handoff));
  assert.equal(readSetupHandoff(saved, "contest", "session"), null);
  saved.setItem = write;
  markSetupHandoff(saved, handoff);
  assert.deepEqual(readSetupHandoff(saved, "contest", "session"), handoff);
});

test("effect replay and paper retries share one exact nonce authorization, scoped to auth generation", async () => {
  const validate = createSetupHandoffValidator();
  let calls = 0;
  const start = async () => {
    calls++;
    return echo;
  };
  const first = validate(handoff, 1, start, () => true);
  assert.equal(
    validate(handoff, 1, start, () => true),
    first
  );
  await first;
  await validate(handoff, 1, start, () => true);
  assert.equal(calls, 1);
  await validate(handoff, 2, start, () => true);
  assert.equal(calls, 2);
});

test("failed, malformed, terminal and mismatched POST echoes never authorize or trigger retry loops", async () => {
  for (const response of [
    null,
    {},
    { ...echo, status: "terminated" },
    { ...echo, status: "submitted" },
    { ...echo, uid: "other" },
    { ...echo, contest_uid: "other" },
    { ...echo, entry_attempt_id: null },
    { ...echo, entry_attempt_id: "other" },
  ]) {
    const validate = createSetupHandoffValidator();
    let calls = 0;
    const start = async () => {
      calls++;
      return response;
    };
    await assert.rejects(validate(handoff, 1, start, () => true));
    await assert.rejects(validate(handoff, 1, start, () => true));
    assert.equal(calls, 1);
  }
  await assert.rejects(
    createSetupHandoffValidator()(
      handoff,
      1,
      async () => {
        throw Error("approval denied");
      },
      () => true
    ),
    /approval denied/
  );
});

test("account or attempt changes fence authorization results before and after POST", async () => {
  let active = false;
  let calls = 0;
  const start = async () => {
    calls++;
    return echo;
  };
  await assert.rejects(
    createSetupHandoffValidator()(handoff, 1, start, () => active),
    /changed/
  );
  assert.equal(calls, 0);
  active = true;
  let complete;
  const result = createSetupHandoffValidator()(
    handoff,
    1,
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    () => active
  );
  await tick();
  active = false;
  complete(echo);
  await assert.rejects(result, /changed/);
});

// Execute the actual effect bodies so a JSX-only guard cannot pass these tests.
const ts = createRequire(import.meta.url)("typescript");
const source = readFileSync(new URL("../contest/client.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "client.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function effectContaining(fragment, bindings) {
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes(fragment)
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect, fragment);
  const js = ts.transpileModule(`const effect = ${effect};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return effect;`)(
    ...Object.values(bindings)
  );
}
function gateFixture({ marked = true, dry = false, start, native = true } = {}) {
  const saved = storage();
  if (marked) markSetupHandoff(saved, handoff);
  let generation = 1;
  let authListener;
  const calls = [];
  const context = { current: null };
  const bindings = {
    contestId: "contest",
    isDryRun: dry,
    isGatingRelaxed: () => false,
    authGeneration: () => generation,
    participantToken: () => "token",
    subscribeAuthChanges: (listener) => {
      authListener = listener;
      return () => {};
    },
    setupContextRef: context,
    setupValidatorRef: { current: createSetupHandoffValidator() },
    sessionStorage: saved,
    readSetupHandoff,
    readStoredSession: () => ({ id: "session", contest_id: "contest" }),
    leavingWorkspaceRef: { current: false },
    setLockGate: (value) => calls.push(value),
    setSessionId() {},
    setQuestions() {},
    redirectAfterRelease: async (route) => calls.push(route),
    startSession: async (input) => {
      calls.push(input);
      return start ? start() : echo;
    },
    invoke: async (command) => {
      calls.push(command);
      if (!native) throw Error("unavailable");
      return true;
    },
    window: native ? { __TAURI__: {} } : {},
  };
  return {
    saved,
    calls,
    context,
    effect: effectContaining("const handoff =", bindings),
    switchAccount: () => {
      generation++;
      authListener();
    },
  };
}

for (const dry of [false, true]) {
  test(`direct real contest without handoff redirects before POST/native (dry-run=${dry})`, async () => {
    const fixture = gateFixture({ marked: false, dry });
    fixture.effect();
    await tick();
    assert.deepEqual(fixture.calls, [
      "checking",
      "redirecting",
      "/session/onboarding?contestId=contest",
    ]);
    assert.equal(fixture.context.current, null);
  });
}

test("approval denial redirects before native; valid refresh POST precedes native", async () => {
  const denied = gateFixture({
    start: async () => {
      throw Error("approval denied");
    },
  });
  denied.effect();
  await tick();
  assert.ok(denied.calls.includes("/session/onboarding?contestId=contest"));
  assert.ok(!denied.calls.includes("is_lockdown_engaged"));
  for (const native of [true, false]) {
    const valid = gateFixture({ native });
    const cleanup = valid.effect();
    cleanup(); // React strict effect replay must share the in-flight POST.
    valid.effect();
    await tick();
    assert.equal(valid.calls.filter((call) => typeof call === "object").length, 1);
    assert.deepEqual(
      valid.calls.find((call) => typeof call === "object"),
      { contestUid: "contest", entryAttemptId: handoff.entryAttemptId }
    );
    assert.equal(valid.calls.at(-1), "ok");
    assert.ok(valid.context.current.isCurrent());
  }
});

test("pending POST cannot apply after account switch, unmount or handoff clear", async () => {
  for (const change of ["account", "unmount", "clear"]) {
    let complete;
    const fixture = gateFixture({
      start: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const cleanup = fixture.effect();
    await tick();
    if (change === "account") fixture.switchAccount();
    if (change === "unmount") cleanup();
    if (change === "clear") clearSetupHandoff(fixture.saved);
    complete(echo);
    await tick();
    assert.ok(!fixture.calls.includes("ok"));
    assert.ok(!fixture.calls.includes("is_lockdown_engaged"));
    assert.equal(fixture.context.current, null);
  }
});

test("paper loading and proctor acquisition effects return before any work when entry is denied", () => {
  for (const fragment of [
    "const paper = await loadContestPaper(",
    "cameraSession.ensure()",
    '"count_monitors"',
    '"scan_processes"',
    "const reportFocusLoss",
  ]) {
    const effect = effectContaining(fragment, { entryReady: false });
    assert.equal(effect(), undefined, fragment);
  }
});

test("same team assignment recovery preserves live unsaved edits and assets without draft reinstall", async () => {
  const files = [{ content: "unsaved live edit" }];
  let paperReads = 0,
    draftReads = 0,
    released = 0,
    error = "prior session read failed",
    loading = true;
  const context = { isCurrent: () => true };
  const retries = { current: 2 };
  const identity = { contestId: "contest", sessionId: "session", generation: 1, label: "A" };
  const effect = effectContaining("const paper = await loadContestPaper(", {
    entryReady: true,
    showTeamLobby: false,
    contestId: "contest",
    isDryRun: false,
    participantToken: () => "token",
    setupContextRef: { current: context },
    leavingWorkspaceRef: { current: false },
    autoLoadRetriesRef: retries,
    readStoredSession: () => ({ id: "session", contest_id: "contest" }),
    getSession: async () => ({ uid: "session", status: "active", phase: "running" }),
    unauthorizedAtRef: { current: null },
    desktopTeamRoom: true,
    nativeTeamUnsupported: false,
    teamProbeResult: null,
    lobbyState: { status: "team" },
    teamOwnLabel: "A",
    authGeneration: () => 1,
    loadedTeamWorkspace: { current: identity },
    workspaceAlreadyLoaded,
    setLoadError: (value) => {
      error = value;
    },
    setLoadRetryable: () => {},
    setLoading: (value) => {
      loading = value;
    },
    loadContestPaper: async () => {
      paperReads++;
      throw new Error("must not reload paper");
    },
    listDrafts: async () => {
      draftReads++;
      return [];
    },
    setQuestionFiles: () => {
      files[0].content = "older draft";
    },
    releaseCandidateQuestionAssets: () => {
      released++;
    },
  });
  const cleanup = effect();
  await tick();
  cleanup();
  assert.equal(files[0].content, "unsaved live edit");
  assert.equal(paperReads, 0);
  assert.equal(draftReads, 0);
  assert.equal(released, 0);
  assert.equal(error, null);
  assert.equal(loading, false);
  assert.equal(retries.current, 0);
});

test("unsupported native client loads no paper until the probe proves a solo contest", async () => {
  for (const result of [null, "team", "solo"]) {
    const reads = [];
    let error = null,
      retryable = null,
      loading = true;
    const effect = effectContaining("const paper = await loadContestPaper(", {
      entryReady: true,
      showTeamLobby: false,
      contestId: "contest",
      isDryRun: false,
      participantToken: () => "token",
      setupContextRef: { current: { isCurrent: () => true } },
      leavingWorkspaceRef: { current: false },
      autoLoadRetriesRef: { current: 0 },
      readStoredSession: () => {
        reads.push("stored");
        return { id: "session", contest_id: "contest" };
      },
      getSession: async () => {
        reads.push("session");
        return { uid: "session", status: "pending", phase: "running" };
      },
      unauthorizedAtRef: { current: null },
      desktopTeamRoom: false,
      nativeTeamUnsupported: true,
      teamProbeResult: result,
      lobbyState: { status: "loading" },
      teamOwnLabel: null,
      authGeneration: () => 1,
      setLoadError: (value) => {
        error = value;
      },
      setLoadRetryable: (value) => {
        retryable = value;
      },
      setLoading: (value) => {
        loading = value;
      },
      setLoadAttempt: () => {},
      MAX_AUTO_LOAD_RETRIES: 0,
      ProctorApiError: class extends Error {},
      loadContestPaper: async () => {
        reads.push("paper");
        return { questions: [] };
      },
    });
    const cleanup = effect();
    await tick();
    cleanup?.();
    if (result === "solo") {
      assert.deepEqual(reads, ["stored", "session"], "solo proceeds exactly as before");
      continue;
    }
    assert.deepEqual(reads, [], `${result}: nothing is read`);
    if (result === null) {
      assert.equal(loading, true, "pending keeps the boot screen");
      assert.equal(error, null);
    } else {
      assert.equal(
        error,
        "This is a team round. Team rounds need the AMS Access app on Windows or Linux. Contact your organizer."
      );
      assert.equal(retryable, false);
      assert.equal(loading, false);
    }
  }
});

function nativeLoadFixture({ result, session }) {
  const reads = [];
  const ui = { error: null, retryable: null, loading: true, probe: "kept", round: 0, attempts: 0 };
  const unauthorizedAtRef = { current: null };
  const effect = effectContaining("const paper = await loadContestPaper(", {
    entryReady: true,
    showTeamLobby: false,
    contestId: "contest",
    isDryRun: false,
    participantToken: () => "token",
    setupContextRef: { current: { isCurrent: () => true } },
    leavingWorkspaceRef: { current: false },
    autoLoadRetriesRef: { current: 0 },
    readStoredSession: () => ({ id: "session", contest_id: "contest" }),
    getSession: async () => {
      reads.push("session");
      return session();
    },
    unauthorizedAtRef,
    onUnauthorized: (firstAt, now) => ({ firstAt: firstAt ?? now, signedOut: false }),
    AUTH_RECHECK_MS: 0,
    redirectAfterRelease: async (route) => reads.push(route),
    desktopTeamRoom: false,
    nativeTeamUnsupported: true,
    teamProbeResult: result,
    lobbyState: { status: "loading" },
    teamOwnLabel: null,
    authGeneration: () => 1,
    setLoadError: (value) => (ui.error = value),
    setLoadRetryable: (value) => (ui.retryable = value),
    setLoading: (value) => (ui.loading = value),
    setLoadAttempt: () => ui.attempts++,
    setTeamProbe: (value) => (ui.probe = value),
    setTeamProbeRound: (update) => (ui.round = update(ui.round)),
    MAX_AUTO_LOAD_RETRIES: 0,
    ProctorApiError,
    loadContestPaper: async () => {
      reads.push("paper");
      return { questions: [] };
    },
  });
  return { effect, reads, ui };
}
class ProctorApiError extends Error {
  constructor(status) {
    super(String(status));
    this.status = status;
  }
}

test("a 401 probe lets the existing sign-in handling run but never fetches the paper", async () => {
  const unauthorized = nativeLoadFixture({
    result: "defer",
    session: () => {
      throw new ProctorApiError(401);
    },
  });
  const cleanup = unauthorized.effect();
  await tick();
  await tick();
  cleanup?.();
  assert.deepEqual(unauthorized.reads, ["session"], "getSession runs, the paper does not");
  assert.equal(
    unauthorized.ui.error,
    "Checking your sign-in. This page will retry in a few seconds."
  );
  assert.equal(unauthorized.ui.retryable, true);
  assert.equal(unauthorized.ui.probe, "kept");
});

test("a deterministic probe refusal reaches the loader's own error handling, never the paper", async () => {
  const gone = nativeLoadFixture({
    result: "defer",
    session: () => {
      throw new ProctorApiError(404);
    },
  });
  let cleanup = gone.effect();
  await tick();
  await tick();
  cleanup?.();
  assert.deepEqual(
    gone.reads,
    ["session", "/session/onboarding?contestId=contest"],
    "a missing session goes to onboarding as before; the paper is not read"
  );
  assert.equal(gone.ui.probe, "kept");

  const refused = nativeLoadFixture({
    result: "defer",
    session: () => {
      const error = new ProctorApiError(403);
      error.isPermanent = true;
      throw error;
    },
  });
  cleanup = refused.effect();
  await tick();
  await tick();
  cleanup?.();
  assert.deepEqual(refused.reads, ["session"], "getSession runs, the paper does not");
  assert.equal(
    refused.ui.error,
    "Unable to load contest. Return to your contest list and try again."
  );
  assert.equal(refused.ui.retryable, false);
  assert.equal(refused.ui.loading, false, "the boot screen does not spin forever");
});

test("a later attempt with a good session and no solo result re-probes instead of fetching", async () => {
  const later = nativeLoadFixture({
    result: "defer",
    session: () => ({ uid: "session", status: "active", phase: "running" }),
  });
  const cleanup = later.effect();
  await tick();
  await tick();
  cleanup?.();
  assert.deepEqual(later.reads, ["session"], "the paper is never fetched without a solo result");
  assert.equal(later.ui.probe, null, "the stale probe result is cleared");
  assert.equal(later.ui.round, 1, "a fresh probe is requested");
  assert.equal(later.ui.loading, true, "the boot screen stays");
  assert.equal(later.ui.error, null);
});
