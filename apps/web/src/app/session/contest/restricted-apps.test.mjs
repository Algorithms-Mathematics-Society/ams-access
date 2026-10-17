import { test } from "node:test";
import assert from "node:assert/strict";
import { appLabel, appList, trayHint, uniqueApps } from "./restricted-apps.ts";

test("one entry per app, however many processes it runs", () => {
  // Exactly the list in the screenshot that prompted this.
  const found = ["discord", "discord", "discord", "discord", "discord", "discord"];
  assert.deepEqual(uniqueApps(found), ["discord"]);
  assert.equal(appList(found), "Discord");
});

test("duplicates differing only in case are one app", () => {
  assert.deepEqual(uniqueApps(["Discord", "discord", "DISCORD"]), ["Discord"]);
});

test("blank and missing input does not become a stray comma", () => {
  assert.equal(appList([]), "");
  assert.equal(appList(undefined), "");
  assert.equal(appList(["", "  ", "obs64"]), "OBS");
});

test("names are shown the way the app spells itself", () => {
  assert.equal(appLabel("ms-teams"), "Microsoft Teams");
  assert.equal(appLabel("whatsapp.exe"), "WhatsApp");
  assert.equal(appLabel("teamviewer"), "TeamViewer");
  // Unknown names are passed through, not mangled.
  assert.equal(appLabel("some-tool"), "some-tool");
});

test("two spellings of one app collapse to a single label", () => {
  assert.equal(appList(["telegram", "telegram-desktop"]), "Telegram");
  assert.equal(appList(["obs", "obs64", "obs32"]), "OBS");
});

test("the tray hint names the app and says it does not block entry", () => {
  const hint = trayHint(["discord"]);
  assert.ok(hint.startsWith("Discord keeps running"));
  assert.ok(hint.includes("does not stop you entering"));
  assert.ok(hint.includes("Quit"));
});

test("several apps read as a sentence, not a list dump", () => {
  assert.ok(trayHint(["discord", "whatsapp"]).startsWith("Discord and WhatsApp keep running"));
  assert.ok(
    trayHint(["discord", "slack", "whatsapp"]).startsWith(
      "Discord, Slack and WhatsApp keep running"
    )
  );
});

test("nothing advisory means no hint at all", () => {
  assert.equal(trayHint([]), null);
  assert.equal(trayHint(undefined), null);
});
