/** Rendered setup-scroll regression. Starts a disposable local Next/Chrome session.
 * Run from the repository root: node scripts/onboarding-scroll-verify.mjs
 * Native/media operations are held pending; no real checks or lockdown run.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { installFixtures } from "./theme-p0-fixtures.mjs";

const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const chromePath =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
  ].find(existsSync);
assert(chromePath, "Install Chrome/Edge or set CHROME_PATH");
const profile = await mkdtemp(path.join(tmpdir(), "ams-setup-scroll-"));
const origin = "http://127.0.0.1:3197";
const server = spawn(
  process.execPath,
  [requireWeb.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3197"],
  {
    cwd: path.resolve("apps/web"),
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let serverLog = "";
server.stdout.on("data", (data) => {
  serverLog += data;
});
server.stderr.on("data", (data) => {
  serverLog += data;
});
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws,
  seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`CDP timeout: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(check, message) {
  for (let i = 0; i < 180; i++) {
    if (await check()) return;
    await delay(500);
  }
  throw Error(`Timed out: ${message}`);
}
function nativeFixtures() {
  const pending = () => new Promise(() => {});
  window.__TAURI__ = {
    core: { invoke: pending },
    window: {
      availableMonitors: pending,
      getCurrentWindow: () => ({
        setFullscreen: pending,
        isFullscreen: pending,
        setAlwaysOnTop: pending,
        setDecorations: pending,
        setResizable: pending,
      }),
    },
  };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = pending;
}
const source = await readFile("apps/web/src/app/session/onboarding/page.tsx", "utf8");
const stateNames = [
  ...source.matchAll(/const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\]\s*=\s*useState/g),
].map((match) => match[1]);
async function setState(values) {
  await evaluate(`(() => {
    let fiber;
    for (const element of document.querySelectorAll('*')) {
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      for (let f = element[key]; f; f = f.return) if (f.type?.name === 'OnboardingPage') { fiber = f; break; }
      if (fiber) break;
    }
    if (!fiber) throw Error('Missing OnboardingPage');
    const hooks = [];
    for (let h = fiber.memoizedState; h; h = h.next) if (h.queue?.dispatch) hooks.push(h);
    const names = ${JSON.stringify(stateNames)};
    if (hooks.length !== names.length) throw Error('Fixture hook count mismatch');
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) hooks[names.indexOf(name)].queue.dispatch(value);
  })()`);
  await delay(300);
}
async function wheel(selector, deltaY) {
  const point = await evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: Math.max(1, Math.min(innerHeight - 1, r.y + r.height / 2)) };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaY, deltaX: 0 });
  await delay(250);
}
try {
  await until(async () => {
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "Next preview");
  let port;
  await until(async () => {
    try {
      port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0];
      return !!port;
    } catch {
      return false;
    }
  }, "Chrome");
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (item)
        message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);
    }
    if (message.method === "Fetch.requestPaused") {
      const url = new URL(message.params.request.url);
      const local =
        url.origin === origin &&
        !url.pathname.includes("/participant/") &&
        !url.pathname.startsWith("/api/");
      void send(local ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: message.params.requestId,
        ...(local ? {} : { errorReason: "BlockedByClient" }),
      }).catch(() => {});
    }
  });
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "http*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${installFixtures.toString()})(${JSON.stringify({ origin, theme: "dark", mode: "normal" })});(${nativeFixtures.toString()})();`,
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: `${origin}/session/onboarding/?contestId=p0-contest` });
  await until(
    () => evaluate("document.body?.innerText.includes('Begin setup')"),
    "setup introduction"
  );
  await evaluate(
    "[...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Begin setup').click()"
  );
  const results = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i + 1, "pass"]));
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1280, height: 500 },
    { width: 900, height: 500 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      ...viewport,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await setState({ currentStage: 12, results, dryRunComplete: false, policyBlock: null });
    await until(
      () => evaluate("document.body.innerText.includes('Your setup checks passed')"),
      "passed checks"
    );
    const stage = '[data-onboarding-stage="12"]';
    await evaluate(
      "document.querySelectorAll('[data-onboarding-page], [data-onboarding-page] *').forEach(e => { e.scrollTop = 0; })"
    );
    await wheel(stage, 4000);
    assert(
      await evaluate(
        "[...document.querySelectorAll('[data-onboarding-page], [data-onboarding-page] *')].some(e => e.scrollTop > 0)"
      ),
      `Wheel must scroll review at ${viewport.width}x${viewport.height}`
    );
    const reachable = await evaluate(`(() => {
      const e = [...document.querySelectorAll('${stage} button')].find(e => e.textContent.trim() === 'Continue');
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })()`);
    assert(reachable, `Continue must be reachable at ${viewport.width}x${viewport.height}`);
    await setState({ dryRunComplete: true });
    await evaluate(
      "document.querySelectorAll('[data-onboarding-page], [data-onboarding-page] *').forEach(e => { e.scrollTop = 0; })"
    );
    await wheel("[data-onboarding-page]", 4000);
    assert(
      await evaluate(
        "[...document.querySelectorAll('[data-onboarding-page], [data-onboarding-page] *')].some(e => e.scrollTop > 0)"
      ),
      `Wheel must scroll practice summary at ${viewport.width}x${viewport.height}`
    );
    assert(
      await evaluate(`(() => {
      const e = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Back to home');
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })()`),
      `Back to home must be reachable at ${viewport.width}x${viewport.height}`
    );
    console.log(`PASS review and practice summary: ${viewport.width}x${viewport.height}`);
  }
} catch (error) {
  console.error(serverLog.slice(-4000));
  throw error;
} finally {
  ws?.close();
  for (const child of [chrome, server]) {
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      } catch {
        /* already exited */
      }
    } else child.kill();
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
