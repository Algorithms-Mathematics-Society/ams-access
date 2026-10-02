/** Sponsor UI walkthrough. Node 24 + Chrome; fixtures stay in a disposable browser.
 * Run: node scripts/sponsor-ui-verify.mjs http://127.0.0.1:3000
 * Requires the development build: React state fixtures use component names.
 * Never contacts the real API or starts a native secure session.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { installFixtures } from './theme-p0-fixtures.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['localhost', '127.0.0.1'].includes(base.hostname) && base.protocol === 'http:', 'Local HTTP only');
const origin = base.origin;
const output = path.join(process.env.AMS_SPONSOR_EVIDENCE_DIR || '/tmp/ams-sponsor-review', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ams-sponsor-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
let ws, seq = 0, scriptId, viewport;
const manifest = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixtureOnly: true, nativeRuntimeVerified: false, captures: [], checks: [], errors: [], blockedRequests: [], failures: [] };
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  const start = Date.now();
  while (Date.now() - start < 45000) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await delay(150);
  }
  throw Error(`Condition timeout: ${expression}`);
}
function isolateNativeAndRemap(config) {
  const pending = () => new Promise(() => {});
  window.__sponsorNativeCommands = [];
  window.__TAURI__ = { core: { invoke: (command, args) => { window.__sponsorNativeCommands.push({ command, args }); return pending(); } }, window: { availableMonitors: pending, getCurrentWindow: () => ({ setFullscreen: pending, isFullscreen: pending, setAlwaysOnTop: pending, setDecorations: pending, setResizable: pending }) } };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = pending;
  if (config.unknown) {
    const fetchFixture = window.fetch;
    window.fetch = async (...args) => {
      const response = await fetchFixture(...args);
      const input = args[0];
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (!url.pathname.includes('/participant/contests')) return response;
      const text = await response.text();
      return new Response(text.replaceAll('p0-contest', 'unbranded-test-contest'), { status: response.status, headers: response.headers });
    };
  }
}
async function navigate(route, ready, extra = {}) {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  const config = { origin, theme: 'dark', mode: 'normal', ...extra };
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)});(${isolateNativeAndRemap.toString()})(${JSON.stringify(config)});` })).identifier;
  await send('Page.navigate', { url: origin + route });
  await until(`location.pathname === ${JSON.stringify(new URL(route, origin).pathname)} && document.readyState === 'complete' && (${ready})`);
  await evaluate('document.fonts.ready.then(()=>true)');
  await delay(350);
}
async function fixtureState(component, file, values) {
  const source = await readFile(file, 'utf8');
  const names = [...source.matchAll(/const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\]\s*=\s*useState/g)].map(match => match[1]);
  await evaluate(`(() => {
    let fiber;
    for (const element of document.querySelectorAll('*')) {
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      for (let candidate = key && element[key]; candidate; candidate = candidate.return) {
        if (candidate.type?.name === ${JSON.stringify(component)} || candidate.type?.displayName === ${JSON.stringify(component)}) { fiber = candidate; break; }
      }
      if (fiber) break;
    }
    if (!fiber) throw Error('Missing fixture component');
    const hooks = []; for (let hook = fiber.memoizedState; hook; hook = hook.next) if (hook.queue?.dispatch) hooks.push(hook);
    const names = ${JSON.stringify(names)};
    if (hooks.length !== names.length) throw Error('Fixture hook count mismatch: ' + hooks.length + '/' + names.length);
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) {
      const index = names.indexOf(name); if (index < 0) throw Error('Unknown fixture state: ' + name);
      hooks[index].queue.dispatch(value);
    }
  })()`);
  await delay(300);
}
async function check(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, viewport, passed });
  assert(passed, name);
}
async function capture(name) {
  const file = `${viewport.width}x${viewport.height}-${name}.png`;
  const metrics = await send('Page.getLayoutMetrics');
  const height = Math.max(viewport.height, Math.min(metrics.cssContentSize.height, 3000));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: viewport.width, height, scale: 1 } });
  await writeFile(path.join(output, file), Buffer.from(shot.data, 'base64'));
  const state = await evaluate(`({url:location.href,text:document.body.innerText,sponsors:[...document.querySelectorAll('[data-contest-sponsor]')].map(e=>({text:e.innerText,rect:e.getBoundingClientRect().toJSON(),images:[...e.querySelectorAll('img')].map(i=>({alt:i.alt,loaded:i.complete&&i.naturalWidth>0,rect:i.getBoundingClientRect().toJSON()}))}))})`);
  manifest.captures.push({ file, ...state });
  console.log('Captured', file);
}
async function bounds(name) {
  await check(`${name}: no horizontal overflow`, 'document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth');
  await check(`${name}: sponsor is non-interactive and fits`, `[...document.querySelectorAll('[data-contest-sponsor]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&!e.querySelector('a,button,[tabindex="0"]')})`);
}
const onboarding = 'apps/web/src/app/session/onboarding/page.tsx';
const contest = 'apps/web/src/app/session/contest/client.tsx';
const count = "document.querySelectorAll('[data-contest-sponsor]').length";
const introRoute = '/session/onboarding/?contestId=p0-contest';
const contestRoute = '/session/contest/?contestId=p0-contest&mode=dry-run';
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert(port, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const item = pending.get(event.id); pending.delete(event.id); if (item) event.error ? item.reject(Error(event.error.message)) : item.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') manifest.errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === 'Fetch.requestPaused') {
      const url = new URL(event.params.request.url);
      const local = url.origin === origin && !url.pathname.includes('/participant/') && !url.pathname.startsWith('/api/');
      if (!local) manifest.blockedRequests.push(event.params.request.url);
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: event.params.requestId, ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(error => manifest.failures.push(error.message));
    }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] });
  for (viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 640, height: 400 }]) {
    // 640x400 at DPR 2 represents a 1280x800 desktop at 200% zoom.
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: viewport.width === 640 ? 2 : 1, mobile: false });
    await navigate('/home/', "document.body.innerText.includes('P0 Preview')");
    await check('Home: exactly one sponsored contest', `${count} === 1`);
    await check('Home: logo loaded', "[...document.querySelectorAll('[data-contest-sponsor] img')].some(i=>i.complete&&i.naturalWidth>0)");
    await bounds('Home'); await capture('home');
    if (viewport.width < 768) {
      await evaluate("document.querySelector('[data-contest-sponsor]').scrollIntoView({block:'center'})");
      await delay(150);
      await check('Narrow Home: sponsor reachable by scrolling', "(()=>{const r=document.querySelector('[data-contest-sponsor]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()");
      await capture('home-sponsor-in-view');
    }
    await navigate(introRoute, "document.body.innerText.includes('Begin setup') && document.body.innerText.includes('P0 Preview')");
    await check('Introduction: one sponsor', `${count} === 1`);
    await bounds('Introduction'); await capture('introduction');
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Begin setup').click()");
    await until("!document.body.innerText.includes('Begin setup')");
    await check('Device check: no sponsor', `${count} === 0`); await capture('device-check');
    const upcoming = await evaluate("(async()=>{const c=await (await fetch('/participant/contests/p0-contest')).json();return {...c,phase:'verification',starts_at:new Date(Date.now()+600000).toISOString()}})()");
    await fixtureState('OnboardingPage', onboarding, { contestIndex: upcoming, currentStage: 13, readyForStart: true, waitMs: 600000, results: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 'pass'])), contestWindow: { startAt: new Date(Date.now() + 600000).toISOString(), endAt: new Date(Date.now() + 7200000).toISOString(), verificationWindowMinutes: 30 } });
    await check('Waiting: one sponsor', `${count} === 1`);
    await check('Waiting: countdown remains visible', "document.body.innerText.includes('Starts in')");
    await bounds('Waiting'); await capture('waiting');
    if (viewport.width < 768) continue; // Workspace has a desktop minimum; mobile onboarding still checked.
    await navigate(contestRoute, "document.querySelector('.cm-editor') && document.body.innerText.includes('Binary Search')");
    await check('Active workspace: no sponsor', `${count} === 0`); await bounds('Workspace'); await capture('workspace');
    await fixtureState('ContestPageClient', contest, { timeUpState: 'submitted', finalDraftSaved: true });
    await check('Confirmed finish: one sponsor', `${count} === 1`);
    await check('Confirmed finish: acknowledgement precedes sponsor', "document.body.innerText.indexOf('Session finish confirmed') < document.body.innerText.indexOf('This round')");
    await bounds('Confirmed finish'); await capture('finish-confirmed');
    await fixtureState('ContestPageClient', contest, { submitWarning: 'Latest draft save was not acknowledged.' });
    await check('Finish with save warning: no sponsor', `${count} === 0`); await capture('finish-warning');
    await fixtureState('ContestPageClient', contest, { timeUpState: 'error', submitWarning: null });
    await check('Unconfirmed finish: no sponsor', `${count} === 0`); await capture('finish-error');
  }
  viewport = { width: 1280, height: 800 };
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await navigate('/session/onboarding/?mode=dry-run', "document.body.innerText.includes('Begin setup')");
  await check('Practice setup without contest: no sponsor', `${count} === 0`);
  await navigate(introRoute + '&mode=dry-run', "document.body.innerText.includes('Begin setup') && document.body.innerText.includes('P0 Preview')");
  await check('Practice setup for branded contest: no sponsor', `${count} === 0`);
  await navigate('/home/', "document.body.innerText.includes('P0 Preview')", { unknown: true });
  await check('Unknown contest: no sponsor', `${count} === 0`); await capture('unknown-contest');
  await navigate('/session/onboarding/?contestId=unbranded-test-contest', "document.body.innerText.includes('Begin setup') && document.body.innerText.includes('P0 Preview')", { unknown: true });
  await check('Unknown onboarding contest: no sponsor', `${count} === 0`);
  await navigate(introRoute, "document.body.innerText.includes('Begin setup') && document.body.innerText.includes('P0 Preview')");
  await fixtureState('OnboardingPage', onboarding, { policyBlock: 'Your device needs attention before you can continue.' });
  await check('Blocked onboarding: no sponsor', `${count} === 0`);
  await navigate(introRoute, "document.body.innerText.includes('Begin setup') && document.body.innerText.includes('P0 Preview')", { theme: 'light' });
  await check('Light preference on dark-locked surface: logo loaded', "[...document.querySelectorAll('[data-contest-sponsor] img')].some(i=>i.complete&&i.naturalWidth>0)");
  await bounds('Light introduction'); await capture('introduction-light');
  await evaluate("document.querySelector('[data-contest-sponsor] img').dispatchEvent(new Event('error'))");
  await until("document.querySelector('[data-contest-sponsor]')?.innerText.includes('Jane Street')");
  await check('Logo failure: visible name fallback', "document.querySelector('[data-contest-sponsor]').innerText.includes('Jane Street')");
  await bounds('Fallback'); await capture('logo-fallback');
  assert.equal(manifest.errors.length, 0, 'No browser runtime exceptions');
} catch (error) {
  manifest.failures.push(error.stack); console.error(error);
  if (ws?.readyState === WebSocket.OPEN) console.error(await evaluate('({url:location.href,text:document.body.innerText})').catch(String));
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ output, captures: manifest.captures.length, checks: manifest.checks.length, failures: manifest.failures.length }));
}
