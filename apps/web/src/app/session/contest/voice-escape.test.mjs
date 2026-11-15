import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { acquireOrdinaryEscape, setEditorEscapeFocused } from "./escape-ownership.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("an open voice owner survives editor blur and teardown, then re-blocks Escape", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI__: { core: { invoke: async (command, args) => calls.push([command, args.blocked]) } },
  };
  try {
    setEditorEscapeFocused(true);
    await flush();
    const release = acquireOrdinaryEscape();
    setEditorEscapeFocused(false); // blur, including editor teardown
    await flush();
    assert.equal(calls.at(-1)[1], false);
    release();
    release(); // effect cleanup must be safe during React replay
    await flush();
    assert.equal(calls.at(-1)[1], true);
    assert.ok(calls.every(([command]) => command === "set_escape_blocked"));
  } finally {
    setEditorEscapeFocused(false);
    await flush();
    globalThis.window = previousWindow;
  }
});

test("pending native writes use current ownership instead of applying a stale blur", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  let finishFirst;
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke: (_command, args) => {
          calls.push(args.blocked);
          if (calls.length === 1)
            return new Promise((resolve) => {
              finishFirst = resolve;
            });
          return Promise.resolve();
        },
      },
    },
  };
  try {
    setEditorEscapeFocused(true);
    await flush();
    setEditorEscapeFocused(false);
    const release = acquireOrdinaryEscape();
    finishFirst();
    await flush();
    assert.deepEqual(calls, [false, false, false]);
    release();
    await flush();
    assert.equal(calls.at(-1), true);
  } finally {
    setEditorEscapeFocused(false);
    await flush();
    globalThis.window = previousWindow;
  }
});

test("voice Escape restores its trigger and yields to visible priority dialogs", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousComputedStyle = globalThis.getComputedStyle;
  const listeners = new Map();
  const stateUpdates = [];
  const effects = [];
  const trigger = {
    focusCalls: 0,
    focus() {
      this.focusCalls++;
    },
  };
  const ownDialog = {
    getAttribute: () => "Team voice settings",
    closest: () => null,
    getClientRects: () => [{}],
  };
  const priorityDialog = {
    getAttribute: () => "Required security check",
    closest: () => null,
    getClientRects: () => [{}],
  };
  let priorityVisible = true;
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    __TAURI__: { core: { invoke: async () => {} } },
  };
  globalThis.document = {
    activeElement: { closest: () => ownDialog },
    querySelectorAll: () => (priorityVisible ? [ownDialog, priorityDialog] : [ownDialog]),
  };
  globalThis.getComputedStyle = () => ({ visibility: "visible" });
  try {
    const source = readFileSync(
      new URL("./components/TeamVoicePresentation.tsx", import.meta.url),
      "utf8"
    );
    const exports = {};
    const jsx = (type, props) => ({ type, props });
    new Function(
      "require",
      "exports",
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
      }).outputText
    )((name) => {
      if (name === "react")
        return {
          useEffect: (effect) => effects.push(effect),
          useRef: () => ({ current: trigger }),
          useState: () => [true, (value) => stateUpdates.push(value)],
        };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-dom") return { createPortal: (node) => node };
      if (name === "../escape-ownership") return { acquireOrdinaryEscape };
      return Object.fromEntries(
        ["Button", "Popover", "HStack", "Text", "Mic", "MicOff"].map((key) => [key, key])
      );
    }, exports);
    let joinRequests = 0;
    const rendered = exports.TeamVoicePresentation({
      compact: true,
      toolbarTarget: {},
      suspended: false,
      snapshot: null,
      onToggleMute() {},
      onRequestJoin() {
        joinRequests++;
      },
      onDismiss() {},
      canJoin: true,
      children: null,
    });
    const popover = rendered.props.children.at(-1);
    assert.equal(popover.props.children.props.ref.current, trigger);
    assert.equal(popover.props.children.props.label, "Join voice");
    popover.props.children.props.onClick();
    assert.equal(joinRequests, 1, "Join only requests confirmation; it cannot capture media");
    const suspendedView = exports.TeamVoicePresentation({
      compact: true,
      toolbarTarget: {},
      suspended: true,
      snapshot: null,
      onToggleMute() {},
      onRequestJoin() {
        joinRequests++;
      },
      onDismiss() {},
      canJoin: true,
      children: null,
    });
    suspendedView.props.children.at(-1).props.children.props.onClick();
    assert.equal(joinRequests, 1, "mandatory overlay blocks confirmation");
    assert.equal(popover.props.hasEscapeDismiss, false);
    const cleanup = effects[1]();
    await flush();
    const escape = {
      key: "Escape",
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
    listeners.get("keydown")(escape);
    assert.equal(escape.prevented, false);
    assert.deepEqual(stateUpdates, []);
    popover.props.onOpenChange(false);
    assert.equal(trigger.focusCalls, 0, "a visible priority dialog keeps focus");
    priorityVisible = false;
    listeners.get("keydown")(escape);
    assert.equal(escape.prevented, true);
    assert.deepEqual(stateUpdates, [false, false]);
    assert.equal(trigger.focusCalls, 1);
    popover.props.onOpenChange(false);
    assert.equal(trigger.focusCalls, 2, "a close while focus is in voice returns to its trigger");
    cleanup();
    await flush();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.getComputedStyle = previousComputedStyle;
  }
});
