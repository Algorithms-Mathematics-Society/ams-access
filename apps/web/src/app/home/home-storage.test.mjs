import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = source.lastIndexOf(
  "  useEffect(() => {",
  source.indexOf("    // The token outlives the page:")
);
const end = source.indexOf("\n  }, []);", start) + "\n  }, []);".length;
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function hydrate({ deniedRead, session, deniedRemoval = false } = {}) {
  const state = {},
    removed = [];
  let cleanup;
  const context = {
    useEffect: (effect) => {
      cleanup = effect();
    },
    restoreToken() {},
    setDisplayName: (value) => {
      state.name = value;
    },
    setIdentityHydrated: (value) => {
      state.hydrated = value;
    },
    setActiveSession: (value) => {
      state.session = value;
    },
    setResumeVerification: (value) => {
      state.verification = value;
    },
    setResumeStatus: (value) => {
      state.status = value;
    },
    STORAGE_KEYS: { DISPLAY_NAME: "display" },
    ACTIVE_SESSION_KEY: "session",
    scanGenerationRef: { current: 0 },
    localStorage: {
      getItem: (key) => {
        if (deniedRead === key || deniedRead === "all") throw new Error("denied");
        return key === "display" ? "Candidate" : session;
      },
      removeItem: (key) => {
        removed.push(key);
        if (deniedRemoval) throw new Error("denied");
      },
    },
  };
  vm.runInNewContext(code, context);
  return { state, removed, cleanup, generation: context.scanGenerationRef };
}
test("presentation read failure defaults name and still hydrates stored session", () => {
  const h = hydrate({ deniedRead: "display", session: JSON.stringify({ id: "saved" }) });
  assert.equal(h.state.name, "");
  assert.equal(h.state.hydrated, true);
  assert.equal(h.state.session.id, "saved");
  assert.equal(h.state.verification, "unverified");
  assert.match(h.state.status, /Validating/);
  h.cleanup();
  assert.equal(h.generation.current, 1);
});
for (const deniedRead of ["session", "all"]) {
  test(`required session read failure ${deniedRead} is explicit and cannot verify recovery`, () => {
    const h = hydrate({ deniedRead });
    assert.equal(h.state.hydrated, true);
    assert.equal(h.state.verification, "invalid");
    assert.equal(h.state.session, undefined);
    assert.match(h.state.status, /could not be accessed/);
    assert.equal(typeof h.cleanup, "function");
  });
}
for (const session of ["invalid json", "{}", "null"]) {
  test(`malformed session ${session} is removed, and removal failure stays explicit`, () => {
    const cleared = hydrate({ session });
    assert.deepEqual(cleared.removed, ["session"]);
    assert.equal(cleared.state.verification, "none");
    const denied = hydrate({ session, deniedRemoval: true });
    assert.equal(denied.state.verification, "invalid");
    assert.match(denied.state.status, /could not be accessed/);
    assert.equal(denied.state.hydrated, true);
    assert.deepEqual(denied.removed, ["session"]);
  });
}
test("normal hydration preserves presentation and leaves absent session alone", () => {
  const h = hydrate();
  assert.equal(h.state.name, "Candidate");
  assert.equal(h.state.hydrated, true);
  assert.equal(h.state.status, undefined);
  assert.deepEqual(h.removed, []);
});

