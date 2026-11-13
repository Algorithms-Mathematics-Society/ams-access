import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("./boostref.ts", import.meta.url), "utf8").replace(
  /import \{ invoke \} from "@ams\/api-client";/,
  ""
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test("Boost updates invalidate cached indexes and pin block reads to their release", async () => {
  let release = "v1";
  const encoder = new TextEncoder();
  const calls = [];
  const invoke = async (command, args) => {
    if (command === "boost_reference_local_status") return { release };
    calls.push(args);
    assert.equal(args.release, release, "reader must pin all assets to the selected release");
    const page = release === "v1" ? "old" : "new reference";
    return encoder.encode(
      args.name === "index.json"
        ? JSON.stringify({
            codec: "brotli",
            home: "boost/index.html",
            blocks: ["b0000.br"],
            files: { "boost/index.html": [0, 0, page.length] },
          })
        : page
    ).buffer;
  };
  const exports = {};
  new Function("exports", "invoke", code)(exports, invoke);
  assert.equal((await exports.readBoostPage("boost/index.html")).html, "old");
  release = "v2";
  exports.clearBoostCache();
  assert.equal((await exports.readBoostPage("boost/index.html")).html, "new reference");
  assert.deepEqual(
    calls.map((call) => call.release),
    ["v1", "v1", "v2", "v2"]
  );
});
