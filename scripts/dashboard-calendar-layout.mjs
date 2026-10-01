/** Capture-only baseline runner; Node 24 + installed Chrome; no extra dependencies.
 * Run: node scripts/dashboard-layout-review.mjs http://127.0.0.1:3000
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
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/dashboard-ui/calendar-layout';
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
  for (viewport of [{width:1440,height:1000},{width:1280,height:800},{width:1024,height:768},{width:800,height:700},{width:390,height:844},{width:320,height:700}]) {
    await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
    await navigate('/home/',{ready:"document.body.innerText.includes('Enter Contest')"});
    await delay(400);await capture('dashboard');
    manifest.layout ??= [];
    manifest.layout.push(await evaluate(`(()=>{
      const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right,padding:s.padding,gap:s.gap,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}};
      const list=document.querySelector('[aria-label=Contests] ul');
      const readiness=document.querySelector('aside[aria-label="Device readiness"]');
      return {viewport:[innerWidth,innerHeight],heading:rect(document.querySelector('h1,[aria-level="1"]')),search:rect(document.querySelector('.astryx-text-input')),contests:rect(document.querySelector('[aria-label=Contests]')),firstContest:rect(list?.firstElementChild),lastContest:rect(list?.lastElementChild),recovery:rect(document.querySelector('[aria-label="Session recovery"]')),readiness:rect(readiness),check:rect(readiness?.querySelector('li')),main:rect(document.getElementById('astryx-app-shell-main')),buttons:[...document.querySelectorAll('[aria-label=Contests] button')].map(e=>({label:e.textContent,...rect(e)}))};
    })()`));
    await recordCheck('Search and rows share section gutters', `(()=>{const section=document.querySelector('[aria-label=Contests]'),search=section.querySelector('.astryx-text-input'),row=section.querySelector('li');const a=section.getBoundingClientRect(),b=search.getBoundingClientRect(),c=row.getBoundingClientRect();return Math.abs(a.x-b.x)<1&&Math.abs(a.right-b.right)<1&&Math.abs(a.x-c.x)<1&&getComputedStyle(row).paddingLeft==='0px'})()`);
    await recordCheck('Main scroller has no horizontal overflow', `(()=>{const e=document.getElementById('astryx-app-shell-main');return e.scrollWidth<=e.clientWidth})()`);
    await recordCheck('Recovery has a deliberate 24px gap and 20px inset', `(()=>{const a=document.querySelector('[aria-label=Contests]').getBoundingClientRect(),b=document.querySelector('[aria-label="Session recovery"]'),r=b.getBoundingClientRect();return Math.abs(r.y-a.bottom-24)<1&&getComputedStyle(b).paddingTop==='20px'&&getComputedStyle(b).borderTopWidth==='0px'})()`);
    await recordCheck('Contest actions stay at the row end', `(()=>{const s=document.querySelector('[aria-label=Contests]').getBoundingClientRect();return [...document.querySelectorAll('[aria-label=Contests] li button')].every(b=>Math.abs(b.getBoundingClientRect().right-s.right)<1)})()`);
    await recordCheck('Resolve controls meet the 24px target minimum', `(()=>{const b=[...document.querySelectorAll('aside[aria-label="Device readiness"] button[aria-label^="Resolve"]')];return b.length>0&&b.every(e=>{const r=e.getBoundingClientRect();return r.width>=24&&r.height>=24})})()`);
    if(viewport.width<=390){
      await evaluate("document.querySelector('aside[aria-label=\"Device readiness\"]').scrollIntoView({block:'start'})");
      await delay(150);await capture('readiness');
      await recordCheck('Narrow readiness actions remain inside the card', `(()=>{const a=document.querySelector('aside[aria-label="Device readiness"]'),r=a.getBoundingClientRect();return a.scrollWidth<=a.clientWidth&&[...a.querySelectorAll('button')].every(b=>{const s=b.getBoundingClientRect();return s.x>=r.x&&s.right<=r.right})})()`);
    }
    const wide=viewport.width>=1024;
    if(wide)await recordCheck('Readiness surface aligns to the contest section', `(()=>{const s=document.querySelector('[aria-label=Contests]').getBoundingClientRect(),d=document.querySelector('aside[aria-label="Device readiness"] .astryx-card').getBoundingClientRect();return Math.abs(s.y-d.y)<1&&d.width>=320&&d.width<322})()`);
    if(viewport.width===1280)await recordCheck('Actionable readiness fits the desktop viewport', `(()=>{const d=document.querySelector('aside[aria-label="Device readiness"]').getBoundingClientRect();return d.bottom<=innerHeight-24})()`);
    await recordCheck('Calendar date grid fits at every width', `(()=>{const a=document.querySelector('[aria-labelledby=contest-calendar-heading]'),g=a?.querySelector('[role=grid]');return a&&g&&a.scrollWidth<=a.clientWidth&&g.scrollWidth<=a.clientWidth})()`);
    await evaluate("document.querySelector('[aria-labelledby=contest-calendar-heading]').scrollIntoView({block:'center'})");
    await delay(150);await capture('calendar');

  }
} catch (err) { manifest.failures.push(err.stack); console.error(err); if(ws?.readyState===WebSocket.OPEN){ console.error('DOM',await evaluate('({url:location.href,state:document.readyState,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,3000)})').catch(String)); } process.exitCode = 1; }
finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks, failures: manifest.failures.length }));
}
