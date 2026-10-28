import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
test("active controls keep Finish, Help, reference and safe recovery without Leave or Contest info", () => {
  const top = read("./components/TopBar.tsx");
  assert.doesNotMatch(top, /ContestInformation|label="Leave contest"|onLeave/);
  for (const label of ["Finish contest", "Help", "Back to contest", "Finish and exit"])
    assert.ok(top.includes(`label="${label}"`));
  assert.match(top, /ReferenceSheetButton/);
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
  for (const file of walk(root.pathname).filter((p) => /\.(ts|tsx)$/.test(p))) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /ServiceStatus|\/client\/status/, file);
  }
});
