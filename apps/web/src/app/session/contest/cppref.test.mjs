import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("./cppref.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const encoder = new TextEncoder();
const home = "reference/en/cpp.html";
const vector = "reference/en/cpp/container/vector.html";
const string = "reference/en/cpp/string/basic_string.html";
const html = [
  "<html>C++ π reference</html>",
  "<html>std::vector</html>",
  "<html>std::string</html>",
];
const lengths = html.map((page) => encoder.encode(page).length);
const index = {
  codec: "brotli",
  release: "v20250209",
  blocks: ["b0000.br"],
  files: {
    [home]: [0, 0, lengths[0]],
    [vector]: [0, lengths[0], lengths[1]],
    [string]: [0, lengths[0] + lengths[1], lengths[2]],
  },
};
const assets = {
  "index.json": encoder.encode(JSON.stringify(index)),
  "b0000.br": encoder.encode(html.join("")),
};

function harness({ protocol = "tauri:", hostname = "localhost", native = true, respond } = {}) {
  const calls = [];
  const context = {
    exports: {},
    TextDecoder,
    Uint8Array,
    URL,
    window: { location: { protocol, hostname }, ...(native ? { __TAURI__: {} } : {}) },
    require(name) {
      assert.equal(name, "@ams/api-client");
      return {
        invoke: async (command, { name: asset }) => {
          calls.push({ transport: "native", command, asset });
          const value = respond ? await respond(asset, "native") : assets[asset];
          return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
        },
      };
    },
    fetch: async (url) => {
      calls.push({ transport: "fetch", url });
      const value = respond
        ? await respond(url.slice("/cppref/".length), "fetch")
        : assets[url.slice("/cppref/".length)];
      return new Response(value ?? "missing", { status: value ? 200 : 404 });
    },
  };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, calls };
}

for (const [protocol, hostname] of [
  ["tauri:", "localhost"],
  ["http:", "tauri.localhost"],
  ["https:", "tauri.localhost"],
]) {
  test(`installed ${protocol}//${hostname} reads embedded pages through IPC, caching adjacent pages`, async () => {
    const { api, calls } = harness({ protocol, hostname });
    assert.equal((await api.readPage(home)).html, html[0]);
    assert.equal((await api.readPage(vector)).html, html[1]);
    assert.deepEqual(calls, [
      { transport: "native", command: "read_cppref_asset", asset: "index.json" },
      { transport: "native", command: "read_cppref_asset", asset: "b0000.br" },
    ]);
  });
}

for (const native of [true, false]) {
  test(`HTTP development loads the served reference even with native bridge ${native}`, async () => {
    const { api, calls } = harness({ protocol: "http:", hostname: "localhost", native });
    assert.equal((await api.readPage(home)).html, html[0]);
    assert.deepEqual(
      calls.map((call) => call.url),
      ["/cppref/index.json", "/cppref/b0000.br"]
    );
  });
}

test("a failed index lookup can be retried and native error strings remain actionable", async () => {
  let failed = false;
  const { api } = harness({
    respond: (name) => {
      if (name === "index.json" && !failed) {
        failed = true;
        throw "Reference bundle missing; rebuild the app";
      }
      return assets[name];
    },
  });
  await assert.rejects(api.readPage(home), /bundle missing; rebuild/);
  assert.equal((await api.readPage(home)).html, html[0]);
});

test("failed block requests do not poison the cache", async () => {
  let attempts = 0;
  const { api, calls } = harness({
    respond: (name) => {
      if (name === "b0000.br" && ++attempts === 1) throw new Error("temporary read failure");
      return assets[name];
    },
  });
  await assert.rejects(api.readPage(home), /temporary read failure/);
  assert.equal((await api.readPage(home)).html, html[0]);
  assert.equal(calls.filter((call) => call.asset === "index.json").length, 1);
  assert.equal(attempts, 2);
});

test("missing HTTP assets and HTML fallback responses report a bundle error", async () => {
  for (const value of [undefined, encoder.encode("<html>app fallback</html>")]) {
    const { api } = harness({ native: false, protocol: "http:", respond: () => value });
    await assert.rejects(api.readPage(home), /reference.*(unavailable|missing|invalid)/i);
  }
});

test("truncated block data is rejected instead of displaying broken reference text", async () => {
  const { api } = harness({
    respond: (name) => (name === "b0000.br" ? encoder.encode("partial") : assets[name]),
  });
  await assert.rejects(api.readPage(home), /incomplete/);
});

test("offline search uses the embedded index and resolves typedefs", async () => {
  const { api, calls } = harness();
  const hits = await api.search("std::string");
  assert.equal(hits[0].path, string);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].asset, "index.json");
  assert.equal(api.resolveHref("https://en.cppreference.com/w/cpp/container/vector"), vector);
  assert.equal(api.resolveHref("https://example.com/w/cpp"), null);
});

test("navigation accepts only bundled article paths, never protocols or application routes", () => {
  const { api } = harness();
  for (const href of [
    "https://outside.invalid/",
    "//outside.invalid/path",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "mailto:a@b.test",
    "tel:12345",
    "blob:https://outside.invalid/id",
    "/login/",
    "../../../../login/",
    "https://en.cppreference.com:8443/w/cpp",
    "https://user@en.cppreference.com/w/cpp",
    "https://en.cppreference.com.outside.invalid/w/cpp",
    "https:\\outside.invalid/path",
  ])
    assert.equal(api.resolveHref(href, home), null, href);
  assert.equal(api.resolveHref("cpp/container/vector.html", home), vector);
  assert.equal(api.resolveHref("/w/cpp/container/vector"), vector);
});
