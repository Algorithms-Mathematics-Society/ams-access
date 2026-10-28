import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {", source.indexOf("// The Mac slept mid-exam"));
const end = source.indexOf("  // A camera-less advisory", start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
test("Mac wake refreshes server time and stops doing work after navigation", async () => {
  let callback, cleanup, beats = 0, incidents = 0;
  vm.runInNewContext(code, {
    sessionId: "s1", contestId: "c1", API_URL: "https://test.invalid",
    useEffect: (f) => { cleanup = f(); },
    listen: async (_, fn) => { callback = fn; return () => {}; },
    retryBeatRef: { current: () => { beats++; } },
    authHeaders: () => ({}),
    postJsonKeepalive: async () => { incidents++; return { ok: true }; },
  });
  callback({ kind: "other" });
  assert.equal(beats, 0);
  callback({ kind: "system_woke", payload: { slept_secs: 90 } });
  await Promise.resolve();
  assert.equal(beats, 1);
  assert.equal(incidents, 1);
  cleanup();
  callback({ kind: "system_woke" });
  assert.equal(beats, 1);
  assert.equal(incidents, 1);
});
