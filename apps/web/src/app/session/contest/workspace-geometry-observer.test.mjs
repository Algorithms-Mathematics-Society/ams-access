import test from 'node:test';
import assert from 'node:assert/strict';
import { observeWorkspaceGeometry } from './workspace-geometry-observer.ts';

test('text mutations do not measure; replaced editors are released and layout resizes still measure', () => {
  const originalResize = globalThis.ResizeObserver;
  const originalMutation = globalThis.MutationObserver;
  let resize, mutation;
  class Resize {
    watched = new Set();
    constructor(callback) { this.callback = callback; resize = this; }
    observe(node) { this.watched.add(node); }
    unobserve(node) { this.watched.delete(node); }
    disconnect() { this.watched.clear(); }
  }
  class Mutation {
    disconnected = false;
    constructor(callback) { this.callback = callback; mutation = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  globalThis.ResizeObserver = Resize;
  globalThis.MutationObserver = Mutation;
  try {
    let code = { kind: 'old editor' };
    const editor = { kind: 'editor shell' };
    const container = { querySelector: selector => selector === '.cm-editor' ? code : selector === '[aria-label="Code editor"]' ? editor : null };
    let measures = 0;
    const cleanup = observeWorkspaceGeometry(container, () => measures++);
    const initial = measures;
    for (let i = 0; i < 100; i++) mutation.callback();
    assert.equal(measures, initial);
    const old = code;
    code = { kind: 'new editor' };
    mutation.callback();
    assert.equal(measures, initial + 1);
    assert.equal(resize.watched.has(old), false);
    assert.equal(resize.watched.has(code), true);
    resize.callback();
    assert.equal(measures, initial + 2);
    cleanup();
    assert.equal(resize.watched.size, 0);
    assert.equal(mutation.disconnected, true);
  } finally {
    globalThis.ResizeObserver = originalResize;
    globalThis.MutationObserver = originalMutation;
  }
});
