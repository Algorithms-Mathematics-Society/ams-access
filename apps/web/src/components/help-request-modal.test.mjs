import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  mergeSupportMessages,
  matchesSupportOperation,
  parseSupportReceipt,
  SUPPORT_STORAGE_KEY,
} from "../lib/support-chat.ts";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./HelpRequestModal.tsx", import.meta.url), "utf8"),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
);
const ACCESS = { uid: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64) };
const MESSAGE_UID = "22222222-2222-4222-8222-222222222222";
const message = (uid = MESSAGE_UID, body = "I can help") => ({
  uid,
  sender: "staff",
  body,
  created_at: "2026-10-24T12:00:00Z",
});
const history = (messages = [], extra = {}) => ({
  ...ACCESS,
  name: "Candidate",
  email: "candidate@example.test",
  phone: "+91 9999999999",
  status: "open",
  messages,
  has_more: false,
  ...extra,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness({ stored, storageFails = false, sharedStorage, newAccess = ACCESS } = {}) {
  const states = [],
    refs = [],
    effects = [],
    requests = [],
    timers = new Map(),
    listeners = new Map();
  const storage =
    sharedStorage ?? new Map(stored ? [[SUPPORT_STORAGE_KEY, JSON.stringify(stored)]] : []);
  let stateIndex = 0,
    refIndex = 0,
    effectIndex = 0,
    timerId = 0,
    dirty = false;
  let props = { open: true, onClose() {}, kind: "LOGIN", summary: "I cannot sign in." };
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    Error,
    Date,
    crypto: { randomUUID: () => MESSAGE_UID },
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) {
        if (storageFails) throw new Error("storage blocked");
        storage.set(key, value);
      },
      removeItem: (key) => storage.delete(key),
    },
    document: {
      hidden: false,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => {
        if (listeners.get(name) === fn) listeners.delete(name);
      },
    },
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    require(name) {
      if (name === "react")
        return {
          useState(initial) {
            const i = stateIndex++;
            if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
            return [
              states[i],
              (value) => {
                const next = typeof value === "function" ? value(states[i]) : value;
                dirty ||= states[i] !== next;
                states[i] = next;
              },
            ];
          },
          useRef(initial) {
            return (refs[refIndex++] ??= { current: initial });
          },
          useEffect(fn, deps) {
            const i = effectIndex++;
            const old = effects[i];
            if (!old || deps.some((d, n) => d !== old.deps[n]))
              effects[i] = { deps, fn, cleanup: old?.cleanup, pending: true };
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name.endsWith("api-base")) return { resolveApiBase: () => "https://example.test" };
      if (name.endsWith("support-chat"))
        return {
          SUPPORT_STORAGE_KEY,
          mergeSupportMessages,
          matchesSupportOperation,
          parseSupportReceipt,
          newSupportAccess: () => ({ ...newAccess }),
          supportRequest: (base, path, access, body) =>
            new Promise((resolve, reject) =>
              requests.push({ base, path, access, body, resolve, reject })
            ),
        };
      if (name.endsWith("candidate-auth"))
        throw new Error("Support must not import account credentials");
      const component = name.split("/").at(-1);
      return { [component]: component, VStack: "VStack", HStack: "HStack" };
    },
  };
  vm.runInNewContext(outputText, context);
  const h = {
    requests,
    storage,
    timers,
    context,
    render(next = {}) {
      props = { ...props, ...next };
      let passes = 0;
      do {
        if (++passes > 20) throw new Error("Render did not settle");
        dirty = false;
        stateIndex = refIndex = effectIndex = 0;
        h.tree = context.exports.HelpRequestModal(props);
        for (const effect of effects)
          if (effect.pending) {
            effect.pending = false;
            effect.cleanup?.();
            effect.cleanup = effect.fn();
          }
      } while (dirty);
      return h.tree;
    },
    all(type) {
      const found = [];
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        if (node.type === type) found.push(node);
        visit(node.props?.children);
      };
      visit(h.tree);
      return found;
    },
    field(label, value) {
      const field = [...h.all("TextInput"), ...h.all("TextArea")].find(
        (n) => n.props.label === label
      );
      assert.ok(field, `Missing ${label}`);
      field.props.onChange(value);
      h.render();
    },
    click(label) {
      const button = h.all("Button").find((n) => n.props.label === label);
      assert.ok(button, `Missing ${label}`);
      button.props.onClick();
      h.render();
    },
    send(valid = true) {
      assert.ok(h.all("form")[0]);
      h.all("form")[0].props.onSubmit({
        preventDefault() {},
        currentTarget: { reportValidity: () => valid },
      });
      h.render();
    },
    text() {
      return JSON.stringify(h.tree);
    },
    receipt() {
      return JSON.parse(storage.get(SUPPORT_STORAGE_KEY));
    },
    timer() {
      const entry = [...timers.entries()].find(([, t]) => t.ms === 4000);
      assert.ok(entry, "Expected poll timer");
      timers.delete(entry[0]);
      entry[1].fn();
    },
    unmount() {
      for (const effect of effects) effect.cleanup?.();
    },
  };
  h.render();
  return h;
}
function contact(h) {
  h.field("Email", " candidate@example.test ");
  h.field("Phone number", " +91 9999999999 ");
  h.field("Name", " Candidate ");
  h.field("Your issue", " The password is rejected. ");
}
async function active(h, messages = []) {
  h.requests.at(-1).resolve(history(messages));
  await flush();
  h.render();
}

