import test from 'node:test';
import assert from 'node:assert/strict';
import { latestResumeRequest, ProctorApiError } from './proctor-api.ts';
import { startResumePolling } from '../app/home/components/resume-polling.ts';
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

test('stalled response body times out and the next resume polling tick can retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let calls = 0;
  const errors = [], decisions = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls++;
    if (calls > 1) return new Response(JSON.stringify({ uid: 'request', status: 'APPROVED' }));
    return { ok: true, text: () => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }) };
  });
  const stop = startResumePolling(async () => {
    try { decisions.push(await latestResumeRequest('session')); }
    catch (error) { errors.push(error); }
  });
  await settle(); assert.equal(calls, 1);
  for (let i = 0; i < 7; i++) { t.mock.timers.tick(3000); await settle(); }
  assert.equal(errors.length, 1);
  assert(errors[0] instanceof ProctorApiError);
  assert.equal(errors[0].code, 'TIMEOUT');
  t.mock.timers.tick(3000); await settle();
  assert(calls >= 2);
  assert.equal(decisions.at(-1).status, 'APPROVED');
  stop();
});

test('HTTP errors retain their status and successful bodies clear the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 });
  });
  await assert.rejects(latestResumeRequest('session'), (error) => error.status === 404 && error.message === 'Not found');
  t.mock.timers.tick(20_000);
  assert.equal(signal.aborted, false);
});
