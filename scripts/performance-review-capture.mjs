/** Performance/lifecycle browser regressions; Node 24 + installed Chrome.
 * Run against THIS worktree's dev server:
 *   node scripts/performance-review-capture.mjs http://127.0.0.1:3010
 * Fixtures live only in a disposable browser. All external HTTP is blocked;
 * this does not test real camera, native enforcement, or cloud connectivity.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installFixtures } from './theme-p0-fixtures.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:', 'Local HTTP preview required');
const origin = base.origin;
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || '/tmp/ams-performance-review';
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ams-theme-p0-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0, scriptId, viewport;
const pending = new Map();
const manifest = { capturedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  origin, worktreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary'])).digest('hex'), fixtureOnly: true, nativeRuntimeVerified: false, captures: [], checks: [], blockedExternalRequests: [], exceptions: [], failures: [] };
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, timeout = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(`Boolean(${expression})`)) return; } catch { /* document replacing */ }
    await delay(150);
  }
  throw Error(`Condition timeout: ${expression}`);
}
async function navigate(route, { theme = 'dark', mode = 'normal', ready = 'document.body.innerText.length > 20' } = {}) {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  const config = { origin, theme, mode };
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)});(${reviewFixtures.toString()})(${JSON.stringify(config)})` })).identifier;
  const navigation = await send('Page.navigate', { url: origin + route }); console.log('Navigate', route, JSON.stringify(navigation));
  await until(`location.pathname === ${JSON.stringify(new URL(route, origin).pathname)} && document.readyState === 'complete' && (${ready})`);
  await evaluate('document.fonts.ready.then(()=>true)');
  await delay(250);
}
async function click(text, { prefix = false } = {}) {
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>${prefix ? `e.innerText.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : `e.innerText.trim().toLowerCase()===${JSON.stringify(text.toLowerCase())}`}||e.getAttribute('aria-label')===${JSON.stringify(text)}||e.title===${JSON.stringify(text)});if(!b)throw Error('Missing control: '+${JSON.stringify(text)});b.click()})()`);
  await delay(150);
}
async function fill(selector, value) {
  await until(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return e&&Object.keys(e).some(k=>k.startsWith('__reactProps$'))})()`);
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.select()})()`);
  await send('Input.insertText', { text: value });
  await delay(100);
}
async function capture(name, note = '') {
  const filename = `${viewport.width}x${viewport.height}-${name}.png`;
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(output, filename), Buffer.from(r.data, 'base64'));
  const state = await evaluate(`({route:location.pathname+location.search,theme:document.documentElement.className,themeAttributes:{mode:document.documentElement.dataset.theme,name:document.documentElement.dataset.astryxTheme},computed:{bodyFont:getComputedStyle(document.body).fontFamily,bodyBackground:getComputedStyle(document.body).backgroundColor,rootScheme:getComputedStyle(document.documentElement).colorScheme,wrapperScheme:document.querySelector('body > [data-astryx-theme]')?getComputedStyle(document.querySelector('body > [data-astryx-theme]')).colorScheme:null},fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),fontAssets:performance.getEntriesByType('resource').filter(r=>/\\.woff2?(?:\\?|$)/.test(r.name)).map(r=>r.name),text:document.body.innerText,bodyWidth:document.body.scrollWidth,viewport:[innerWidth,innerHeight],requests:window.__p0Requests||[],scrollRegions:[...document.querySelectorAll('body,main,section,article,aside,div')].filter(e=>e.scrollHeight>e.clientHeight+4&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({tag:e.tagName,class:e.className,height:e.clientHeight,scrollHeight:e.scrollHeight})).slice(0,15)})`);
  manifest.captures.push({ file: filename, note, ...state });
  console.log('Captured', filename);
}
async function recordCheck(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, viewport, passed });
  assert(passed, name);
}
function reviewFixtures(config) {
  if (location.origin !== config.origin) return;
  const original = window.fetch.bind(window);
  const started = new Date().toISOString();
  if (location.pathname.includes('/session/contest')) {
    // Hold the browser permission request while verifying the ordinary dialog.
    // No successful camera/readiness signal is fabricated; critical camera
    // overlays are tested separately, and may legitimately take focus.
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable:true, value: () => new Promise(() => {}) });
  }
  window.__reviewPolls = [];
  window.__reviewStorageWrites = 0;
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (key === 'ams_active_session') window.__reviewStorageWrites++;
    return setItem.call(this, key, value);
  };
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.pathname.endsWith('/resume-request')) {
      window.__reviewPolls.push(performance.now());
      return new Response(JSON.stringify(config.mode === 'resume-pending' ? {
        uid: 'review-request', status: 'PENDING', created_at: started, review_note: null
      } : null), { headers: { 'Content-Type': 'application/json' } });
    }
    return original(input, init);
  };
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert(port, 'Chrome did not start');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', ({ data }) => {
    const e = JSON.parse(data);
    if (e.id) { const p = pending.get(e.id); pending.delete(e.id); if (p) e.error ? p.reject(Error(e.error.message)) : p.resolve(e.result); }
    if (e.method === 'Runtime.exceptionThrown') manifest.exceptions.push({message:e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text, url:e.params.exceptionDetails.url, line:e.params.exceptionDetails.lineNumber, stack:e.params.exceptionDetails.stackTrace});
    if (e.method === 'Fetch.requestPaused') {
      const request = e.params.request;
      const requestUrl = new URL(request.url);
      const local = requestUrl.origin === origin && !requestUrl.pathname.includes('/participant/') && !requestUrl.pathname.startsWith('/api/');
      if (!local) manifest.blockedExternalRequests.push({ url: request.url, method: request.method });
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: e.params.requestId,
        ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(err => manifest.failures.push(err.message));
    }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  viewport = { width: 1440, height: 1000 };
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  await navigate('/home/', { mode: 'resume-pending', ready: "document.body.innerText.includes('Waiting for organizer approval')" });
  await delay(6500);
  const pollState = await evaluate('({polls:window.__reviewPolls,writes:window.__reviewStorageWrites})');
  assert(pollState.polls.length >= 3 && pollState.polls.length <= 5, JSON.stringify(pollState));
  // Initial hydration also reads the decision. Subsequent poll requests must be spaced out.
  const gaps = pollState.polls.slice(2).map((t, i) => t - pollState.polls[i + 1]);
  assert(gaps.every(gap => gap > 2800), JSON.stringify(pollState));
  assert(pollState.writes <= 2, JSON.stringify(pollState));
  manifest.checks.push({ name: 'Home fixed polling cadence and no repeated storage writes', passed: true, ...pollState });
  await capture('home-pending');
  await navigate('/session/contest/?contestId=p0-contest&mode=dry-run', { ready: "document.querySelector('.cm-editor') && document.body.innerText.includes('Binary Search')" });
  await evaluate("document.querySelector('.cm-content').focus()");
  await send('Input.insertText', { text: '// review typing check\n' });
  await until("Object.values(localStorage).some(value => value.includes('review typing check'))");
  manifest.checks.push({ name: 'Typing still writes crash-recovery buffer', passed: true });
  const styleSize = () => evaluate("[...document.querySelectorAll('style')].reduce((sum,e)=>sum+e.textContent.length,0)");
  const choose = async title => {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('[aria-label="Choose a question"] button')].find(e=>(e.getAttribute('aria-label')||e.innerText).includes(${JSON.stringify(title)}));if(!button)throw Error('Question missing');button.click()})()`);
    await delay(300);
  };
  await choose('Balanced Brackets'); await choose('Binary Search');
  const beforeStyles = await styleSize();
  for (let i=0;i<5;i++) { await choose('Balanced Brackets'); await choose('Binary Search'); }
  const afterStyles = await styleSize();
  assert.equal(afterStyles, beforeStyles, 'Editor styles must not accumulate on question switches');
  manifest.checks.push({ name:'Editor styles stable over repeated question switches', passed:true, beforeStyles, afterStyles });
  await capture('contest-editor');
  await navigate('/session/contest/?contestId=p0-contest&mode=dry-run', { ready: "document.querySelector('.cm-editor') && document.body.innerText.includes('Binary Search')" });
  await click('Turn camera off');
  await until("document.querySelector('[role=dialog]')");
  const dialogButtons = await evaluate("[...document.querySelectorAll('[role=dialog] button')].map(e=>e.innerText)");
  await evaluate("[...document.querySelectorAll('[role=dialog] button')].at(-1).focus();window.__reviewFocus=document.activeElement;true");
  await delay(6200);
  await recordCheck('Media confirmation retains focused action across background updates', 'document.activeElement===window.__reviewFocus');
  await capture('contest-media-focus');
  await click('Cancel');
  await capture('contest-editor');
  await send('Emulation.setDeviceMetricsOverride', { width:1280, height:800, deviceScaleFactor:1, mobile:false });
  viewport = { width:1280,height:800 };
  await delay(300);
  await recordCheck('Contest remains inside viewport after resize', 'document.body.scrollWidth <= innerWidth');
  await capture('contest-1280');
  console.log(JSON.stringify({ checks:manifest.checks, exceptions:manifest.exceptions, output }, null, 2));
} catch (error) {
  manifest.failures.push(error.stack || String(error));
  console.error(error);
  process.exitCode=1;
} finally {
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  if (ws) ws.close();
  chrome.kill();
}
