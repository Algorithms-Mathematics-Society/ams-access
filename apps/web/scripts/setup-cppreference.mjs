#!/usr/bin/env node
/** Prepare the pinned, offline cppreference book for the web app. */
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "zlib";
import { dirname, join, posix, relative, sep, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createWriteStream } from "fs";
import https from "https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const projectRoot = join(root, "../..");
const dest = join(root, "public/cppref");
const cache = join(projectRoot, ".cache/cppreference");
const BLOCK_BYTES = 1024 * 1024;
const MAX_BLOCK_BYTES = 8 * 1024 * 1024;
const RELEASE = "v20250209";
const ARCHIVE_SHA256 = "ac50671a1f52d7f0ab0911d14450eb35e8c2f812edd0e426b2cd1e3d9db91d6f";
const ARCHIVE_URL = `https://github.com/PeterFeicht/cppreference-doc/releases/download/${RELEASE}/html-book-20250209.tar.xz`;
const ARCHIVE_NAME = "html-book-20250209.tar.xz";
const PACKED = new Set([".html"]);
const COPIED = new Set([".css", ".svg", ".png", ".gif", ".ttf", ".woff", ".woff2"]);

// CSS escapes and comments are interpreted before URLs are fetched. Normalize
// them before both sanitizing and validation so an obfuscated token fails the
// same checks as its plain-text form.
function decodeCss(text) {
  return text.replace(/\\([\da-f]{1,6})\s?|\\([^\r\n])/gi, (_match, hex, char) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : char
  );
}
function normalizeCss(text) {
  return decodeCss(text).replace(/\/\*[\s\S]*?\*\//g, "");
}
function hasExternalReference(text, svg = false) {
  const normalized = svg ? text : normalizeCss(text);
  const url =
    /url\(\s*["']?\s*(?!(?:data:|#|\.\.?\/|\/))[a-z][a-z0-9+.-]*:|url\(\s*["']?\s*(?:\/\/|\\\\)/i;
  const importRef = /@import\s+(?:url\()?\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  const href = /(?:xlink:)?href\s*=\s*["']\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  const imageSet =
    /(?:-webkit-)?image-set\s*\([^)]*["']\s*(?!(?:data:))(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
  return (
    url.test(normalized) ||
    (svg ? href.test(normalized) : importRef.test(normalized) || imageSet.test(normalized))
  );
}
export function sanitizeCss(text) {
  const normalized = normalizeCss(text);
  return normalized
    .replace(/@import\s+[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)\s*(?!(?:data:))[a-z][a-z0-9+.-]*:[^)]*\)/gi, 'url("")')
    .replace(/url\(\s*(["']?)\s*(?:\/\/|\\\\)[^)]*\)/gi, 'url("")')
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)/gi, (value) =>
      /["']\s*(?!(?:data:))(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) ? "none" : value
    );
}
export function sanitizeSvg(text) {
  return text
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/\s+(?:xlink:)?href\s*=\s*(["'])(?:[a-z][a-z0-9+.-]*:|\/\/)[^"']*\1/gi, ' href=""')
    .replace(/url\(\s*(["']?)\s*(?!(?:data:))[a-z][a-z0-9+.-]*:[^)]*\)/gi, 'url("")')
    .replace(/url\(\s*(["']?)\s*(?:\/\/|\\\\)[^)]*\)/gi, 'url("")');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}
export function findReferenceDir(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name === "reference") return path;
    const nested = findReferenceDir(path);
    if (nested) return nested;
  }
  return null;
}
function extOf(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A reusable bundle is valid only when all referenced payloads exist and its
 * index is self-consistent. This also backs --check for CI/offline validation. */
export function checkBundle(directory = dest) {
  try {
    const manifestBytes = readFileSync(join(directory, "manifest.json"));
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const indexBytes = readFileSync(join(directory, "index.json"));
    const index = JSON.parse(indexBytes.toString("utf8"));
    if (
      manifest.release !== RELEASE ||
      manifest.codec !== "brotli" ||
      index.release !== RELEASE ||
      index.codec !== "brotli"
    )
      return { ok: false, reason: "bundle release or codec does not match the pinned format" };
    if (manifest.indexSha256 !== sha256(indexBytes))
      return { ok: false, reason: "index checksum does not match manifest" };
    if (
      !index.files ||
      typeof index.files !== "object" ||
      Array.isArray(index.files) ||
      !Array.isArray(index.blocks) ||
      !index.blocks.length
    )
      return { ok: false, reason: "index has no pages or blocks" };
    if (!Object.hasOwn(index.files, "reference/en/cpp.html"))
      return { ok: false, reason: "index is missing the cppreference homepage" };
    for (const asset of [
      "assets/reference/common/ext.css",
      "assets/reference/common/site_modules.css",
    ]) {
      if (!existsSync(join(directory, asset)) || !statSync(join(directory, asset)).isFile())
        return { ok: false, reason: `missing required stylesheet: ${asset}` };
    }
    for (const path of walk(join(directory, "assets"))) {
      const ext = extOf(path);
      if (ext !== ".css" && ext !== ".svg") continue;
      const content = readFileSync(path, "utf8");
      if (hasExternalReference(content, ext === ".svg"))
        return {
          ok: false,
          reason: `external resource reference in asset: ${relative(directory, path)}`,
        };
    }
    const blockNames = new Set(index.blocks);
    if (blockNames.size !== index.blocks.length)
      return { ok: false, reason: "index contains duplicate block names" };
    const blockExtents = Array(index.blocks.length).fill(0);
    for (const [key, record] of Object.entries(index.files)) {
      if (
        typeof key !== "string" ||
        !Array.isArray(record) ||
        record.length !== 3 ||
        !record.every(Number.isSafeInteger) ||
        record[0] < 0 ||
        record[0] >= index.blocks.length ||
        record[1] < 0 ||
        record[2] <= 0 ||
        !Number.isSafeInteger(record[1] + record[2])
      )
        return { ok: false, reason: `invalid file entry: ${key}` };
      if (!key.endsWith(".html")) return { ok: false, reason: `unexpected indexed file: ${key}` };
      blockExtents[record[0]] = Math.max(blockExtents[record[0]], record[1] + record[2]);
    }
    for (const [blockIndex, name] of index.blocks.entries()) {
      if (
        typeof name !== "string" ||
        !/^b\d{4}\.br$/.test(name) ||
        !existsSync(join(directory, name)) ||
        !statSync(join(directory, name)).isFile()
      )
        return { ok: false, reason: `missing or invalid block: ${name}` };
      const blockPath = join(directory, name);
      const packedSize = statSync(blockPath).size;
      if (packedSize === 0 || packedSize > MAX_BLOCK_BYTES)
        return { ok: false, reason: `invalid compressed block size: ${name}` };
      const packed = readFileSync(blockPath);
      let raw;
      try {
        raw = brotliDecompressSync(packed, { maxOutputLength: MAX_BLOCK_BYTES });
      } catch (error) {
        return { ok: false, reason: `invalid or oversized Brotli block ${name}: ${error.message}` };
      }
      if (raw.length < blockExtents[blockIndex])
        return { ok: false, reason: `indexed file range exceeds block: ${name}` };
    }
    if (
      manifest.pages !== Object.keys(index.files).length ||
      manifest.blocks !== index.blocks.length ||
      !Object.keys(index.files).length
    )
      return { ok: false, reason: "manifest counts do not match index" };
    return { ok: true, manifest };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

export function pack(source, output) {
  const referenceRoot = existsSync(join(source, "reference")) ? join(source, "reference") : null;
  if (!referenceRoot)
    throw new Error(`${source} has no reference/ directory; expected extracted html-book archive`);
  const all = walk(source).sort();
  const pages = all.filter(
    (p) =>
      PACKED.has(extOf(p)) &&
      relative(referenceRoot, p) !== ".." &&
      !relative(referenceRoot, p).startsWith(`..${sep}`)
  );
  const assets = all.filter((p) => COPIED.has(extOf(p)));
  if (!pages.length) throw new Error(`${source} contains no HTML reference pages`);
  mkdirSync(output, { recursive: true });
  const files = {};
  const blocks = [];
  let pending = [],
    pendingBytes = 0;
  const flush = () => {
    if (!pending.length) return;
    const index = blocks.length,
      name = `b${String(index).padStart(4, "0")}.br`;
    let offset = 0;
    const raw = Buffer.concat(
      pending.map(({ key, bytes }) => {
        files[key] = [index, offset, bytes.length];
        offset += bytes.length;
        return bytes;
      })
    );
    const packed = brotliCompressSync(raw, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 10,
        [zlibConstants.BROTLI_PARAM_LGWIN]: 24,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    writeFileSync(join(output, name), packed);
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
  let assetBytes = 0;
  for (const path of assets) {
    const key = posix.join(...relative(source, path).split(sep));
    const target = join(output, "assets", key);
    mkdirSync(dirname(target), { recursive: true });
    const raw = readFileSync(path);
    const ext = extOf(path);
    const bytes =
      ext === ".css"
        ? Buffer.from(sanitizeCss(raw.toString("utf8")))
        : ext === ".svg"
          ? Buffer.from(sanitizeSvg(raw.toString("utf8")))
          : raw;
    writeFileSync(target, bytes);
    assetBytes += bytes.length;
  }
  const rawTotal = blocks.reduce((n, b) => n + b.raw, 0),
    packedTotal = blocks.reduce((n, b) => n + b.packed, 0);
  const index = {
    codec: "brotli",
    release: RELEASE,
    blockBytes: BLOCK_BYTES,
    blocks: blocks.map((b) => b.name),
    files,
  };
  const indexJson = JSON.stringify(index);
  writeFileSync(join(output, "index.json"), indexJson);
  writeFileSync(
    join(output, "manifest.json"),
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
        indexSha256: sha256(indexJson),
      },
      null,
      2
    ) + "\n"
  );
  return {
    pages: Object.keys(files).length,
    blocks: blocks.length,
    packedBytes: packedTotal,
    assetBytes,
    assetFiles: assets.length,
  };
}

function safeArchiveListing(archive) {
  const listing = spawnSync("tar", ["-tf", archive], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listing.status !== 0)
    throw new Error(`cannot inspect archive: ${listing.stderr || listing.error || "tar failed"}`);
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error("archive is empty");
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split("/").includes("..")
    )
      throw new Error(`unsafe archive path: ${entry}`);
  }
  // Links can redirect later extraction entries outside the staging directory.
  const verbose = spawnSync("tar", ["-tvf", archive], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (verbose.status !== 0)
    throw new Error(`cannot validate archive entries: ${verbose.stderr || "tar failed"}`);
  for (const line of verbose.stdout.split(/\r?\n/))
    if (/^[lh]/.test(line)) throw new Error("archive contains links; refusing unsafe extraction");
}

export async function download(
  url,
  target,
  redirects = 0,
  getRequest = https.get,
  createStream = createWriteStream
) {
  if (redirects > 5) throw new Error("archive download exceeded redirect limit");
  let deadline;
  let activeRequest;
  try {
    const response = await new Promise((resolvePromise, reject) => {
      activeRequest = getRequest(
        url,
        { headers: { "User-Agent": "ams-access-cppreference-setup" } },
        resolvePromise
      );
      deadline = setTimeout(
        () => activeRequest.destroy(new Error("archive download timed out after 120 seconds")),
        120_000
      );
      deadline.unref?.();
      activeRequest.setTimeout(30_000, () =>
        activeRequest.destroy(new Error("archive download stalled for 30 seconds"))
      );
      activeRequest.on("error", reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.resume();
      if (!location) throw new Error("archive server returned redirect without location");
      const next = new URL(location, url);
      if (next.protocol !== "https:") throw new Error("archive redirect must remain HTTPS");
      clearTimeout(deadline);
      return await download(next, target, redirects + 1, getRequest, createStream);
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`archive download failed with HTTP ${response.statusCode}`);
    }
    const stream = createStream(target);
    response.setTimeout(30_000, () =>
      response.destroy(new Error("archive download stalled for 30 seconds"))
    );
    await new Promise((resolvePromise, reject) => {
      let settled = false;
      let finished = false;
      let failure;
      const fail = (error) => {
        if (settled || failure) return;
        failure = error;
        activeRequest.destroy();
        response.destroy();
        stream.destroy();
      };
      stream.once("error", fail);
      response.once("error", fail);
      response.once("aborted", () => fail(new Error("archive download response was aborted")));
      stream.once("finish", () => {
        finished = true;
      });
      stream.once("close", () => {
        if (settled) return;
        settled = true;
        if (failure) reject(failure);
        else if (!finished) reject(new Error("archive download closed before completion"));
        else resolvePromise();
      });
      response.pipe(stream);
    });
  } finally {
    clearTimeout(deadline);
  }
}

export function publishBundle(staging, destination, move = renameSync) {
  const backup = `${destination}.backup-${process.pid}`;
  if (existsSync(backup)) throw new Error(`previous bundle backup already exists: ${backup}`);
  const hadPrevious = existsSync(destination);
  if (hadPrevious) move(destination, backup);
  try {
    move(staging, destination);
  } catch (error) {
    if (hadPrevious) {
      try {
        move(backup, destination);
      } catch (restoreError) {
        throw new Error(
          `bundle replacement failed; previous bundle remains at ${backup}: ${restoreError.message}`,
          { cause: error }
        );
      }
    }
    throw error;
  }
  if (hadPrevious) rmSync(backup, { recursive: true, force: true });
}

async function obtainSource() {
  const explicit = process.env.CPPREFERENCE_SOURCE;
  if (explicit) {
    const path = resolve(explicit);
    if (existsSync(join(path, "reference"))) return path;
    if (existsSync(path) && statSync(path).isFile()) return extractArchive(path);
    throw new Error(`CPPREFERENCE_SOURCE does not exist: ${path}`);
  }
  const localArchive = process.env.CPPREFERENCE_ARCHIVE;
  if (localArchive) return extractArchive(resolve(localArchive));
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, ARCHIVE_NAME);
  if (!existsSync(archive) || sha256(readFileSync(archive)) !== ARCHIVE_SHA256) {
    rmSync(archive, { force: true });
    const partial = `${archive}.part`;
    try {
      await download(new URL(ARCHIVE_URL), partial);
    } catch (error) {
      rmSync(partial, { force: true });
      throw new Error(
        `could not download pinned cppreference archive (${ARCHIVE_URL}): ${error.message}`
      );
    }
    const digest = sha256(readFileSync(partial));
    if (digest !== ARCHIVE_SHA256) {
      rmSync(partial, { force: true });
      throw new Error(
        `cppreference archive SHA-256 mismatch: expected ${ARCHIVE_SHA256}, got ${digest}`
      );
    }
    renameSync(partial, archive);
  }
  return extractArchive(archive);
}

function extractArchive(archive) {
  if (!existsSync(archive) || !statSync(archive).isFile())
    throw new Error(`cppreference archive does not exist: ${archive}`);
  const digest = sha256(readFileSync(archive));
  if (digest !== ARCHIVE_SHA256)
    throw new Error(
      `cppreference archive SHA-256 mismatch: expected ${ARCHIVE_SHA256}, got ${digest}`
    );
  safeArchiveListing(archive);
  const extracted = join(cache, "source");
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  const result = spawnSync("tar", ["-xf", archive, "-C", extracted], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `cppreference archive extraction failed: ${result.stderr || result.error || "tar failed"}`
    );
  const referenceDir = findReferenceDir(extracted);
  if (!referenceDir) throw new Error("pinned archive extracted without a reference/ directory");
  return dirname(referenceDir);
}

export async function run(args = process.argv.slice(2)) {
  if (args.includes("--check")) {
    const result = checkBundle();
    if (!result.ok) {
      console.error(`cppreference bundle is missing or invalid: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `cppreference bundle OK: ${result.manifest.pages} pages, ${result.manifest.blocks} blocks (${result.manifest.release})`
    );
    return;
  }
  // Preserve the original explicit extracted-source mode for maintainers.
  const sourceArg = args.find((arg) => !arg.startsWith("--"));
  const current = checkBundle();
  if (!sourceArg && current.ok) {
    console.log(
      `cppreference bundle is current (${current.manifest.release}); skipping preparation`
    );
    return;
  }
  try {
    const source = sourceArg ? resolve(sourceArg) : await obtainSource();
    const staging = `${dest}.staging-${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    pack(source, staging);
    const check = checkBundle(staging);
    if (!check.ok) throw new Error(`generated bundle failed validation: ${check.reason}`);
    publishBundle(staging, dest);
    const manifest = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
    const mb = (n) => (n / 1048576).toFixed(1);
    console.log(
      `cppreference ${manifest.release}: ${manifest.pages} pages, ${manifest.blocks} blocks, ${mb(manifest.packedBytes)} MB packed + ${mb(manifest.assetBytes)} MB assets`
    );
  } catch (error) {
    console.error(
      `cppreference preparation failed: ${error.message}\nSet CPPREFERENCE_SOURCE to an extracted html-book directory or CPPREFERENCE_ARCHIVE to the pinned archive and retry.`
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
