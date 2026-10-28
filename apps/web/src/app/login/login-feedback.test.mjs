import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { formatHandle, formatPassword, HANDLE_SUFFIX } from "./components/slip-format.ts";
const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = page.indexOf("  async function handleSubmit(");
const end = page.indexOf("\n  // Frame budget", start);
assert.ok(start >= 0 && end > start);
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const handlerCode = compile(page.slice(start, end));
class ProctorApiError extends Error {
  // A number is the 503's retry wait; an object is the structured detail (426).
  constructor(message, status, extra = null) {
    super(message);
    this.status = status;
    this.detail = typeof extra === "number" ? null : extra;
    this.retryAfterSeconds = typeof extra === "number" ? extra : 0;
  }
  get needsUpgrade() {
    return this.status === 426;
  }
}
function harness({
  loginId = "candidate",
  password = "ABCD-EFGH-IJKL",
  failKey,
  failure,
  loading = false,
  contest = { uid: "contest", title: "Contest" },
  request,
} = {}) {
  const state = {},
    calls = [],
    routes = [],
    focused = [],
    writes = [];
  const context = {
    loginId,
    password,
    loading,
    loginInFlightRef: { current: false },
    performance: { now: () => 0 },
    cooldownUntil: { current: 0 },
    ProctorApiError,
    setServiceFailure: (value) => {
      state.serviceFailure = value;
    },
    setError: (value) => {
      state.error = value;
    },
    setDiagnostic: (value) => {
      state.diagnostic = value;
    },
    setInvalidField: (value) => {
      state.invalidField = value;
    },
    setLoading: (value) => {
      state.loading = value;
    },
    setUpgrade: (value) => {
      state.upgrade = value;
    },
    DEFAULT_DOWNLOAD_URL: "https://default.test",
    setCooldownSeconds: (value) => {
      state.cooldownSeconds = value;
    },
    studentLogin: async (...args) => {
      calls.push(args);
      if (request) return request(...args);
      if (failure) throw failure;
      return { user: { display_name: "Candidate" }, contest };
    },
    STORAGE_KEYS: {
      DISPLAY_NAME: "display",
      ACTIVE_CONTEST: "contest",
      ACTIVE_CONTEST_TITLE: "title",
    },
    localStorage: {
      setItem: (key, value) => {
        writes.push([key, value]);
        if (key === failKey || failKey === "all") throw new Error("storage blocked");
      },
      removeItem: (key) => writes.push([key, null]),
    },
    router: { push: (path) => routes.push(path) },
    describeUnreachable: () => ({ message: "Connection failed", diagnostic: "fixture" }),
    invoke: async () => {},
  };
  vm.runInNewContext(handlerCode, context);
  return {
    state,
    calls,
    routes,
    writes,
    focused,
    submit: () =>
      context.handleSubmit({
        preventDefault() {},
        currentTarget: { elements: { namedItem: (name) => ({ focus: () => focused.push(name) }) } },
      }),
  };
}
for (const [loginId, password, field] of [
  ["", "", "handle"],
  ["", "ABCD", "handle"],
  ["candidate", "", "password"],
  ["  ", "ABCD", "handle"],
]) {
  test(`missing credentials focus ${field} without authentication (${JSON.stringify([loginId, password])})`, async () => {
    const h = harness({ loginId, password });
    await h.submit();
    assert.equal(h.calls.length, 0);
    assert.equal(h.state.invalidField, field);
    assert.deepEqual(h.focused, [field === "handle" ? "login-id" : "login-password"]);
    assert.equal(
      h.state.error,
      field === "handle" ? "Enter the login ID from your slip." : "Enter your password."
    );
    assert.equal(h.state.loading, undefined);
  });
}
for (const failKey of ["display", "contest", "title", "all"]) {
  test(`metadata failure ${failKey} does not misreport authentication`, async () => {
    const h = harness({ failKey });
    await h.submit();
    assert.deepEqual(h.routes, ["/home"]);
    assert.equal(h.state.error, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.writes.length, 3);
  });
}
test("nonempty password is passed unchanged and server rejection remains authoritative", async () => {
  const h = harness({
    password: " unchanged ",
    failure: new ProctorApiError("Incorrect credentials", 401),
  });
  await h.submit();
  assert.equal(h.calls[0][1], " unchanged ");
  assert.equal(h.state.error, "Incorrect credentials");
  assert.equal(h.state.invalidField, null);
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.routes, []);
});
test("a sign-in with no contest clears the previous contest labels", async () => {
  const h = harness({ contest: null });
  await h.submit();
  assert.deepEqual(h.routes, ["/home"]);
  assert.deepEqual(
    h.writes.map((write) => [...write]),
    [
      ["display", "Candidate"],
      ["contest", null],
      ["title", null],
    ]
  );
});
test("a 426 opens the update dialog with the server's download link", async () => {
  const h = harness({
    failure: new ProctorApiError("Too old", 426, {
      min_version: "4.2.0",
      download_url: "https://server.test/download",
    }),
  });
  await h.submit();
  assert.deepEqual(
    { ...h.state.upgrade },
    { version: "4.2.0", url: "https://server.test/download" }
  );
  assert.deepEqual(h.routes, []);
  const bare = harness({ failure: new ProctorApiError("Too old", 426) });
  await bare.submit();
  assert.deepEqual({ ...bare.state.upgrade }, { version: "", url: "https://default.test" });
});
test("a rapid keyboard/click burst sends only one pending sign-in request", async () => {
  let reject;
  const h = harness({
    request: () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  });
  const pending = h.submit();
  const burst = Array.from({ length: 1000 }, () => h.submit());
  assert.equal(h.calls.length, 1);
  reject(new ProctorApiError("Busy", 503));
  await pending;
  await Promise.all(burst);
  const retry = h.submit();
  assert.equal(h.calls.length, 2, "a settled failure permits an explicit retry");
  reject(new ProctorApiError("Busy", 503));
  await retry;
});