test("signed-out form has required contact fields in requested order and native email validation", () => {
  const h = harness();
  assert.deepEqual(
    h
      .all("TextInput")
      .map((n) => n.props.label)
      .slice(0, 3),
    ["Email", "Phone number", "Name"]
  );
  for (const field of [...h.all("TextInput").slice(0, 3), h.all("TextArea")[0]]) {
    const input = {};
    field.props.ref(input);
    assert.equal(input.required, true);
  }
  assert.equal(h.all("TextInput")[0].props.type, "email");
  assert.match(h.text(), /even if you cannot sign in/);
  h.send(false);
  assert.equal(h.requests.length, 0);
  h.unmount();
});

test("first query and trimmed contacts create a private conversation without account auth", async () => {
  const h = harness();
  contact(h);
  h.send();
  h.send();
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.path, "/support/conversations");
  assert.equal(request.access, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)), {
    ...ACCESS,
    email: "candidate@example.test",
    phone: "+91 9999999999",
    name: "Candidate",
    organization: "",
    category: "LOGIN",
    body: "I cannot sign in.\n\nThe password is rejected.",
  });
  assert.equal(h.receipt().pendingStart.uid, ACCESS.uid);
  request.resolve({ uid: ACCESS.uid });
  await flush();
  h.render();
  assert.equal(h.receipt().pendingStart, undefined);
  assert.equal(h.requests[1].access.token, ACCESS.token);
  await active(h, [message()]);
  assert.match(h.text(), /I can help/);
  h.unmount();
});

test("closing during creation preserves acknowledgement and guards duplicate clicks", async () => {
  const h = harness();
  contact(h);
  h.send();
  assert.equal(h.render({ open: false }), null);
  h.requests[0].resolve({ uid: ACCESS.uid });
  await flush();
  h.render({ open: true, summary: "A different problem" });
  assert.equal(h.requests.filter((r) => r.path === "/support/conversations").length, 1);
  assert.equal(h.receipt().access.uid, ACCESS.uid);
  await active(h);
  h.unmount();
});

test("failed create retries the exact saved request after close, context changes and reload", async () => {
  const h = harness();
  contact(h);
  h.send();
  const original = JSON.parse(JSON.stringify(h.requests[0].body));
  h.requests[0].reject(new Error("Delivery unconfirmed"));
  await flush();
  h.render();
  assert.match(h.text(), /Request not confirmed/);
  assert.equal(h.requests.length, 1);
  h.render({ open: false });
  h.render({ open: true, summary: "Changed caller" });
  h.send();
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].body)), original);
  h.requests[1].reject(new Error("Still offline"));
  await flush();
  h.unmount();
  const resumed = harness({ stored: h.receipt() });
  assert.equal(resumed.requests.length, 0);
  resumed.send();
  assert.deepEqual(JSON.parse(JSON.stringify(resumed.requests[0].body)), original);
  resumed.requests[0].resolve({ uid: ACCESS.uid });
  await flush();
  resumed.render();
  await active(resumed);
  resumed.unmount();
});

