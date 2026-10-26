import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = (file) =>
  ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
const code = compile("./LocationPermission.tsx");
const nodes = (tree) =>
  !tree || typeof tree !== "object"
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];
const settle = () => new Promise(setImmediate);

function harness({ status = "not_determined", env = "production", relaxed = false, invoke } = {}) {
  const slots = [],
    effects = [],
    timers = new Map(),
    listeners = new Map();
  const ready = [],
    calls = [],
    quit = [];
  let cursor = 0,
    time = 0,
    nextTimer = 0,
    tree;
  const onReady = (value) => ready.push(value);
  const context = {
    exports: {},
    process: { env: { NODE_ENV: env } },
    Date: { now: () => time },
    setInterval(fn, ms) {
      const id = ++nextTimer;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    window: {
      addEventListener(name, fn) {
        listeners.set(name, fn);
      },
      removeEventListener(name, fn) {
        if (listeners.get(name) === fn) listeners.delete(name);
      },
    },
    require(name) {
      if (name === "react")
        return {
          useState(initial) {
            const index = cursor++;
            if (!(index in slots)) slots[index] = initial;
            return [
              slots[index],
              (value) => {
                slots[index] = typeof value === "function" ? value(slots[index]) : value;
              },
            ];
          },
          useRef(initial) {
            const index = cursor++;
            return (slots[index] ??= { current: initial });
          },
          useEffect(fn, deps) {
            const index = cursor++,
              old = slots[index];
            if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
              effects.push(() => {
                old?.cleanup?.();
                slots[index] = { deps, cleanup: fn() };
              });
            }
          },
        };
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      if (name === "@/lib/gating") return { isGatingRelaxed: () => relaxed };
      if (name === "../support")
        return {
          invokeStrict: async (command, args) => {
            calls.push({ command, args });
            if (invoke) return invoke(command, args);
            return command === "wifi_location_status" ? status : undefined;
          },
        };
      return Object.fromEntries(
        ["Button", "VStack", "Text", "StatusBadge"].map((name) => [name, name])
      );
    },
  };
  vm.runInNewContext(code, context);
  function draw() {
    cursor = 0;
    tree = context.exports.LocationPermission({ onReady, onQuitAndReopen: () => quit.push(true) });
    effects.splice(0).forEach((effect) => effect());
    return tree;
  }
  return {
    ready,
    calls,
    quit,
    timers,
    listeners,
    draw,
    async flush() {
      for (let i = 0; i < 3; i++) {
        await settle();
        draw();
      }
      return tree;
    },
    status(value) {
      status = value;
    },
    click(label) {
      const button = nodes(tree).find((node) => node.props?.label === label);
      assert.ok(button, label);
      button.props.onClick();
    },
    button(label) {
      return nodes(tree).find((node) => node.props?.label === label);
    },
    focus() {
      listeners.get("focus")?.();
    },
    tick(ms) {
      time += ms;
      [...timers.values()].forEach(({ fn }) => fn());
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
}

test("setup requires authorization, explains reconnecting and offers Allow without auto-requesting", async () => {
  const h = harness();
  h.draw();
  const tree = await h.flush();
  assert.equal(h.ready.at(-1), false);
  assert.match(JSON.stringify(tree), /Location access required/);
  assert.match(JSON.stringify(tree), /If no prompt appeared/);
  assert.match(JSON.stringify(tree), /Your location is never recorded or sent/);
  assert.ok(h.button("Allow Location access"));
  assert.deepEqual(
    h.calls.map((call) => call.command),
    ["wifi_location_status"]
  );
  h.click("Allow Location access");
  h.click("Allow Location access");
  await h.flush();
  assert.equal(h.calls.filter((call) => call.command === "request_wifi_location").length, 1);
  assert.ok(h.button("Allow Location access"));
  assert.equal(h.ready.at(-1), false);
  h.status("authorized");
  h.tick(1000);
  await h.flush();
  assert.equal(h.ready.at(-1), true);
  assert.equal(h.timers.size, 0);
  assert.ok(!h.button("Allow Location access"));
});

test("denied and restricted block with Settings and safe relaunch actions", async () => {
  for (const status of ["denied", "restricted"]) {
    const h = harness({ status });
    h.draw();
    const tree = await h.flush();
    assert.equal(h.ready.at(-1), false);
    assert.ok(!h.button("Allow Location access"));
    assert.match(
      JSON.stringify(tree),
      status === "restricted"
        ? /Location Services is turned off.*invigilator/
        : /Location access was denied/
    );
    assert.match(JSON.stringify(tree), /may require quitting and reopening/);
    h.click("Open System Settings");
    await h.flush();
    assert.equal(h.calls.at(-1).command, "open_privacy_settings");
    assert.equal(h.calls.at(-1).args.section, "location");
    h.click("Quit & reopen AMS Access");
    assert.equal(h.quit.length, 1);
    h.status("authorized");
    h.focus();
    await h.flush();
    assert.equal(h.ready.at(-1), true);
  }
});

test("polling stops at 60 seconds, while focus still rechecks access and revocation", async () => {
  const h = harness();
  h.draw();
  await h.flush();
  h.click("Allow Location access");
  await h.flush();
  const calls = h.calls.length;
  h.tick(60_000);
  await h.flush();
  assert.equal(h.calls.length, calls);
  assert.equal(h.timers.size, 0);
  h.status("authorized");
  h.focus();
  await h.flush();
  assert.equal(h.ready.at(-1), true);
  h.status("denied");
  h.focus();
  await h.flush();
  assert.equal(h.ready.at(-1), false);
  h.unmount();
  assert.equal(h.listeners.size, 0);
});

test("only relaxed development builds skip Location, with a visible note and no native work", async () => {
  for (const [env, relaxed, skipped] of [
    ["development", true, true],
    ["development", false, false],
    ["production", true, false],
  ]) {
    const h = harness({ status: "denied", env, relaxed });
    h.draw();
    const tree = await h.flush();
    assert.equal(h.ready.at(-1), skipped);
    assert.equal(JSON.stringify(tree).includes("skipped in dev build"), skipped);
    if (skipped) assert.equal(h.calls.length, 0);
  }
});

test("unavailable or malformed status fails closed, and a late query cannot pass after unmount", async () => {
  for (const response of [null, "unexpected", new Error("IPC failed")]) {
    const h = harness({
      invoke: async () => {
        if (response instanceof Error) throw response;
        return response;
      },
    });
    h.draw();
    const tree = await h.flush();
    assert.equal(h.ready.at(-1), false);
    assert.match(JSON.stringify(tree), /Could not check Location access/);
    assert.ok(h.button("Allow Location access"));
  }
  let resolve;
  const h = harness({
    invoke: () =>
      new Promise((yes) => {
        resolve = yes;
      }),
  });
  h.draw();
  h.unmount();
  resolve("authorized");
  await settle();
  assert.deepEqual(h.ready, [false]);
});

test("only macOS camera setup mounts the Location row; Windows and Linux have no new UI", () => {
  const stageCode = compile("./stages/Stage7_CameraInit.tsx");
  for (const platform of ["macos", "windows", "windows_no_admin", "linux"]) {
    const context = {
      exports: {},
      process: { env: { NODE_ENV: "production" } },
      require(name) {
        if (name === "react")
          return {
            useState: (value) => [typeof value === "function" ? value() : value, () => {}],
            useEffect: () => {},
            useRef: (value) => ({ current: value }),
          };
        if (name === "react/jsx-runtime")
          return {
            jsx: (type, props) => ({ type, props }),
            jsxs: (type, props) => ({ type, props }),
          };
        return {
          ...Object.fromEntries(
            [
              "VStack",
              "Text",
              "Selector",
              "Button",
              "Spinner",
              "StageHeader",
              "StatusBadge",
              "SetupPermissionInfo",
              "LocationPermission",
            ].map((key) => [key, key])
          ),
          useTheme: () => ({ theme: "dark" }),
          cameraSession: { preferredVideoDevice: () => null },
          useCameraDevices: () => ({ state: { status: "empty", devices: [] }, refresh() {} }),
          isSavedCameraUnavailable: () => false,
          readinessAction: () => ({ decision: "warn" }),
        };
      },
    };
    vm.runInNewContext(stageCode, context);
    const tree = context.exports.Stage7_CameraInit({ platform, policy: {}, overrideActive: false });
    assert.equal(
      nodes(tree).some((node) => node.type === "LocationPermission"),
      platform === "macos"
    );
  }
});
