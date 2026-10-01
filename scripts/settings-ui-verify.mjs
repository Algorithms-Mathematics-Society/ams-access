/** Settings UI regression runner; Node 24 + installed Chrome; no extra dependencies.
 * Run: node scripts/settings-ui-verify.mjs http://127.0.0.1:3000
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
const evidenceRoot = process.env.AMS_THEME_EVIDENCE_DIR || 'apps/web/dashboard-ui/settings-evidence';
const output = path.resolve(evidenceRoot, new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'ams-theme-p0-'));
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0, scriptId, viewport;
const pending = new Map();
function installSettingsFixtures(config) {
  if (location.origin !== config.origin) return;
  window.__settingsCommands = [];
  window.__settingsMedia = [];
  window.__settingsTracks = [];
  window.__settingsDeviceScans = 0;
  Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', {configurable:true, value:async()=>{
    window.__settingsDeviceScans++;
    return config.mode==='no-devices'?[]:[{deviceId:'camera-1',kind:'videoinput',label:'Built-in camera',groupId:'g1'},
      {deviceId:'camera-2',kind:'videoinput',label:config.mode==='long'?'External camera '+ 'Long device name '.repeat(15):'External camera',groupId:'g2'}];
  }});
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {configurable:true, value:async constraints=>{
    window.__settingsMedia.push(constraints);
    if (config.mode !== 'media') throw new DOMException('Fixture permission denied','NotAllowedError');
    let stream;
    if(constraints.video){
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#202020';ctx.fillRect(0,0,640,480);ctx.fillStyle='#ddd';ctx.font='24px sans-serif';ctx.fillText('Local camera fixture',180,240);
      stream=canvas.captureStream(30);
    } else {
      const ctx=new AudioContext(); const dest=ctx.createMediaStreamDestination();stream=dest.stream;
    }
    window.__settingsTracks.push(...stream.getTracks());
    return stream;
  }});
  window.__TAURI__ = { core: { invoke: async(command,args)=>{
    window.__settingsCommands.push({command,args});
    if(command==='plugin:app|version')return '9.8.7-fixture';
    if(command==='get_platform')return{os:'linux',arch:'x86_64',family:'unix'};
    if(command==='get_full_telemetry'){
      if(config.mode==='unavailable')throw Error('Tauri bridge unavailable');
      if(config.mode==='loading')return new Promise(()=>{});
      return {platform:{os:'linux',arch:'x86_64',family:'unix'},env:{os:'linux',display_server:config.mode==='long'?'display-'+ 'LongMetadata'.repeat(25):'x11',ld_preload_injection:false,ptrace_scope:1},processes:{found:config.mode==='flagged'||config.mode==='long'?['screen-recorder-'+ 'long-name-'.repeat(15),'discord','discord']:[],clean:!['flagged','long'].includes(config.mode)},virt:{detected:config.mode==='flagged',platform:config.mode==='flagged'?'VirtualBox':null,confidence:'high'},network:null};
    }
    if(['unlock_desktop','disable_keyboard_intercept','disable_network_lockdown'].includes(command)){
      if(config.mode==='restore-error')throw Error('Fixture recovery failure');
      return null;
    }
    throw Error('Fixture command unavailable: '+command);
  }}};
}
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
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installFixtures.toString()})(${JSON.stringify(config)});(${installDashboardFixtures.toString()})(${JSON.stringify(config)});(${installSettingsFixtures.toString()})(${JSON.stringify(config)})` })).identifier;
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
  console.log('Captured', filename);
}
async function recordCheck(name, expression) {
  const passed = Boolean(await evaluate(expression));
  manifest.checks.push({ name, viewport, passed });
  if(!passed) console.error('FAILED CHECK DOM',await evaluate("({active:document.activeElement?.outerHTML.slice(0,400),dialogs:[...document.querySelectorAll('dialog')].map(d=>({label:d.getAttribute('aria-label'),open:d.open})),resolve:[...document.querySelectorAll('[aria-label^=\"Resolve\"]')].map(b=>({label:b.getAttribute('aria-label'),connected:b.isConnected}))})"));
  assert(passed, name);
}
async function key(key, shift = false) {
  await send('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,modifiers:shift?8:0,windowsVirtualKeyCode:key==='Escape'?27:key==='Tab'?9:key==='ArrowRight'?39:13,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
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
  async function settings(mode='normal') {
    await navigate('/home/', {mode,ready:"document.body.innerText.includes('Your contests')"});
    if(viewport.width<=1024) await click('Open navigation');
    await click('Settings');
    await until("!!document.querySelector('[role=tablist]')");
    await delay(350);
  }
  async function tab(label) { await click(label,{prefix:true});await until(`document.querySelector('[role=tab][aria-selected=true]')?.textContent.includes(${JSON.stringify(label)})`); }
  async function bounds(label){
    await recordCheck(label+' no page overflow', 'document.body.scrollWidth<=innerWidth&&[...document.querySelectorAll(".astryx-app-shell")].every(e=>e.scrollWidth<=e.clientWidth+1)');
    await recordCheck(label+' content remains within main width', `(()=>{const p=document.querySelector('[role=tabpanel]:not([hidden])');const m=document.querySelector('[data-testid=settings-panel]').getBoundingClientRect();return p&&[...p.querySelectorAll('button,[role=combobox],[role=slider],dl,video')].filter(e=>e.getClientRects().length).every(e=>{const r=e.getBoundingClientRect();return r.left>=m.left-1&&r.right<=m.right+1})})()`);
    await recordCheck(label+' one selected tab and associated panel', `(()=>{const t=document.querySelector('[role=tab][aria-selected=true]'),p=document.querySelector('[role=tabpanel]:not([hidden])');return document.querySelectorAll('[role=tab][aria-selected=true]').length===1&&p?.getAttribute('aria-labelledby')===t?.id&&t?.getAttribute('aria-controls')===p?.id})()`);
  }
  for (viewport of [{width:1440,height:1000},{width:1280,height:800},{width:1024,height:800},{width:800,height:700},{width:390,height:844},{width:320,height:700}]) {
    await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
    await settings();
    for(const label of ['Hardware','Permissions','Security','About']){
      await tab(label);await bounds(label);await capture(label.toLowerCase());await contrastAudit(undefined,8);
    }
    await recordCheck('Legal links retained', "['/privacy','/terms','/licenses'].every(h=>document.querySelector('a[href=\"'+h+'\"]'))");
    await recordCheck('About shows native app version',"document.body.innerText.includes('9.8.7-fixture')");
    await recordCheck('Tabs avoid current-page and selected-tab duplication',"[...document.querySelectorAll('[role=tab]')].every(t=>!t.hasAttribute('aria-current'))");
    await recordCheck('Placeholder version and theme text removed', "!document.body.innerText.includes('v0.1.0')&&!document.body.innerText.includes('Theme Change Toggle')");
    await tab('Hardware');
    await evaluate("document.querySelector('[role=tab][aria-selected=true]').focus()");await key('ArrowRight');
    await recordCheck('Tab arrow keyboard moves focus', "document.activeElement.getAttribute('role')==='tab'&&document.activeElement.textContent.includes('Permissions')");
    await key('Enter');await until("document.querySelector('[role=tabpanel]:not([hidden])').textContent.includes('Restore')");
  }
  viewport={width:1280,height:800};await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  for(const mode of ['unavailable','loading','flagged','long']){
    await settings(mode);await tab('Security');await capture('security-'+mode);await bounds('Security '+mode);
    if(mode==='unavailable'||mode==='loading')await recordCheck('Unmeasured processes never shown as cleared', "!document.querySelector('[role=tabpanel]:not([hidden])').innerText.includes('CLEARED')&&!document.querySelector('[role=tabpanel]:not([hidden])').innerText.includes('No restricted processes')");
    if(mode==='flagged')await recordCheck('Duplicate flagged process names render individually', "document.querySelector('[role=tabpanel]:not([hidden])').innerText.match(/discord/g)?.length===2");
  }
  await settings('normal');await tab('Security');
  const beforeScan=await evaluate("window.__settingsCommands.filter(c=>c.command==='get_full_telemetry').length");
  await click('Run Native Scan');
  await until(`window.__settingsCommands.filter(c=>c.command==='get_full_telemetry').length===${beforeScan+1}`);
  await recordCheck('Scan remains original native telemetry action', "window.__settingsCommands.filter(c=>c.command==='get_full_telemetry').every(c=>c.args.networkHost===null)");
  await tab('Permissions');await click('Restore system settings');await until("document.body.innerText.includes('have been restored')");
  await recordCheck('Restore invokes original three commands once', "['unlock_desktop','disable_keyboard_intercept','disable_network_lockdown'].every(cmd=>window.__settingsCommands.filter(c=>c.command===cmd).length===1)");await capture('restore-success');
  await settings('restore-error');await tab('Permissions');await click('Restore system settings');
  await until("document.querySelector('[role=tabpanel]:not([hidden])').innerText.includes('sudo')");await capture('restore-error');
  await settings('normal');
  await click('Start camera');await until("document.querySelector('[role=tabpanel]:not([hidden])').innerText.toLowerCase().includes('permission')");await capture('camera-denied');
  await click('Start microphone');await until("document.querySelector('[role=tabpanel]:not([hidden])').innerText.toLowerCase().includes('microphone permission')");await capture('microphone-denied');
  await settings('media');
  const scansBefore=await evaluate('window.__settingsDeviceScans');await click('Refresh cameras');
  await recordCheck('Refresh cameras enumerates devices', `window.__settingsDeviceScans===${scansBefore+1}`);
  await click('System default');await click('External camera',{prefix:true});
  await click('Start camera');await until("!!document.querySelector('video')?.srcObject");
  await recordCheck('Camera selector preserves selected device constraint', "window.__settingsMedia.some(c=>c.video?.deviceId?.exact==='camera-2')");
  await recordCheck('Camera shows real stream metadata after capture', "document.querySelector('[role=tabpanel]:not([hidden])').innerText.includes('640 × 480')");await capture('camera-live');
  await tab('Permissions');await recordCheck('Leaving hardware stops camera tracks', "window.__settingsTracks.filter(t=>t.kind==='video').every(t=>t.readyState==='ended')");
  await tab('Hardware');await click('Start microphone');await until("document.body.innerText.includes('Stop microphone')");
  await tab('Permissions');
  await recordCheck('Running microphone stays visible on other tabs', "document.body.innerText.includes('Microphone is running')&&window.__settingsTracks.some(t=>t.kind==='audio'&&t.readyState==='live')");
  await click('Manage microphone');
  await recordCheck('Manage microphone restores its stop control and focus', "document.activeElement.id==='settings-microphone-control'&&document.activeElement.textContent.includes('Stop microphone')");
  await click('Stop microphone');
  await recordCheck('Stopping microphone releases tracks', "window.__settingsTracks.filter(t=>t.kind==='audio').every(t=>t.readyState==='ended')");
  await evaluate("document.querySelector('[role=slider]').focus()");await key('ArrowRight');
  await recordCheck('Volume slider changes existing speaker value with keyboard', "Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow'))>50");
  await click('Play test tone');await recordCheck('Tone playback disables duplicate activation', "[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Playing')&&b.disabled)");
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Play test tone')&&!b.disabled)");
  await click('I heard the tone');await recordCheck('Speaker confirmation remains local', "document.querySelector('[aria-labelledby=settings-speakers-heading]').innerText.includes('Confirmed')");
  viewport={width:320,height:700};await send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});
  await settings('long');await click('System default');await capture('long-camera-options');
  await recordCheck('Long camera options stay within narrow viewport', "[...document.querySelectorAll('[role=listbox]')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})");await key('Escape');
  await tab('Security');await bounds('Long narrow security');await capture('long-security');
  await recordCheck('UI testing did not submit backend mutations', "!(window.__p0Requests||[]).some(r=>r.method==='POST')");
} catch (err) { manifest.failures.push(err.stack); console.error(err); if(ws?.readyState===WebSocket.OPEN){ console.error('DOM',await evaluate('({url:location.href,state:document.readyState,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,3000)})').catch(String)); } process.exitCode = 1; }
finally {
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.failures.length) await writeFile(path.resolve(evidenceRoot, 'latest.json'), JSON.stringify({directory:path.basename(output)},null,2)+'\n');
  if (ws?.readyState === WebSocket.OPEN) { await send('Page.navigate', { url: 'about:blank' }).catch(() => {}); ws.close(); }
  chrome.kill('SIGTERM'); await delay(500); await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ captures: manifest.captures.length, checks: manifest.checks.length, failures: manifest.failures.length }));
}
