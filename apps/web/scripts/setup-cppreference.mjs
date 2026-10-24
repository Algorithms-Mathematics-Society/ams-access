#!/usr/bin/env node
/**
 * Pack the cppreference offline book into public/cppref/ as block archives.
 *
 * The exam has no internet, so the reference has to ship with the app. The
 * naive forms are both unacceptable: the upstream `.zip` is 50 MB because it
 * deflates each of 6,640 pages on its own, and the extracted tree is 336 MB
 * of small files, which on Windows means Defender scanning every one.
 *
 * So pages are concatenated into blocks and each block is compressed whole.
 * Sibling pages share a block, and cppreference pages are near-identical
 * boilerplate, so compressing across them is what pays: measured at 51:1 for
 * solid xz against 6.6:1 for per-file deflate. A block is the unit of
 * decompression, which is why it is small -- opening one page must not mean
 * inflating the whole book.
 *
 * Blocks are brotli, and nothing in the app decodes them: they are served
 * with `Content-Encoding: br`, so the browser inflates them in the network
 * layer for free. gzip was measured first and only reaches 7.6:1 here --
 * deflate's 32 KB window cannot see across pages that average 51 KB -- which
 * put the bundle over its 45 MB budget. Brotli's window can, at 38:1.
 * `codec` is recorded in the manifest so this can be swapped without
 * changing the index format.
 *
 * Link rewriting is deliberately NOT done here. Internal links are absolute
 * (`https://en.cppreference.com/w/cpp/...`) and map to a local path by string
 * transform, which the viewer does on click; external links are refused the
 * same way. Remote scripts -- the book carries Google Tag Manager on every
 * page -- cannot load at all under `script-src 'self'`, so the CSP already
 * neutralises them.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { brotliCompressSync, constants as zlibConstants } from "zlib";
import { dirname, join, posix, relative, sep } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dest = join(root, "public/cppref");

/** Bytes of page text per block. Small enough that one page view inflates
 *  little, large enough that cross-page redundancy is still captured. At 1 MB
 *  a block costs ~37 KB on the wire and the whole book is under 9 MB. */
const BLOCK_BYTES = 1024 * 1024;

/** Upstream release. The *official* cppreference archive is stuck at 2019,
 *  which predates C++20 and is useless for a C++23 contest. */
const RELEASE = "v20250209";
const ARCHIVE_SHA256 = "ac50671a1f52d7f0ab0911d14450eb35e8c2f812edd0e426b2cd1e3d9db91d6f";
const ARCHIVE_URL =
  `https://github.com/PeterFeicht/cppreference-doc/releases/download/${RELEASE}/html-book-20250209.tar.xz`;

/** Served as text and decompressed by the viewer. Anything else (fonts,
 *  images, css) is copied through untouched so the pages render. */
const PACKED = new Set([".html"]);
const COPIED = new Set([".css", ".svg", ".png", ".gif", ".ttf", ".woff", ".woff2", ".js"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function extOf(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

function main() {
  const source = process.argv[2];
  if (!source || !existsSync(source)) {
    console.error(
      "usage: setup-cppreference.mjs <extracted-html-book-dir>\n" +
        `       (expects the tree from ${ARCHIVE_URL}\n` +
        `        sha256 ${ARCHIVE_SHA256}, extracted so that <dir>/reference exists)`
    );
    process.exit(2);
  }
  if (!existsSync(join(source, "reference"))) {
    console.error(`${source} has no reference/ directory -- is it the html book?`);
    process.exit(2);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const all = walk(source).sort();
  const pages = all.filter((p) => PACKED.has(extOf(p)));
  const assets = all.filter((p) => COPIED.has(extOf(p)));

  // Sorted order matters: it puts sibling pages in the same block, which is
  // where the compression ratio comes from.
  const files = {};
  const blocks = [];
  let pending = [];
  let pendingBytes = 0;

  const flush = () => {
    if (pending.length === 0) return;
    const index = blocks.length;
    const name = `b${String(index).padStart(4, "0")}.br`;
    let offset = 0;
    const parts = [];
    for (const { key, bytes } of pending) {
      files[key] = [index, offset, bytes.length];
      parts.push(bytes);
      offset += bytes.length;
    }
    const raw = Buffer.concat(parts);
    const packed = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 10,
        [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    writeFileSync(join(dest, name), packed);
    blocks.push({ name, raw: raw.length, packed: packed.length });
    pending = [];
    pendingBytes = 0;
  };

  for (const path of pages) {
    const key = posix.join(...relative(source, path).split(sep));
    const bytes = readFileSync(path);
    pending.push({ key, bytes });
    pendingBytes += bytes.length;
    if (pendingBytes >= BLOCK_BYTES) flush();
  }
  flush();

  // Assets are few and already compressed formats, so they are copied as-is
  // rather than packed -- the viewer references them by their own path.
  let assetBytes = 0;
  for (const path of assets) {
    const key = posix.join(...relative(source, path).split(sep));
    const target = join(dest, "assets", key);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readFileSync(path);
    writeFileSync(target, bytes);
    assetBytes += bytes.length;
  }

  const rawTotal = blocks.reduce((n, b) => n + b.raw, 0);
  const packedTotal = blocks.reduce((n, b) => n + b.packed, 0);

  const index = {
    codec: "brotli",
    release: RELEASE,
    blockBytes: BLOCK_BYTES,
    blocks: blocks.map((b) => b.name),
    files,
  };
  const indexJson = JSON.stringify(index);
  writeFileSync(join(dest, "index.json"), indexJson);

  writeFileSync(
    join(dest, "manifest.json"),
    JSON.stringify(
      {
        release: RELEASE,
        codec: "brotli",
        pages: Object.keys(files).length,
        blocks: blocks.length,
        rawBytes: rawTotal,
        packedBytes: packedTotal,
        assetBytes,
        indexBytes: Buffer.byteLength(indexJson),
        indexSha256: createHash("sha256").update(indexJson).digest("hex"),
      },
      null,
      2
    ) + "\n"
  );

  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`pages      ${Object.keys(files).length}`);
  console.log(`blocks     ${blocks.length} x ${mb(BLOCK_BYTES)} MB`);
  console.log(`raw        ${mb(rawTotal)} MB`);
  console.log(`packed     ${mb(packedTotal)} MB  (${(rawTotal / packedTotal).toFixed(1)}:1)`);
  console.log(`assets     ${mb(assetBytes)} MB (${assets.length} files, copied)`);
  console.log(`index      ${(Buffer.byteLength(indexJson) / 1024).toFixed(0)} KB`);
  console.log(`total      ${mb(packedTotal + assetBytes + Buffer.byteLength(indexJson))} MB in public/cppref/`);
}

main();
