/** Contest confidence first-batch regression runner; Node 24 + installed Chrome.
 * Run: node scripts/contest-confidence-verify.mjs http://127.0.0.1:3000
 * Contest UI fixtures exist exclusively in this disposable browser, never in the live app.
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
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/contest-ui/problem-panel/browser';
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ams-theme-p0-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0, scriptId, viewport;
const pending = new Map();
function onboardingFixtures() {
  window.__onboardingCommands=[];
  const pending=()=>new Promise(()=>{});
  window.__TAURI__={core:{invoke:(command,args)=>{window.__onboardingCommands.push({command,args});return pending()}},window:{availableMonitors:pending,getCurrentWindow:()=>({setFullscreen:pending,isFullscreen:pending,setAlwaysOnTop:pending,setDecorations:pending,setResizable:pending})}};
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=pending;
}
function confidenceFixtures(config) {
  const previous = window.fetch;
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
  window.__confidence = {support:'success', finish:'success', draft:'success', history:config.mode==='history-error'?'non2xx':'success', submitted:[], calls:[]};
  if(config.mode === 'recovery') localStorage.setItem('ams_contest_answer_buffer:p0-session:A', JSON.stringify({language:'cpp', files:[{id:'A:main',name:'solution.cpp',content:'// RECOVERED_DEVICE_WORK\nint main() { return 0; }'}],activeFileId:'A:main',savedAtMs:Date.now(),revision:3}));
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url,location.href);
    const p = url.pathname, method = init.method || (input instanceof Request ? input.method : 'GET');
    const settings = window.__confidence;
    if(p.includes('/participant/sessions/')) settings.calls.push({path:p,method,body:init.body});
    if(p.endsWith('/submissions')) {
      if(method==='POST') {
        const body=JSON.parse(init.body);const attempt={uid:'confidence-attempt-'+(settings.submitted.length+1),problem_label:body.problem_label,language:body.language,status:'completed',created_at:new Date().toISOString(),verdict:'AC',score:100,passed_count:1,total_count:1,max_runtime_ms:12,max_memory_kb:1024,compile_output:'',testcases:[]};
        settings.submitted.push(attempt);return json(attempt);
      }
      if(settings.history==='non2xx') return json({detail:'Synthetic history unavailable'},503);
      if(settings.submitted.length){const original=await previous(input,init);return json([...(await original.json()),...settings.submitted]);}
    }
    if(p.endsWith('/incidents')) {
      if(settings.support==='reject') throw new TypeError('Synthetic network rejection');
      if(settings.support==='non2xx') return json({detail:'Synthetic unavailable'},503);
      if(settings.support==='pending') return new Promise(resolve=>{settings.resolveSupport=()=>resolve(json({received:true}))});
      return json({received:true});
    }
    if(p.endsWith('/finish')) {
      if(settings.finish==='reject') throw new TypeError('Synthetic finish rejection');
      if(settings.finish==='non2xx') return json({detail:'Synthetic unavailable'},503);
      if(settings.finish==='pending') return new Promise(resolve=>{settings.resolveFinish=()=>resolve(json({status:'submitted'}))});
      return json({status:'submitted'});
    }
    if(p.endsWith('/drafts') && config.mode==='recovery') return json([{problem_label:'A',language:'cpp',source:'// OLD_SERVER_WORK',client_revision:2}]);
    if(p.includes('/drafts/') && method==='PUT') {
      if(settings.draft==='pending') return new Promise(resolve=>{settings.resolveDraft=()=>resolve(json({...JSON.parse(init.body),problem_label:p.split('/').at(-1)}))});
      if(settings.draft==='reject') throw new TypeError('Synthetic draft rejection');
      return json({...JSON.parse(init.body),problem_label:p.split('/').at(-1)});
    }
    return previous(input,init);
  };
}
const pageSource=await readFile('apps/web/src/app/session/contest/client.tsx','utf8');
const stateNames=[...pageSource.matchAll(/const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\]\s*=\s*useState/g)].map(m=>m[1]);
async function setFixtureState(values,component='ContestPageClient',names=stateNames){
  return evaluate(`(()=>{
    let fiber=null;
    for(const e of document.querySelectorAll('*')){const k=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));if(!k)continue;let f=e[k];while(f){if(f.type?.name===${JSON.stringify(component)}||f.type?.displayName===${JSON.stringify(component)}){fiber=f;break}f=f.return}if(fiber)break}
    if(!fiber)throw Error('Missing React fixture component '+${JSON.stringify(component)});
    const hooks=[];for(let h=fiber.memoizedState;h;h=h.next)if(h.queue?.dispatch)hooks.push(h);
    const names=${JSON.stringify(names)},values=${JSON.stringify(values)};
    if(hooks.length!==names.length)throw Error('Fixture hook count mismatch '+hooks.length+' vs '+names.length);
    for(const [name,value] of Object.entries(values)){const i=names.indexOf(name);if(i<0)throw Error('Unknown state '+name);hooks[i].queue.dispatch(value)}
    return hooks.map((h,i)=>({name:names[i],type:typeof h.memoizedState}));
  })()`);
}
const manifest = { capturedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  origin, worktreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary'])).digest('hex'), fixtureOnly: true, nativeRuntimeVerified: false, fixtureMethod:'Disposable browser React state dispatch for rendered states; no application debug bypass. Native/media calls held pending. Real intro action checked separately.', captures: [], checks: [], blockedExternalRequests: [], exceptions: [], failures: [] };
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
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString().replace("localStorage.clear();", "/* retain disposable browser preferences on reload */")})(${JSON.stringify(config)});(${onboardingFixtures.toString()})();(${confidenceFixtures.toString()})(${JSON.stringify(config)});` })).identifier;
  const navigation = await send('Page.navigate', { url: origin + route }); console.log('Navigate', route, JSON.stringify(navigation));
  await until(`location.pathname === ${JSON.stringify(new URL(route, origin).pathname)} && document.readyState === 'complete' && (${ready})`);
  await evaluate('document.fonts.ready.then(()=>true)');
  await delay(250);
}
async function click(text, { prefix = false } = {}) {
  const point = await evaluate(`(()=>{const scope=document;const b=[...scope.querySelectorAll('button,a,label,[role=radio],[role=tab],[role=option],[role=combobox]')].find(e=>${prefix ? `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase()===${JSON.stringify(text.toLowerCase())}`}||(${prefix}&&(e.getAttribute('aria-label')||'').toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}))||e.getAttribute('aria-label')===${JSON.stringify(text)}||e.title===${JSON.stringify(text)});if(!b)throw Error('Missing control: '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
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
  const passed = Boolean(await evaluate(`Boolean(${expression})`));
  manifest.checks.push({ name, viewport, passed });
  if(!passed) console.error('FAILED CHECK DOM',await evaluate("({active:document.activeElement?.outerHTML.slice(0,400),dialogs:[...document.querySelectorAll('dialog')].map(d=>({label:d.getAttribute('aria-label'),open:d.open})),resolve:[...document.querySelectorAll('[aria-label^=\"Resolve\"]')].map(b=>({label:b.getAttribute('aria-label'),connected:b.isConnected}))})"));
  assert(passed, name);
}
async function key(key, shift = false) {
  await send('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:({Escape:27,Tab:9,ArrowRight:39,ArrowLeft:37,ArrowDown:40,ArrowUp:38,Home:36,End:35,PageDown:34,Enter:13})[key]||13,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key,code:key});
  await delay(100);
}
async function contrastAudit(selector = ".astryx-app-shell *", minimumSamples = 10) {
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
  assert(results.length>=minimumSamples,'Contrast audit found text');
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
    if (e.method === 'Runtime.consoleAPICalled' && ['warning','error'].includes(e.params.type)) {manifest.consoleMessages ??= [];manifest.consoleMessages.push({type:e.params.type,text:e.params.args.map(a=>a.value??a.description??'').join(' ').slice(0,1000)});}
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
  async function size(width,height){viewport={width,height};await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});}
  const route='/session/contest/?contestId=p0-contest&mode=dry-run';
  async function openContest(){await navigate(route,{ready:"document.querySelector('.cm-editor')&&document.body.innerText.includes('Binary Search')"});await delay(400);}
  async function geometry(){await recordCheck('No horizontal page overflow',"document.body.scrollWidth<=innerWidth");await recordCheck('One main landmark',"document.querySelectorAll('main,[role=main]').length===1");await recordCheck('Single mounted camera',"document.querySelectorAll('video').length===1");await recordCheck('Editor has usable area',"document.querySelector('.cm-editor').getBoundingClientRect().height>=180");}

  for (const [width,height] of [[1440,1000],[1024,600],[390,844],[320,640]]) {
    await size(width,height);await openContest();
    await recordCheck('Problem panel has no horizontal overflow', "(()=>{const p=document.querySelector('.contest-problem-pane');return p.scrollWidth<=p.clientWidth+1&&document.body.scrollWidth<=innerWidth})()");
    await recordCheck('Title precedes section navigation', "document.querySelector('.contest-problem-article :is(h1,h2,[role=heading])').getBoundingClientRect().bottom<document.querySelector('[aria-label=\"Problem sections\"]').getBoundingClientRect().top");
    await recordCheck('Limits remain visible and grouped', "document.querySelector('.contest-problem-limits').innerText.includes('256 MB')&&document.querySelector('.contest-problem-limits').innerText.includes('2 s')");
    await recordCheck('Scoring uses correct singular test label', "document.querySelector('[aria-label=\"How this is marked\"]').innerText.includes('1 test ·')&&!document.querySelector('[aria-label=\"How this is marked\"]').innerText.includes('1 tests')");
    await click('Mark for later');
    await recordCheck('Compact bookmark communicates its selected state', "document.querySelector('[aria-label=\"Marked for later\"]').getAttribute('aria-pressed')==='true'");
    await capture('problem-summary');
    await click('Marked for later');
    await click('Examples',{prefix:true});await recordCheck('Examples remain available', "document.querySelector('[aria-label=\"Problem sections\"] [aria-current=page]').textContent.includes('Examples')");
    await click('Constraints',{prefix:true});await recordCheck('Constraints remain available', "document.querySelector('[aria-label=\"Problem sections\"] [aria-current=page]').textContent.includes('Constraints')");
    await click('Statement',{prefix:true});
    if(width<=390){
      await evaluate("document.querySelector('[aria-label=\"How this is marked\"]').scrollIntoView({block:'center'});true");await delay(200);
      await recordCheck('Scoring remains reachable on narrow screens', "(()=>{const r=document.querySelector('[aria-label=\"How this is marked\"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()");
      await capture('statement-scoring-scrolled');
    }
    await contrastAudit('.contest-problem-pane *',10);
  }
  await size(1440,1000);await openContest();
  const originals = await evaluate(`(()=>{const e=document.querySelector('.contest-problem-pane');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];while(f){if(f.memoizedProps?.questions)return f.memoizedProps.questions;f=f.return}throw Error('Missing question fixture')})()`);
  await setFixtureState({questions:originals.map((q,i)=>i? q:{...q,title:'Binary Search with repeated values and a deliberately long problem title to verify wrapping',points:0,time_limit_ms:null,memory_limit_mb:null})});await delay(200);
  await capture('long-title-partial-limits');
  await recordCheck('Long title wraps without displacing bookmark outside panel', "(()=>{const p=document.querySelector('.contest-problem-pane').getBoundingClientRect(),b=document.querySelector('[aria-label=\"Mark for later\"]').getBoundingClientRect();return b.right<=p.right&&b.left>=p.left})()");
  await recordCheck('Unavailable limits are omitted and zero points retained', "document.querySelector('.contest-problem-limits').innerText.includes('0')&&!document.querySelector('.contest-problem-limits').innerText.includes('Time limit')");
  assert.equal(manifest.exceptions.length,0,'No runtime exceptions');

} catch (err) { manifest.failures.push(err.stack); console.error(err); try{console.error('Failure state',await evaluate("({url:location.href,text:document.body.innerText.slice(0,2200),requests:window.__p0Requests})"));await capture('failure');}catch{} process.exitCode = 1; }
finally {
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if(!manifest.failures.length)await writeFile(path.resolve(evidenceRoot,'latest.json'),JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if(ws?.readyState===WebSocket.OPEN){await send('Page.navigate',{url:'about:blank'}).catch(()=>{});ws.close();}
  chrome.kill('SIGTERM');await delay(500);await rm(profile,{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify({captures:manifest.captures.length,checks:manifest.checks.length,failures:manifest.failures.length}));
}
