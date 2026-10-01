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
import { installDashboardFixtures } from './dashboard-ui-fixtures.mjs';

const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:', 'Local HTTP preview required');
const origin = base.origin;
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/dashboard-ui/evidence';
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
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)});(${installDashboardFixtures.toString()})(${JSON.stringify(config)})` })).identifier;
  const navigation = await send('Page.navigate', { url: origin + route }); console.log('Navigate', route, JSON.stringify(navigation));
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
  const state = await evaluate(`({route:location.pathname+location.search,theme:document.documentElement.className,themeAttributes:{mode:document.documentElement.dataset.theme,name:document.documentElement.dataset.astryxTheme},computed:{bodyFont:getComputedStyle(document.body).fontFamily,bodyBackground:getComputedStyle(document.body).backgroundColor,rootScheme:getComputedStyle(document.documentElement).colorScheme,wrapperScheme:document.querySelector('body > [data-astryx-theme]')?getComputedStyle(document.querySelector('body > [data-astryx-theme]')).colorScheme:null},fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),fontAssets:performance.getEntriesByType('resource').filter(r=>/\\.woff2?(?:\\?|$)/.test(r.name)).map(r=>r.name),text:document.body.innerText,bodyWidth:document.body.scrollWidth,viewport:[innerWidth,innerHeight],requests:window.__p0Requests||[],scrollRegions:[...document.querySelectorAll('body,main,section,article,aside,div')].filter(e=>e.scrollHeight>e.clientHeight+4&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>({tag:e.tagName,class:e.className,height:e.clientHeight,scrollHeight:e.scrollHeight})).slice(0,15)})`);
  manifest.captures.push({ file: filename, note, ...state });
  console.log('Captured', filename);
}
async function recordCheck(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, viewport, passed });
  assert(passed, name);
}
async function key(key, shift = false) {
  await send('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:key==='Escape'?27:key==='Tab'?9:13,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key,code:key});
  await delay(100);
}
async function contrastAudit(selector = ".astryx-app-shell *") {
  await delay(350); // Wait for overlay fade-in before sampling effective opacity.
  const results = await evaluate(`(()=>{
    const ctx=document.createElement('canvas').getContext('2d');
    function rgba(color){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v)}
    function mix(f,b){return f.slice(0,3).map((c,i)=>c*f[3]+b[i]*(1-f[3])).concat(1)}
    function lum(c){return c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)}
    const results=[];
    for(const el of document.querySelectorAll(${JSON.stringify(selector)})){
      if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||!el.getClientRects().length||el.closest('[aria-hidden=true],button:disabled,[aria-disabled=true]'))continue;
      const style=getComputedStyle(el);if(style.visibility!=='visible')continue;
      let stack=[],ancestor=el,opacity=1;while(ancestor){const s=getComputedStyle(ancestor);stack.push(rgba(s.backgroundColor));opacity*=Number(s.opacity);ancestor=ancestor.parentElement}
      if(opacity<.99)continue;
      let bg=[255,255,255,1];for(const c of stack.reverse())bg=mix(c,bg);
      const fg=mix(rgba(style.color),bg),ratio=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);
      const large=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700);
      results.push({text:el.textContent.trim().slice(0,100),ratio:Number(ratio.toFixed(2)),minimum:large?3:4.5,color:style.color,background:bg.slice(0,3)});
    }return results;
  })()`);
  manifest.contrast ??= [];
  manifest.contrast.push({viewport,selector,results});
  assert(results.length>10,'Contrast audit found text');
  assert(results.every(r=>r.ratio>=r.minimum),JSON.stringify(results.filter(r=>r.ratio<r.minimum)));
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
  for (viewport of [{width:1440,height:1000},{width:1280,height:800},{width:800,height:700},{width:390,height:844}]) {
    await send('Emulation.setDeviceMetricsOverride', {...viewport,deviceScaleFactor:1,mobile:false});
    await navigate('/home/', {ready:"document.body.innerText.includes('Enter Contest')"});
    await delay(400);
    await capture('dashboard');
    await recordCheck('No horizontal page overflow', 'document.body.scrollWidth <= innerWidth && [...document.querySelectorAll(".astryx-app-shell")].every(e=>e.scrollWidth<=e.clientWidth)' );
    await recordCheck('Practice is explicitly untimed without invalid dates', "document.body.innerText.includes('Practice · untimed')&&!/NaN|Invalid Date/.test(document.body.innerText)");
    await contrastAudit();
    await recordCheck('Passed checks start collapsed', "(()=>{const a=document.querySelector('aside[aria-label=\"Device readiness\"]');return [...a.querySelectorAll('button')].some(b=>b.textContent.includes('check passed')&&b.getAttribute('aria-expanded')==='false')})()");
    await evaluate("(()=>{const b=[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('check passed'));b.focus()})()");
    await key('Enter');await delay(250);
    await recordCheck('Passed checks expand with the keyboard', "(()=>{const a=document.querySelector('aside[aria-label=\"Device readiness\"]');return a.innerText.includes('Network connection')&&[...a.querySelectorAll('button')].some(b=>b.textContent.includes('check passed')&&b.getAttribute('aria-expanded')==='true')})()");
    await capture('passed-checks');
    await key('Enter');await delay(250);
    await recordCheck('Passed checks collapse without losing focus', "document.activeElement.getAttribute('aria-expanded')==='false'");
    const requestsBefore = await evaluate("window.__p0Requests.filter(r=>r.path.endsWith('/participant/contests')).length");
    await fill('input', 'practice');
    await recordCheck('Search filters contests locally', "document.querySelector('[aria-label=Contests]').innerText.includes('Practice environment')&&!document.querySelector('[aria-label=Contests]').innerText.includes('P0 Preview')");
    await fill('input', 'no-matching-contest');
    await recordCheck('Search has its own empty state', "document.body.innerText.includes('No matching contests')");
    await capture('search-empty');
    await click('Clear Search contests');
    await recordCheck('Clear restores rows and input focus', "document.activeElement.tagName==='INPUT'&&document.querySelector('[aria-label=Contests]').innerText.includes('P0 Preview')");
    assert.equal(await evaluate("window.__p0Requests.filter(r=>r.path.endsWith('/participant/contests')).length"),requestsBefore,'Search must not fetch contests');
    if(viewport.width>1024){
      await recordCheck('Navigation starts as a compact rail', "!!document.querySelector('[aria-label=\"Expand sidebar\"]')");
      await click('Expand sidebar');
      await capture('expanded-nav');
      await click('Collapse sidebar');
      await recordCheck('Navigation rail collapses again', "!!document.querySelector('[aria-label=\"Expand sidebar\"]')");
      await click('Settings');
      await recordCheck('Settings destination works', "document.querySelector('h1,[aria-level=\"1\"]').textContent==='Settings'");
      await click('Device');
      await recordCheck('Device destination works', "document.querySelector('h1,[aria-level=\"1\"]').textContent==='Device diagnostics'");
      await click('Home');
    }else{
      await click('Open navigation');
      await capture('mobile-navigation');
      await click('Settings');
      await recordCheck('Mobile navigation selects a destination and closes', "document.querySelector('h1,[aria-level=\"1\"]').textContent==='Settings'&&!document.querySelector('dialog[open]')");
      await click('Open navigation');await click('Home');
    }
    await click('Enter Contest');
    await until("document.querySelector('[aria-labelledby=session-readiness-title]')");
    await delay(300);
    await recordCheck('Preflight blocks entry without a readiness report', "!document.querySelector('[aria-labelledby=session-readiness-title] a[href*=onboarding]')");
    await recordCheck('Missing report is explicitly unverified', "document.querySelector('[aria-labelledby=session-readiness-title]').innerText.includes('Readiness report unavailable')");
    await recordCheck('Preflight content has no horizontal clipping', "(()=>{const p=document.querySelector('[aria-labelledby=session-readiness-title] .astryx-card');return p.scrollWidth<=p.clientWidth})()");
    await contrastAudit('[aria-labelledby=session-readiness-title] *');
    await capture('preflight-blocked');
    await key('Escape');
    await until("!document.querySelector('[aria-labelledby=session-readiness-title]')");
    // A second click must still open recovery after preflight dismissal.
    await click('Resolve camera');
    await until("document.querySelector('[aria-labelledby=resolve-modal-title]')");
    await contrastAudit('[aria-labelledby=resolve-modal-title] *');
    await capture('resolve-camera');
    await key('Escape');
    await recordCheck('Recovery Escape closes and restores focus', "!document.querySelector('[aria-labelledby=resolve-modal-title]')&&document.activeElement.getAttribute('aria-label')==='Resolve camera'");
  }
  viewport={width:1280,height:800};
  await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  for(const [mode,expected] of [['empty','No contests yet'],['loading','Loading your contests'],['error','Contests unavailable'],['states','Upcoming contest'],['long','Contest-'],['resume-pending','Awaiting Approval'],['resume-rejected','Organizer rejected']]) {
    await navigate('/home/',{mode,ready:`document.body.innerText.includes(${JSON.stringify(expected)})`});
    await delay(300);await capture(mode);
    await recordCheck(mode+' does not overflow', 'document.body.scrollWidth<=innerWidth && [...document.querySelectorAll(".astryx-layout-content")].every(e=>e.scrollWidth<=e.clientWidth)' );
    if(mode==='states'){
      await recordCheck('Scheduled, verification, ended, unavailable states are distinct', "['Not open yet','Begin Verification','View Results','Unavailable'].every(t=>[...document.querySelectorAll('button')].some(b=>b.textContent.includes(t)))");
      await recordCheck('Unavailable and not-open actions remain disabled', "['Not open yet','Unavailable'].every(t=>[...document.querySelectorAll('button')].filter(b=>b.textContent.includes(t)).every(b=>b.disabled||b.getAttribute('aria-disabled')==='true'))");
    }
    if(mode==='resume-pending')await recordCheck('Pending approval disables resume', "[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Awaiting Approval')).disabled");
  }
  viewport={width:900,height:500};
  await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  await navigate('/home/',{ready:"document.body.innerText.includes('Enter Contest')"});
  await click('Enter Contest');await delay(300);await click('Technical details', {prefix:true});await delay(350);await capture('short-preflight');
  await recordCheck('Preflight stays within a short viewport', "(()=>{const p=document.querySelector('[aria-labelledby=session-readiness-title] .astryx-card');const r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(p).overflowY==='auto'})()");
  await recordCheck('Short preflight scrolls instead of compressing sections', "(()=>{const p=document.querySelector('[aria-labelledby=session-readiness-title] .astryx-card');return p.scrollHeight>p.clientHeight&&[...p.querySelectorAll('section')].every(s=>s.getBoundingClientRect().height>50)})()");
  await key('Escape');await click('Resolve camera');await capture('short-recovery');
  await recordCheck('Recovery stays within a short viewport', "(()=>{const p=document.querySelector('[aria-labelledby=resolve-modal-title] .astryx-card');const r=p.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(p).overflowY==='auto'})()");
  await key('Escape');
  await click('Sign out');await until("location.pathname==='/'");
  await recordCheck('Sign out still clears AMS credentials', "!Object.keys(localStorage).some(k=>k.startsWith('ams_'))");
} catch (err) { manifest.failures.push(err.stack); console.error(err); if(ws?.readyState===WebSocket.OPEN){ console.error('DOM',await evaluate('({url:location.href,state:document.readyState,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,3000)})').catch(String)); } process.exitCode = 1; }
finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks, failures: manifest.failures.length }));
}
