import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync(new URL("./components/TeamVoiceControls.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
test("Windows adapter retains lifecycle boundaries and mandatory overlay priority", () => {
  assert.match(ui, /!window\.__TAURI__.*!\/\^Win/);
  assert.match(ui, /generation === authGeneration\(\).*token === participantToken\(\)/);
  assert.match(ui, /subscribeAuthChanges\(terminate\)/);
  assert.match(ui, /addEventListener\("pagehide", terminate\)/);
  assert.match(ui, /addEventListener\("beforeunload", terminate\)/);
  assert.match(ui, /if \(!open.current\) stopSession\(\)/);
  assert.match(ui, /inert=\{suspended/);
  assert.match(
    client.replace(/\s+/g, " "),
    /enabled=\{ entryReady && Boolean\(sessionId\) && !isDryRun && !bellRung && !sessionEnded && contestPhase !== "ended" \}/
  );
});
