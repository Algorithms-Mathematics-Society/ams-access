// Test-only readers of the actual emitted theme and its migration aliases.
import { readFileSync } from 'node:fs';
import { accessTheme } from '../theme/access.js';
export const tokens = accessTheme.tokens;
export const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
export const compatibilityCss = readFileSync(new URL('../theme/compatibility.css', import.meta.url), 'utf8');
export const themeCss = readFileSync(new URL('../theme/accessTheme.css', import.meta.url), 'utf8');
export const aliases = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*(var\(--[\w-]+\))\s*;/g)].map(m => [m[1], m[2]]));
export function value(token, mode, seen = []) {
  if (seen.includes(token)) throw Error(`Token cycle: ${[...seen, token].join(' -> ')}`);
  const raw = aliases[token] ?? tokens[token];
  if (!raw) throw Error(`Unknown theme token: ${token}`);
  const alias = raw.match(/^var\((--[\w-]+)\)$/);
  if (alias) return value(alias[1], mode, [...seen, token]);
  const pair = raw.match(/^light-dark\((#[0-9a-f]{6,8}),\s*(#[0-9a-f]{6,8})\)$/i);
  if (pair) return pair[mode === 'light' ? 1 : 2];
  return raw;
}
export function rgba(raw) {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) throw Error(`Unsupported test color: ${raw}`);
  return [1,3,5].map(i => parseInt(raw.slice(i,i+2),16)).concat(raw.length === 9 ? parseInt(raw.slice(7,9),16)/255 : 1);
}
export function composite(fg,bg) { return fg.slice(0,3).map((c,i) => fg[3]*c+(1-fg[3])*bg[i]).concat(1); }
const luminance = rgba => rgba.slice(0,3).map(c => c/255).map(c => c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4).reduce((a,c,i)=>a+c*[0.2126,0.7152,0.0722][i],0);
export function contrast(fg,bg) { const a=luminance(composite(fg,bg)), b=luminance(bg); return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05); }
