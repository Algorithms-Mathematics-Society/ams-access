import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke, fetchOrganizerOverrides } from './index.ts';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
test('native metadata is shared across simultaneous calls; live telemetry is never cached', async (t) => {
  const previous = globalThis.__TAURI__;
  t.after(() => { globalThis.__TAURI__ = previous; });
  const calls = [];
  globalThis.__TAURI__ = { core: { invoke: async (command) => { calls.push(command); return { os: 'linux' }; } } };
  await Promise.all([invoke('get_platform'), invoke('get_platform')]);
  await invoke('get_platform');
  await invoke('plugin:app|version'); await invoke('plugin:app|version');
  await invoke('get_full_telemetry'); await invoke('get_full_telemetry');
  await invoke('get_platform', {});
  assert.deepEqual(calls, ['get_platform', 'plugin:app|version', 'get_full_telemetry', 'get_full_telemetry', 'get_platform']);
});
test('failed metadata is retried and a replacement bridge has its own cache', async (t) => {
  const previous = globalThis.__TAURI__; t.after(() => { globalThis.__TAURI__ = previous; });
  let calls = 0;
  globalThis.__TAURI__ = { core: { invoke: async () => { if (++calls === 1) throw new Error('unavailable'); return 'old'; } } };
  await assert.rejects(invoke('get_platform'), /unavailable/);
  assert.equal(await invoke('get_platform'), 'old'); assert.equal(calls, 2);
  globalThis.__TAURI__ = { core: { invoke: async () => 'new' } };
  assert.equal(await invoke('get_platform'), 'new');
});
for (const stalledPart of ['headers', 'body']) test(`override timeout covers stalled ${stalledPart} and falls back to the base policy`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    const never = () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    if (stalledPart === 'headers') return never();
    return { ok: true, json: never };
  });
  const request = fetchOrganizerOverrides('https://example.invalid', 'contest', 'device', 'token');
  await settle(); t.mock.timers.tick(9999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); assert.deepEqual(await request, []); assert.equal(signal.aborted, true);
});
test('successful override fetch clears its timer and still filters non-waivable grants', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return { ok: true, json: async () => [{ check_kind: 'contest_id', expires_at_ms: Date.now() + 60_000 }, { check_kind: 'camera', expires_at_ms: Date.now() + 60_000 }] };
  });
  const grants = await fetchOrganizerOverrides('https://example.invalid', 'contest', 'device', 'token');
  assert.deepEqual(grants.map((g) => g.check_kind), ['camera']);
  t.mock.timers.tick(10_000); assert.equal(signal.aborted, false);
});
