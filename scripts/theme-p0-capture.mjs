/** Capture-only baseline runner; Node 24 + installed Chrome; no extra dependencies.
 * Run: node scripts/theme-p0-capture.mjs http://127.0.0.1:3000
 * Fixtures exist exclusively in this disposable browser, never in the live app.
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
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/theme-p0/baselines';
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
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)})` })).identifier;
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
  for (viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 1000 }]) {
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['dark', 'light']) {
      await navigate('/', { theme, ready: "document.querySelector('.welcome-root')" }); await delay(650); await capture('welcome-' + theme);
      await navigate('/login/', { theme, ready: "document.querySelector('#login-id')" }); await capture('login-' + theme);
      await fill('#login-id', 'Ayush.S-KQMWD@access');
      await recordCheck('Full handle input normalizes and fixed suffix remains (CDP text input, not clipboard)', "document.querySelector('#login-id').value==='ayush.s-kqmwd'&&document.querySelector('.login-handle-suffix').innerText==='@access'");
      await capture('login-handle-' + theme);
      await click("Can't sign in? Get help"); await capture('login-help-' + theme);
    }
    await navigate('/login/', { mode: 'login-loading', ready: "document.querySelector('#login-id')" });
    await fill('#login-id', 'preview'); await fill('#login-password', 'ABCD-EFGH-JKLM'); await click('Sign in');
    await until("document.body.innerText.toLowerCase().includes('signing in')"); await capture('login-loading', 'Fixture promise held pending; no external login call');
    await navigate('/login/', { ready: "document.querySelector('#login-id')" });
    await fill('#login-id', 'preview'); await fill('#login-password', 'ABCD-EFGH-JKLM'); await click('Sign in');
    await until("document.querySelector('[role=alert]')"); await capture('login-error');
    for (const mode of ['empty', 'loading', 'error', 'normal']) {
      await navigate('/home/', { mode, ready: "document.body.innerText.includes('SYSTEM INTEGRITY HUB')" });
      if (mode !== 'loading') await delay(500);
      await capture('home-' + mode, 'Native telemetry unavailable in browser; no successful native checks simulated');
    }
    await click('Enter Contest'); await capture('home-preflight-blocked');
    await navigate('/home/', { ready: "document.body.innerText.includes('Enter Contest')" });
    await click('Resolve'); await capture('home-resolve');
    await navigate('/home/', { ready: "document.body.innerText.includes('Enter Contest')" });
    await click('Settings'); await capture('settings-hardware');
    for (const [name, label] of [['permissions', 'Permissions Check'], ['security', 'Security Environment'], ['about', 'About / Legal'], ['device', 'Device']]) {
      await click(label); await capture('settings-' + name);
    }
    await navigate('/session/onboarding/?mode=dry-run', { ready: "document.body.innerText.includes('Begin setup')" }); await capture('onboarding-intro');
    await click('Begin setup'); await capture('onboarding-fullscreen', 'Browser-only stage appearance, not native fullscreen validation');
    const contestRoute = '/session/contest/?contestId=p0-contest&mode=dry-run';
    await navigate(contestRoute, { ready: "document.querySelector('.cm-editor')&&document.body.innerText.includes('Binary Search')" });
    await capture('contest-workspace');
    await click('Attempts', { prefix: true });
    await until("document.body.innerText.includes('PROBLEM A')&&document.body.innerText.includes('Attempt #1')"); await capture('contest-attempts-a');
    await recordCheck('A shows its populated attempt', "document.body.innerText.includes('PROBLEM A')&&document.body.innerText.includes('Attempt #1')");
    await click('B\nBalanced Brackets');
    await until("document.body.innerText.includes('No attempts on B yet')"); await capture('contest-attempts-b-empty');
    await recordCheck('B does not show A attempt', "document.body.innerText.includes('No attempts on B yet')&&document.body.innerText.includes('This list shows only problem B')&&!document.body.innerText.includes('Attempt #1')");
    for (const [name, action] of [['editor-settings', 'Editor settings'], ['support', 'Request support'], ['exit-confirm', 'Submit and exit contest']]) {
      await navigate(contestRoute, { ready: "document.querySelector('.cm-editor')" }); await click(action); await capture('contest-' + name);
    }
    await navigate(contestRoute, { ready: "document.querySelector('.cm-editor')" });
    await click('Collapse questions list'); await click('Collapse output panel'); await capture('contest-collapsed');
    await navigate('/session/contest/', { ready: "document.body.innerText.includes('Contest Load Error')" }); await capture('contest-load-error');
    for (const [name, theme, mode] of [['dark','dark','normal'], ['light','light','normal'], ['empty','dark','results-empty'], ['loading','dark','results-loading'], ['error','dark','results-error']]) {
      await navigate('/results/?contestId=p0-contest', { theme, mode,
        ready: mode === 'results-loading' ? "document.body.innerText.includes('Loading results')" : mode === 'results-error' ? "document.body.innerText.includes('Could not load')" : "document.body.innerText.includes('Binary Search')" });
      await capture('results-' + name);
    }
    for (const route of ['privacy', 'terms', 'licenses']) {
      await navigate('/' + route + '/', { ready: "document.querySelector('.legal-shell')" }); await capture(route, 'Existing fixed light legal surface while saved theme is dark');
    }
  }
  assert.equal(manifest.captures.length, 78, 'Both viewport capture sets must be complete');
} catch (err) { manifest.failures.push(err.stack); console.error(err); if(ws?.readyState===WebSocket.OPEN){ console.error('DOM',await evaluate('({url:location.href,state:document.readyState,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,3000)})').catch(String)); } process.exitCode = 1; }
finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks, failures: manifest.failures.length }));
}
