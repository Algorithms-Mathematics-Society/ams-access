import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { brotliCompressSync } from "node:zlib";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter, once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { openSync, closeSync, linkSync } from "node:fs";
import {
  runArchiveTar,
  safeArchiveListing,
  checkBundle,
  download,
  findReferenceDir,
  pack,
  publishBundle,
  sanitizeCss,
  sanitizeSvg,
} from "./setup-cppreference.mjs";

test("download completes only after the output file closes", async () => {
  const response = Readable.from([Buffer.from("archive")]);
  response.statusCode = 200;
  response.setTimeout = () => {};
  const request = new EventEmitter();
  request.setTimeout = () => {};
  request.destroy = () => {};
  const stream = new Writable({
    autoDestroy: false,
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const getRequest = (_url, _options, callback) => {
    queueMicrotask(() => callback(response));
    return request;
  };
  let completed = false;
  const pending = download(
    new URL("https://example.test/archive"),
    "unused",
    0,
    getRequest,
    () => stream
  ).then(() => {
    completed = true;
  });
  await once(stream, "finish");
  await Promise.resolve();
  assert.equal(completed, false);
  stream.emit("close");
  await pending;
  assert.equal(completed, true);
});

test("a failed download waits for the output file to close before rejecting", async () => {
  const response = new PassThrough();
  response.statusCode = 200;
  response.setTimeout = () => {};
  response.destroy = () => {};
  const request = new EventEmitter();
  request.setTimeout = () => {};
  request.destroy = () => {};
  const stream = new Writable({
    autoDestroy: false,
    write(_chunk, _encoding, done) {
      done();
    },
  });
  let destroyCalled = false;
  stream.destroy = () => {
    destroyCalled = true;
    return stream;
  };
  const getRequest = (_url, _options, callback) => {
    queueMicrotask(() => callback(response));
    return request;
  };
  let rejected = false;
  const pending = download(
    new URL("https://example.test/archive"),
    "unused",
    0,
    getRequest,
    () => stream
  ).catch((error) => {
    rejected = true;
    return error;
  });
  await new Promise((resolve) => setImmediate(resolve));
  response.emit("error", new Error("injected read failure"));
  await Promise.resolve();
  assert.equal(destroyCalled, true);
  assert.equal(rejected, false);
  stream.emit("close");
  assert.match((await pending).message, /injected read failure/);
  assert.equal(rejected, true);
});

test("a failed bundle promotion restores the previous bundle", () => {
  const root = mkdtempSync(join(process.cwd(), "cppref-publish-"));
  const staging = join(root, "staging"),
    destination = join(root, "bundle");
  mkdirSync(staging);
  mkdirSync(destination);
  writeFileSync(join(staging, "marker"), "new");
  writeFileSync(join(destination, "marker"), "old");
  try {
    assert.throws(
      () =>
        publishBundle(staging, destination, (from, to) => {
          if (from === staging) throw new Error("injected promotion failure");
          renameSync(from, to);
        }),
      /injected promotion failure/
    );
    assert.equal(readFileSync(join(destination, "marker"), "utf8"), "old");
    assert.equal(readFileSync(join(staging, "marker"), "utf8"), "new");
    assert.equal(existsSync(`${destination}.backup-${process.pid}`), false);
    publishBundle(staging, destination);
    assert.equal(readFileSync(join(destination, "marker"), "utf8"), "new");
    assert.equal(existsSync(`${destination}.backup-${process.pid}`), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cppref-check-"));
  const page = Buffer.from("abc");
  const index = {
    codec: "brotli",
    release: "v20250209",
    blockBytes: 1024,
    blocks: ["b0000.br"],
    files: { "reference/en/cpp.html": [0, 0, page.length] },
  };
  const bytes = Buffer.from(JSON.stringify(index));
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(root, "index.json"), bytes);
  writeFileSync(join(root, "b0000.br"), brotliCompressSync(page));
  mkdirSync(join(root, "assets/reference/common"), { recursive: true });
  writeFileSync(join(root, "assets/reference/common/ext.css"), "/* fixture */");
  writeFileSync(join(root, "assets/reference/common/site_modules.css"), "/* fixture */");
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify({
      release: "v20250209",
      codec: "brotli",
      pages: 1,
      blocks: 1,
      indexSha256: digest,
    })
  );
  return root;
}

test("accepts a pinned bundle with index, manifest, and all block files", () => {
  const root = fixture();
  try {
    assert.equal(checkBundle(root).ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finds reference/ as an extracted directory rather than searching files", () => {
  const root = mkdtempSync(join(tmpdir(), "cppref-extract-"));
  const reference = join(root, "html-book", "reference");
  mkdirSync(join(reference, "en"), { recursive: true });
  writeFileSync(join(reference, "en", "cpp.html"), "homepage");
  try {
    assert.equal(findReferenceDir(root), reference);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("packs a tiny extracted tree with manifest, index, block, and copied assets", () => {
  const root = mkdtempSync(join(tmpdir(), "cppref-pack-"));
  const source = join(root, "source"),
    output = join(root, "bundle");
  mkdirSync(join(source, "reference/cpp"), { recursive: true });
  mkdirSync(join(source, "reference/en"), { recursive: true });
  mkdirSync(join(source, "reference/common"), { recursive: true });
  writeFileSync(join(source, "reference/cpp/vector.html"), "<html>vector</html>");
  writeFileSync(join(source, "reference/en/cpp.html"), "<html>home</html>");
  writeFileSync(join(source, "reference/common/ext.css"), "body{color:black}");
  writeFileSync(join(source, "reference/common/site_modules.css"), "body{font:serif}");
  try {
    assert.equal(pack(source, output).pages, 2);
    assert.equal(checkBundle(output).ok, true);
    assert.equal(existsSync(join(output, "b0000.br")), true);
    assert.equal(
      JSON.parse(readFileSync(join(output, "index.json"), "utf8")).files[
        "reference/cpp/vector.html"
      ][0],
      0
    );
    assert.equal(
      readFileSync(join(output, "assets/reference/common/ext.css"), "utf8"),
      "body{color:black}"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strips external CSS and SVG resource references and omits copied scripts", () => {
  const root = mkdtempSync(join(tmpdir(), "cppref-safe-assets-"));
  const source = join(root, "source"),
    output = join(root, "bundle");
  mkdirSync(join(source, "reference/en"), { recursive: true });
  mkdirSync(join(source, "reference/common"), { recursive: true });
  writeFileSync(join(source, "reference/en/cpp.html"), "<html>home</html>");
  writeFileSync(
    join(source, "reference/common/ext.css"),
    '@import url("https://evil.invalid/x.css");a{background:url(//evil.invalid/x.png)}b{background:url(data:image/png;base64,AA==)}'
  );
  writeFileSync(join(source, "reference/common/site_modules.css"), "body{color:black}");
  writeFileSync(
    join(source, "reference/common/linked.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="https://evil.invalid/"><text>x</text></a></svg>'
  );
  writeFileSync(join(source, "reference/common/site_scripts.js"), "fetch('https://evil.invalid')");
  try {
    pack(source, output);
    const css = readFileSync(join(output, "assets/reference/common/ext.css"), "utf8");
    const svg = readFileSync(join(output, "assets/reference/common/linked.svg"), "utf8");
    assert.doesNotMatch(css, /https?:|\/\/evil/);
    assert.match(css, /data:image\/png/);
    assert.doesNotMatch(svg, /evil\.invalid/);
    assert.equal(existsSync(join(output, "assets/reference/common/site_scripts.js")), false);
    assert.equal(checkBundle(output).ok, true);
    const hostileCss = [
      "u\\72l(https://example.com/a.png)",
      "url(\\68ttps://example.com/a.png)",
      'image-set("https://example.com/a.png" 1x)',
      '@\\69mport "https://example.com/a.css";',
      "url/**/(https://example.com/a.png)",
    ].join(";");
    assert.doesNotMatch(sanitizeCss(hostileCss), /example\.com/);
    assert.doesNotMatch(sanitizeCss('@import "https://example.com/a.css";'), /example\.com/);
    assert.doesNotMatch(
      sanitizeSvg('<svg><image href="//example.com/a.png"/></svg>'),
      /example\.com/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects missing blocks and mismatched index checksum", () => {
  const root = fixture();
  try {
    rmSync(join(root, "b0000.br"));
    assert.match(checkBundle(root).reason, /missing or invalid block/);
    writeFileSync(join(root, "b0000.br"), "present");
    writeFileSync(
      join(root, "index.json"),
      JSON.stringify({ codec: "brotli", release: "v20250209", blocks: ["b0000.br"], files: {} })
    );
    assert.match(checkBundle(root).reason, /checksum/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects corrupt or truncated Brotli blocks", () => {
  const root = fixture();
  const goodBlock = readFileSync(join(root, "b0000.br"));
  try {
    writeFileSync(join(root, "b0000.br"), Buffer.from("not brotli"));
    assert.match(checkBundle(root).reason, /invalid or oversized Brotli block/);
    writeFileSync(join(root, "b0000.br"), goodBlock.subarray(0, goodBlock.length - 1));
    assert.match(checkBundle(root).reason, /invalid or oversized Brotli block/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects indexed ranges outside the decoded block", () => {
  const root = fixture();
  try {
    const index = {
      codec: "brotli",
      release: "v20250209",
      blocks: ["b0000.br"],
      files: { "reference/en/cpp.html": [0, 2, 2] },
    };
    const bytes = Buffer.from(JSON.stringify(index));
    writeFileSync(join(root, "index.json"), bytes);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    manifest.indexSha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.match(checkBundle(root).reason, /range exceeds block/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a bundle that lacks the homepage or viewer stylesheets", () => {
  const root = fixture();
  try {
    const index = {
      codec: "brotli",
      release: "v20250209",
      blocks: ["b0000.br"],
      files: { "reference/cpp/vector.html": [0, 0, 3] },
    };
    const bytes = Buffer.from(JSON.stringify(index));
    writeFileSync(join(root, "index.json"), bytes);
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    manifest.indexSha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.match(checkBundle(root).reason, /homepage/);
    writeFileSync(
      join(root, "index.json"),
      JSON.stringify({ ...index, files: { "reference/en/cpp.html": [0, 0, 3] } })
    );
    const nextBytes = readFileSync(join(root, "index.json"));
    manifest.indexSha256 = createHash("sha256").update(nextBytes).digest("hex");
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    rmSync(join(root, "assets/reference/common/site_modules.css"));
    assert.match(checkBundle(root).reason, /stylesheet/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a bundle with a different release or malformed file mapping", () => {
  const root = fixture();
  try {
    const index = {
      codec: "brotli",
      release: "v20250209",
      blocks: ["b0000.br"],
      files: { "reference/en/cpp.html": [4, 0, 3] },
    };
    const bytes = Buffer.from(JSON.stringify(index));
    writeFileSync(join(root, "index.json"), bytes);
    const manifest = {
      release: "v20240101",
      codec: "brotli",
      pages: 1,
      blocks: 1,
      indexSha256: createHash("sha256").update(bytes).digest("hex"),
    };
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.match(checkBundle(root).reason, /release/);
    manifest.release = "v20250209";
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.match(checkBundle(root).reason, /invalid file entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function archiveFixture(withLink = false) {
  const root = mkdtempSync(join(tmpdir(), "cppref tar spaces-"));
  const source = join(root, "source"),
    output = join(root, "output");
  mkdirSync(source);
  mkdirSync(output);
  writeFileSync(join(source, "page.html"), "offline reference");
  if (withLink) linkSync(join(source, "page.html"), join(source, "linked.html"));
  // On Windows tmpdir already supplies a drive prefix. On Unix deliberately
  // include a colon, reproducing GNU tar's remote-host parsing without Windows.
  const archive = join(
    root,
    process.platform === "win32" ? "book spaces.tar.xz" : "D: book spaces.tar.xz"
  );
  const fd = openSync(archive, "w");
  try {
    const result = spawnSync(
      "tar",
      ["-cJf", "-", "page.html", ...(withLink ? ["linked.html"] : [])],
      {
        cwd: source,
        stdio: ["ignore", fd, "pipe"],
        encoding: "utf8",
      }
    );
    assert.equal(result.status, 0, String(result.error || result.stderr));
  } finally {
    closeSync(fd);
  }
  return { root, archive, output };
}

test("real xz archive with drive/colon and spaces lists, validates and extracts locally", () => {
  const { root, archive, output } = archiveFixture();
  try {
    const listed = runArchiveTar(archive, "t");
    assert.equal(listed.status, 0, String(listed.error || listed.stderr));
    assert.match(listed.stdout, /page.html/);
    safeArchiveListing(archive);
    const extracted = runArchiveTar(archive, "x", output);
    assert.equal(extracted.status, 0, String(extracted.error || extracted.stderr));
    assert.equal(readFileSync(join(output, "page.html"), "utf8"), "offline reference");
    // Windows also catches leaked archive descriptors when removing the file.
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stdin archive validation still refuses hard links before extraction", () => {
  const { root, archive, output } = archiveFixture(true);
  try {
    assert.throws(() => safeArchiveListing(archive), /contains links/);
    assert.equal(existsSync(join(output, "page.html")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
