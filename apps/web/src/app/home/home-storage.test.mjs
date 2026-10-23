import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const start = source.lastIndexOf(
  "  useEffect(() => {",
  source.indexOf("    // The token outlives the page:")
);
const end = source.indexOf("\n  }, []);", start) + "\n  }, []);".length;
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function hydrate({ deniedRead, session, deniedRemoval = false } = {}) {
  const state = {},
    removed = [];
  let cleanup;
  const context = {
    useEffect: (effect) => {
      cleanup = effect();
    },
    restoreToken() {},
    setDisplayName: (value) => {
      state.name = value;
    },
    setIdentityHydrated: (value) => {
      state.hydrated = value;
    },
    setActiveSession: (value) => {
      state.session = value;
    },
    setResumeVerification: (value) => {
      state.verification = value;
    },
    setResumeStatus: (value) => {
      state.status = value;
    },
    STORAGE_KEYS: { DISPLAY_NAME: "display" },
    ACTIVE_SESSION_KEY: "session",
    scanGenerationRef: { current: 0 },
    localStorage: {
      getItem: (key) => {
        if (deniedRead === key || deniedRead === "all") throw new Error("denied");
        return key === "display" ? "Candidate" : session;
      },
      removeItem: (key) => {
        removed.push(key);
        if (deniedRemoval) throw new Error("denied");
      },
    },
  };
  vm.runInNewContext(code, context);
  return { state, removed, cleanup, generation: context.scanGenerationRef };
}
test("presentation read failure defaults name and still hydrates stored session", () => {
  const h = hydrate({ deniedRead: "display", session: JSON.stringify({ id: "saved" }) });
  assert.equal(h.state.name, "");
  assert.equal(h.state.hydrated, true);
  assert.equal(h.state.session.id, "saved");
  assert.equal(h.state.verification, "unverified");
  assert.match(h.state.status, /Validating/);
  h.cleanup();
  assert.equal(h.generation.current, 1);
});
for (const deniedRead of ["session", "all"]) {
  test(`required session read failure ${deniedRead} is explicit and cannot verify recovery`, () => {
    const h = hydrate({ deniedRead });
    assert.equal(h.state.hydrated, true);
    assert.equal(h.state.verification, "invalid");
    assert.equal(h.state.session, undefined);
    assert.match(h.state.status, /could not be accessed/);
    assert.equal(typeof h.cleanup, "function");
  });
}
for (const session of ["invalid json", "{}", "null"]) {
  test(`malformed session ${session} is removed, and removal failure stays explicit`, () => {
    const cleared = hydrate({ session });
    assert.deepEqual(cleared.removed, ["session"]);
    assert.equal(cleared.state.verification, "none");
    const denied = hydrate({ session, deniedRemoval: true });
    assert.equal(denied.state.verification, "invalid");
    assert.match(denied.state.status, /could not be accessed/);
    assert.equal(denied.state.hydrated, true);
    assert.deepEqual(denied.removed, ["session"]);
  });
}
test("normal hydration preserves presentation and leaves absent session alone", () => {
  const h = hydrate();
  assert.equal(h.state.name, "Candidate");
  assert.equal(h.state.hydrated, true);
  assert.equal(h.state.status, undefined);
  assert.deepEqual(h.removed, []);
});
