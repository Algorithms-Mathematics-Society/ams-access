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
  constructor(message, status, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
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
    ProctorApiError,
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
    studentLogin: async (...args) => {
      calls.push(args);
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
test("loading prevents duplicate sign-in and network error is not field invalidity", async () => {
  const busy = harness({ loading: true });
  await busy.submit();
  assert.equal(busy.calls.length, 0);
  const h = harness({ failure: new ProctorApiError("Network", 0) });
  await h.submit();
  assert.equal(h.state.invalidField, null);
  assert.equal(h.state.error, "Connection failed");
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
    assert.equal(input.props["aria-describedby"], error ? "login-error" : undefined);
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
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "password");
  nodes.find((n) => n.props?.label === "Show").props.onClick();
  nodes = all(render());
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "text");
  nodes.find((n) => n.props?.label === "Hide").props.onClick();
  nodes = all(render());
  assert.equal(nodes.find((n) => n.props?.id === "login-password").props.type, "password");
});
