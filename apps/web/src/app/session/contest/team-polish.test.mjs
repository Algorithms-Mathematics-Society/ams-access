import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
function harness() {
  const source = readFileSync(
    new URL("./components/VoiceEndedNotice.tsx", import.meta.url),
    "utf8"
  );
  const state = [],
    effects = [],
    pending = [];
  let cursor = 0,
    timer;
  const react = {
    useRef(v) {
      const i = cursor++;
      return (state[i] ??= { current: v });
    },
    useState(v) {
      const i = cursor++;
      state[i] ??= v;
      return [
        state[i],
        (v) => {
          state[i] = v;
        },
      ];
    },
    useEffect(fn, deps) {
      const i = cursor++,
        old = effects[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j])))
        pending.push(() => {
          old?.cleanup?.();
          effects[i] = { deps, cleanup: fn() };
        });
    },
  };
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "exports", "setTimeout", "clearTimeout", js)(
    (name) => {
      if (name === "react") return react;
      if (name === "react-dom") return { createPortal: (node, target) => ({ node, target }) };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      return { Text: "Text" };
    },
    exports,
    (fn, ms) => {
      timer = { fn, ms };
      return timer;
    },
    () => {
      timer = null;
    }
  );
  return {
    render(patch = {}) {
      const props = {
        contestUid: "one",
        enabled: true,
        status: "team",
        voiceOpen: true,
        compact: true,
        toolbarTarget: "toolbar",
        ...patch,
      };
      cursor = 0;
      exports.useVoiceEndedNotice(props);
      pending.splice(0).forEach((fn) => fn());
      cursor = 0;
      const result = exports.useVoiceEndedNotice(props);
      pending.splice(0).forEach((fn) => fn());
      return result;
    },
    get timer() {
      return timer;
    },
    unmount() {
      effects.forEach((e) => e?.cleanup?.());
    },
  };
}
test("voice end announces for five seconds, not initial wait or transient polls", () => {
  const h = harness();
  assert.equal(h.render({ voiceOpen: false }), null);
  assert.equal(h.render(), null);
  assert.equal(h.render({ status: "error" }), null);
  const notice = h.render({ voiceOpen: false });
  assert.equal(notice.target, "toolbar");
  assert.equal(notice.node.props.children, "Voice has ended for this round");
  assert.equal(h.timer.ms, 5000);
  h.timer.fn();
  assert.equal(h.render({ voiceOpen: false }), null);
  assert.equal(h.timer, null);
});
test("local round end retains notice when disabled and cleans up on unmount", () => {
  const h = harness();
  h.render();
  assert.ok(h.render({ enabled: false }));
  h.unmount();
  assert.equal(h.timer, null);
});
test("phase boundary, actions, and hidden output names have explicit feedback", () => {
  const source = readFileSync(new URL("./components/TeamLobby.tsx", import.meta.url), "utf8");
  assert.match(source, /phase === "discussion" && remaining !== 0/);
  assert.match(source, /setPendingAction\(`Claiming part \$\{part.label\}…`\)/);
  assert.match(source, /setPendingAction\(`Releasing part \$\{part.label\}…`\)/);
  assert.match(source, /state.pending && <Text role="status">/);
  const voice = readFileSync(
    new URL("./components/TeamVoiceControls.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(voice, /Teams have not been published yet/);
  assert.match(voice, /Output names may appear after microphone access is granted/);
});
