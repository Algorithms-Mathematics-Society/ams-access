import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { contestTimestamp } from "./contest-information.ts";
import { readReferenceSheet } from "./reference-sheet.ts";

const sheet = {
  title: "Contest guidance",
  body: "Read carefully.\nUse Submit.",
  revision: 1,
  published_at: "2026-10-23T12:00:00Z",
};
test("accepts only a bounded, published snapshot and excludes unrelated draft fields", () => {
  assert.deepEqual(readReferenceSheet({ ...sheet, draft_body: "SECRET" }), sheet);
  for (const invalid of [
    undefined,
    null,
    {},
    { ...sheet, body: " " },
    { ...sheet, title: "" },
    { ...sheet, body: "x".repeat(20_001) },
    { ...sheet, title: "x".repeat(121) },
    { ...sheet, revision: 0 },
    { ...sheet, revision: 1.5 },
    { ...sheet, published_at: "bad" },
  ]) {
    assert.equal(readReferenceSheet(invalid), null);
  }
});
test("retains literal text, whitespace and the full permitted body", () => {
  const body = "<script>alert(1)</script>\nhttps://example.test\n";
  assert.equal(readReferenceSheet({ ...sheet, body }).body, body);
  assert.equal(readReferenceSheet({ ...sheet, body: "x".repeat(20_000) }).body.length, 20_000);
  assert.ok(readReferenceSheet({ ...sheet, title: "😀".repeat(120), body: "😀".repeat(20_000) }));
  assert.equal(readReferenceSheet({ ...sheet, body: "😀".repeat(20_001) }), null);
});

test("rejects oversized UTF-16 input before allocating a code-point array", () => {
  const originalFrom = Array.from;
  let counts = 0;
  Array.from = (...args) => {
    counts++;
    return originalFrom(...args);
  };
  try {
    assert.equal(readReferenceSheet({ ...sheet, title: "x".repeat(241) }), null);
    assert.equal(counts, 0);
    assert.equal(readReferenceSheet({ ...sheet, body: "x".repeat(40_001) }), null);
    // Only the short valid title was scanned; the oversized body was not.
    assert.equal(counts, 1);
    assert.ok(readReferenceSheet({ ...sheet, title: "😀".repeat(120), body: "😀".repeat(20_000) }));
    // Inputs inside the cheap UTF-16 bound still need exact code-point validation.
    assert.equal(readReferenceSheet({ ...sheet, body: "x".repeat(20_001) }), null);
  } finally {
    Array.from = originalFrom;
  }
});

