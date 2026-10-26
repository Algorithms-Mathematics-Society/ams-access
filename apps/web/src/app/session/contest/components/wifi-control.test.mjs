import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(
    process.env.WIFI_CONTROL_SOURCE ?? new URL("./WifiControl.tsx", import.meta.url),
    "utf8"
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }
);

function mountPair(scan, invoke) {
  const instances = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    exports: {},
    window: {
      __TAURI__: { core: { invoke } },
      setTimeout(fn) {
        const id = ++timerId;
        timers.set(id, fn);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
      setInterval(fn) {
        const id = ++timerId;
        timers.set(id, fn);
        return id;
      },
      clearInterval(id) {
        timers.delete(id);
      },
      addEventListener() {},
      removeEventListener() {},
    },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime")
        return {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        };
      return {};
    },
  };
  let active;
  const hooks = {
    useState(initial) {
      const owner = active;
      const i = owner.index++;
      if (!(i in owner.slots)) owner.slots[i] = i === 0 ? scan : initial;
      return [
        owner.slots[i],
        (value) => {
          owner.slots[i] = typeof value === "function" ? value(owner.slots[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = active.index++;
      return (active.slots[i] ??= { current: initial });
    },
    useCallback(fn, deps) {
      const i = active.index++;
      if (!active.slots[i] || deps.some((dep, n) => dep !== active.slots[i].deps[n]))
        active.slots[i] = { fn, deps };
      return active.slots[i].fn;
    },
    useEffect(fn, deps) {
      const owner = active;
      const i = owner.index++;
      if (!owner.slots[i] || deps.some((dep, n) => dep !== owner.slots[i].deps[n])) {
        owner.slots[i]?.cleanup?.();
        owner.slots[i] = { deps };
        owner.effects.push(() => {
          owner.slots[i].cleanup = fn();
        });
      }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = active.index++;
      if (!active.slots[i]) active.slots[i] = { cleanup: subscribe(() => {}) };
      return getSnapshot();
    },
  };
  vm.runInNewContext(outputText, context);
  function instance(inline = false) {
    const self = { slots: [], effects: [], index: 0, tree: null };
    instances.push(self);
    self.render = () => {
      active = self;
      self.index = 0;
      self.tree = context.exports.WifiControl({ online: false, inline });
      while (self.effects.length) self.effects.shift()();
      return self.tree;
    };
    const find = (predicate, node) => {
      if (!node || typeof node !== "object") return null;
      if (predicate(node)) return node;
      for (const child of [node.props?.children].flat(Infinity)) {
        const found = find(predicate, child);
        if (found) return found;
      }
      return null;
    };
    self.find = (predicate) => find(predicate, self.tree);
    self.unmount = () => {
      for (const slot of self.slots) slot?.cleanup?.();
    };
    self.render();
    return self;
  }
  return { instance, timers };
}

const network = { ssid: "Campus", current: false, secured: true, signal: null };
const base = { supported: true, networks: [network], current: null, connected: false };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function choose(ui) {
  ui.find((node) => node.props?.["aria-expanded"] !== undefined).props.onClick();
  ui.render();
  ui.find(
    (node) =>
      node.type === "button" &&
      !node.props?.["aria-label"] &&
      JSON.stringify(node).includes("Campus")
  ).props.onClick();
  ui.render();
}

test("hidden SSID reports association without inventing a name or marking a saved row", () => {
  const ui = mountPair({ ...base, connected: true }, async () => base).instance();
  const view = JSON.stringify(ui.render());
  assert.match(view, /Connected to Wi-Fi \(name unavailable\)/);
  assert.doesNotMatch(view, /Not connected| · connected|Network: Campus/);
  ui.unmount();
});

test("join error is visible in the separate offline picker and password stays for retry", async () => {
  const join = deferred();
  let calls = 0;
  const app = mountPair(base, (command) =>
    command === "scan_wifi" ? Promise.resolve(base) : (calls++, join.promise)
  );
  const header = app.instance();
  choose(header);
  header.find((node) => node.type === "input").props.onChange({ target: { value: "secret123" } });
  header.render();
  const joinButton = header.find((node) => node.props?.label === "Join");
  joinButton.props.onClick();
  joinButton.props.onClick();
  assert.equal(calls, 1);
  const offline = app.instance(true);
  assert.match(JSON.stringify(offline.render()), /Joining Campus/);
  assert.equal(
    offline.find((node) => node.props?.["aria-expanded"] !== undefined).props["aria-expanded"],
    true
  );
  join.reject("Incorrect password.");
  await tick();
  assert.match(JSON.stringify(offline.render()), /Incorrect password/);
  assert.equal(
    offline.find((node) => node.props?.role === "alert")?.props.children,
    "Incorrect password."
  );
  assert.equal(
    header.render() && header.find((node) => node.type === "input").props.value,
    "secret123"
  );
  header.unmount();
  offline.unmount();
  await tick();
  const nextContest = app.instance(true);
  assert.doesNotMatch(JSON.stringify(nextContest.render()), /Incorrect password/);
  nextContest.unmount();
});

test("native layer can reuse saved credentials when the password is blank", async () => {
  let calls = 0;
  const ui = mountPair(base, (command, args) => {
    if (command === "connect_wifi") {
      calls++;
      assert.equal(args.password, null);
    }
    return Promise.resolve(base);
  }).instance();
  choose(ui);
  ui.find((node) => node.props?.label === "Join").props.onClick();
  assert.equal(calls, 1);
  await tick();
  assert.doesNotMatch(JSON.stringify(ui.render()), /Enter the network password/);
  ui.unmount();
});

test("accepted join retains password until native scan confirms target", async () => {
  let current = base;
  const app = mountPair(base, (command) =>
    Promise.resolve(command === "scan_wifi" ? current : undefined)
  );
  const ui = app.instance();
  choose(ui);
  ui.find((node) => node.type === "input").props.onChange({ target: { value: "secret123" } });
  ui.render();
  ui.find((node) => node.props?.label === "Join").props.onClick();
  await tick();
  assert.equal(ui.render() && ui.find((node) => node.type === "input").props.value, "secret123");
  const offline = app.instance(true);
  offline.render();
  offline
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "another-secret" } });
  offline.render();
  current = { ...base, current: "Campus", connected: true };
  for (const callback of app.timers.values()) callback();
  await tick();
  ui.render();
  offline.render();
  assert.match(JSON.stringify(ui.render()), /Connected to Campus/);
  assert.equal(
    ui.find((node) => node.type === "input"),
    null
  );
  assert.equal(offline.render() && offline.find((node) => node.type === "input"), null);
  current = base;
  offline.find((node) => node.props?.["aria-label"] === "Rescan networks").props.onClick();
  await tick();
  assert.doesNotMatch(JSON.stringify(offline.render()), /Connected to Campus/);
  ui.unmount();
  offline.unmount();
});

