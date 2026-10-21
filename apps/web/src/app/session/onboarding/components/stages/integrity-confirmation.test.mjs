import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const componentSource = readFileSync(
  new URL("./Stage12_IntegrityConfirmation.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../../page.tsx", import.meta.url), "utf8");

// Execute the real component with presentation-only dependencies stubbed.
function element(type, props, ...children) {
  return { type, props: { ...props, children } };
}
const component = ts.transpileModule(componentSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    jsxFactory: "element",
  },
}).outputText;
const exports = {};
new Function("require", "exports", "element", component)(
  (name) => {
    if (name === "../../support") {
      return { REVIEW_STAGE: 12, STAGES: [{ id: 1, label: "Secure Full-Screen" }] };
    }
    return new Proxy({}, { get: (_, key) => key });
  },
  exports,
  element
);

function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function render(props = {}) {
  return nodes(
    exports.Stage12_IntegrityConfirmation({
      results: { 1: "pass" },
      onPass() {},
      ...props,
    })
  );
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return typeof node === "string" ? node : "";
}

test("blocked review displays the exact reason locally even with green setup checks", () => {
  const reason = "Keyboard lockdown — interception could not be verified.\nRun device setup again.";
  const tree = render({ blocked: true, blockReason: reason });
  const banner = tree.find((node) => node.type === "Banner");
  assert.equal(banner.props.status, "error");
  assert.equal(banner.props.title, "Contest entry is blocked");
  assert.equal(text(banner.props.description), reason);
  assert.ok(!tree.some((node) => node.type === "Button"));
});

test("blocked review has actionable fallback guidance when the reason is unavailable", () => {
  const banner = render({ blocked: true }).find((node) => node.type === "Banner");
  assert.match(text(banner.props.description), /invigilator|organizer/i);
  assert.doesNotMatch(text(banner.props.description), /guidance above/i);
});

test("unblocked review still allows an explicit Continue", () => {
  const tree = render();
  assert.equal(tree.find((node) => node.type === "Banner").props.status, "success");
  assert.ok(tree.some((node) => node.type === "Button" && node.props.label === "Continue"));
});

test("onboarding passes both native-policy and contest-window reasons into the review", () => {
  const ast = ts.createSourceFile(
    "page.tsx",
    pageSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let review;
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(ast) === "Stage12_IntegrityConfirmation"
    )
      review = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(review);
  const attribute = review.attributes.properties.find(
    (attr) => attr.name?.getText(ast) === "blockReason"
  );
  assert.ok(attribute, "review must receive the block reason, not just a boolean");
  const expression = attribute.initializer.expression.getText(ast);
  const reason = new Function("policyBlock", "entryBlockedMessage", `return ${expression};`);
  assert.equal(reason("native readiness failed", null), "native readiness failed");
  assert.equal(reason(null, "Check-in has not opened yet."), "Check-in has not opened yet.");
});

const labelsExports = {};
const labelsSource = readFileSync(new URL("../labels.ts", import.meta.url), "utf8");
new Function(
  "require",
  "exports",
  ts.transpileModule(labelsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
)(() => ({}), labelsExports);

function catchLaunchError(error) {
  const ast = ts.createSourceFile(
    "page.tsx",
    pageSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let launchCatch;
  function visit(node) {
    if (ts.isCatchClause(node) && node.block.getText(ast).includes("const rawMsg"))
      launchCatch = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(launchCatch, "test must exercise the actual launch catch block");
  const code = ts.transpileModule(launchCatch.block.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    error,
    SessionBindingError: class extends Error {},
    EntryCancelledError: class extends Error {},
    EntryTimeoutError: class extends Error {},
    attempts: { current: () => true },
    attempt: 1,
    setEntryRetryAvailable() {},
    windowMeta: null,
    isTestAccount: false,
    readinessErrorText: labelsExports.readinessErrorText,
    readinessBlockMessage: labelsExports.readinessBlockMessage,
    REVIEW_STAGE: 12,
    setCurrentStage() {},
    setTransitioning() {},
    setReadyForStart() {},
    setPolicyBlock: (message) => {
      result = message;
    },
  };
  let result;
  new Function(...Object.keys(context), code)(...Object.values(context));
  return result;
}

test("actual launch catch preserves and translates the JSON string rejected by Tauri", async () => {
  const report = JSON.stringify({
    decision: "blocked",
    checks: [
      {
        kind: "keyboard_lockdown",
        blocking: true,
        outcome: "fail",
        detail: "Windows keyboard interception did not engage.",
      },
    ],
  });
  // Rust Result<_, String> rejects with a string, not a JavaScript Error.
  const message = await Promise.reject(report).catch(catchLaunchError);
  assert.match(message, /Keyboard lockdown — Windows keyboard interception did not engage/);
  assert.doesNotMatch(message, /Readiness policy blocked contest launch/);
  const banner = render({ blocked: true, blockReason: message }).find(
    (node) => node.type === "Banner"
  );
  assert.equal(text(banner.props.description), message);
});

test("actual launch catch preserves native plain-string and JavaScript Error details", () => {
  const detail = "Required desktop protections failed: keyboard hook installation failed.";
  assert.equal(catchLaunchError(detail), detail);
  assert.equal(catchLaunchError(new Error(detail)), detail);
});

test("actual launch catch provides recovery guidance for an empty or unknown rejection", () => {
  for (const error of [undefined, null, "", "  ", new Error("")]) {
    assert.match(catchLaunchError(error), /invigilator|organizer/i);
  }
});

test("readiness error copy includes an unknown check that actually blocks", () => {
  const message = labelsExports.readinessBlockMessage(
    JSON.stringify({
      decision: "blocked",
      checks: [
        {
          kind: "external_display",
          blocking: true,
          outcome: "unknown",
          detail: "Could not verify the Windows display list.",
        },
      ],
    })
  );
  assert.match(message, /External display — Could not verify the Windows display list/);
});

test("readiness error copy does not blame advisory platform warnings for a real block", () => {
  const message = labelsExports.readinessBlockMessage(
    JSON.stringify({
      decision: "blocked",
      checks: [
        {
          kind: "platform",
          blocking: false,
          outcome: "warn",
          detail: "Advisory platform warning.",
        },
        { kind: "camera", blocking: true, outcome: "fail", detail: "Camera is unavailable." },
      ],
    })
  );
  assert.match(message, /Camera — Camera is unavailable/);
  assert.doesNotMatch(message, /platform/i);
});