test("missing create acknowledgement retains capability and retry payload", async () => {
  const h = harness();
  contact(h);
  h.send();
  h.requests[0].resolve({ uid: "wrong" });
  await flush();
  h.render();
  assert.match(h.text(), /did not confirm/);
  assert.ok(h.receipt().pendingStart);
  h.unmount();
});

test("message retry retains UUID and body until acknowledged, including after reload", async () => {
  const h = harness({ stored: { access: ACCESS } });
  await active(h, [message()]);
  h.field("Message", " Can you check my login? ");
  h.send();
  const sent = h.requests.at(-1);
  assert.equal(sent.path, `/support/conversations/${ACCESS.uid}/messages`);
  assert.equal(sent.body.uid, MESSAGE_UID);
  assert.equal(sent.body.body, "Can you check my login?");
  sent.reject(new Error("Connection interrupted"));
  await flush();
  h.render();
  assert.match(h.text(), /Message not confirmed/);
  assert.equal(h.receipt().pendingMessage.uid, MESSAGE_UID);
  h.unmount();
  const resumed = harness({ stored: h.receipt() });
  await active(resumed);
  assert.equal(resumed.all("TextArea")[0].props.value, "Can you check my login?");
  resumed.send();
  const retry = resumed.requests.at(-1);
  assert.equal(retry.body.uid, MESSAGE_UID);
  assert.equal(retry.body.body, sent.body.body);
  retry.resolve({ uid: MESSAGE_UID });
  await flush();
  resumed.render();
  assert.equal(resumed.receipt().pendingMessage, undefined);
  assert.equal(resumed.all("TextArea")[0].props.value, "");
  resumed.unmount();
});

test("polling preserves loaded messages on failure, reports the error and resumes from last UUID", async () => {
  const h = harness({ stored: { access: ACCESS } });
  await active(h, [message()]);
  h.timer();
  assert.match(h.requests.at(-1).path, new RegExp(`after=${MESSAGE_UID}$`));
  h.requests.at(-1).reject(new Error("Refresh unavailable"));
  await flush();
  h.render();
  assert.match(h.text(), /I can help/);
  assert.match(h.text(), /Chat refresh interrupted/);
  h.timer();
  h.requests
    .at(-1)
    .resolve(history([message(), message("33333333-3333-4333-8333-333333333333", "Try now")]));
  await flush();
  h.render();
  assert.doesNotMatch(h.text(), /Chat refresh interrupted/);
  assert.equal(h.all("Text").filter((n) => n.props.children === "I can help").length, 1);
  assert.match(h.text(), /Try now/);
  h.unmount();
});

