import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
test("active controls keep Finish, Help, reference and safe recovery with Contest info and without Leave", () => {
  const top = read("./components/TopBar.tsx");
  assert.doesNotMatch(top, /label="Leave contest"|onLeave/);
  for (const label of ["Finish contest", "Help", "Back to contest", "Finish and exit"])
    assert.ok(top.includes(`label="${label}"`));
  assert.match(top, /ReferenceSheetButton/);
  assert.match(top, /<ContestInformation/);
  const info = read("./components/ContestInformation.tsx");
  assert.match(info, /label="Contest info"/);
  assert.match(info, /<IconButton/);
  assert.match(info, /tooltip="Contest info"/);
  assert.ok(info.includes('icon={<Info size={16} aria-hidden="true" />}'));
  const client = read("./client.tsx");
  assert.match(client, /label="Exit Contest"[^<]*onClick=\{requestLeave\}/);
  assert.match(client, /onExit=\{requestLeave\}/);
});
test("no production web source mounts service status or polls its endpoint", () => {
  const root = new URL("../../../", import.meta.url);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
    );
  for (const file of walk(fileURLToPath(root)).filter((p) => /\.(ts|tsx)$/.test(p))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /ServiceStatus|\/client\/status/, file);
  }
});

test("compact toolbar keeps battery state accessible and preserves dialog button styling", () => {
  const battery = read("./components/BatteryStatus.tsx");
  assert.match(battery, /aria-label=\{label\}/);
  assert.match(battery, /Tooltip content=\{label\}/);
  assert.match(battery, /tabIndex=\{0\}/);
  assert.match(battery, /\{battery.percentage\}%/);
  assert.doesNotMatch(battery, /\{state\}|>Charging</);
  const css = read("./components/workspace-styles.ts");
  assert.ok(css.includes('button:not([role="dialog"] button, [role="alertdialog"] button)'));
  assert.ok(css.includes(':not([aria-pressed="true"])'));
  assert.match(css, /contest-topbar-actions \{ flex:none !important; flex-wrap:wrap !important;/);
  for (const state of [":hover", ":active", ":focus-visible"]) assert.ok(css.includes(state));
});