const source = readFileSync(new URL("./components/ReferenceSheet.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function harness({ supportsInert = true } = {}) {
  const states = [],
    refs = [],
    effects = [],
    listeners = new Map();
  let si = 0,
    ri = 0,
    ei = 0;
  const document = { activeElement: null };
  const jsx = (type, props) => ({ type, props });
  const nodes = new Map();
  const focusCalls = [];
  const node = (name) => {
    if (!nodes.has(name))
      nodes.set(name, {
        name,
        ...(supportsInert ? { inert: false } : {}),
        attributes: new Map(),
        getAttribute(name) {
          return this.attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        removeAttribute(name) {
          this.attributes.delete(name);
        },
        children: [],
        matches(selector) {
          return selector === "[data-contest-page]" ? name === "contest" : name === "mandatory";
        },
        scrollTop: 0,
        focus() {
          document.activeElement = this;
          focusCalls.push(name);
        },
        getClientRects: () => [{}],
        contains(other) {
          return ["close", "body"].includes(other?.name);
        },
        querySelector() {
          return node("close");
        },
        querySelectorAll() {
          return [node("close"), node("body")];
        },
      });
    return nodes.get(name);
  };
  const attach = (parent, ...children) => {
    node(parent).children = children.map(node);
    for (const child of children) node(child).parentElement = node(parent);
  };
  attach("contest", "header", "workspace", "mandatory");
  attach("header", "title", "actions");
  attach("actions", "trigger", "overlay");
  attach("overlay", "root");
  const context = {
    HTMLElement: Object,
    exports: {},
    document,
    window: {
      addEventListener(name, fn) {
        listeners.set(name, fn);
      },
      removeEventListener(name, fn) {
        if (listeners.get(name) === fn) listeners.delete(name);
      },
    },
    require(name) {
      if (name === "../contest-information") return { contestTimestamp };
      if (name === "react")
        return {
          memo: (fn) => fn,
          useState(initial) {
            const i = si++;
            if (!(i in states)) states[i] = initial;
            return [
              states[i],
              (value) => {
                states[i] = typeof value === "function" ? value(states[i]) : value;
              },
            ];
          },
          useRef(initial) {
            return (refs[ri++] ??= { current: initial });
          },
          useEffect(fn, deps) {
            const i = ei++;
            const old = effects[i];
            if (!old || deps.some((v, j) => v !== old.deps[j]))
              effects[i] = { fn, deps, oldCleanup: old?.cleanup, pending: true };
          },
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      return Object.fromEntries(
        [
          "Button",
          "HStack",
          "VStack",
          "Heading",
          "Text",
          "ContestOverlay",
          "CountdownBadge",
          "FileText",
        ].map((key) => [key, key])
      );
    },
  };
  vm.runInNewContext(compiled, context);
  let props = { sheet, suspended: false, clock: { endsAtMs: null, phase: "running" } };
  let tree;
  const all = (type) => {
    const found = [];
    function walk(value) {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      if (value.type === type) found.push(value);
      walk(value.props?.children);
    }
    walk(tree);
    return found;
  };
  const h = {
    all,
    node,
    focusCalls,
    listeners,
    document,
    render(next = {}) {
      props = { ...props, ...next };
      si = ri = ei = 0;
      tree = context.exports.ReferenceSheetButton(props);
      const trigger = all("Button").find((v) => v.props.label === "Reference");
      trigger.props.ref.current = node("trigger");
      const overlay = all("ContestOverlay")[0];
      if (overlay) {
        overlay.props.dialogRef.current = node("root");
        all("VStack").find((v) => v.props["aria-label"] === "Reference content").props.ref.current =
          node("body");
      }
      for (const effect of effects)
        if (effect.pending) {
          effect.oldCleanup?.();
          effect.cleanup = effect.fn();
          effect.pending = false;
        }
      return h;
    },
    click(label) {
      all("Button")
        .find((v) => v.props.label === label)
        .props.onClick();
      return h.render();
    },
    key(key, shiftKey = false) {
      const event = {
        key,
        shiftKey,
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      listeners.get("keydown")?.(event);
      return event;
    },
  };
  return h.render();
}

test("opens preloaded text locally, has no editing or interpreted links, and keeps expiry ownership outside sheet", () => {
  const h = harness();
  assert.equal(h.all("ContestOverlay").length, 0);
  h.render({ sheet: { ...sheet, body: "<img src=x> https://example.test" } }).click("Reference");
  assert.equal(h.all("ContestOverlay").length, 1);
  assert.ok(h.all("Text").some((n) => n.props.children === "<img src=x> https://example.test"));
  assert.equal(h.all("CountdownBadge")[0].props.onExpiry, undefined);
  assert.equal(h.document.activeElement, h.node("close"));
});

test("Escape closes and restores trigger focus, without losing reading position", () => {
  const h = harness().click("Reference");
  h.node("body").scrollTop = 321;
  assert.equal(h.key("Escape").prevented, true);
  h.render();
  assert.equal(h.all("ContestOverlay").length, 0);
  assert.equal(h.document.activeElement, h.node("trigger"));
  assert.equal(h.listeners.size, 0);
  h.node("body").scrollTop = 0;
  h.click("Reference");
  assert.equal(h.node("body").scrollTop, 321);
});

test("Tab and Shift+Tab stay inside the dialog and the text is keyboard-scrollable", () => {
  const h = harness().click("Reference");
  assert.equal(h.key("Tab", true).prevented, true);
  assert.equal(h.document.activeElement, h.node("body"));
  assert.equal(h.key("Tab").prevented, true);
  assert.equal(h.document.activeElement, h.node("close"));
  h.document.activeElement = h.node("root");
  assert.equal(h.key("Tab", true).prevented, true);
  assert.equal(h.document.activeElement, h.node("body"));
  h.document.activeElement = h.node("outside");
  assert.equal(h.key("Tab").prevented, true);
  assert.equal(h.document.activeElement, h.node("close"));
});

test("mandatory overlays suspend immediately without stealing their focus or reopening afterwards", () => {
  const h = harness().click("Reference");
  h.document.activeElement = h.node("mandatory");
  const count = h.focusCalls.length;
  h.render({ suspended: true });
  assert.equal(h.all("ContestOverlay").length, 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.focusCalls.length, count);
  h.render({ suspended: false });
  assert.equal(h.all("ContestOverlay").length, 0);
  assert.equal(h.document.activeElement, h.node("mandatory"));
});

test("separate contest mounts cannot inherit another contest's open state or scroll", () => {
  const a = harness().click("Reference");
  a.node("body").scrollTop = 321;
  const b = harness().render({ sheet: { ...sheet, title: "Second contest" } });
  assert.equal(b.all("ContestOverlay").length, 0);
  b.click("Reference");
  assert.equal(b.node("body").scrollTop, 0);
  assert.ok(b.all("Heading").some((n) => n.props.children === "Second contest"));
});

test("background workspace is inert only while open; mandatory layers are never isolated", () => {
  const h = harness();
  assert.equal(h.node("workspace").inert, false);
  h.click("Reference");
  assert.equal(h.node("workspace").inert, true);
  assert.equal(h.node("trigger").inert, true);
  assert.equal(h.node("mandatory").inert, false);
  h.click("Close");
  assert.equal(h.node("workspace").inert, false);
  assert.equal(h.node("trigger").inert, false);
});

test("older WebKit isolation restores exact accessibility attributes on close and suspension", () => {
  for (const suspended of [false, true]) {
    const h = harness({ supportsInert: false });
    h.node("title").setAttribute("aria-hidden", "false");
    h.node("workspace").setAttribute("aria-hidden", "true");
    h.click("Reference");
    assert.equal(h.node("trigger").getAttribute("aria-hidden"), "true");
    assert.equal(h.node("title").getAttribute("aria-hidden"), "true");
    assert.equal(h.node("mandatory").getAttribute("aria-hidden"), null);
    assert.equal(h.node("trigger").inert, undefined);
    assert.equal(h.document.activeElement, h.node("close"));
    assert.equal(h.key("Tab", true).prevented, true);
    if (suspended) {
      h.document.activeElement = h.node("mandatory");
      h.render({ suspended: true });
      assert.equal(h.document.activeElement, h.node("mandatory"));
    } else h.click("Close");
    assert.equal(h.node("trigger").getAttribute("aria-hidden"), null);
    assert.equal(h.node("title").getAttribute("aria-hidden"), "false");
    assert.equal(h.node("workspace").getAttribute("aria-hidden"), "true");
    assert.equal(h.node("mandatory").getAttribute("aria-hidden"), null);
    assert.equal(h.listeners.size, 0);
  }
});

test("native isolation preserves already-inert backgrounds and existing accessibility attributes", () => {
  const h = harness();
  h.node("workspace").inert = true;
  h.node("title").setAttribute("aria-hidden", "false");
  h.click("Reference");
  assert.equal(h.node("title").getAttribute("aria-hidden"), "false");
  h.click("Close");
  assert.equal(h.node("workspace").inert, true);
  assert.equal(h.node("title").inert, false);
  assert.equal(h.node("title").getAttribute("aria-hidden"), "false");
});

// Exercise the real loader across the publication/start boundary without assets.
const loaderCode = ts.transpileModule(
  readFileSync(new URL("./load-contest-problems.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;
for (const phase of ["running", "verification", "before_window"]) {
  test(`paper loading keeps the final published snapshot at the ${phase} boundary`, async () => {
    let calls = 0;
    const events = [];
    const initial = { phase, problems: [{ label: "A" }], reference_sheet: sheet };
    const final = {
      ...initial,
      phase: "running",
      problems: [{ label: "A" }, { label: "B" }],
      reference_sheet: { ...sheet, revision: 2 },
    };
    const projection = {
      label: "A",
      title: "Example",
      statement: { markdown: "Example" },
      limits: {},
      samples: [],
      assets: [],
      families: {},
    };
    const context = {
      exports: {},
      require: () => ({
        getContest: async () => {
          events.push("index");
          return ++calls === 1 ? initial : final;
        },
        getProblem: async (_uid, label) => {
          events.push(`problem:${label}`);
          return { ...projection, label };
        },
      }),
    };
    vm.runInNewContext(loaderCode, context);
    const loaded = await context.exports.loadContestPaper("contest");
    assert.equal(loaded.index.reference_sheet.revision, phase === "running" ? 1 : 2);
    assert.equal(loaded.index.phase, "running");
    assert.deepEqual(
      Array.from(loaded.questions, (question) => question.id),
      phase === "running" ? ["A"] : ["A", "B"]
    );
    assert.deepEqual(
      events,
      phase === "running"
        ? ["index", "problem:A"]
        : ["index", "problem:A", "index", "problem:A", "problem:B"]
    );
  });
}
