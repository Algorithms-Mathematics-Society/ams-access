/** Onboarding warning/context usability regression runner; Node 24 + installed Chrome.
 * Run: node scripts/onboarding-progress-verify.mjs http://127.0.0.1:3000
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
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/onboarding-ui/usability-evidence';
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
const pageSource=await readFile('apps/web/src/app/session/onboarding/page.tsx','utf8');
const stateNames=[...pageSource.matchAll(/const \[([A-Za-z0-9_]+),\s*set[A-Za-z0-9_]+\]\s*=\s*useState/g)].map(m=>m[1]);
async function setFixtureState(values,component='OnboardingPage',names=stateNames){
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
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)});(${onboardingFixtures.toString()})();` })).identifier;
  const navigation = await send('Page.navigate', { url: origin + route }); console.log('Navigate', route, JSON.stringify(navigation));
  await until(`location.pathname === ${JSON.stringify(new URL(route, origin).pathname)} && document.readyState === 'complete' && (${ready})`);
  await evaluate('document.fonts.ready.then(()=>true)');
  await delay(250);
}
async function click(text, { prefix = false } = {}) {
  const point = await evaluate(`(()=>{const scope=[...document.querySelectorAll('dialog[open]')].at(-1)||document;const b=[...scope.querySelectorAll('button,a,[role=tab],[role=option],[role=combobox]')].find(e=>${prefix ? `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})` : `e.textContent.trim().replace(/\\s+/g,' ').toLowerCase()===${JSON.stringify(text.toLowerCase())}`}||e.getAttribute('aria-label')===${JSON.stringify(text)}||e.title===${JSON.stringify(text)});if(!b)throw Error('Missing control: '+${JSON.stringify(text)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
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
  if (state.scrollRegions.length || await evaluate('document.documentElement.scrollHeight>innerHeight+4')) {
    const metrics=await send('Page.getLayoutMetrics');const height=Math.min(metrics.cssContentSize.height,4000);
    if(height>viewport.height){const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:viewport.width,height,scale:1}});await writeFile(path.join(output,filename.replace('.png','-full.png')),Buffer.from(full.data,'base64'));}
  }
  if(state.scrollRegions.length){
    const lowerAction=await evaluate("(()=>{const buttons=[...document.querySelectorAll('[data-onboarding-page] button')].filter(e=>e.getClientRects().length);const e=buttons.at(-1);return e&&e.getBoundingClientRect().bottom>innerHeight?e.textContent.trim():null})()");
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:viewport.width/2,y:viewport.height/2,deltaY:5000,deltaX:0});await delay(250);
    const bottom=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(output,filename.replace('.png','-bottom.png')),Buffer.from(bottom.data,'base64'));
    const scrolled=await evaluate("[...document.querySelectorAll('*')].some(e=>e.scrollTop>0)");
    manifest.checks.push({name:name+' actual wheel reaches lower content',viewport,passed:scrolled});assert(scrolled,'Actual mouse wheel must scroll long onboarding content');
    if(lowerAction)await recordCheck(name+' final action reachable by scrolling',`(()=>{const e=[...document.querySelectorAll('[data-onboarding-page] button')].filter(e=>e.getClientRects().length).at(-1);const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()`);
    await evaluate("[...document.querySelectorAll('*')].filter(e=>e.scrollTop>0).forEach(e=>{e.scrollTop=0})");await delay(100);
  }
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
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});viewport={width:1280,height:800};
  const results=Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,'pass']));
  await navigate('/session/onboarding/?contestId=p0-contest',{ready:"document.body.innerText.includes('Begin setup')"});
  await recordCheck('Contest title and explicit timezone on intro',"document.querySelector('[aria-label=\"Contest setup context\"]').innerText.includes('P0 Preview') && document.querySelector('[aria-label=\"Contest setup context\"]').innerText.includes('UTC')");
  await recordCheck('Full privacy policy available before secure setup',"document.querySelector('a[href=\"/privacy\"]')?.target === ''");
  await click('Begin setup');
  await evaluate("window.__TAURI__.core.invoke=(command)=>command==='detect_virtualization'?Promise.resolve({detected:true,platform:'Fixture VM'}):new Promise(()=>{})");
  await setFixtureState({currentStage:6,results});
  await until("document.body.innerText.includes('Continue with warning')");
  await delay(3300);
  await recordCheck('VM warning waits for candidate, past former automatic delay',"!!document.querySelector('[data-onboarding-stage=\"6\"]') && document.body.innerText.includes('Fixture VM')");
  await capture('virtualization-warning');
  await click('Continue with warning');
  await until("document.querySelector('[data-onboarding-stage=\"7\"]')");
  await recordCheck('Camera purpose disclosure exists',"document.body.innerText.includes('Why this camera check?')");
  await evaluate("document.querySelector('details').open=true");
  await recordCheck('Camera explanation describes next steps without retention claims',"document.body.innerText.includes('position your face')");
  await capture('camera-purpose');
  await evaluate("window.__originalAudioContext=window.AudioContext;window.__stoppedMicTracks=0;window.AudioContext=function(){throw Error('Fixture audio initialization failed')};navigator.mediaDevices.getUserMedia=()=>Promise.resolve({getTracks:()=>[{stop:()=>window.__stoppedMicTracks++}]})");
  await setFixtureState({currentStage:10});
  await until("document.body.innerText.includes('Try microphone again')");
  await recordCheck('Audio initialization failure releases acquired microphone',"window.__stoppedMicTracks>0");
  await setFixtureState({currentStage:7});await delay(300);
  await evaluate("window.AudioContext=window.__originalAudioContext;window.__microphoneRequests=0;navigator.mediaDevices.getUserMedia=()=>{window.__microphoneRequests++;return Promise.reject(new DOMException('Permission denied','NotAllowedError'))}");
  await setFixtureState({currentStage:10});
  await until("document.body.innerText.includes('Try microphone again')");
  await delay(2400);
  await recordCheck('Microphone warning waits for candidate',"!!document.querySelector('[data-onboarding-stage=\"10\"]')");
  await evaluate('window.__microphoneRequestsBeforeRetry=window.__microphoneRequests');
  await click('Try microphone again');
  await until("window.__microphoneRequests>window.__microphoneRequestsBeforeRetry && document.body.innerText.includes('Try microphone again')");
  await recordCheck('Retry makes a fresh microphone check',"window.__microphoneRequests===window.__microphoneRequestsBeforeRetry+1");
  await capture('microphone-warning');
  await click('Continue with warning');
  await until("document.querySelector('[data-onboarding-stage=\"11\"]')");
  await setFixtureState({currentStage:12});await delay(400);
  await recordCheck('Original VM details and microphone remedy preserved in review',"document.body.innerText.includes('Fixture VM') && document.body.innerText.includes('close other apps using it')");
  await recordCheck('Warnings appear before successful checks',"(()=>{const t=document.querySelector('[data-onboarding-stage]').innerText;return t.indexOf('Device Compatibility')<t.indexOf('Secure Full-Screen') && t.indexOf('Microphone Check')<t.indexOf('Secure Full-Screen')})()");
  await recordCheck('Context remains present in review',"document.querySelector('[aria-label=\"Contest setup context\"]').innerText.includes('P0 Preview')");
  await capture('warnings-review');
  await setFixtureState({policyBlock:'Fixture entry requirement blocks this contest.'});await delay(400);
  await recordCheck('Policy block still removes Continue',"![...document.querySelectorAll('[data-onboarding-stage] button')].some(e=>e.textContent.trim()==='Continue')");
  await setFixtureState({policyBlock:null,dryRunComplete:true});await delay(400);
  await recordCheck('Practice summary retains original warning details',"document.querySelector('[aria-label=\"Practice check results\"]').innerText.includes('Fixture VM')");
  for(const width of [390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:640,deviceScaleFactor:1,mobile:false});viewport={width,height:640};
    await setFixtureState({dryRunComplete:false,currentStage:12});await delay(400);
    await recordCheck('Review fits '+width+'px',"document.body.scrollWidth<=innerWidth");await capture('warnings-review');
  }
  await recordCheck('No secure session created by inspection',"!(window.__onboardingCommands||[]).some(c=>c.command==='start_secure_session')");
  assert.equal(manifest.exceptions.length,0,'No runtime errors');
} catch (err) { manifest.failures.push(err.stack); console.error(err); process.exitCode = 1; }
finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks.length, failures: manifest.failures.length }));
}
