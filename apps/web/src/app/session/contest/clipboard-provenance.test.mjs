import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  registerAllowedClipboard,
  resetAllowedClipboard,
  isAllowedClipboard,
} from "./clipboard-provenance.ts";

test("pre-contest and external clipboard contents of any length are rejected", () => {
  resetAllowedClipboard();
  for (const text of ["x", "answer", "int main() {}", "external\ncode"]) {
    assert.equal(isAllowedClipboard(text), false);
  }
});
test("internal copy/cut and sample copy allow exact contents, not appended external code", () => {
  const text = "int main() {\n  return 0;\n}";
  registerAllowedClipboard(text);
  assert.equal(isAllowedClipboard(text), true);
  assert.equal(isAllowedClipboard(text.replaceAll("\n", "\r\n")), true);
  assert.equal(isAllowedClipboard(text + "\nexternal code"), false);
  assert.equal(isAllowedClipboard("return 0;"), false);
  registerAllowedClipboard("x");
  assert.equal(isAllowedClipboard("x"), true);
  assert.equal(isAllowedClipboard(text), false);
});
test("session exit and stale copies cannot authorize another contest's paste", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  registerAllowedClipboard("inside");
  t.mock.timers.tick(300000);
  assert.equal(isAllowedClipboard("inside"), false);
  registerAllowedClipboard("inside");
  resetAllowedClipboard();
  assert.equal(isAllowedClipboard("inside"), false);
});
test("editor paste handler prevents insertion and shows notice for short external text", () => {
  const source = readFileSync(new URL("./editor-pane.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const body = source.slice(
    source.indexOf("        const text = event.clipboardData"),
    source.indexOf("      },\n    }),", source.indexOf("        const text = event.clipboardData"))
  );
  const handler = new Function(
    "event",
    "isAllowedClipboard",
    "logClipboardEvent",
    "metaPayload",
    "onBlockedPaste",
    body
  );
  resetAllowedClipboard();
  let prevented = 0,
    notice = 0;
  const event = { clipboardData: { getData: () => "x" }, preventDefault: () => prevented++ };
  assert.equal(
    handler(
      event,
      isAllowedClipboard,
      () => {},
      {},
      () => notice++
    ),
    true
  );
  assert.equal(prevented, 1);
  assert.equal(notice, 1);
  registerAllowedClipboard("x");
  assert.equal(
    handler(
      event,
      isAllowedClipboard,
      () => {},
      {},
      () => notice++
    ),
    false
  );
  assert.equal(prevented, 1);
  const client = readFileSync(new URL("./client.tsx", import.meta.url), "utf8");
  assert.match(client, /resetAllowedClipboard\(\);\s+setViolationSession\(sessionId\)/);
  assert.match(client, /return \(\) => \{\s+resetAllowedClipboard\(\)/);
});
