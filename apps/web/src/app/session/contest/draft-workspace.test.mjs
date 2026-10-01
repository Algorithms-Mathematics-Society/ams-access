import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftSaveQueue, restoreDraftWorkspace } from './draft-workspace.ts';
import { read, bufferKey } from './answer-buffer.ts';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const files = [{ id: 'A:main', name: 'main.cpp', content: 'answer' }, { id: 'A:scratch-1', name: 'scratch.cpp', content: 'scratch answer' }];
const buffer = (extra = {}) => ({ files, activeFileId: 'A:scratch-1', language: 'cpp', revision: 4, savedAtMs: 1, ...extra });

test('queued save retains edited A after navigation to B during earlier A save', async () => {
  const queue = createDraftSaveQueue();
  const gate = deferred();
  const writes = [];
  let current = { question: 'A', source: 'old A' };
  const request = () => { const snapshot = current; return queue(snapshot.question, async () => { writes.push(snapshot); if (writes.length === 1) await gate.promise; return true; }); };
  const oldA = request();
  current = { question: 'A', source: 'latest A' };
  const newA = request();
  current = { question: 'B', source: 'B' };
  const b = request();
  gate.resolve();
  assert.deepEqual(await Promise.all([oldA, newA, b]), [true, true, true]);
  assert.deepEqual(writes.map(x => [x.question, x.source]), [['A', 'old A'], ['A', 'latest A'], ['B', 'B']]);
});

test('awaited save receives its own result, and rejection never strands another question', async () => {
  const queue = createDraftSaveQueue();
  const gate = deferred();
  const a = queue('A', async () => { await gate.promise; throw Error('offline'); });
  const b = queue('B', async () => true);
  gate.resolve();
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
});

test('local-only question restores every tab and active scratch file', () => {
  const result = restoreDraftWorkspace('A', 'main.cpp', buffer(), null);
  assert.deepEqual(result.files, files);
  assert.equal(result.activeFileId, 'A:scratch-1');
  assert.equal(result.recovered, true);
});

test('matching server draft retains scratch workspace without false recovery warning', () => {
  const result = restoreDraftWorkspace('A', 'main.cpp', buffer(), { source: 'scratch answer', language: 'cpp', client_revision: 4 });
  assert.deepEqual(result.files, files);
  assert.equal(result.activeFileId, 'A:scratch-1');
  assert.equal(result.recovered, false);
});

test('newer server draft takes precedence while retaining unsynced scratch tabs', () => {
  const result = restoreDraftWorkspace('A', 'main.cpp', buffer(), { source: 'new server answer', language: 'cpp', client_revision: 5 });
  assert.equal(result.files[0].content, 'new server answer');
  assert.deepEqual(result.files[1], files[1]);
  assert.equal(result.activeFileId, 'A:main');
});

test('language-only change is recovered even if source matches', () => {
  const result = restoreDraftWorkspace('A', 'main.cpp', buffer({ language: 'python3' }), { source: 'scratch answer', language: 'cpp', client_revision: 4 });
  assert.equal(result.recovered, true);
  assert.equal(result.language, 'python3');
});

test('malformed local file data is ignored instead of crashing editor startup', () => {
  for (const value of [{ files: [null], language: 'cpp' }, { files: [{id:'A',name:'a',content:22}], language:'cpp' }, {files:[],language:'cpp'}]) {
    assert.equal(read({ getItem: () => JSON.stringify(value) }, 's', 'A'), null);
  }
  const restored = read({ getItem: () => JSON.stringify(buffer({ activeFileId: 'missing' })) }, 's', 'A');
  assert.equal(restored.activeFileId, 'A:main');
});

test('slow saves coalesce latest pending source per question without dropping another question', async () => {
  const queue = createDraftSaveQueue();
  const gate = deferred();
  const writes = [];
  const first = queue('A', async () => { await gate.promise; return true; });
  const a2 = queue('A', async () => { writes.push('old A'); return false; });
  const b = queue('B', async () => { writes.push('B'); return true; });
  const a3 = queue('A', async () => { writes.push('new A'); return true; });
  gate.resolve();
  assert.deepEqual(await Promise.all([first, a2, b, a3]), [true, true, true, true]);
  assert.deepEqual(writes, ['new A', 'B']);
});

 test('invalid persisted revision cannot poison subsequent save requests', () => {
  for (const revision of [-1, 1.5, '12', Infinity]) {
    const restored = read({ getItem: () => JSON.stringify(buffer({ revision })) }, 's', 'A');
    assert.equal(restored.revision, 0);
  }
});
