import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("./WifiControl.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
);

function harness(scan, invoke = async () => {}, online = true, location = null) {
  const states = [scan, true, null, "", false, "", "", "", location];
  let cursor = 0;
  let refCursor = 0;
  const refs = [];
  const context = {
    exports: {},
    window: { __TAURI__: { core: { invoke } }, setTimeout: () => {} },
    require(name) {
      if (name === "react")
        return {
          useState: (initial) => {
            const index = cursor++;
            if (index >= states.length) states[index] = initial;
            return [
              states[index],
              (value) => {
                states[index] = value;
              },
            ];
          },
          useRef: (initial) => {
            const index = refCursor++;
            return (refs[index] ??= { current: initial });
          },
          useCallback: (fn) => fn,
          useEffect: () => {},
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      return Object.fromEntries(
        [
          "Check",
          "Lock",
          "RefreshCw",
          "Wifi",
          "WifiOff",
          "Button",
          "HStack",
          "VStack",
          "Text",
          "Token",
        ].map((name) => [name, name])
      );
    },
  };
  vm.runInNewContext(outputText, context);
  return () => {
    cursor = 0;
    refCursor = 0;
    return context.exports.WifiControl({ online });
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const base = { supported: true, networks: [], current: null, connected: false, saved_only: false };
const network = { ssid: "Campus", current: false, secured: true, signal: 72, saved: false };
const render = (scan, online = true) => JSON.stringify(harness(scan, undefined, online)());
const settle = () => new Promise(setImmediate);
const row = (view) =>
  nodes(view).find(
    (node) => node.type === "button" && JSON.stringify(node.props.children).includes("Campus")
  );

test("hidden SSID reports association without inventing a name or marking a saved row", () => {
  const view = render({ ...base, connected: true, networks: [network] }, false);
  assert.match(view, /Connected to Wi-Fi \(name unavailable\)/);
  assert.doesNotMatch(view, /Not connected| · connected|Network: Campus/);
});

test("named, disconnected and unsupported Wi-Fi retain honest labels", () => {
  assert.match(render({ ...base, current: "Campus", connected: true }), /Network: Campus/);
  assert.match(render(base), /Not connected to Wi-Fi/);
  assert.match(render({ ...base, supported: false }), /Network connection: online/);
});

test("nearby results show signal, security, saved label and the connected tick", () => {
  const tree = harness({
    ...base,
    current: "Campus",
    connected: true,
    networks: [{ ...network, current: true, saved: true }],
  })();
  const elements = nodes(tree);
  assert.match(JSON.stringify(tree), /Nearby networks/);
  assert.ok(
    elements.some((node) => node.type === "Check" && node.props["aria-label"] === "Connected")
  );
  assert.ok(elements.some((node) => node.type === "Lock"));
  assert.ok(elements.some((node) => node.type === "Token" && node.props.label === "Saved"));
  assert.ok(elements.some((node) => node.props["aria-label"] === "Signal strength 72%"));
});

test("fallback identifies saved profiles and warns they may be out of range", () => {
  const view = render({ ...base, saved_only: true });
  assert.match(view, /Saved networks/);
  assert.match(view, /may be out of range/);
  assert.match(view, /No saved networks found/);
});

test("new secured networks ask for a password before invoking native join", () => {
  let calls = 0;
  const draw = harness({ ...base, networks: [network] }, async () => {
    calls++;
  });
  row(draw()).props.onClick();
  assert.ok(nodes(draw()).some((node) => node.type === "input" && node.props.type === "password"));
  assert.equal(calls, 0);
});

test("saved join tries without a password, then allows retry with inline errors", async () => {
  const calls = [];
  const draw = harness(
    { ...base, networks: [{ ...network, saved: true }] },
    async (command, args) => {
      calls.push({ command, args });
      throw "Check the password";
    }
  );
  row(draw()).props.onClick();
  await settle();
  assert.equal(calls[0].command, "connect_wifi");
  assert.equal(calls[0].args.password, null);
  let tree = draw();
  const input = nodes(tree).find((node) => node.type === "input");
  assert.ok(input);
  assert.match(JSON.stringify(tree), /Check the password/);
  input.props.onChange({ target: { value: "secret" } });
  tree = draw();
  nodes(tree)
    .find((node) => node.type === "Button" && node.props.label === "Join")
    .props.onClick();
  await settle();
  assert.equal(calls[1].args.password, "secret");
  assert.match(JSON.stringify(draw()), /Check the password/);
});

test("successful saved joins need no prompt and open networks join directly", async () => {
  for (const variant of [{ saved: true }, { secured: false }]) {
    let calls = 0;
    const draw = harness({ ...base, networks: [{ ...network, ...variant }] }, async () => {
      calls++;
    });
    row(draw()).props.onClick();
    await settle();
    assert.equal(calls, 1);
    assert.ok(!nodes(draw()).some((node) => node.type === "input"));
  }
});

test("repeated rescans share a pending native scan", async () => {
  let calls = 0;
  let release;
  const draw = harness(
    base,
    () =>
      new Promise((resolve) => {
        calls++;
        release = resolve;
      })
  );
  const rescan = nodes(draw()).find((node) => node.props["aria-label"] === "Rescan networks");
  rescan.props.onClick();
  rescan.props.onClick();
  assert.equal(calls, 1);
  release(base);
  await settle();
  rescan.props.onClick();
  assert.equal(calls, 2);
  release(base);
  await settle();
});

const locationButton = (tree) =>
  nodes(tree).find((node) => node.props.label === "Show networks near you");

test("only undetermined Location access on saved-only macOS offers the request", () => {
  assert.ok(
    locationButton(harness({ ...base, saved_only: true }, undefined, true, "not_determined")())
  );
  for (const status of [null, "authorized", "denied", "restricted"]) {
    assert.ok(!locationButton(harness({ ...base, saved_only: true }, undefined, true, status)()));
  }
  assert.ok(!locationButton(harness(base, undefined, true, "not_determined")()));
});

test("denied and restricted access point to Location Services without requesting again", () => {
  for (const status of ["denied", "restricted"]) {
    const tree = harness({ ...base, saved_only: true }, undefined, true, status)();
    assert.match(JSON.stringify(tree), /System Settings > Privacy &.*Security > Location Services/);
    assert.ok(!locationButton(tree));
  }
});

test("Location request is single-flight and rescans nearby networks after granting", async () => {
  const calls = [];
  let grant;
  const draw = harness(
    { ...base, saved_only: true },
    async (command) => {
      calls.push(command);
      if (command === "request_wifi_location")
        return new Promise((resolve) => {
          grant = resolve;
        });
      if (command === "scan_wifi") return { ...base, networks: [network] };
    },
    true,
    "not_determined"
  );
  const button = locationButton(draw());
  button.props.onClick();
  button.props.onClick();
  assert.deepEqual(calls, ["request_wifi_location"]);
  assert.equal(locationButton(draw()).props.isLoading, true);
  grant("authorized");
  await settle();
  assert.deepEqual(calls, ["request_wifi_location", "scan_wifi"]);
  assert.match(JSON.stringify(draw()), /Nearby networks/);
  assert.ok(!locationButton(draw()));
});

test("denial keeps saved networks usable and request failure allows retry", async () => {
  for (const fail of [false, true]) {
    const draw = harness(
      { ...base, saved_only: true, networks: [network] },
      async (command) => {
        if (command === "request_wifi_location") {
          if (fail) throw new Error("unavailable");
          return "denied";
        }
        if (command === "get_platform") return { os: "macos" };
        if (command === "wifi_location_status") return "denied";
        return { ...base, saved_only: true, networks: [network] };
      },
      true,
      "not_determined"
    );
    locationButton(draw()).props.onClick();
    await settle();
    const tree = draw();
    assert.ok(row(tree));
    if (fail) {
      assert.match(JSON.stringify(tree), /Could not request Location access/);
      assert.equal(locationButton(tree).props.isLoading, false);
    } else {
      assert.ok(!locationButton(tree));
      assert.match(JSON.stringify(tree), /Location Services/);
    }
  }
});

test("saved-only refresh queries Location status only on native macOS", async () => {
  for (const os of ["macos", "linux", "windows"]) {
    const calls = [];
    const draw = harness({ ...base, saved_only: true }, async (command) => {
      calls.push(command);
      if (command === "get_platform") return { os };
      if (command === "wifi_location_status") return "not_determined";
      return { ...base, saved_only: true };
    });
    nodes(draw())
      .find((node) => node.props["aria-label"] === "Rescan networks")
      .props.onClick();
    await settle();
    assert.equal(calls.includes("wifi_location_status"), os === "macos");
    assert.equal(Boolean(locationButton(draw())), os === "macos");
  }
});

test("granting during a pending rescan queues a fresh scan with the new access", async () => {
  let release;
  let scans = 0;
  const draw = harness(
    { ...base, saved_only: true },
    async (command) => {
      if (command === "request_wifi_location" || command === "wifi_location_status")
        return "authorized";
      if (command === "get_platform") return { os: "macos" };
      if (command === "scan_wifi") {
        scans++;
        if (scans === 1)
          return new Promise((resolve) => {
            release = resolve;
          });
        return { ...base, networks: [network] };
      }
    },
    true,
    "not_determined"
  );
  const tree = draw();
  nodes(tree)
    .find((node) => node.props["aria-label"] === "Rescan networks")
    .props.onClick();
  locationButton(tree).props.onClick();
  await settle();
  assert.equal(scans, 1);
  release({ ...base, saved_only: true });
  await settle();
  assert.equal(scans, 2);
  assert.match(JSON.stringify(draw()), /Nearby networks/);
});