// Execute the real page handlers with controlled server/storage outcomes.
const validationStart = source.indexOf("  async function validateStoredActiveSession(");
const validationEnd = source.indexOf("\n  useEffect(() => {", validationStart);
const validationCode = ts.transpileModule(source.slice(validationStart, validationEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
class ApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}
function validationHarness({ error, approvalError, live, writeDenied = false } = {}) {
  const session = { id: "saved", contest_id: "contest", resume_request_status: "PENDING" };
  const state = {
    session,
    stored: JSON.stringify(session),
    removed: 0,
    approvalCalls: 0,
    busy: false,
  };
  const context = {
    ProctorApiError: ApiError,
    getSession: async () => {
      if (error) throw error;
      return live ?? { uid: "saved", contest_uid: "contest", status: "ACTIVE" };
    },
    latestResumeRequest: async () => {
      state.approvalCalls++;
      if (approvalError) throw approvalError;
      return { uid: "request", status: "PENDING" };
    },
    mergeResumeRequestIntoSession: (saved, request) => ({
      ...saved,
      resume_request_status: request?.status,
    }),
    setResumeBusy: (value) => {
      state.busy = value;
    },
    setResumeVerification: (value) => {
      state.verification = value;
    },
    setResumeStatus: (value) => {
      state.status = value;
    },
    setActiveSession: (value) => {
      state.session = value;
    },
    clearStoredActiveSession: (reason) => {
      state.removed++;
      state.stored = null;
      state.session = null;
      state.verification = "invalid";
      state.status = reason;
    },
    appendSecurityEvent() {},
    ACTIVE_SESSION_KEY: "session",
    localStorage: {
      setItem: (_key, value) => {
        if (writeDenied) throw new Error("storage denied");
        state.stored = value;
      },
    },
  };
  vm.runInNewContext(validationCode, context);
  return {
    state,
    session,
    context,
    validate: (mode = "hydrate") => context.validateStoredActiveSession(session, mode),
  };
}
for (const error of [
  new TypeError("offline"),
  new Error("timeout"),
  new ApiError(429),
  new ApiError(500),
  new ApiError(503),
  new ApiError(401),
  new ApiError(403),
]) {
  test(`verification ${error.message} keeps recovery and permits explicit retry`, async () => {
    const h = validationHarness({ error });
    const before = h.state.stored;
    assert.equal(await h.validate("resume"), null);
    assert.equal(h.state.stored, before);
    assert.equal(h.state.session, h.session);
    assert.equal(h.state.removed, 0);
    assert.equal(h.state.verification, "retryable");
    assert.equal(h.state.busy, false);
    h.context.getSession = async () => ({ uid: "saved", contest_uid: "contest", status: "ACTIVE" });
    const resumed = await h.validate("resume");
    assert.equal(resumed.id, "saved");
    assert.equal(h.state.verification, "verified");
    assert.equal(h.state.session.resume_request_status, "PENDING");
  });
}
test("authoritative session 404 clears saved recovery", async () => {
  const h = validationHarness({ error: new ApiError(404) });
  assert.equal(await h.validate(), null);
  assert.equal(h.state.stored, null);
  assert.equal(h.state.removed, 1);
  assert.equal(h.state.verification, "invalid");
});
for (const live of [
  { uid: "saved", contest_uid: "other", status: "ACTIVE" },
  { uid: "saved", contest_uid: "contest", status: "SUBMITTED" },
  { uid: "saved", contest_uid: "contest", status: "ACTIVE", ended_at: "2026-10-24T00:00:00Z" },
]) {
  test(`definitive inactive or mismatched record clears recovery: ${JSON.stringify(live)}`, async () => {
    const h = validationHarness({ live });
    assert.equal(await h.validate(), null);
    assert.equal(h.state.removed, 1);
    assert.equal(h.state.approvalCalls, 0);
  });
  test(`definitive invalid record clears before an unavailable approval endpoint: ${JSON.stringify(live)}`, async () => {
    const h = validationHarness({ live, approvalError: new ApiError(503) });
    assert.equal(await h.validate("resume"), null);
    assert.equal(h.state.removed, 1);
    assert.equal(h.state.verification, "invalid");
    assert.equal(h.state.approvalCalls, 0);
    assert.equal(h.state.busy, false);
  });
}
test("unknown approval state keeps saved pending request and blocks entry", async () => {
  const h = validationHarness({ approvalError: new ApiError(503) });
  const before = h.state.stored;
  assert.equal(await h.validate("resume"), null);
  assert.equal(h.state.stored, before);
  assert.equal(h.state.session.resume_request_status, "PENDING");
  assert.equal(h.state.verification, "retryable");
});
test("denied verification persistence does not erase existing recovery", async () => {
  const h = validationHarness({ writeDenied: true });
  const before = h.state.stored;
  assert.equal(await h.validate("resume"), null);
  assert.equal(h.state.stored, before);
  assert.equal(h.state.removed, 0);
  assert.equal(h.state.verification, "retryable");
});

const panelSource = readFileSync(
  new URL("./components/SessionActionsPanel.tsx", import.meta.url),
  "utf8"
);
const panelStart = panelSource.indexOf("  const resumeRetryable =");
const panelEnd = panelSource.indexOf("\n  const hasQuietEmptyState", panelStart);
const panelCode =
  panelSource.slice(panelStart, panelEnd) +
  "\nresult = { resumeButtonDisabled, resumeButtonLabel };";
test("retry is actionable with a saved pending approval; checking and verified pending remain disabled", () => {
  for (const [verification, disabled, label] of [
    ["retryable", false, "Retry verification"],
    ["checking", true, "Awaiting Approval"],
    ["verified", true, "Awaiting Approval"],
    ["invalid", true, "Awaiting Approval"],
  ]) {
    const context = {
      activeSession: { resume_request_status: "PENDING" },
      resumeVerification: verification,
      resumeBusy: false,
    };
    vm.runInNewContext(panelCode, context);
    assert.equal(context.result.resumeButtonDisabled, disabled);
    assert.equal(context.result.resumeButtonLabel, label);
  }
});
