/** Capture-only baseline runner; Node 24 + installed Chrome; no extra dependencies.
 * Run: node scripts/theme-p1-verify.mjs http://127.0.0.1:3000
 * Fixtures exist exclusively in this disposable browser, never in the live app.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installFixtures } from './theme-p0-fixtures.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:', 'Local HTTP preview required');
const origin = base.origin;
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/theme-p1/verification';
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const previewDir = path.resolve('apps/web/src/app/theme-preview');
const previewRoute = path.join(previewDir, 'page.tsx');
let mountedPreview = false;
const profile = await mkdtemp(path.join(tmpdir(), 'ams-theme-p0-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0, scriptId, viewport;
let blockScripts = false;
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
  let navigation = await send('Page.navigate', { url: origin + route });
  if (navigation.errorText === 'net::ERR_ABORTED') { await delay(300); navigation = await send('Page.navigate', {url:origin+route}); }
  assert(!navigation.errorText, 'Navigation failed: ' + navigation.errorText);
  console.log('Navigate', route, JSON.stringify(navigation));
  await until(`location.pathname === ${JSON.stringify(new URL(route, origin).pathname)} && document.readyState === 'complete' && (${ready})`);
  await evaluate('document.fonts.ready.then(()=>true)');
  await delay(250);
}
async function click(text, { prefix = false } = {}) {
  const point = await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(e=>${prefix ? `e.innerText.trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : `e.innerText.trim().toLowerCase()===${JSON.stringify(text.toLowerCase())}`}||e.getAttribute('aria-label')===${JSON.stringify(text)}||e.title===${JSON.stringify(text)});if(!b)throw Error('Missing control: '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
  await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
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
  const state = await evaluate(`({route:location.pathname+location.search,theme:document.documentElement.className,themeAttributes:{mode:document.documentElement.dataset.theme,name:document.documentElement.dataset.astryxTheme},computed:{bodyFont:getComputedStyle(document.body).fontFamily,bodyBackground:getComputedStyle(document.body).backgroundColor,rootScheme:getComputedStyle(document.documentElement).colorScheme,wrapperScheme:document.querySelector('body > [data-astryx-theme]')?getComputedStyle(document.querySelector('body > [data-astryx-theme]')).colorScheme:null},text:document.body.innerText,bodyWidth:document.body.scrollWidth,viewport:[innerWidth,innerHeight],requests:window.__p0Requests||[],scrollRegions:[...document.querySelectorAll('body,main,section,article,aside,div')].filter(e=>e.scrollHeight>e.clientHeight+4&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({tag:e.tagName,class:e.className,height:e.clientHeight,scrollHeight:e.scrollHeight})).slice(0,15)})`);
  manifest.captures.push({ file: filename, note, ...state });
  console.log('Captured', filename);
}
async function recordCheck(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, viewport, passed });
  assert(passed, name);
}
try {
  await mkdir(previewDir, { recursive: true });
  await writeFile(previewRoute, 'export { default } from "../../../theme-p1/PrimitivePreview";\n', { flag: 'wx' });
  mountedPreview = true;
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
      const local = !(blockScripts && e.params.resourceType === 'Script') && requestUrl.origin === origin && !requestUrl.pathname.includes('/participant/') && !requestUrl.pathname.startsWith('/api/');
      if (!local) manifest.blockedExternalRequests.push({ url: request.url, method: request.method });
      void send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: e.params.requestId,
        ...(local ? {} : { errorReason: 'BlockedByClient' }) }).catch(err => manifest.failures.push(err.message));
    }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: 'http*', requestStage: 'Request' }] });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  viewport = { width: 1280, height: 800 };
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
  const modeExpression = mode => `document.documentElement.dataset.theme==='${mode}'&&getComputedStyle(document.documentElement).colorScheme==='${mode}'&&getComputedStyle(document.querySelector('body > [data-astryx-theme]')).colorScheme==='${mode}'`;
  for (const theme of ['light', 'dark']) {
    await navigate('/theme-preview/', { theme, ready: "document.body.innerText.includes('P1 shared control review')" });
    await until("[...document.querySelectorAll('button')].some(e=>Object.keys(e).some(k=>k.startsWith('__reactProps$')))");
    await capture('primitives-' + theme);
    await recordCheck(theme + ' effective scheme and wrapper inheritance', modeExpression(theme));
    await recordCheck(theme + ' local Geist font', "getComputedStyle(document.body).fontFamily.includes('Geist')");
    await recordCheck(theme + ' disabled control', "[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Disabled action'))?.disabled");
    await click('Primary action');
    await recordCheck(theme + ' button action', "document.body.textContent.includes('Last action: Primary')");
    await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'ArrowRight', code:'ArrowRight', windowsVirtualKeyCode:39 });
    await recordCheck(theme + ' tab keyboard moves focus', "document.activeElement.textContent.includes('Details')");
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
    await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
    await until("document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Details')");
    await recordCheck(theme + ' tab activates associated panel', "[...document.querySelectorAll('[role=tabpanel]')].some(e=>!e.hidden&&e.textContent.includes('Details'))");
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Tooltip trigger')).focus()");
    await until("document.querySelector('[role=tooltip]')");
    await capture('tooltip-' + theme);
    await click('Open preview dialog');
    await until("document.querySelector('dialog[open]')");
    await capture('dialog-' + theme);
    await recordCheck(theme + ' dialog inherits host', `getComputedStyle(document.querySelector('dialog[open]')).colorScheme==='${theme}'`);
    await recordCheck(theme + ' dialog starts with focus inside', "document.querySelector('dialog[open]').contains(document.activeElement)");
    const focusSamples = [];
    for (let i=0;i<8;i++) {
      await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
      await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
      const focus = await evaluate("({inside:document.querySelector('dialog[open]').contains(document.activeElement),focused:document.hasFocus(),tag:document.activeElement.tagName,text:document.activeElement.textContent.slice(0,80)})");
      focusSamples.push(focus.inside);
      assert(focus.inside || focus.tag === 'BODY', 'Dialog reached background control: ' + JSON.stringify(focus));
      assert(await evaluate("document.querySelector('dialog[open]').matches(':modal')"), 'Dialog lost native modality');
    }
    const firstBoundary = focusSamples.indexOf(false);
    assert(firstBoundary < 0 || focusSamples.slice(firstBoundary+1).some(Boolean), 'Focus did not return to a dialog control after browser boundary');
    await recordCheck(theme + ' native dialog isolates background controls', "document.querySelector('dialog[open]').matches(':modal')&&(document.querySelector('dialog[open]').contains(document.activeElement)||document.activeElement===document.body)");
    // Native modal dialogs may cycle through browser chrome; restore content focus for Escape.
    await send('Page.bringToFront');
    await evaluate("document.querySelector('dialog[open] input').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until("!document.querySelector('dialog[open]')");
    await until("document.activeElement.textContent.includes('Open preview dialog')&&document.activeElement.tagName==='BUTTON'",5000);
    await recordCheck(theme + ' dialog restores focus', "document.activeElement.textContent.includes('Open preview dialog')");
  }
  await navigate('/theme-preview/', { theme: 'light', ready: "document.body.innerText.includes('P1 shared control review')" });
  await click('Preview locked Home');
  await until("location.pathname==='/home/'&&document.documentElement.classList.contains('theme-dark-locked')");
  await recordCheck('SPA entry locks dark without replacing saved preference', modeExpression('dark') + "&&localStorage.getItem('ams_theme')==='light'");
  await capture('home-saved-light-locked');
  const history = await send('Page.getNavigationHistory');
  await send('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex-1].id });
  await until("location.pathname==='/theme-preview/'&&!document.documentElement.classList.contains('theme-dark-locked')");
  await recordCheck('SPA return restores light preference', modeExpression('light'));
  await click('Switch to dark theme');
  await until(modeExpression('dark'));
  await recordCheck('Toggle persists dark', "localStorage.getItem('ams_theme')==='dark'");
  await evaluate("localStorage.setItem('ams_theme','light');window.dispatchEvent(new StorageEvent('storage',{key:'ams_theme',newValue:'light'}))");
  await until(modeExpression('light'));
  await recordCheck('Storage updates theme', modeExpression('light'));
  await evaluate("localStorage.removeItem('ams_theme');window.dispatchEvent(new StorageEvent('storage',{key:'ams_theme',newValue:null}))");
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await until(modeExpression('dark'));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await until(modeExpression('light'));
  await recordCheck('System preference followed without saved override', modeExpression('light'));
  // Block external Next scripts while retaining inline pre-paint initialization and CSS.
  blockScripts = true;
  for (const [route, expected] of [['/login/', 'light'], ['/home/', 'dark']]) {
    await send('Page.navigate', {url:'about:blank'});
    await until("location.href==='about:blank'");
    await navigate(route, {theme:'light',ready:"document.querySelector('body > [data-astryx-theme]')"});
    await recordCheck('Pre-hydration ' + route + ' scheme', modeExpression(expected));
    await capture('before-hydration-' + expected, 'Next scripts blocked; inline initialization and CSS only');
  }
  blockScripts = false;
} catch (err) { manifest.failures.push(err.stack); console.error(err); if(ws?.readyState===WebSocket.OPEN){ console.error('DOM',await evaluate('({url:location.href,state:document.readyState,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,3000)})').catch(String)); } process.exitCode = 1; }
finally {
  if (mountedPreview) { try { await rm(previewRoute); await rmdir(previewDir); } catch (error) { manifest.failures.push('Preview cleanup: ' + error.message); process.exitCode = 1; } }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks, failures: manifest.failures.length }));
}
