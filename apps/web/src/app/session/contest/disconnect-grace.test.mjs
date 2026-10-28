import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startDisconnectGrace, DISCONNECT_GRACE_MS } from "./disconnect-grace.ts";

test("continuous disconnection opens recovery at 12 seconds, never earlier", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = [];
  const stop = startDisconnectGrace(true, (visible) => seen.push(visible));
  assert.equal(DISCONNECT_GRACE_MS, 12000);
  t.mock.timers.tick(11999);
  assert.deepEqual(seen, [false]);
  t.mock.timers.tick(1);
  assert.deepEqual(seen, [false, true]);
  stop();
});

test("reconnection cancels an old countdown and a new outage gets a fresh grace", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let shown = false;
  const show = (v) => {
    shown = v;
  };
  let stop = startDisconnectGrace(true, show);
  t.mock.timers.tick(11000);
  stop();
  startDisconnectGrace(false, show)();
  t.mock.timers.tick(60000);
  assert.equal(shown, false);
  stop = startDisconnectGrace(true, show);
  t.mock.timers.tick(12000);
  assert.equal(shown, true);
  stop();
  startDisconnectGrace(false, show)();
  assert.equal(shown, false);
});

test("3000 closed workspaces cancel all pending callbacks without network work", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let opened = 0;
  const stops = Array.from({ length: 3000 }, () =>
    startDisconnectGrace(true, (v) => {
      if (v) opened++;
    })
  );
  stops.forEach((stop) => stop());
  t.mock.timers.tick(60000);
  assert.equal(opened, 0);
});

test("recovery offers Check Again and Exit Contest through existing safe handlers", () => {
  const source = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
  assert.match(source, /label="Check Again"[^<]*retryBeatRef.current/);
  assert.match(source, /label="Exit Contest"[^<]*onClick=\{requestLeave\}/);
  assert.doesNotMatch(source, /WifiControl|scan_wifi|connect_wifi/);
  const toolbar = readFileSync(new URL("./components/TopBar.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(toolbar, /WifiControl/);
});
