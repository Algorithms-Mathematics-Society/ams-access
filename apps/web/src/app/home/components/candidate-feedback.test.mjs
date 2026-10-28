import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { approvalMessage, approvalLabel, acceptedRequestTime } from "./approval-feedback.ts";
import { deriveContestantReadiness } from "./readiness-context.ts";
import { mergeResumeRequestIntoSession } from "./resume-polling.ts";

function extract(path, names, bindings) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
      functions.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(functions.length, names.length);
  const compiled = ts.transpileModule(functions.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return {${names.join(",")}};`)(
    ...Object.values(bindings)
  );
}
function approvalHarness({ request, latest, storageFails = false } = {}) {
  const session = { id: "session", contest_id: "contest" };
  const state = {};
  const calls = [];
  const refs = { current: session };
  const bindings = {
    recoveryEpochRef: { current: 0 },
    recoveryCurrent: (id, epoch) => refs.current?.id === id && epoch === 0,
    resumeInFlightRef: { current: false },
    resumeRequestInFlightRef: { current: false },
    resumePollInFlightRef: { current: false },
    resumeConsumeInFlightRef: { current: false },
    activeSessionRef: refs,
    setResumeBusy: (value) => {
      state.busy = value;
    },
    setResumeStatus: (value) => {
      state.message = value;
    },
    setApprovalUnavailable: (value) => {
      state.unavailable = value;
    },
    setActiveSession: (value) => {
      state.session = value;
      refs.current = value;
    },
    appendSecurityEvent() {},
    getOrCreateDeviceId: () => "device",
    requestResume: async () => {
      calls.push("request");
      return request();
    },
    latestResumeRequest: async () => latest(),
    consumeApprovedResume: async () => {
      calls.push("consume");
    },
    localStorage: {
      setItem() {
        if (storageFails) throw Error("full");
      },
    },
    ACTIVE_SESSION_KEY: "session",
    approvalMessage,
    mergeResumeRequestIntoSession,
  };
  return {
    ...extract("../page.tsx", ["submitResumeRequest", "refreshResumeRequest"], bindings),
    state,
    calls,
    session,
    refs,
  };
}

test("rapid approval requests share one write and honor returned state", async () => {
  let resolve;
  const h = approvalHarness({
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const first = h.submitResumeRequest(h.session);
  await h.submitResumeRequest(h.session);
  assert.deepEqual(h.calls, ["request"]);
  assert.equal(h.state.busy, true);
  resolve({ uid: "request", status: "approved", created_at: "2026-10-24T10:00:00Z" });
  await first;
  assert.match(h.state.message, /approved/i);
  assert.equal(h.state.busy, false);
});

test("accepted request remains acknowledged if local recovery write fails", async () => {
  const h = approvalHarness({
    storageFails: true,
    request: async () => ({
      uid: "request",
      status: "pending",
      created_at: "2026-10-24T10:00:00Z",
    }),
  });
  await h.submitResumeRequest(h.session);
  assert.equal(h.state.session.resume_request_id, "request");
  assert.match(h.state.message, /request was received/);
  assert.match(h.state.message, /could not be saved/);
  assert.equal(h.state.busy, false);
});

test("unacknowledged write never claims request received and releases retry", async () => {
  const h = approvalHarness({
    request: async () => {
      throw Error("lost response");
    },
  });
  await h.submitResumeRequest(h.session);
  assert.match(h.state.message, /could not be confirmed/);
  assert.equal(h.state.unavailable, true);
  assert.equal(h.state.busy, false);
  assert.equal(h.state.session, undefined);
});

test("failed and missing approval reads keep uncertainty distinct from pending", async () => {
  for (const latest of [
    async () => {
      throw Error("offline");
    },
    async () => null,
  ]) {
    const h = approvalHarness({ latest });
    await h.refreshResumeRequest(h.session).catch((error) => assert.equal(error.message, "offline"));
    assert.equal(h.state.unavailable, true);
    assert.doesNotMatch(h.state.message, /^Waiting for organizer approval/);
    assert.equal(h.state.session, undefined);
  }
});

test("approved background read never consumes approval", async () => {
  const h = approvalHarness({ latest: async () => ({ uid: "request", status: "approved" }) });
  await h.refreshResumeRequest(h.session);
  assert.equal(h.state.unavailable, false);
  assert.match(h.state.message, /Choose Resume/);
  assert.deepEqual(h.calls, []);
});

test("late approval response does not replace another session", async () => {
  let resolve;
  const h = approvalHarness({
    request: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = h.submitResumeRequest(h.session);
  h.refs.current = { id: "new-session", contest_id: "other" };
  resolve({ uid: "old-request", status: "approved" });
  await pending;
  assert.equal(h.state.session, undefined);
});

test("preflight rescan has one owner and recovers after rejection", async () => {
  let reject;
  let calls = 0;
  const state = {};
  const bindings = {
    rescanInFlightRef: { current: false },
    setIsRescanning: (value) => {
      state.busy = value;
    },
    setRescanError: (value) => {
      state.error = value;
    },
    setEntryWindowRefreshIndex() {},
    onRescan: () => {
      calls++;
      return new Promise((_, r) => {
        reject = r;
      });
    },
  };
  const { handleRescan } = extract("./SessionReadinessModal.tsx", ["handleRescan"], bindings);
  const first = handleRescan();
  await handleRescan();
  assert.equal(calls, 1);
  reject(Error("offline"));
  await first;
  assert.equal(state.busy, false);
  assert.match(state.error, /could not complete/);
  assert.equal(bindings.rescanInFlightRef.current, false);
});

test("unavailable baseline check does not assert device eligibility", () => {
  const readiness = {
    network: "ok",
    camera: "ok",
    mic: "ok",
    vm: "ok",
    keyboard: "unavailable",
    platform: "ok",
    restrictedApps: "warn",
  };
  const result = deriveContestantReadiness({ readiness, report: null, entryWindowStatus: null });
  assert.equal(result.status, "advisory_warning");
  assert.match(result.message, /not verified/);
  assert.doesNotMatch(result.message, /eligible to enter/);
});

test("approval labels distinguish decisions and never fabricate times", () => {
  assert.equal(approvalLabel("approved", false), "Approved to rejoin");
  assert.equal(approvalLabel("pending", true), "Status unavailable");
  assert.match(approvalMessage("rejected", "Ask at desk"), /declined.*Ask at desk/);
  assert.equal(acceptedRequestTime("invalid"), null);
  assert.equal(acceptedRequestTime(), null);
  assert.ok(acceptedRequestTime("2026-10-24T10:00:00Z"));
});

function component(path) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const require = (name) => {
    if (name === "react") return { memo: (fn) => fn, useState: (value) => [value, () => {}] };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "./approval-feedback") return { approvalLabel, acceptedRequestTime };
    return new Proxy({}, { get: (_, key) => key });
  };
  new Function("require", "exports", code)(require, exports);
  return exports;
}
function nodes(node) {
  return !node || typeof node !== "object"
    ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
test("readiness rows expose actual outcome visibly, not only in aria labels", () => {
  const { ReadinessItem } = component("./ReadinessPanel.tsx");
  for (const [status, label] of [
    ["ok", "Passed"],
    ["fail", "Needs action"],
    ["warn", "Warning"],
    ["unavailable", "Not verified"],
    ["checking", "Checking"],
  ]) {
    const row = ReadinessItem({ label: "Camera", status, theme: "light", onResolve() {} });
    assert.match(row.props.description.props.children, new RegExp(label));
    assert.doesNotMatch(row.props.description.props.children, /you can still enter/);
  }
});
test("pending approval has help and neutral status; unavailable cannot look approved", () => {
  const { SessionActionsPanel } = component("./SessionActionsPanel.tsx");
  for (const unavailable of [false, true]) {
    const result = nodes(
      SessionActionsPanel({
        activeSession: {
          id: "s",
          contest_id: "contest",
          resume_request_status: "PENDING",
          resume_request_id: "r",
          resume_request_requested_at: "2026-10-24T10:00:00Z",
        },
        onResume() {},
        resumeBusy: false,
        resumeStatus: approvalMessage("PENDING"),
        resumeVerification: "verified",
        approvalUnavailable: unavailable,
        sessionsError: null,
        theme: "light",
      })
    );
    assert.ok(
      result.some((node) => node.type === "Button" && node.props.label === "Get help rejoining")
    );
    assert.equal(
      result.find((node) => node.type === "Token").props.label,
      unavailable ? "Status unavailable" : "Approval pending"
    );
    assert.equal(
      result.some((node) => node.type === "InlineAlert"),
      unavailable
    );
  }
});

test("declined and expired decisions retain help independently of message wording", () => {
  const { SessionActionsPanel } = component("./SessionActionsPanel.tsx");
  for (const status of ["REJECTED", "rejected", "EXPIRED"]) {
    for (const message of [approvalMessage(status), "Please contact the organizer.", null]) {
      const result = nodes(
        SessionActionsPanel({
          activeSession: { id: "s", contest_id: "contest", resume_request_status: status },
          onResume() {},
          resumeBusy: false,
          resumeStatus: message,
          resumeVerification: "verified",
          sessionsError: null,
          theme: "light",
        })
      );
      assert.ok(
        result.some((node) => node.type === "Button" && node.props.label === "Get help rejoining")
      );
      assert.equal(
        result.some((node) => node.type === "InlineAlert"),
        Boolean(message)
      );
    }
  }
});
