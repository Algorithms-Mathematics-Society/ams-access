import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HOME = new URL("../app/home/", import.meta.url).pathname;
function homeFiles(dir = HOME, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) homeFiles(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(e)) acc.push(p);
  }
  return acc;
}
// Detectors operate on a source STRING so they can be proven-sensitive on fixtures.
// All real-tree scans run on stripComments(source) so fold-audit annotations in
// ui-primitives.tsx (e.g. `// dark rgba(255,255,255,0.70)`) are not live-style positions
// and must not trigger the guard.
const stripComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/([^:])\/\/[^\n]*/g, "$1") // line comments ("://" in URLs preserved)
    .replace(/^\/\/[^\n]*/gm, ""); // line comment at start of line
const bareWhiteAlpha = (s) => [...s.matchAll(/rgba\(\s*255\s*,\s*255\s*,\s*255/gi)];
const opaqueZinc = (s) => [
  ...s.matchAll(/#(27272a|3f3f46|52525b|71717a|1a1a24|18181b|a1a1aa)\b/gi),
];
const blackAlpha = (s) => [...s.matchAll(/rgba\(\s*0\s*,\s*0\s*,\s*0/gi)];
const RAW_STATUS =
  /#(ef4444|fca5a5|f87171|f59e0b|fbbf24|fcd34d|fde047|4ade80|22c55e|86efac|a1a1aa|c084fc)\b/gi;
const rawStatusHex = (s) => [...s.matchAll(RAW_STATUS)];
// on-neutral #ffffff = a #ffffff NOT on a var(--color-accent-base) surface. We assert the count of
// bare #ffffff equals the known KEEP-set count (ledger §4: on-accent only). Any NEW bare #ffffff
// tips the count and fails — pointing the reviewer at it to classify.
const KEEP_FFFFFF = 14; // ledger §4 on-accent sites; update deliberately if the accent-button set changes
const anyFfffff = (s) => [...s.matchAll(/#ffffff\b/gi)];

const files = homeFiles();
const all = files.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");

test("NEUTRAL completeness: no bare white-alpha literal in app/home", () => {
  const hits = files.flatMap((f) =>
    bareWhiteAlpha(stripComments(readFileSync(f, "utf8"))).map(() => f)
  );
  assert.equal(hits.length, 0, `bare white-alpha remains in: ${[...new Set(hits)].join(", ")}`);
});
test("NEUTRAL completeness: no opaque zinc/gray hex in app/home", () => {
  const hits = files.flatMap((f) =>
    opaqueZinc(stripComments(readFileSync(f, "utf8"))).map((m) => `${f}:${m[0]}`)
  );
  assert.equal(hits.length, 0, `opaque zinc remains: ${hits.join(", ")}`);
});
test("NEUTRAL completeness: black-alpha rgba(0,0,0,…) only the 2 scrims", () => {
  assert.equal(blackAlpha(all).length, 2, "black-alpha count != 2 (KEEP scrims only)");
});
test("NEUTRAL completeness: bare #ffffff count == KEEP set (on-accent only)", () => {
  assert.equal(
    anyFfffff(all).length,
    KEEP_FFFFFF,
    "a new bare #ffffff appeared — classify on-accent (keep) vs on-neutral (fold)"
  );
});
test("STATUS completeness: no raw status hex literal in app/home", () => {
  const hits = files.flatMap((f) =>
    rawStatusHex(stripComments(readFileSync(f, "utf8"))).map((m) => `${f}:${m[0]}`)
  );
  assert.equal(hits.length, 0, `raw status hex remains: ${hits.join(", ")}`);
});

// ── PROVEN-SENSITIVE: each detector must catch its class on a known-bad fixture ──
test("PROVEN-SENSITIVE (neutral): detector catches an injected bare white-alpha", () => {
  assert.ok(bareWhiteAlpha('color: "rgba(255,255,255,0.45)"').length === 1);
});
test("PROVEN-SENSITIVE (neutral): detector catches an injected opaque zinc", () => {
  assert.ok(opaqueZinc('border: "1px solid #27272a"').length === 1);
});
test("PROVEN-SENSITIVE (status): detector catches an injected raw status hex", () => {
  assert.ok(rawStatusHex('color: "#ef4444"').length === 1);
});

// ── CORRECTNESS: comment mentions must NOT be flagged (they are not live style positions) ──
test("CORRECTNESS: a color literal in a // comment is NOT flagged (comments are not live style)", () => {
  assert.equal(
    bareWhiteAlpha(stripComments("  text: x, // dark rgba(255,255,255,0.70); was 0.72")).length,
    0
  );
  assert.equal(rawStatusHex(stripComments("  // dark #22c55e; was #4ade80")).length, 0);
});