test("pagination drains immediately and closing stops polls and late updates", async () => {
  const h = harness({ stored: { access: ACCESS } });
  h.requests[0].resolve(history([message()], { has_more: true }));
  await flush();
  h.render();
  assert.equal(h.requests.length, 2);
  h.render({ open: false });
  h.requests[1].resolve(history([message("33333333-3333-4333-8333-333333333333", "Late reply")]));
  await flush();
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test("resolved conversations remain readable and have no message composer", async () => {
  const h = harness({ stored: { access: ACCESS } });
  h.requests[0].resolve(history([message()], { status: "resolved" }));
  await flush();
  h.render();
  assert.match(h.text(), /Issue resolved/);
  assert.match(h.text(), /I can help/);
  assert.equal(h.all("form").length, 0);
  h.click("Forget chat / new request");
  assert.equal(h.storage.has(SUPPORT_STORAGE_KEY), false);
  assert.equal(h.all("TextInput")[0].props.label, "Email");
  h.unmount();
});

test("blocked storage warns without losing in-memory access or duplicating creation", async () => {
  const h = harness({ storageFails: true });
  contact(h);
  h.send();
  h.requests[0].resolve({ uid: ACCESS.uid });
  await flush();
  h.render();
  assert.match(h.text(), /Conversation recovery is unavailable/);
  assert.equal(h.requests.at(-1).access.token, ACCESS.token);
  await active(h);
  h.unmount();
});

test("reopening adopts another help surface's saved chat without mixing histories or drafts", async () => {
  const h = harness({ stored: { access: ACCESS } });
  await active(h, [message()]);
  h.field("Message", "Draft for the first issue");
  h.render({ open: false });
  const other = { uid: "44444444-4444-4444-8444-444444444444", token: "b".repeat(64) };
  h.storage.set(SUPPORT_STORAGE_KEY, JSON.stringify({ access: other }));
  h.render({ open: true });
  assert.equal(h.requests.at(-1).access.token, other.token);
  assert.doesNotMatch(h.text(), /I can help/);
  assert.equal(h.all("TextArea")[0].props.value, "");
  h.requests.at(-1).resolve(history([], { uid: other.uid }));
  await flush();
  h.render();
  h.unmount();
});

test("a storage write failure preserves in-memory conversation across close and reopen", async () => {
  const h = harness({ storageFails: true });
  contact(h);
  h.send();
  h.requests[0].resolve({ uid: ACCESS.uid });
  await flush();
  h.render();
  await active(h, [message()]);
  h.render({ open: false });
  h.render({ open: true });
  assert.equal(h.requests.at(-1).access?.uid, ACCESS.uid);
  assert.equal(h.all("TextInput").length, 0);
  assert.match(h.text(), /I can help/);
  h.unmount();
});

test("contest host can render the form without mounting a native dialog above security overlays", () => {
  const h = harness();
  h.render({ renderDialog: (children) => ({ type: "ContestOverlay", props: { children } }) });
  assert.equal(h.all("AccessDialog").length, 0);
  assert.equal(h.all("ContestOverlay").length, 1);
  assert.equal(h.all("form").length, 1);
  h.unmount();
});

test("malformed or nonadvancing history stops pagination and preserves visible messages", async () => {
  const h = harness({ stored: { access: ACCESS } });
  h.requests[0].resolve(history([message()], { has_more: true }));
  await flush();
  h.render();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(history([message()], { has_more: true }));
  await flush();
  h.render();
  assert.equal(h.requests.length, 2, "a repeated page must wait for the polling delay");
  assert.match(h.text(), /history did not advance/);
  assert.match(h.text(), /I can help/);
  h.timer();
  h.requests.at(-1).resolve(history([], { uid: "another-thread" }));
  await flush();
  h.render();
  assert.match(h.text(), /response was incomplete/);
  assert.match(h.text(), /I can help/);
  h.unmount();
});

const NEW_ACCESS = { uid: "44444444-4444-4444-8444-444444444444", token: "b".repeat(64) };
const NEXT_MESSAGE_UID = "55555555-5555-4555-8555-555555555555";

test("late creation acknowledgement cannot replace a newer help surface's conversation", async () => {
  const sharedStorage = new Map();
  const a = harness({ sharedStorage });
  contact(a);
  a.send();
  const late = a.requests[0];
  a.render({ open: false });
  const b = harness({ sharedStorage, newAccess: NEW_ACCESS });
  b.click("Start a new request");
  contact(b);
  b.send();
  assert.equal(b.receipt().access.uid, NEW_ACCESS.uid);
  late.resolve({ uid: ACCESS.uid });
  await flush();
  a.render();
  assert.equal(b.receipt().access.uid, NEW_ACCESS.uid);
  assert.ok(b.receipt().pendingStart);
  a.unmount();
  b.unmount();
});

test("late message acknowledgement cannot replace an adopted conversation or its pending creation", async () => {
  const sharedStorage = new Map([[SUPPORT_STORAGE_KEY, JSON.stringify({ access: ACCESS })]]);
  const a = harness({ sharedStorage });
  await active(a);
  a.field("Message", "Old message");
  a.send();
  const late = a.requests.at(-1);
  a.render({ open: false });
  const b = harness({ sharedStorage, newAccess: NEW_ACCESS });
  await active(b);
  b.click("Forget chat / new request");
  contact(b);
  b.send();
  a.render({ open: true });
  late.resolve({ uid: MESSAGE_UID });
  await flush();
  a.render();
  assert.equal(a.receipt().access.uid, NEW_ACCESS.uid);
  assert.equal(a.all("TextInput").length, 4, "the adopted pending creation stays displayed");
  assert.ok(a.receipt().pendingStart);
  a.unmount();
  b.unmount();
});

test("late duplicate acknowledgement preserves a newer pending message on the same conversation", async () => {
  const sharedStorage = new Map([[SUPPORT_STORAGE_KEY, JSON.stringify({ access: ACCESS })]]);
  const a = harness({ sharedStorage });
  await active(a);
  a.field("Message", "First message");
  a.send();
  const late = a.requests.at(-1);
  a.render({ open: false });
  const b = harness({ sharedStorage });
  await active(b);
  b.send();
  b.requests.at(-1).resolve({ uid: MESSAGE_UID });
  await flush();
  b.render();
  await active(b);
  b.context.crypto.randomUUID = () => NEXT_MESSAGE_UID;
  b.field("Message", "Second message");
  b.send();
  late.resolve({ uid: MESSAGE_UID });
  await flush();
  a.render();
  assert.equal(b.receipt().pendingMessage.uid, NEXT_MESSAGE_UID);
  assert.equal(b.receipt().pendingMessage.body, "Second message");
  a.unmount();
  b.unmount();
});

test("a late failure does not attach the old request's error to an adopted conversation", async () => {
  const h = harness({ stored: { access: ACCESS } });
  await active(h);
  h.field("Message", "Old message");
  h.send();
  const late = h.requests.at(-1);
  h.render({ open: false });
  h.storage.set(SUPPORT_STORAGE_KEY, JSON.stringify({ access: NEW_ACCESS }));
  h.render({ open: true });
  h.requests.at(-1).resolve(history([], { uid: NEW_ACCESS.uid }));
  await flush();
  h.render();
  late.reject(new Error("Old conversation failed"));
  await flush();
  h.render();
  assert.doesNotMatch(h.text(), /Old conversation failed/);
  assert.equal(h.receipt().access.uid, NEW_ACCESS.uid);
  h.unmount();
});

test("resolved conversation retains an unconfirmed message and can acknowledge a committed retry", async () => {
  const pendingMessage = { uid: MESSAGE_UID, body: "My login is still broken" };
  const h = harness({ stored: { access: ACCESS, pendingMessage } });
  h.requests[0].resolve(history([], { status: "resolved" }));
  await flush();
  h.render();
  assert.match(h.text(), /Issue resolved/);
  assert.equal(h.all("TextArea")[0].props.value, pendingMessage.body);
  assert.match(h.text(), /Awaiting confirmation/);
  h.send();
  assert.equal(h.requests.at(-1).body.uid, MESSAGE_UID);
  h.requests.at(-1).resolve({ uid: MESSAGE_UID });
  await flush();
  h.render();
  assert.equal(h.receipt().pendingMessage, undefined);
  assert.equal(h.all("form").length, 0);
  h.unmount();
});

test("resolved conversation keeps an uncommitted retry and its rejection visible", async () => {
  const pendingMessage = { uid: MESSAGE_UID, body: "My latest issue" };
  const h = harness({ stored: { access: ACCESS, pendingMessage } });
  h.requests[0].resolve(history([], { status: "resolved" }));
  await flush();
  h.render();
  h.send();
  h.requests.at(-1).reject(new Error("Issue resolved. Ask staff to reopen it."));
  await flush();
  h.render();
  assert.equal(h.receipt().pendingMessage.body, pendingMessage.body);
  assert.match(h.text(), /Ask staff to reopen/);
  assert.equal(h.all("TextArea")[0].props.value, pendingMessage.body);
  h.unmount();
});
