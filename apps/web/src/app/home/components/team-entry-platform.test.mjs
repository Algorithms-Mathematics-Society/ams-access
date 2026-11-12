import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
const callback = source
  .slice(
    source.indexOf("    async (contestId: string) => {", source.indexOf("const openPreflight")),
    source.indexOf("\n    [router]", source.indexOf("const openPreflight"))
  )
  .trim()
  .replace(/,$/, "");
function harness(result, platform = "Linux aarch64", native = true) {
  const calls = [],
    messages = [];
  let generation = 1;
  const state = { entryNavigationRef: { current: false }, teamEntryProbe: { current: null } };
  const context = {
    ...state,
    navigator: { platform, userAgent: "" },
    hasNativeBridge: () => native,
    supportsTeamDesktopWebView: (_, p) => p === "Win32" || p === "MacIntel" || p === "Linux x86_64",
    authGeneration: () => generation,
    participantToken: () => String(generation),
    authHeaders: () => ({}),
    setTeamEntryMessage: (m) => messages.push(m),
    setResumeStatus: (m) => messages.push(m),
    probeTeamRound: async () => {
      calls.push("probe");
      return typeof result === "function" ? await result() : result;
    },
    AbortController,
    setTimeout,
    clearTimeout,
    API_URL: "https://example.test",
    TEAM_PLATFORM_MESSAGE: "unsupported team",
    TEAM_WRONG_CONTEST_MESSAGE: "wrong contest",
    sessionStorage: {},
    crypto: { randomUUID: () => "id" },
    clearSetupHandoff: () => calls.push("clear"),
    setupAttemptId: () => calls.push("attempt"),
    router: { push: () => calls.push("navigate") },
  };
  const js = ts.transpileModule(`const run = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = vm.runInNewContext(js + "\nrun;", context);
  return { run, calls, messages, state, changeIdentity: () => generation++ };
}
test("unsupported team is blocked before setup; unknown permits deliberate retry only", async () => {
  for (const result of ["team", "error", "defer", "wrong-contest"]) {
    const h = harness(result);
    await h.run("contest");
    assert.deepEqual(h.calls, ["probe"]);
    assert.equal(h.state.entryNavigationRef.current, false);
    await h.run("contest");
    assert.deepEqual(h.calls, ["probe", "probe"]);
  }
});
test("solo proceeds after probe; supported native and browser entry unchanged", async () => {
  const solo = harness("solo");
  await solo.run("contest");
  assert.deepEqual(solo.calls, ["probe", "clear", "attempt", "navigate"]);
  for (const [platform, native] of [
    ["Win32", true],
    ["MacIntel", true],
    ["Linux x86_64", true],
    ["MacIntel", false],
  ]) {
    const h = harness("team", platform, native);
    await h.run("contest");
    assert.deepEqual(h.calls, ["clear", "attempt", "navigate"]);
  }
});
test("inflight requests are single flight and stale identity never navigates", async () => {
  let resolve;
  const h = harness(() => new Promise((r) => (resolve = r)));
  const pending = h.run("a");
  await h.run("b");
  assert.deepEqual(h.calls, ["probe"]);
  h.changeIdentity();
  resolve("solo");
  await pending;
  assert.deepEqual(h.calls, ["probe"]);
});
test("Home and readiness both expose compatibility notice", () => {
  assert.match(source, /title="Team round compatibility"/);
  assert.match(source, /platformNotice=\{unsupportedTeamDevice/);
  const readiness = readFileSync(new URL("./ReadinessPanel.tsx", import.meta.url), "utf8");
  assert.match(readiness, /platformNotice && <Text role="status">/);
});
