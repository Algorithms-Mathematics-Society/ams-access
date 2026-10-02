import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeResumeRequestIntoSession, startResumePolling } from './resume-polling.ts';

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const session = { id: 'session', resume_request_id: 'request', resume_request_status: 'PENDING', resume_request_requested_at: 'today', resume_request_review_note: null };

test('unchanged approval response preserves session identity; decision and note updates are retained', () => {
  assert.equal(mergeResumeRequestIntoSession(session, { id: 'request', status: 'PENDING', requested_at: 'today', review_note: null }), session);
  assert.equal(mergeResumeRequestIntoSession(session, { status: 'APPROVED' }).resume_request_status, 'APPROVED');
  assert.equal(mergeResumeRequestIntoSession(session, { review_note: 'Contact proctor' }).resume_request_review_note, 'Contact proctor');
});

test('polls immediately then every three seconds, with no requests between ticks', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startResumePolling(async () => { calls++; });
  await settle();
  assert.equal(calls, 1);
  t.mock.timers.tick(2999); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await settle(); assert.equal(calls, 2);
  t.mock.timers.tick(3000); await settle(); assert.equal(calls, 3);
  stop(); t.mock.timers.tick(9000); await settle(); assert.equal(calls, 3);
});

test('slow requests never overlap and disposal invalidates the outstanding response', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, complete, cancelled, applied = false;
  const stop = startResumePolling(async (isCancelled) => {
    calls++; cancelled = isCancelled;
    await new Promise((resolve) => { complete = resolve; });
    if (!isCancelled()) applied = true;
  });
  t.mock.timers.tick(12_000); await settle(); assert.equal(calls, 1);
  stop(); assert.equal(cancelled(), true); complete(); await settle();
  assert.equal(applied, false);
});
