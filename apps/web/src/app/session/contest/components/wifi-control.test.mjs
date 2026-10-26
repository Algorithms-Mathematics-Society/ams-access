import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./WifiControl.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
);

function render(scan, online = true) {
  let state = 0;
  const context = {
    exports: {},
    window: { __TAURI__: {} },
    require(name) {
      if (name === "react")
        return {
          useState: (initial) => [state++ === 0 ? scan : state === 2 ? true : initial, () => {}],
          useRef: () => ({ current: null }),
          useCallback: (fn) => fn,
          useEffect: () => {},
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      return {};
    },
  };
  vm.runInNewContext(outputText, context);
  return JSON.stringify(context.exports.WifiControl({ online }));
}

const base = { supported: true, networks: [], current: null, connected: false };

test("hidden SSID reports association without inventing a name or marking a saved row", () => {
  const view = render(
    {
      ...base,
      connected: true,
      networks: [{ ssid: "Saved", current: false, secured: true, signal: null }],
    },
    false
  );
  assert.match(view, /Connected to Wi-Fi \(name unavailable\)/);
  assert.doesNotMatch(view, /Not connected| · connected|Network: Saved/);
});

test("named, disconnected and unsupported Wi-Fi retain honest labels", () => {
  assert.match(render({ ...base, current: "Campus", connected: true }), /Network: Campus/);
  assert.match(render(base), /Not connected to Wi-Fi/);
  assert.match(render({ ...base, supported: false }), /Network connection: online/);
});
