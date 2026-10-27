import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as help from "../lib/login-help.ts";

const source = readFileSync(new URL("./LoginHelpDialog.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function harness() {
  const states = [],
    refs = [],
    copies = [],
    opened = [],
    cleanups = [];
  let cursor = 0,
    refCursor = 0,
    metadataReads = 0,
    effectRegistered = false;
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    navigator: {
      userAgent: "Windows user-agent with private device metadata",
      clipboard: {
        writeText: (text) =>
          new Promise((resolve, reject) => copies.push({ text, resolve, reject })),
      },
    },
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react")
        return {
          useState(initial) {
            const i = cursor++;
            if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
            return [
              states[i],
              (value) => {
                states[i] = typeof value === "function" ? value(states[i]) : value;
              },
            ];
          },
          useRef(initial) {
            return (refs[refCursor++] ??= { current: initial });
          },
          useEffect(effect) {
            if (!effectRegistered) {
              effectRegistered = true;
              cleanups.push(effect());
            }
          },
        };
      if (name.endsWith("/ServiceStatus")) return { ServiceStatus: "ServiceStatus" };
      if (name.endsWith("/login-help")) return help;
      if (name.endsWith("/use-app-version"))
        return {
          useAppVersion() {
            metadataReads++;
            return { version: "4.7.0" };
          },
        };
      if (name.endsWith("/open-external")) return { openExternal: (url) => opened.push(url) };
      if (name.endsWith("/AccessDialog")) return { AccessDialog: "AccessDialog" };
      if (name.endsWith("/Button")) return { Button: "Button" };
      if (name.endsWith("/Stack")) return { VStack: "VStack", HStack: "HStack" };
      if (name.endsWith("/Text")) return { Text: "Text" };
      throw Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  const h = {
    copies,
    opened,
    states,
    render(props = {}) {
      cursor = refCursor = 0;
      const child = context.exports.LoginHelpDialog({
        open: true,
        onClose() {},
        hasError: true,
        diagnostic: "api.example · TIMEOUT",
        ...props,
      });
      h.tree = child ? child.type(child.props) : null;
      return h.tree;
    },
    nodes() {
      const nodes = [];
      function visit(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        nodes.push(node);
        visit(node.props?.children);
      }
      visit(h.tree);
      return nodes;
    },
    click(label) {
      const button = h.nodes().find((n) => n.type === "Button" && n.props.label === label);
      assert.ok(button, `Button ${label} exists`);
      return button.props.onClick();
    },
    status() {
      return h.nodes().find((n) => n.props.role === "status")?.props.children;
    },
    unmount() {
      cleanups.forEach((cleanup) => cleanup?.());
    },
    get metadataReads() {
      return metadataReads;
    },
  };
  return h;
}

test("closed help does not request optional metadata; opening needs no token or network", () => {
  const h = harness();
  assert.equal(h.render({ open: false }), null);
  assert.equal(h.metadataReads, 0);
  h.render();
  assert.equal(h.metadataReads, 1);
  assert.equal(h.copies.length, 0);
  assert.equal(h.opened.length, 0);
  assert.ok(h.nodes().some((n) => n.props.children === help.LOGIN_SUPPORT_EMAIL));
  assert.ok(h.nodes().some((n) => n.props.children === help.LOGIN_SUPPORT_URL));
});
test("browser handoff uses only the fixed public URL and does not claim delivery", () => {
  const h = harness();
  h.render();
  h.click("Contact AMS support");
  h.render();
  assert.deepEqual(h.opened, ["https://amsaccess.com/contact?source=access-login"]);
  assert.ok(!h.opened[0].includes("&"), "single query remains safe for Windows shell handoff");
  assert.match(h.status(), /Nothing has been sent/);
});
test("details must be reviewed before copying; preview equals clipboard text", async () => {
  const h = harness();
  h.render();
  assert.ok(!h.nodes().some((n) => n.props.label === "Copy details"));
  h.click("Review troubleshooting details");
  h.render();
  const preview = h
    .nodes()
    .find(
      (n) =>
        typeof n.props.children === "string" &&
        n.props.children.startsWith("AMS Access sign-in help\n")
    ).props.children;
  h.click("Copy details");
  assert.equal(h.copies[0].text, preview);
  assert.ok(!h.status().includes("copied"));
  h.copies[0].resolve();
  await new Promise(setImmediate);
  h.render();
  assert.match(h.status(), /Troubleshooting details copied. Nothing has been sent/);
});
test("clipboard failure leaves manual text; late result cannot overwrite newer action or unmount", async () => {
  const h = harness();
  h.render();
  h.click("Copy email address");
  h.copies[0].reject(Error("denied"));
  await new Promise(setImmediate);
  h.render();
  assert.match(h.status(), /copy it manually/);
  h.click("Copy support link");
  h.click("Contact AMS support");
  h.copies[1].resolve();
  await new Promise(setImmediate);
  h.render();
  assert.match(h.status(), /If the page did not open/);
  h.click("Copy email address");
  h.unmount();
  const before = [...h.states];
  h.copies[2].resolve();
  await new Promise(setImmediate);
  assert.deepEqual(h.states, before);
});
test("diagnostic summary excludes arbitrary server secrets, raw user agent and unsupported metadata", () => {
  const summary = help.buildLoginHelpSummary({
    version: "secret-token",
    userAgent: "Linux private-machine-name",
    diagnostic: "https://user:password@host/?token=secret · UNKNOWN_SECRET",
    hasError: true,
    topic: "other",
    openedAt: new Date("2026-10-25T12:00:00Z"),
    password: "password",
    loginId: "private-student",
    token: "token",
  });
  assert.match(summary, /App version: Unavailable/);
  assert.match(summary, /Platform \(browser-reported\): Linux/);
  assert.doesNotMatch(summary, /secret|password|private|UNKNOWN|https/);
  assert.ok(summary.length < 1000);
  assert.equal(
    help.loginHelpError("host · TIMEOUT", true),
    "The exam server did not respond in time (TIMEOUT)."
  );
  assert.equal(
    help.loginHelpError("host · UNREACHABLE", true),
    "The app could not reach the exam server (UNREACHABLE)."
  );
});
