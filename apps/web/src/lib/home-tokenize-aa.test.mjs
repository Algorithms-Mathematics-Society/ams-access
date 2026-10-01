// Contrast uses emitted palette values and actual legacy aliases, not an old
// cream-palette ledger. Disabled text is excluded from ordinary text AA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { value, rgba, composite, contrast, themeCss, css } from './theme-test-tokens.mjs';

const surfaces = ['--color-background-body','--color-background-card','--color-background-surface','--color-background-popover','--color-background-muted'];
const readable = ['--theme-text','--theme-text-muted','--theme-text-muted-strong','--text-dim','--home-status-ok','--home-status-error','--theme-error-text','--home-status-warn','--theme-accent-text'];
for (const mode of ['light','dark']) {
  for (const token of readable) {
    test(`${token} ${mode} text meets AA on every shared surface`, () => {
      for (const surface of surfaces) {
        const ratio = contrast(rgba(value(token,mode)),rgba(value(surface,mode)));
        assert(ratio>=4.5, `${token} on ${surface} (${mode}) = ${ratio.toFixed(2)}:1 < 4.5`);
      }
    });
  }
  test(`${mode} primary and Submit text meet AA`, () => {
    for (const [fg,bg] of [['--color-background-body','--color-background-inverted'],['--color-on-accent','--color-accent']]) {
      const ratio=contrast(rgba(value(fg,mode)),rgba(value(bg,mode)));
      assert(ratio>=4.5, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
  });
  test(`${mode} focus ring and success dot retain 3:1 graphical contrast`, () => {
    for (const token of ['--theme-dot','--color-accent']) {
      for (const surface of surfaces) {
        const ratio=contrast(rgba(value(token,mode)),rgba(value(surface,mode)));
        assert(ratio>=3, `${token} on ${surface} (${mode}) = ${ratio.toFixed(2)}:1 < 3`);
      }
    }
  });
  test(`${mode} neutral surfaces and borders are achromatic; hover moves in readable direction`, () => {
    for (const token of [...surfaces,'--home-border-control','--home-border-hover','--home-overlay-rail']) {
      const channels=rgba(value(token,mode)).slice(0,3);
      assert.equal(Math.max(...channels),Math.min(...channels), `${token} acquired a color cast`);
    }
    const bg=rgba(value('--color-background-body',mode));
    const hover=composite(rgba(value('--home-overlay-faintest',mode)),bg);
    assert(mode==='light' ? hover[0]<bg[0] : hover[0]>bg[0], `${mode} hover has wrong polarity`);
  });
}

test('contrast guard rejects former unreadable status green and detects alpha compositing', () => {
  const bg=rgba('#eeeeee');
  assert(contrast(rgba('#4ade80'),bg)<4.5);
  assert(contrast(rgba('#10b981'),bg)<4.5);
  assert(contrast(rgba('#00000010'),rgba('#ffffff'))<4.5);
  assert.equal(contrast(rgba('#000000'),rgba('#ffffff')),21);
  assert(Math.abs(contrast(rgba('#777777'),rgba('#ffffff'))-4.478089453577214)<1e-10, 'sRGB gamma must be 2.4');
});

for (const mode of ['light','dark']) {
  test(`${mode} primary and Submit hover/active text meet AA`, () => {
    for (const variant of ['primary','submit']) {
      const foreground=rgba(value(variant==='primary' ? '--color-background-body' : '--color-on-accent',mode));
      for (const state of ['hover','active']) {
        const rule=themeCss.match(new RegExp('\\.astryx-button\\.'+variant+':'+state+'\\s*\\{([^}]+)\\}'));
        assert.ok(rule, `Missing ${variant}:${state} theme rule`);
        const mix=rule[1].match(/background-color:\s*color-mix\(in srgb, var\((--[\w-]+)\), var\((--[\w-]+)\) ([\d.]+)%\)/);
        assert.ok(mix, `Update state contrast evaluation for ${variant}:${state} if its CSS color function changes`);
        const a=rgba(value(mix[1],mode)), b=rgba(value(mix[2],mode)), t=Number(mix[3])/100;
        const background=a.slice(0,3).map((c,i)=>c*(1-t)+b[i]*t).concat(1);
        const ratio=contrast(foreground,background);
        assert(ratio>=4.5, `${variant}:${state} (${mode}) = ${ratio.toFixed(2)}:1 < 4.5`);
      }
    }
  });
}

const legacyActions=['onb-btn--primary','results-btn-primary','help-btn-primary','welcome-cta'];
const legacyRule=name=>css.match(new RegExp('\\.'+name+'\\s*\\{([^}]+)\\}'))?.[1];
test('legacy solid accent CSS actions declare paired foregrounds', () => {
  for (const name of legacyActions) {
    const rule=legacyRule(name);
    assert.ok(rule, `Missing action rule ${name}`);
    assert.match(rule,/color:\s*var\(--color-on-accent\)/, `${name} must inherit the paired foreground`);
  }
});
for (const mode of ['light','dark']) {
  test(`${mode} legacy solid actions remain AA across brightness and hover states`, () => {
    const fg=rgba(value('--color-on-accent',mode));
    for (const name of legacyActions) {
      const bgToken=legacyRule(name).match(/background:\s*var\((--[\w-]+)\)/)?.[1];
      assert.ok(bgToken);
      const bg=rgba(value(bgToken,mode));
      for (const factor of [1,1.08,1.1]) {
        const brighten=color=>color.slice(0,3).map(c=>Math.min(255,c*factor)).concat(1);
        assert(contrast(brighten(fg),brighten(bg))>=4.5, `${name} ${mode} brightness ${factor} lost AA`);
      }
    }
    const welcomeHover=rgba(value('--color-accent-light',mode));
    assert(contrast(fg,welcomeHover)>=4.5, 'Welcome hover lost AA');
    const submitHover=rgba(value('--color-accent-base',mode)).slice(0,3).map(c=>c*.88+255*.12).concat(1);
    assert(contrast(fg,submitHover)>=4.5, 'Legacy Submit/recovery hover lost AA');
    if(mode==='dark') {
      for(const surface of surfaces) {
        const panel=rgba(value(surface,mode));
        const fadedFg=composite(fg.slice(0,3).concat(.88),panel);
        const fadedBg=composite(rgba(value('--color-accent-base',mode)).slice(0,3).concat(.88),panel);
        assert(contrast(fadedFg,fadedBg)>=4.5, `Recovery opacity hover on ${surface} lost AA`);
      }
    }
  });
}

test('legacy inline solid action styles preserve on-accent pairing', () => {
  for(const [file,minimum] of [['../app/home/page.tsx',0],['../app/home/components/SessionReadinessModal.tsx',0],['../app/home/components/ResolveModal.tsx',0],['../app/session/contest/client.tsx',4],['../app/session/contest/components/EditorPanel.tsx',1]]) {
    const source=readFileSync(new URL(file,import.meta.url),'utf8');
    const styles=[...source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)].map(m=>m[1]);
    const solid=styles.filter(style=>/\bcolor:/.test(style) && /background:\s*[^,]*(?:var\(--color-accent-(?:base|deep)\)|c\.accent)/.test(style));
    assert(solid.length>=minimum, `Expected ${minimum} solid action foregrounds in ${file}, found ${solid.length}`);
    for(const style of solid) assert.match(style,/color:\s*[^\n]*var\(--color-on-accent\)/, `${file}: solid action has an unpaired foreground`);
  }
});
