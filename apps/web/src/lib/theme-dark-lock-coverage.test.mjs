// Route policy is tested by theme-bridge-core.test.mjs; this guards the CSS side:
// no independently light-scoped alias may bypass that effective-mode policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aliases, css, compatibilityCss, tokens, themeCss, value, rgba } from './theme-test-tokens.mjs';

const rules = [...(css + compatibilityCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1],body:m[2]}));

test('light-specific legacy declarations cannot leak onto dark-locked routes', () => {
  for (const rule of rules.filter(r => /\.light\b/.test(r.selector) && /--[\w-]+\s*:/.test(r.body))) {
    assert.match(rule.selector, /:not\(\s*\.theme-dark-locked\s*\)/, rule.selector);
  }
  // The new guard is non-vacuous even without light-only aliases: every formerly
  // leaking color/surface/verdict role must resolve to the canonical mode pair.
  for (const token of ['--surface-2','--text-dim','--verdict-ac','--theme-bg','--theme-accent']) {
    assert.ok(aliases[token], `${token} lost its migration alias`);
    assert.notEqual(value(token,'light'),value(token,'dark'), `${token} lost effective-mode coverage`);
  }
});

test('canonical theme colors are owned by the generated theme, not legacy globals', () => {
  for (const name of Object.keys(tokens).filter(name=>name.startsWith('--color-'))) {
    assert.doesNotMatch(css, new RegExp(name+'\\s*:'), `${name} has competing ownership`);
    assert.ok(themeCss.includes(`${name}: ${tokens[name]};`), `${name} missing from generated stylesheet`);
  }
});

test('migration alias graph has no self-reference or cycles', () => {
  for (const name of Object.keys(aliases)) {
    const visited = new Set();
    let current = name;
    while (aliases[current]) {
      assert(!visited.has(current), `cyclic alias beginning at ${name}: ${[...visited,current].join(' -> ')}`);
      visited.add(current);
      current = aliases[current].slice(4,-1);
    }
  }
});

test('root provider inherits pre-paint policy instead of imposing SSR default dark', () => {
  assert.ok(rules.some(r => /body\s*>\s*\[data-astryx-theme="access"\]/.test(r.selector) && /color-scheme\s*:\s*inherit/.test(r.body)));
  assert.match(css, /@layer\s+reset,\s*theme,\s*base,\s*astryx-base,\s*astryx-theme,\s*components,\s*utilities/);
});

test('legacy accent triplets match canonical mode colors and exclude dark locks', () => {
  const dark = compatibilityCss.match(/:root\s*\{([^}]+)\}/)?.[1];
  const light = compatibilityCss.match(/html\.light:not\(\.theme-dark-locked\)\s*\{([^}]+)\}/)?.[1];
  assert.ok(dark && light, 'Both compatibility facets and the route-lock exclusion must exist');
  for (const [mode, declarations] of [['light',light],['dark',dark]]) {
    for (const [alias,canonical] of [['--accent-rgb','--color-accent'],['--accent-light-rgb','--color-text-accent']]) {
      const actual = declarations.match(new RegExp(alias+':\\s*([^;]+);'))?.[1].trim().split(/\s+/).map(Number);
      assert.deepEqual(actual,rgba(value(canonical,mode)).slice(0,3));
    }
  }
});
