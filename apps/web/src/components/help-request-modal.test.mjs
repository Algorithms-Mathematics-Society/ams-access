import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

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
function harness() {
  const states = [],
    refs = [],
    requests = [],
    timeouts = [];
  let stateIndex = 0,
    refIndex = 0,
    authenticated = true;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    fetch: (url, init) =>
      new Promise((resolve, reject) => requests.push({ url, init, resolve, reject })),
    require(name) {
      if (name === "react")
        return {
          useState(initial) {
            const i = stateIndex++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (value) => {
                states[i] = typeof value === "function" ? value(states[i]) : value;
              },
            ];
          },
          useRef(initial) {
            return (refs[refIndex++] ??= { current: initial });
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name.endsWith("api-base")) return { resolveApiBase: () => "https://example.test" };
      if (name.endsWith("candidate-auth"))
        return {
          participantToken: () => (authenticated ? "token" : null),
          authHeaders: () => ({ Authorization: "Bearer token" }),
        };
      if (name.endsWith("abort-timeout"))
        return {
          createAbortTimeout: () => {
            const controller = new AbortController();
            const timeout = {
              signal: controller.signal,
              abort: () => controller.abort(),
              cleared: false,
              clear() {
                timeout.cleared = true;
              },
            };
            timeouts.push(timeout);
            return timeout;
          },
        };
      const component = name.split("/").at(-1);
      return {
        [component]: component,
        VStack: "VStack",
        HStack: "HStack",
        MetadataListItem: "MetadataListItem",
      };
    },
  };
  vm.runInNewContext(outputText, context);
  let props = {
    open: true,
    onClose() {},
    kind: "READINESS",
    summary: "Camera unavailable",
    details: { code: "CAMERA" },
    contestId: "contest-A",
  };
  const h = {
    requests,
    timeouts,
    render(next = {}) {
      props = { ...props, ...next };
      stateIndex = refIndex = 0;
      h.tree = context.exports.HelpRequestModal(props);
      return h.tree;
    },
    all(type) {
      const found = [];
      function visit(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (node.type === type) found.push(node);
        visit(node.props?.children);
      }
      visit(h.tree);
      return found;
    },
    field(type, value) {
      h.all(type)[0].props.onChange(value);
      h.render();
    },
    text() {
      return JSON.stringify(h.tree);
    },
    send(valid = true) {
      return h
        .all("form")[0]
        .props.onSubmit({ preventDefault() {}, currentTarget: { reportValidity: () => valid } });
    },
    auth(value) {
      authenticated = value;
      h.render();
    },
  };
  h.render();
  return h;
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const receipt = (id) => ({ ok: true, json: async () => ({ id }) });
function draft(h) {
  h.field("TextInput", "candidate@example.test");
  h.field("TextArea", "Preview is blank");
}

test("native required/email validation blocks dispatch and shows specific field errors", () => {
  const h = harness();
  const field = h.all("TextInput")[0];
  const input = {};
  field.props.ref(input);
  assert.equal(input.required, true);
  assert.equal(field.props.type, "email");
  for (const missing of [true, false]) {
    h.all("form")[0].props.onInvalidCapture({ target: { validity: { valueMissing: missing } } });
    h.send(false);
    h.render();
    assert.match(
      h.all("TextInput")[0].props.status.message,
      missing ? /Enter an email/ : /valid email/
    );
    assert.equal(h.requests.length, 0);
  }
  h.field("TextInput", "candidate@example.test");
  assert.equal(h.all("TextInput")[0].props.status, undefined);
});

test("pending close/reopen preserves request ownership and duplicate-click guard", async () => {
  const h = harness();
  draft(h);
  h.send();
  h.send();
  assert.equal(h.requests.length, 1);
  const payload = JSON.parse(h.requests[0].init.body);
  assert.equal(payload.message, "Camera unavailable\n\nPreview is blank");
  assert.equal(payload.contact, "candidate@example.test");
  assert.equal(h.requests[0].init.headers.Authorization, "Bearer token");
  assert.equal(h.render({ open: false }), null);
  h.render({ open: true, summary: "Microphone unavailable" });
  assert.match(h.text(), /Camera unavailable/);
  assert.doesNotMatch(h.text(), /Microphone unavailable/);
  assert.equal(h.all("TextInput")[0].props.isDisabled, true);
  h.requests[0].resolve(receipt("REF-A"));
  await flush();
  h.render();
  assert.match(h.text(), /REF-A/);
  assert.match(h.text(), /Camera unavailable/);
  assert.doesNotMatch(h.text(), /Microphone unavailable/);
  assert.equal(h.timeouts[0].cleared, true);
});

test("receipt survives closed completion and explicit new composition uses current context", async () => {
  const h = harness();
  draft(h);
  h.send();
  h.render({ open: false });
  h.requests[0].resolve(receipt("REF-A"));
  await flush();
  h.render({ open: true, summary: "New problem", sessionId: "session B" });
  assert.match(h.text(), /REF-A/);
  h.all("Button")
    .find((node) => node.props.label === "Send another request")
    .props.onClick();
  h.render();
  assert.doesNotMatch(h.text(), /REF-A/);
  assert.match(h.text(), /New problem/);
  assert.equal(h.all("TextInput")[0].props.value, "candidate@example.test");
  assert.equal(h.all("TextArea")[0].props.value, "");
  h.send();
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[1].url, /sessions\/session%20B\/incidents$/);
  assert.equal(JSON.parse(h.requests[1].init.body).message, "New problem");
  h.requests[1].resolve(receipt("REF-B"));
  await flush();
});

for (const failure of ["rejected", "timeout", "server", "missing-reference"]) {
  test(`${failure} retains draft, identifies last attempt and never resends automatically`, async () => {
    const h = harness();
    draft(h);
    h.send();
    if (failure === "rejected") h.requests[0].resolve({ ok: false, status: 403 });
    else if (failure === "server") h.requests[0].resolve({ ok: false, status: 500 });
    else if (failure === "timeout") {
      h.timeouts[0].abort();
      h.requests[0].reject(new Error("abort"));
    } else h.requests[0].resolve(receipt(null));
    await flush();
    h.render({ summary: "Changed context" });
    assert.equal(
      h.all("Banner")[0].props.title,
      failure === "rejected" ? "Request rejected" : "Delivery not confirmed"
    );
    assert.match(h.text(), /Last attempt/);
    assert.match(h.text(), /Camera unavailable/);
    assert.equal(h.all("TextArea")[0].props.value, "Preview is blank");
    h.render({ open: false });
    h.render({ open: true });
    assert.equal(h.requests.length, 1);
    h.field("TextInput", "updated@example.test");
    h.send();
    assert.equal(h.requests.length, 2);
    assert.equal(JSON.parse(h.requests[1].init.body).contact, "updated@example.test");
    h.requests[1].resolve(receipt("REF-RETRY"));
    await flush();
    h.render();
    assert.match(h.text(), /REF-RETRY/);
  });
}

test("a valid receipt is retained even if the timeout signal fired before body completion", async () => {
  const h = harness();
  draft(h);
  h.send();
  h.timeouts[0].abort();
  h.requests[0].resolve(receipt("CONFIRMED"));
  await flush();
  h.render();
  assert.match(h.text(), /CONFIRMED/);
});

test("unauthenticated help preserves direct-organizer guidance and cannot send", () => {
  const h = harness();
  h.auth(false);
  assert.equal(h.all("form").length, 0);
  assert.match(h.text(), /Sign in to send/);
  assert.equal(h.requests.length, 0);
});