test("successful sign-in stays owned until navigation even without a React rerender", async () => {
  const h = harness();
  await h.submit();
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.routes, ["/home"]);
});
test("loading prevents duplicate sign-in and network error is not field invalidity", async () => {
  const busy = harness({ loading: true });
  await busy.submit();
  assert.equal(busy.calls.length, 0);
  const h = harness({ failure: new ProctorApiError("Network", 0) });
  await h.submit();
  assert.equal(h.state.invalidField, null);
  assert.equal(h.state.error, "Connection failed");
});

test("server wait disables repeated login submissions even before rerender", async () => {
  const h = harness({ failure: new ProctorApiError("The exam server is busy.", 503, 5) });
  await h.submit();
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.cooldownSeconds, 5);
  assert.equal(h.state.error, "The exam server is busy.");
});

const formCode = compile(
  readFileSync(new URL("./components/SlipForm.tsx", import.meta.url), "utf8")
);
function formHarness() {
  let visible;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react")
        return {
          useState: (initial) => [
            (visible ??= initial),
            (fn) => {
              visible = fn(visible);
            },
          ],
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "./slip-format") return { formatHandle, formatPassword, HANDLE_SUFFIX };
      if (name.endsWith(".css")) return { default: {} };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(formCode, context);
  return (props) =>
    context.exports.SlipForm({
      loginId: "",
      password: "",
      loading: false,
      error: null,
      setLoginId() {},
      setPassword() {},
      onSubmit() {},
      ...props,
    });
}
function all(node) {
  return !node || typeof node !== "object"
    ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(all)];
}
test("password format and errors are described; only missing field is invalid", () => {
  const render = formHarness();
  for (const error of [null, "Connection failed"]) {
    const nodes = all(render({ error })),
      input = nodes.find((n) => n.props?.id === "login-id"),
      field = nodes.find((n) => n.props?.inputID === "login-id");
    assert.equal(field.props.label, "Login ID");
    assert.equal(
      input.props["aria-describedby"],
      error ? "login-id-suffix login-error" : "login-id-suffix"
    );
    assert.equal(field.props.description, undefined);
    const suffix = nodes.find((n) => n.props?.id === "login-id-suffix");
    assert.equal(suffix.props.children, "@access");
    const passwordInput = nodes.find((n) => n.props?.id === "login-password");
    const passwordField = nodes.find((n) => n.props?.inputID === "login-password");
    assert.equal(passwordField.props.descriptionID, "login-password-help");
    assert.equal(
      passwordInput.props["aria-describedby"],
      error ? "login-password-help login-error" : "login-password-help"
    );
    assert.equal(input.props["aria-invalid"], undefined);
  }
  const nodes = all(render({ invalidField: "password", error: "Enter your password." }));
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props["aria-invalid"], true);
  assert.equal(nodes.find((n) => n.props?.id === "login-id").props["aria-invalid"], undefined);
});
test("full-handle paste and password reveal behavior stay intact", () => {
  const render = formHarness();
  let handle;
  let nodes = all(
    render({
      setLoginId: (value) => {
        handle = value;
      },
    })
  );
  nodes
    .find((n) => n.props?.id === "login-id")
    .props.onChange({ target: { value: "Candidate@access" } });
  assert.equal(handle, "candidate");
  const input = nodes.find((n) => n.props?.id === "login-id");
  const fullHandle = `${"a".repeat(64)}@access.amsaccess.com`;
  assert.ok(input.props.maxLength >= fullHandle.length);
  input.props.onChange({ target: { value: fullHandle } });
  assert.equal(handle, "a".repeat(64));
  input.props.onChange({ target: { value: "john doe@other.example" } });
  assert.equal(handle, "john doe@other.example");
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "password");
  nodes.find((n) => n.props?.label === "Show").props.onClick();
  nodes = all(render());
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "text");
  nodes.find((n) => n.props?.label === "Hide").props.onClick();
  nodes = all(render());
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "password");
});

test("sign-in button shows and honors the server cooldown", () => {
  const nodes = all(formHarness()({ cooldownSeconds: 5 }));
  const button = nodes.find((node) => node.props?.type === "submit");
  assert.equal(button.props.label, "Try again in 5s");
  assert.equal(button.props.isDisabled, true);
});

test("typed spaces are blocked without intercepting paste or navigation shortcuts", () => {
  const input = all(formHarness()()).find((n) => n.props?.id === "login-id");
  let prevented = 0;
  const press = (key, modifiers = {}) => input.props.onKeyDown({
    key, ...modifiers, preventDefault() { prevented++; },
  });
  press(" ");
  assert.equal(prevented, 1);
  press("v", { ctrlKey: true });
  press("v", { metaKey: true });
  press("Tab");
  press("ArrowLeft");
  press(" ", { ctrlKey: true });
  assert.equal(prevented, 1);
});
for (const status of [0, 429, 503, 401, 403]) {
  test(`HTTP ${status} keeps authoritative error without a service-status surface`, async () => {
    const h = harness({ failure: new ProctorApiError("Server response", status) });
    await h.submit();
    assert.equal(h.state.serviceFailure, undefined);
    assert.equal(
      h.state.error,
      status === 0
        ? "Connection failed"
        : status === 429
          ? "Server response Wait before trying again; repeated attempts may be limited."
          : "Server response"
    );
    assert.deepEqual(h.routes, []);
  });
}
