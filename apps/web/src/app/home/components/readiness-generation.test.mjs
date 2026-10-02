import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const home = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'HomePage');
const scan = home.body.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'runIntegrityScan');
const lifecycle = home.body.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect' && node.expression.arguments[0].getText(ast).includes('void runIntegrityScan'));
assert(scan && lifecycle, 'Test must exercise the actual Home scan and its lifecycle effect');
const program = ts.transpileModule(`${scan.getText(ast)}\nconst effect = ${lifecycle.expression.arguments[0].getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness() {
  const calls = [], applied = [], logs = [];
  let readiness;
  const context = {
    scanGenerationRef: { current: 0 },
    setReadinessReport: (report) => { if (report) applied.push(report); },
    setReadiness: (value) => { readiness = value; },
    appendSecurityEvent: (event) => logs.push(event),
    getBrowserMediaAvailability: async () => ({ cameraAvailable: true, microphoneAvailable: true }),
    getOrCreateDeviceId: () => 'device',
    fetchOrganizerOverrides: async () => [],
    API_URL: 'https://example.invalid',
    participantToken: () => 'token',
    invoke: async () => ({ label: 'linux', os: 'linux' }),
    sessionPolicy: (profile) => ({ profile }),
    applyOrganizerOverrides: (policy) => policy,
    runSessionReadiness: (options) => new Promise((resolve) => calls.push({ options, resolve })),
    readinessFromReport: (report) => ({ camera: 'ok', mic: 'ok', reportId: report.id }),
  };
  const keys = Object.keys(context);
  // Effect dependencies are component state; keep the same lexical bindings
  // across renders while deferred promises capture their own scan arguments.
  const scopedCreate = new Function(...keys, `let preflightContestId = null, identityHydrated = false; ${program}\nreturn { scan: runIntegrityScan, start: (target, hydrated = true) => { preflightContestId = target; identityHydrated = hydrated; return effect(); } };`);
  const { start, scan: manual } = scopedCreate(...Object.values(context));
  return { start, manual, calls, applied, logs, readiness: () => readiness };
}

test('closing pending preflight starts a fresh baseline and rejects stale baseline/strict reports', async () => {
  const h = harness();
  assert.equal(h.start(null, false), undefined);
  await settle(); assert.equal(h.calls.length, 0);
  let cleanup = h.start(null); await settle();
  assert.equal(h.calls[0].options.policy.profile, 'internal_pilot');
  cleanup(); cleanup = h.start('contest'); await settle();
  assert.equal(h.calls[1].options.policy.profile, 'strict_contest');
  cleanup(); cleanup = h.start(null); await settle();
  assert.equal(h.calls[2].options.policy.profile, 'internal_pilot');
  h.calls[1].resolve({ id: 'stale-strict', decision: 'blocked' });
  h.calls[0].resolve({ id: 'stale-baseline', decision: 'allowed' });
  await settle();
  assert.equal(h.applied.length, 0);
  assert.equal(h.readiness().camera, 'checking');
  h.calls[2].resolve({ id: 'fresh-baseline', decision: 'allowed' }); await settle();
  assert.deepEqual(h.applied.map((report) => report.id), ['fresh-baseline']);
  assert.equal(h.readiness().camera, 'ok');
  assert.equal(h.readiness().reportId, 'fresh-baseline');
  cleanup();
});

test('changing contests also invalidates an outstanding manual rescan', async () => {
  const h = harness();
  let cleanup = h.start('first'); await settle();
  const manual = h.manual(undefined, 'first'); await settle();
  cleanup(); cleanup = h.start('second'); await settle();
  h.calls[0].resolve({ id: 'old-automatic', decision: 'allowed' });
  h.calls[1].resolve({ id: 'old-manual', decision: 'allowed' });
  await manual; await settle();
  assert.equal(h.applied.length, 0);
  h.calls[2].resolve({ id: 'second-contest', decision: 'blocked' }); await settle();
  assert.deepEqual(h.applied.map((report) => report.id), ['second-contest']);
  assert.equal(h.calls[2].options.contestId, 'second');
  cleanup();
});
