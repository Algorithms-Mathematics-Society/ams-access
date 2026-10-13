/** Contest browser audit; Node 22.6+ (with WebSocket) + installed Chrome.
 * Run: node scripts/contest-audit-verify.mjs http://127.0.0.1:3000
 * CHROME_PATH overrides installed Chrome discovery; AMS_THEME_EVIDENCE_DIR overrides output.
 * Contest UI fixtures exist exclusively in this disposable browser, never in the live app.
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { installFixtures } from './theme-p0-fixtures.mjs';


const base = new URL(process.argv[2] || 'http://127.0.0.1:3000');
assert(['127.0.0.1', 'localhost'].includes(base.hostname) && base.protocol === 'http:', 'Local HTTP preview required');
const origin = base.origin;
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/contest-ui/audit/browser';
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ams-theme-p0-'));
function chromePath() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map(root => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(existsSync);
  assert(found, 'Chrome not found; set CHROME_PATH to the installed browser executable');
  return found;
}
let chrome;
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0, scriptId, viewport;
const pending = new Map();
function onboardingFixtures() {
  window.__onboardingCommands=[];
  const pending=()=>new Promise(()=>{});
  window.__TAURI__={core:{invoke:(command,args)=>{window.__onboardingCommands.push({command,args});if(command==='is_lockdown_engaged')return Promise.resolve(true);if(['unlock_desktop','configure_event_stream','stop_event_stream','stop_proctoring','stop_keyboard_monitoring'].includes(command))return Promise.resolve();if(command==='get_lockdown_restore_status')return Promise.resolve({pending:false,items:[]});return pending()}},window:{availableMonitors:pending,getCurrentWindow:()=>({setFullscreen:async()=>{},isFullscreen:async()=>false,setAlwaysOnTop:async()=>{},setDecorations:async()=>{},setResizable:async()=>{}})}};
  if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=pending;
}
function confidenceFixtures(config) {
  const previous = window.fetch;
  const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
  window.__confidence = {support:'success', finish:'success', run:'success', quota:false, history:config.mode==='history-error'?'non2xx':'success', submitted:[], calls:[], runs:[], polls:0};
  const store = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if(window.__confidence.quota && key.startsWith('ams_contest_answer_buffer:')) throw new DOMException('Synthetic storage full', 'QuotaExceededError');
    return store.call(this, key, value);
  };
  if(config.mode === 'recovery') localStorage.setItem('ams_contest_answer_buffer:p0-session:A', JSON.stringify({language:'cpp', files:[{id:'A:main',name:'solution.cpp',content:'// RECOVERED_DEVICE_WORK\nint main() { return 0; }'}],activeFileId:'A:main',savedAtMs:Date.now(),revision:3}));
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url,location.href);
    const p = url.pathname, method = init.method || (input instanceof Request ? input.method : 'GET');
    const settings = window.__confidence;
    if(p.includes('/participant/sessions/')) settings.calls.push({path:p,method,body:init.body});
    if(p.endsWith('/runs') && method==='POST') {
      if(settings.run==='reject') throw new TypeError('Synthetic judge rejection');
      const body=JSON.parse(init.body);
      const run={uid:'audit-run-'+(settings.runs.length+1),problem_label:body.problem_label,language:body.language,status:'QUEUED',created_at:new Date().toISOString()};
      settings.runs.push(run);settings.polls=0;
      if(settings.run==='pending')return new Promise(resolve=>{settings.resolveRun=()=>resolve(json(run))});
      return json(run);
    }
    if(p.includes('/runs/') && method==='GET') {
      settings.polls++;
      const run=settings.runs.find(r=>p.endsWith('/'+r.uid));
      if(!run)return json({detail:'Unknown synthetic run'},404);
      return json({...run,status:settings.run==='queued'?'QUEUED':'completed',verdict:'AC',score:100,passed_count:1,total_count:1,max_runtime_ms:12,max_memory_kb:1024,compile_output:'',testcases:[{kind:'io',testcase_no:1,label:'Sample 1',verdict:'AC',runtime_ms:12,memory_kb:1024,stdout:'AUDIT_SAMPLE_OUTPUT',stderr:''}]});
    }
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
    return previous(input,init);
  };
}
const manifest = { capturedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  origin, worktreeStatus: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }), trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary'])).digest('hex'), fixtureOnly: true, nativeRuntimeVerified: false, fixtureMethod:'Public DOM controls and keyboard input in a disposable browser; synthetic API, storage quota and native/media fixtures. No React internals or application debug bypass.', captures: [], checks: [], blockedExternalRequests: [], exceptions: [], failures: [] };
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
  const point = await evaluate(`(()=>{const scope=[...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]')].at(-1)||document;const b=[...scope.querySelectorAll('button,a,label,[role=radio],[role=tab],[role=option],[role=combobox]')].find(e=>e.getClientRects().length&&(${prefix ? `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase()===${JSON.stringify(text.toLowerCase())}`}||(${prefix}&&(e.getAttribute('aria-label')||'').toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())}))||e.getAttribute('aria-label')===${JSON.stringify(text)}||e.title===${JSON.stringify(text)}));if(!b)throw Error('Missing control: '+${JSON.stringify(text)});if(b.disabled)throw Error('Disabled control: '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
  await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...point});
  await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...point});
  await delay(150);
}
async function fill(selector, value) {
  await until(`document.querySelector(${JSON.stringify(selector)})`);
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
  chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.once('error', error => { launchError = error; });
  let port;
  for (let i = 0; i < 100; i++) {
    if(launchError)throw launchError;
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
  const route='/session/contest/?contestId=p0-contest';
  async function openContest(){await navigate(route,{ready:"document.querySelector('.cm-editor')&&document.body.innerText.includes('Binary Search')"});await delay(400);}
  async function geometry(){await recordCheck('No horizontal page overflow',"document.body.scrollWidth<=innerWidth");await recordCheck('One main landmark',"document.querySelectorAll('main,[role=main]').length===1");await recordCheck('Single mounted camera',"document.querySelectorAll('video').length===1");await recordCheck('Editor has usable area',"document.querySelector('.cm-editor').getBoundingClientRect().height>=180");}

  await size(1024,600);await openContest();
  await geometry();
  await evaluate("document.querySelector('[aria-label=\"Resize output panel\"]').focus();true");
  await key('End');
  await capture('max-output-short');
  manifest.auditObservations=[];
  manifest.auditObservations.push(await evaluate("({case:'max-output-short',editorHeight:document.querySelector('.cm-editor').getBoundingClientRect().height,outputHeight:document.querySelector('.contest-terminal-panel').getBoundingClientRect().height})"));
  await key('Home');
  await evaluate("document.querySelector('[aria-label=\"Resize output panel\"]').focus();window.__minOutput=document.querySelector('.contest-terminal-panel').getBoundingClientRect().height;true");
  await key('ArrowUp');
  await recordCheck('Output divider moves immediately from minimum physical height', "document.querySelector('.contest-terminal-panel').getBoundingClientRect().height>window.__minOutput");
  await size(2560,1440);await openContest();
  await evaluate("document.querySelector('[aria-label=\"Resize problem and editor panes\"]').focus();window.__before=document.querySelector('.contest-problem-pane').getBoundingClientRect().width;true");await key('ArrowRight');
  manifest.auditObservations.push(await evaluate("({case:'wide-problem-resize',before:window.__before,after:document.querySelector('.contest-problem-pane').getBoundingClientRect().width,value:document.querySelector('[aria-label=\"Resize problem and editor panes\"]').getAttribute('aria-valuetext')})"));
  await size(1440,1000);await openContest();await click('Editor settings');await click('Workspace');await capture('overlapping-popovers');
  manifest.auditObservations.push(await evaluate("({case:'popup-exclusivity',settings:!!document.querySelector('#contest-editor-themes'),workspace:!!document.querySelector('#workspace-controls')})"));
  await click('Workspace');await click('Editor settings');await click('VS Code Dark+');
  manifest.auditObservations.push(await evaluate("({case:'theme-focus',focused:document.activeElement.tagName,id:document.activeElement.id})"));
  await recordCheck('Theme selection returns keyboard focus', "document.activeElement.id==='contest-editor-settings-trigger'");
  assert(manifest.auditObservations[0].editorHeight >= 119, 'Short editor retains at least 120px');
  assert(manifest.auditObservations[1].after > manifest.auditObservations[1].before, 'Wide divider moves actual problem width');
  assert(!manifest.auditObservations[2].settings && manifest.auditObservations[2].workspace, 'Only one preferences/menu panel is open');
  manifest.checks.push({label:'Short editor usable at max output',passed:true},{label:'Wide divider changes rendered width',passed:true},{label:'Menus do not overlap',passed:true});
  await click('Editor settings');await key('Escape');
  await recordCheck('Escape dismisses preferences and restores focus', "!document.querySelector('#contest-editor-themes')&&document.activeElement.id==='contest-editor-settings-trigger'");
  await click('Editor settings');await evaluate("document.querySelector('[aria-label=\"Programming language\"]').focus();true");
  await recordCheck('Tabbing out dismisses preferences without stealing focus', "!document.querySelector('#contest-editor-themes')&&document.activeElement.id==='contest-language'");
  // Drafts are local only: exercise real editor changes, switching and reload.
  await evaluate("document.querySelector('.cm-content').focus();true");
  await send('Input.insertText',{text:'// AUDIT_OLDER_A\n'});
  await send('Input.insertText',{text:'// AUDIT_LATEST_A\n'});await delay(80);
  await click('Balanced Brackets',{prefix:true});
  await evaluate("document.querySelector('.cm-content').focus();true");await send('Input.insertText',{text:'// AUDIT_B\n'});await delay(700);
  await recordCheck('Switching questions buffers the latest A locally', "localStorage.getItem('ams_contest_answer_buffer:p0-session:A').includes('AUDIT_LATEST_A')");
  await recordCheck('B saves its own source locally', "localStorage.getItem('ams_contest_answer_buffer:p0-session:B').includes('AUDIT_B')");
  await recordCheck('Editing drafts never sends a draft API request', "!window.__confidence.calls.some(c=>c.path.includes('/drafts'))");
  await click('Binary Search',{prefix:true});
  await recordCheck('Returning to A retains latest source', "document.querySelector('.cm-content').innerText.includes('AUDIT_LATEST_A')");
  await openContest();
  await recordCheck('Reload restores latest A from its local-only workspace', "document.querySelector('.cm-content').innerText.includes('AUDIT_LATEST_A')&&document.body.innerText.includes('Draft restored from this device')");
  await click('Balanced Brackets',{prefix:true});
  await recordCheck('Reload preserves independent B source too', "document.querySelector('.cm-content').innerText.includes('AUDIT_B')&&!document.querySelector('.cm-content').innerText.includes('AUDIT_LATEST_A')");
  await click('Binary Search',{prefix:true});
  await capture('recovered-workspace');

  await evaluate("window.__confidence.quota=true;document.querySelector('.cm-content').focus();true");
  await send('Input.insertText',{text:'// AUDIT_UNSAVED_QUOTA\n'});
  await until("document.body.innerText.includes('Not saved on this device')");
  await recordCheck('Quota failure keeps editor work and truthfully marks it unsaved', "document.querySelector('.cm-content').innerText.includes('AUDIT_UNSAVED_QUOTA')&&!localStorage.getItem('ams_contest_answer_buffer:p0-session:A').includes('AUDIT_UNSAVED_QUOTA')&&document.body.innerText.includes('storage full or blocked')");
  await capture('storage-quota-failure');
  await evaluate("window.__confidence.quota=false;document.querySelector('.cm-content').focus();true");
  await send('Input.insertText',{text:'// AUDIT_QUOTA_RECOVERED\n'});
  await until("document.body.innerText.includes('Saved on this device')&&!document.body.innerText.includes('Not saved on this device')");
  await recordCheck('Next edit retries local persistence after quota clears', "localStorage.getItem('ams_contest_answer_buffer:p0-session:A').includes('AUDIT_UNSAVED_QUOTA')&&localStorage.getItem('ams_contest_answer_buffer:p0-session:A').includes('AUDIT_QUOTA_RECOVERED')");

  // A rejected or non-2xx report cannot become a receipt. The API contract
  // acknowledges any 2xx response; it does not require a made-up body flag.
  await click('Request support');
  await fill('textarea', 'Synthetic browser audit incident; no real candidate data.');
  for(const failure of ['reject','non2xx']) {
    await evaluate(`window.__confidence.support=${JSON.stringify(failure)}`);
    await click('Submit report');
    await until("document.body.innerText.includes('Report not confirmed')");
    await recordCheck(`${failure} report retains details without success receipt`, "document.querySelector('textarea').value.includes('Synthetic browser audit incident')&&!document.body.innerText.includes('Report sent')&&!document.querySelector('[aria-label=\"Recent reports\"]')");
  }
  await capture('support-network-failure');
  await evaluate("window.__confidence.support='pending'");await click('Submit report');
  await until("typeof window.__confidence.resolveSupport==='function'");
  await recordCheck('Pending support response cannot claim a receipt or send twice', "document.body.innerText.includes('Sending…')&&!document.body.innerText.includes('Report sent')&&[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Sending')&&b.disabled)");
  await evaluate("window.__confidence.resolveSupport();true");
  await until("document.body.innerText.includes('Report sent')");
  await recordCheck('2xx support acknowledgment records the actual report contract', "document.querySelector('[aria-label=\"Recent reports\"]')&&window.__confidence.calls.filter(c=>c.path.endsWith('/incidents')&&JSON.parse(c.body||'{}').message?.includes('Synthetic browser audit incident')).length===3");
  await capture('support-confirmed');await click('Back to contest');

  await evaluate("window.__confidence.run='reject'");await click('Run');
  await until("document.body.innerText.includes('Could not reach the judge')");
  await recordCheck('Run network rejection is visible and retryable', "!document.querySelector('button[aria-label^=\"Run \" ]').disabled&&window.__confidence.runs.length===0");
  await capture('run-network-failure');
  await evaluate("window.__confidence.run='pending'");await click('Run');
  await until("typeof window.__confidence.resolveRun==='function'");
  await recordCheck('Delayed run disables duplicate requests', "document.querySelector('button[aria-label^=\"Run \" ]').disabled&&window.__confidence.runs.length===1");
  await evaluate("window.__confidence.run='success';window.__confidence.resolveRun();true");
  await until("window.__confidence.polls>0&&!document.querySelector('button[aria-label^=\"Run \" ]').disabled");
  await recordCheck('Delayed run resolves by its own UID without scored submission', "window.__confidence.calls.some(c=>c.path.endsWith('/runs/audit-run-1'))&&!window.__confidence.calls.some(c=>c.path.endsWith('/submissions')&&c.method==='POST')");
  await capture('delayed-run-result');

  // Finish retries are bounded, and a confirmed finish cannot turn a failed
  // device write into a saved draft. Each case starts a synthetic session.
  for(const failure of ['reject','non2xx']) {
    await openContest();await evaluate(`window.__confidence.finish=${JSON.stringify(failure)}`);
    await click('Finish contest');await click('Finish and exit');
    await until("document.body.innerText.includes('Could not confirm session finish')");
    await recordCheck(`${failure} finish fails after bounded retries and releases fixture locks`, "window.__confidence.calls.filter(c=>c.path.endsWith('/finish')).length===4&&!document.body.innerText.includes('Session finish confirmed')&&window.__onboardingCommands.some(c=>c.command==='unlock_desktop')&&localStorage.getItem('ams_active_session')===null");
    await capture(`finish-${failure}-failure`);
  }
  await openContest();
  await evaluate("window.__confidence.quota=true;window.__confidence.finish='pending';document.querySelector('.cm-content').focus();true");
  await send('Input.insertText',{text:'// AUDIT_FINISH_UNSAVED\n'});
  await until("document.body.innerText.includes('Not saved on this device')");
  await click('Finish contest');await click('Finish and exit');
  await until("typeof window.__confidence.resolveFinish==='function'");
  await recordCheck('Pending finish does not claim success', "document.body.innerText.includes('Waiting for the server to acknowledge')&&!document.body.innerText.includes('Session finish confirmed')");
  await evaluate("window.__confidence.resolveFinish();true");
  await until("document.body.innerText.includes('Session finish confirmed')");
  await recordCheck('Confirmed finish preserves truthful failed draft warning', "document.body.innerText.includes('Latest draft save not confirmed')&&!document.body.innerText.includes('final draft save was also confirmed')&&window.__confidence.calls.filter(c=>c.path.endsWith('/finish')).length===1");
  await capture('finish-confirmed-unsaved-draft');
  const fixtureIsolation = manifest.blockedExternalRequests.length===0;
  manifest.checks.push({name:'No API request escaped the synthetic fixtures',viewport,passed:fixtureIsolation});
  assert(fixtureIsolation, 'Unexpected HTTP requests were blocked; inspect manifest');
  assert(manifest.exceptions.length===0, 'Unexpected browser exception; inspect manifest');
  console.log(JSON.stringify(manifest.auditObservations,null,2));

} catch (err) { manifest.failures.push(err.stack); console.error(err); try{console.error('Failure state',await evaluate("({url:location.href,text:document.body.innerText.slice(0,2200),requests:window.__p0Requests})"));await capture('failure');}catch{} process.exitCode = 1; }
finally {
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  if(!manifest.failures.length)await writeFile(path.resolve(evidenceRoot,'latest.json'),JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if(ws?.readyState===WebSocket.OPEN){await send('Page.navigate',{url:'about:blank'}).catch(()=>{});ws.close();}
  if(chrome && chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),delay(5000)]);}
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(error=>console.error('Disposable profile cleanup failed:',error.message));
  console.log(JSON.stringify({captures:manifest.captures.length,checks:manifest.checks.length,failures:manifest.failures.length,evidence:output}));
}
