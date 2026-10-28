import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(
  readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8"),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }
).outputText;

function render(overrides = {}) {
  const jsx = (type, props) => ({ type, props });
  const context = {
    exports: {},
    require(name) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return { useRef: (current) => ({ current }), useEffect() {} };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports.TopBar({
    contest: { id: "contest", title: "Test Round", reference_sheet: { revision: 1 } },
    clock: {},
    timeUpState: "idle",
    finishQuestions: [],
    markedQuestionIds: [],
    ...overrides,
  });
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test("toolbar keeps Contest info, Help, Reference and Finish without Leave", () => {
  let review = false,
    support = false;
  const tree = nodes(
    render({
      setSubmitConfirm: (value) => {
        review = value;
      },
      setShowSupportModal: (value) => {
        support = value;
      },
    })
  );
  const buttons = tree.filter((n) => n.type === "Button");
  assert.deepEqual(
    buttons.map((n) => n.props.label),
    ["Help", "Finish contest"]
  );
  assert.ok(tree.some((n) => n.type === "ReferenceSheetButton"));
  assert.ok(tree.some((n) => n.type === "ContestInformation"));
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  assert.equal(support, true);
  assert.equal(review, true);
});

test("Finish confirmation still calls completion and waits for pending submissions", () => {
  let finishes = 0;
  for (const pending of [false, true]) {
    const tree = nodes(
      render({
        submitConfirm: true,
        submissionPending: pending,
        handleSubmitConfirmed: () => {
          finishes++;
        },
      })
    );
    const finish = tree.find((n) => n.props?.label === "Finish and exit");
    assert.equal(finish.props.isDisabled, pending);
    if (!pending) finish.props.onClick();
  }
  assert.equal(finishes, 1);
  const blocked = nodes(render({ submitConfirm: true, finishReviewSuspended: true }));
  assert.ok(!blocked.some((n) => n.type === "ContestOverlay"));
});

test("candidate production sources no longer mount or poll service status", () => {
  const root = new URL("../../../../", import.meta.url);
  for (const file of readdirSync(root, { recursive: true })) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(new URL(file.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(source, /ServiceStatus|service-status|\/client\/status/, file);
  }
});
