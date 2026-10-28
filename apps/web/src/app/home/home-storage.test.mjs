import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { approvalMessage } from "./components/approval-feedback.ts";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const requestStart = source.indexOf("  async function submitResumeRequest(");
const requestEnd = source.indexOf("\n  async function validateStoredActiveSession(", requestStart);
assert.ok(requestStart >= 0 && requestEnd > requestStart);
const requestCode = ts.transpileModule(source.slice(requestStart, requestEnd), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function approvalRequestHarness() {
  const calls = [],
    writes = [],
    states = [];
  let resolve, reject;
  const context = {
    approvalMessage,
    setApprovalUnavailable() {},
    activeSessionRef: { current: { id: "A" } },
    resumeRequestInFlightRef: { current: false },
    recoveryEpochRef: { current: 0 },
    recoveryCurrent: (_id, epoch) => epoch === context.recoveryEpochRef.current,
    setResumeBusy() {},
    setResumeStatus: (status) => states.push(status),
    appendSecurityEvent() {},
    getOrCreateDeviceId: () => "synthetic-device",
    requestResume: (id) => {
      calls.push(id);
      return new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
    mergeResumeRequestIntoSession: (session, request) => ({
      ...session,
      resume_request_id: request.id,
    }),
    ACTIVE_SESSION_KEY: "session",
    localStorage: { setItem: (...args) => writes.push(args) },
    setActiveSession: (session) => states.push(session),
  };
  vm.runInNewContext(requestCode, context);
  return {
    calls,
    writes,
    states,
    context,
    submit: () => context.submitResumeRequest({ id: "A", contest_id: "contest" }),
    complete: () => resolve({ uid: "request", status: "PENDING" }),
    fail: () => reject(new Error("offline")),
  };
}

test("rapid approval-request retries send one mutation and permit retry after failure", async () => {
  const h = approvalRequestHarness();
  const first = h.submit();
  const burst = Array.from({ length: 1000 }, () => h.submit());
  assert.equal(h.calls.length, 1);
  h.fail();
  await first;
  await Promise.all(burst);
  const retry = h.submit();
  assert.equal(h.calls.length, 2);
  h.complete();
  await retry;
  assert.equal(h.writes.length, 1);
});

test("approval response arriving after sign-out cannot publish state or keep the guard locked", async () => {
  const h = approvalRequestHarness();
  const pending = h.submit();
  h.context.recoveryEpochRef.current++;
  h.complete();
  await pending;
  assert.equal(h.writes.length, 0);
  assert.equal(h.context.resumeRequestInFlightRef.current, false);
});
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
    recoveryEpochRef: { current: 0 },
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
const recoveryCheckStart = source.indexOf("  function recoveryCurrent(");
const recoveryCheckEnd = source.indexOf(
  "\n  async function consumeApprovedResume",
  recoveryCheckStart
);
assert.ok(recoveryCheckStart >= 0 && recoveryCheckEnd > recoveryCheckStart);
const recoveryCheckCode = ts.transpileModule(source.slice(recoveryCheckStart, recoveryCheckEnd), {
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
    recoveryEpochRef: { current: 0 },
    ProctorApiError: ApiError,
    approvalMessage,
    setApprovalUnavailable: (value) => {
      state.approvalUnavailable = value;
    },
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
      getItem: () => state.stored,
      setItem: (_key, value) => {
        if (writeDenied) throw new Error("storage denied");
        state.stored = value;
      },
    },
  };
  vm.runInNewContext(recoveryCheckCode, context);
  vm.runInNewContext(validationCode, context);
  return {
    state,
    session,
    context,
    validate: (mode = "hydrate") => context.validateStoredActiveSession(session, mode),
  };
}
test("late validation of A cannot clear a newer onboarding session B", async () => {
  let rejectOld;
  const h = validationHarness();
  h.context.getSession = () =>
    new Promise((_resolve, reject) => {
      rejectOld = reject;
    });
  const pending = h.validate();
  const newer = JSON.stringify({ id: "B", contest_id: "contest-B" });
  h.state.stored = newer;
  rejectOld(new ApiError(404));
  await pending;
  assert.equal(h.state.stored, newer);
  assert.equal(h.state.removed, 0);
});
test("sign-out prevents an earlier verification response from restoring saved recovery", async () => {
  let resolveApproval;
  const h = validationHarness();
  h.context.latestResumeRequest = () =>
    new Promise((resolve) => {
      resolveApproval = resolve;
    });
  const pending = h.validate();
  for (let i = 0; i < 8 && !resolveApproval; i++) await Promise.resolve();
  assert.equal(typeof resolveApproval, "function");

  const signOutStart = source.indexOf("  async function signOut() {");
  const signOutEnd = source.indexOf("\n  // Match the existing resume guards", signOutStart);
  const signOutCode = ts.transpileModule(source.slice(signOutStart, signOutEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const storage = h.context.localStorage;
  h.context.ACTIVE_SESSION_KEY = "ams_active_session";
  storage.ams_active_session = h.state.stored;
  storage.removeItem = (key) => {
    delete storage[key];
    h.state.stored = null;
  };
  h.context.setConfirmDiscardOpen = () => {};
  h.context.setSigningOut = () => {};
  h.context.logout = () => {};
  h.context.clearQueryCache = () => {};
  h.context.hasNativeBridge = () => false;
  h.context.DEVICE_SCOPED_KEYS = new Set();
  h.context.setTimeout = () => 1;
  h.context.router = { push: () => assert.fail("navigation should remain delayed") };
  vm.runInNewContext(signOutCode, h.context);
  await h.context.signOut();
  assert.equal(h.state.stored, null);
  resolveApproval({ uid: "request", status: "APPROVED" });
  await pending;
  assert.equal(h.state.stored, null, "old verification must not restore A after sign-out");
});
test("sign-out cannot be followed by a late approval-consume redirect", async () => {
  const start = source.indexOf("  async function consumeApprovedResume(");
  const end = source.indexOf("  async function refreshResumeRequest(", start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let resolveConsume;
  const writes = [];
  const navigation = [];
  const recoveryEpochRef = { current: 0 };
  const context = {
    recoveryEpochRef,
    recoveryCurrent: (_id, epoch) => epoch === recoveryEpochRef.current,
    resumeConsumeInFlightRef: { current: false },
    setResumeBusy: () => {},
    setResumeStatus: () => {},
    consumeResume: () => new Promise((resolve) => (resolveConsume = resolve)),
    mergeResumeRequestIntoSession: () => ({ id: "A", contest_id: "contest" }),
    localStorage: { setItem: (...args) => writes.push(args) },
    ACTIVE_SESSION_KEY: "ams_active_session",
    setActiveSession: () => writes.push("state"),
    router: { push: (path) => navigation.push(path) },
    encodeURIComponent,
  };
  vm.runInNewContext(code, context);
  const pending = context.consumeApprovedResume({ id: "A", contest_id: "contest" });
  recoveryEpochRef.current += 1; // signOut invalidates work started under the old identity
  resolveConsume({});
  await pending;
  assert.deepEqual(writes, []);
  assert.deepEqual(navigation, []);
});
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

test("Resume consumes a verified approval even while a background poll is in flight", async () => {
  const start = source.indexOf("  async function handleResumeActiveSession() {");
  const end = source.indexOf("\n  function handleSignOut()", start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const consumed = [];
  let polled = 0;
  const context = {
    activeSession: { id: "saved", contest_id: "contest" },
    resumeBusy: false,
    resumeInFlightRef: { current: false },
    setResumeStatus() {},
    setResumeVerification() {},
    validateStoredActiveSession: async () => ({
      id: "saved",
      contest_id: "contest",
      resume_request_status: "APPROVED",
    }),
    consumeApprovedResume: async (session) => {
      consumed.push(session.id);
    },
    refreshResumeRequest: async () => {
      polled++;
    },
  };
  vm.runInNewContext(code, context);
  await Promise.all([context.handleResumeActiveSession(), context.handleResumeActiveSession()]);
  assert.deepEqual(consumed, ["saved"]);
  assert.equal(polled, 0);
  assert.equal(context.resumeInFlightRef.current, false);
});

test("a late approval poll cannot reset Resume state during consumption", async () => {
  const start = source.indexOf("  async function refreshResumeRequest(");
  const end = source.indexOf("\n  const refreshResumeRequestRef", start);
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let resolvePoll;
  const session = { id: "saved", resume_request_id: "request", resume_request_status: "APPROVED" };
  const writes = [];
  const context = {
    resumePollInFlightRef: { current: false },
    resumeConsumeInFlightRef: { current: false },
    resumeInFlightRef: { current: false },
    activeSessionRef: { current: session },
    recoveryEpochRef: { current: 0 },
    recoveryCurrent: () => true,
    latestResumeRequest: () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
    mergeResumeRequestIntoSession: () => {
      throw new Error("late poll applied");
    },
    setResumeStatus: (value) => writes.push(value),
    setResumeBusy: (value) => writes.push(value),
  };
  vm.runInNewContext(code, context);
  const pending = context.refreshResumeRequest(session);
  assert.equal(context.resumePollInFlightRef.current, true);
  context.resumeConsumeInFlightRef.current = true;
  resolvePoll({ uid: "request", status: "APPROVED" });
  await pending;
  assert.deepEqual(writes, []);
  assert.equal(context.resumePollInFlightRef.current, false);
});

const panelSource = readFileSync(
  new URL("./components/SessionActionsPanel.tsx", import.meta.url),
  "utf8"
);
const panelStart = panelSource.indexOf("  const requestStatus =");
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
      resumeStatus: null,
      resumeVerification: verification,
      resumeBusy: false,
    };
    vm.runInNewContext(panelCode, context);
    assert.equal(context.result.resumeButtonDisabled, disabled);
    assert.equal(context.result.resumeButtonLabel, label);
  }
});
