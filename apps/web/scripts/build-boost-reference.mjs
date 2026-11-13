#!/usr/bin/env node
/** Build an optional offline Boost pack from a curated directory of HTML pages.
 * Usage: node build-boost-reference.mjs SOURCE_DIR OUTPUT_DIR RELEASE [TITLE]
 * SOURCE_DIR is expected to contain boost/index.html and selected linked pages.
 * Copy OUTPUT_DIR into AMS_BOOST_REFERENCE_PACK_DIR, then atomically publish
 * latest.json last. No upstream content is fetched by this tool.
 */
import { readdir, readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";

const [sourceArg, outputArg, release, title = "Boost reference"] = process.argv.slice(2);
if (
  !sourceArg ||
  !outputArg ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(release ?? "") ||
  !title ||
  title.length > 120
) {
  throw new Error("Usage: build-boost-reference.mjs SOURCE_DIR OUTPUT_DIR RELEASE [TITLE]");
}
const source = resolve(sourceArg),
  output = resolve(outputArg);
if (output === source || output.startsWith(`${source}${sep}`))
  throw new Error("Output cannot be inside the source tree");
const pages = [];
async function collect(dir) {
  for (const dirent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${path}`);
    if (stat.isDirectory()) await collect(path);
    else if (stat.isFile() && path.endsWith(".html")) {
      const name = relative(source, path).split(sep).join("/");
      if (!name.startsWith("boost/") || name.includes(".."))
        throw new Error(`Invalid article path: ${name}`);
      const bytes = await readFile(path);
      if (!bytes.length || bytes.length > 8 * 1024 * 1024)
        throw new Error(`Invalid article size: ${name}`);
      pages.push({ name, bytes });
    }
  }
}
await collect(source);
pages.sort((a, b) => a.name.localeCompare(b.name));
if (!pages.some((page) => page.name === "boost/index.html"))
  throw new Error("Source needs boost/index.html");
if (pages.length > 100_000) throw new Error("Too many articles");
const releaseDir = join(output, release);
await mkdir(releaseDir, { recursive: true });
const files = {},
  blocks = [],
  blockFiles = [];
let chunks = [],
  length = 0;
async function flush() {
  if (!chunks.length) return;
  const name = `b${String(blocks.length).padStart(4, "0")}.br`;
  const compressed = brotliCompressSync(Buffer.concat(chunks), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
  });
  if (compressed.length > 8 * 1024 * 1024) throw new Error(`Block ${name} too large`);
  await writeFile(join(releaseDir, name), compressed);
  blocks.push(name);
  blockFiles.push({
    name,
    bytes: compressed.length,
    sha256: createHash("sha256").update(compressed).digest("hex"),
  });
  chunks = [];
  length = 0;
}
for (const page of pages) {
  if (length && length + page.bytes.length > 4 * 1024 * 1024) await flush();
  files[page.name] = [blocks.length, length, page.bytes.length];
  chunks.push(page.bytes);
  length += page.bytes.length;
}
await flush();
if (blocks.length > 32) throw new Error("Too many blocks");
const indexBytes = Buffer.from(
  JSON.stringify({ codec: "brotli", home: "boost/index.html", blocks, files })
);
if (indexBytes.length > 8 * 1024 * 1024) throw new Error("Index too large");
await writeFile(join(releaseDir, "index.json"), indexBytes);
const manifest = {
  schema: 1,
  release,
  title,
  index: {
    name: "index.json",
    bytes: indexBytes.length,
    sha256: createHash("sha256").update(indexBytes).digest("hex"),
  },
  blocks: blockFiles,
};
if ([manifest.index, ...blockFiles].reduce((sum, file) => sum + file.bytes, 0) > 128 * 1024 * 1024)
  throw new Error("Pack too large");
await writeFile(join(output, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(
  `Built ${pages.length} Boost pages in ${blocks.length} blocks (${release}).\n`
);
