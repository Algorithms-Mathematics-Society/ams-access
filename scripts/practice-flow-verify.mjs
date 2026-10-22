/** Production-export practice traversal using only accessible DOM actions and fixture native APIs.
 * Run: node scripts/practice-flow-verify.mjs http://127.0.0.1:3000
 */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = new URL(process.argv[2] || "http://127.0.0.1:3000");
assert(
  ["127.0.0.1", "localhost"].includes(base.hostname) && base.protocol === "http:",
  "Local HTTP preview required"
);
const origin = base.origin,
  evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || "reports/practice-flow";
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "ams-practice-"));
const chrome = spawn(
  "/usr/bin/google-chrome",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let ws,
  seq = 0;
const pending = new Map();
const manifest = {
  capturedAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  origin,
  worktreeStatus: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  trackedDiffSha256: createHash("sha256")
    .update(execFileSync("git", ["diff", "--binary"]))
    .digest("hex"),
  fixtureOnly: true,
  nativeRuntimeVerified: false,
  fixtureMethod:
    "Accessible buttons and rendered status text against production export; native, monitor, and media APIs are disposable browser fixtures.",
  checks: [],
  commands: [],
  failures: [],
  exceptions: [],
};
function fixtures(config) {
  if (location.origin !== config.origin) return;
  window.__practiceCommands = [];
  window.__practiceTracks = [];
  const done = () => Promise.resolve();
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        window.__practiceCommands.push({ command, args });
        if (command === "get_platform") return { os: "linux", arch: "x86_64", family: "unix" };
        if (command === "enable_keyboard_intercept")
          return { active: true, method: "gnome", platform: "linux" };
        if (command === "apply_capture_protection") return true;
        if (command === "scan_processes") return { found: [], clean: true };
        if (command === "detect_virtualization") return { detected: false, platform: null };
        if (command === "get_lockdown_restore_status") return { pending: false, items: [] };
        return null;
      },
    },
    window: {
      availableMonitors: async () => [
        {
          name: "Fixture display",
          position: { x: 0, y: 0 },
          size: { width: 1280, height: 800 },
          scaleFactor: 1,
        },
      ],
      getCurrentWindow: () => ({
        setFullscreen: done,
        setSimpleFullscreen: done,
        setAlwaysOnTop: done,
        setDecorations: done,
        setResizable: done,
        isFullscreen: async () => true,
      }),
    },
  };
  Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
    configurable: true,
    value: async () => [
      {
        kind: "videoinput",
        deviceId: "practice-camera",
        groupId: "practice",
        label: "Practice camera",
      },
    ],
  });
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: async (constraints) => {
      if (!constraints.video)
        throw new DOMException("Fixture has no microphone", "NotAllowedError");
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#303030";
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "#fff";
      ctx.font = "24px sans-serif";
      ctx.fillText("Practice camera fixture", 170, 240);
      const stream = canvas.captureStream(30);
      window.__practiceTracks.push(...stream.getTracks());
      return stream;
    },
  });
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`CDP timeout: ${method}`));
      }, 45000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails)
    throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(`Boolean(${expression})`)) return;
    } catch {}
    await delay(100);
  }
  throw Error(`Condition timeout: ${expression}`);
}
async function click(label) {
  const point = await evaluate(
    `(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim().replace(/\\s+/g,' ')===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e)throw Error('Missing control: '+${JSON.stringify(label)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point });
}
async function check(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, passed });
  assert(passed, name);
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch {
      await delay(100);
    }
  }
  assert(port, "Chrome did not start");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", ({ data }) => {
    const e = JSON.parse(data);
    if (e.id) {
      const p = pending.get(e.id);
      pending.delete(e.id);
      if (p) e.error ? p.reject(Error(e.error.message)) : p.resolve(e.result);
    }
    if (e.method === "Runtime.exceptionThrown")
      manifest.exceptions.push(
        e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text
      );
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${fixtures.toString()})(${JSON.stringify({ origin })})`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: origin + "/session/onboarding/?mode=dry-run" });
  await until("document.body.innerText.includes('Begin setup')");
  await click("Begin setup");
  await until("document.body.innerText.includes('Display check')", 10000);
  await until("document.body.innerText.includes('Single screen environment confirmed')", 6000);
  await check(
    "Stage 2 receives a policy and completes instead of staying pending",
    "document.body.innerText.includes('Single screen environment confirmed')&&!document.body.innerText.includes('Policy check unavailable')"
  );
  await until("document.body.innerText.includes('Set up your camera')", 20000);
  await until("document.body.innerText.includes('Camera ready')", 10000);
  await check(
    "Stage 7 receives camera policy and passes a working preview",
    "document.body.innerText.includes('Camera ready')&&!document.body.innerText.includes('Policy check unavailable')"
  );
  await until("document.body.innerText.includes('Position your face')", 6000);
  await check(
    "Practice continues from camera policy into Stage 8",
    "document.body.innerText.includes('Position your face')"
  );
  await check(
    "Traversal used native monitor and camera fixtures",
    "window.__practiceCommands.some(c=>c.command==='get_platform')&&window.__practiceTracks.some(t=>t.readyState==='live')"
  );
  manifest.commands = await evaluate("window.__practiceCommands");
  await evaluate("window.__practiceTracks.forEach(t=>t.stop())");
} catch (error) {
  manifest.failures.push(error.stack || String(error));
  if (ws?.readyState === WebSocket.OPEN) {
    manifest.debug = await evaluate(
      "({text:document.body.innerText,commands:window.__practiceCommands||[]})"
    ).catch(String);
  }
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!manifest.failures.length)
    await writeFile(
      path.resolve(evidenceRoot, "latest.json"),
      JSON.stringify({ directory: path.basename(output) }, null, 2) + "\n"
    );
  if (ws?.readyState === WebSocket.OPEN) {
    await send("Page.navigate", { url: "about:blank" }).catch(() => {});
    ws.close();
  }
  chrome.kill("SIGTERM");
  await delay(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(
    JSON.stringify({ checks: manifest.checks.length, failures: manifest.failures.length })
  );
}