test("a scan started before join cannot confirm it with a stale result", async () => {
  const firstScan = deferred();
  let scanCalls = 0;
  const app = mountPair(base, (command) =>
    command === "scan_wifi"
      ? ++scanCalls === 1
        ? firstScan.promise
        : Promise.resolve({ ...base, current: "Campus", connected: true })
      : Promise.resolve()
  );
  const ui = app.instance();
  choose(ui);
  ui.find((node) => node.type === "input").props.onChange({ target: { value: "secret123" } });
  ui.render();
  ui.find((node) => node.props?.label === "Join").props.onClick();
  await tick();
  firstScan.resolve({ ...base, current: "Campus", connected: true });
  await tick();
  assert.equal(ui.render() && ui.find((node) => node.type === "input").props.value, "secret123");
  for (const callback of app.timers.values()) callback();
  await tick();
  assert.match(JSON.stringify(ui.render()), /Connected to Campus/);
  ui.unmount();
});

test("polling scans cannot overlap and timers clean up on unmount", async () => {
  const scan = deferred();
  let calls = 0;
  const app = mountPair(base, (command) =>
    command === "scan_wifi" ? (calls++, scan.promise) : Promise.resolve()
  );
  const ui = app.instance();
  for (const callback of app.timers.values()) callback();
  for (const callback of app.timers.values()) callback();
  assert.equal(calls, 1);
  scan.resolve(base);
  await tick();
  ui.unmount();
  assert.equal(app.timers.size, 0);
});

test("password reveal and retry form survive an empty refresh and failed join", async () => {
  let current = base;
  const join = deferred();
  const app = mountPair(base, (command) =>
    command === "scan_wifi" ? Promise.resolve(current) : join.promise
  );
  const ui = app.instance();
  choose(ui);
  ui.find((node) => node.type === "input").props.onChange({ target: { value: "secret123" } });
  ui.render();
  const reveal = () => ui.find((node) => node.props?.label === "Show password");
  assert.ok(reveal());
  reveal().props.onClick();
  ui.render();
  assert.equal(ui.find((node) => node.type === "input").props.type, "text");
  ui.find((node) => node.props?.label === "Join").props.onClick();
  await tick();
  current = { ...base, networks: [] };
  ui.find((node) => node.props?.["aria-label"] === "Rescan networks").props.onClick();
  await tick();
  ui.render();
  assert.equal(ui.find((node) => node.type === "input").props.value, "secret123");
  assert.ok(ui.find((node) => node.props?.label === "Hide password"));
  ui.find((node) => node.props?.["aria-expanded"] !== undefined).props.onClick();
  ui.render();
  join.reject("Windows rejected the password.");
  await tick();
  ui.render();
  ui.render();
  assert.ok(ui.find((node) => node.props?.role === "alert"));
  assert.equal(ui.find((node) => node.type === "input").props.value, "secret123");
  ui.find((node) => node.props?.label === "Hide password").props.onClick();
  ui.render();
  assert.equal(ui.find((node) => node.type === "input").props.type, "password");
  ui.unmount();
});

test("verified native success clears password even when scans cannot expose the SSID", async () => {
  let hidden = { ...base, current: null, connected: true };
  const app = mountPair(base, (command) =>
    Promise.resolve(command === "scan_wifi" ? hidden : true)
  );
  const ui = app.instance();
  choose(ui);
  ui.find((node) => node.type === "input").props.onChange({ target: { value: "secret123" } });
  ui.render();
  ui.find((node) => node.props?.label === "Join").props.onClick();
  await tick();
  ui.render();
  ui.render();
  assert.match(JSON.stringify(ui.tree), /Connected to Campus/);
  assert.equal(
    ui.find((node) => node.type === "input"),
    null
  );
  for (const callback of app.timers.values()) callback();
  await tick();
  assert.match(JSON.stringify(ui.render()), /Connected to Campus/);
  hidden = { supported: false, connected: false, current: null, networks: [] };
  ui.find((node) => node.props?.["aria-label"] === "Rescan networks").props.onClick();
  await tick();
  assert.match(JSON.stringify(ui.render()), /Connected to Campus/);
  hidden = base;
  ui.find((node) => node.props?.["aria-label"] === "Rescan networks").props.onClick();
  await tick();
  assert.doesNotMatch(JSON.stringify(ui.render()), /Connected to Campus/);
  ui.unmount();
});
