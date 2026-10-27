import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
const start = source.indexOf("  useEffect(() => {", source.indexOf("// Background backup of the device buffer"));
const end = source.indexOf("  // Flush the moment", start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class ApiError extends Error { status = 403; }
function harness() {
  let tick, cleanup, resolve, reject, calls = 0;
  const context = {
    sessionId: "s1", questions: [{ id: "p1" }], DRAFT_BACKUP_MS: 30000,
    draftBackupFlightRef: { current: false }, draftBackupOffRef: { current: false },
    serverDraftRef: { current: {} }, draftRevisionsRef: { current: {} },
    localStorage: {}, readAnswerBuffer: () => ({}),
    draftBackup: () => ({ source: "draft", language: "cpp" }),
    saveDraft: () => { calls++; return new Promise((a, b) => { resolve = a; reject = b; }); },
    ProctorApiError: ApiError, stopsDraftBackup: () => true,
    useEffect: (f) => { cleanup = f(); },
    setInterval: (f) => { tick = f; return 1; }, clearInterval: () => {},
  };
  const mount = () => vm.runInNewContext(code, context);
  mount();
  return { context, mount, tick: () => tick(), stop: () => cleanup(),
    calls: () => calls, resolve: () => resolve({ source: "draft", language: "cpp", client_revision: 1 }),
    reject: () => reject(new ApiError()) };
}
test("slow backups stay single-flight across ticks and effect replacement", async () => {
  const h = harness(); h.tick(); h.tick(); assert.equal(h.calls(), 1);
  h.stop(); h.mount(); h.tick(); assert.equal(h.calls(), 1);
  h.resolve(); await flush();
  assert.deepEqual(h.context.serverDraftRef.current, {});
  assert.deepEqual(h.context.draftRevisionsRef.current, {});
  h.tick(); assert.equal(h.calls(), 2);
  h.resolve(); await flush();
  assert.equal(h.context.serverDraftRef.current.p1, "cpp\ndraft");
  assert.equal(h.context.draftRevisionsRef.current.p1, 1);
});
test("a failed old backup cannot disable the new session's backups", async () => {
  const h = harness(); h.tick(); h.stop(); h.reject(); await flush();
  assert.equal(h.context.draftBackupOffRef.current, false);
  assert.equal(h.context.draftBackupFlightRef.current, false);
});
test("a current permanent failure still stops backups", async () => {
  const h = harness(); h.tick(); h.reject(); await flush();
  assert.equal(h.context.draftBackupOffRef.current, true);
  h.tick(); assert.equal(h.calls(), 1);
});
