import test from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserMediaAvailability, getUserMediaWithTimeout } from './media-availability.ts';
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function media(t, getUserMedia) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia } } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; });
}

test('permission denial rejects only the returned promise (no unhandled side promise)', async (t) => {
  media(t, async () => { throw new Error('Permission denied'); });
  await assert.rejects(getUserMediaWithTimeout({ video: true }), /Permission denied/);
  await settle();
});

test('a timed-out permission request stops a stream that arrives late', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve, stopped = 0;
  media(t, () => new Promise((done) => { resolve = done; }));
  const request = getUserMediaWithTimeout({ video: true }, 10);
  const rejected = assert.rejects(request, /timed out/);
  await settle(); t.mock.timers.tick(10); await rejected;
  resolve({ getTracks: () => [{ stop: () => stopped++ }] }); await settle();
  assert.equal(stopped, 1);
});

test('overlapping readiness probes share camera/mic requests, release tracks, and later rescan freshly', async (t) => {
  let calls = 0, stops = 0;
  media(t, async () => { calls++; return { getTracks: () => [{ stop: () => stops++ }] }; });
  const first = getBrowserMediaAvailability(), second = getBrowserMediaAvailability();
  assert.equal(first, second);
  assert.deepEqual(await first, { cameraAvailable: true, microphoneAvailable: true });
  assert.equal(calls, 2); assert.equal(stops, 2);
  await getBrowserMediaAvailability(); assert.equal(calls, 4); assert.equal(stops, 4);
});

test('missing mediaDevices produces an unavailable report rather than an unhandled rejection', async (t) => {
  media(t, undefined);
  assert.deepEqual(await getBrowserMediaAvailability(), { cameraAvailable: false, microphoneAvailable: false });
});
