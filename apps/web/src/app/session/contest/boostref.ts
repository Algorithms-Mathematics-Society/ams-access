/** Offline Boost book reader. All bytes come from native verified cache. */
import { invoke } from "@ams/api-client";

type Entry = [number, number, number];
type Index = {
  release: string;
  codec: string;
  home: string;
  blocks: string[];
  files: Record<string, Entry>;
  /** Page titles in the insertion order of `files` (absent in older packs). */
  titles?: string[];
};
export type BoostHit = { path: string; label: string; category: string };
let indexPromise: Promise<Index> | null = null;
let searchable: { path: string; label: string; text: string }[] | null = null;
const blocks = new Map<string, Promise<Uint8Array>>();
const decoder = new TextDecoder();
// Decoded blocks are up to 16 MiB each; keep only a few in memory.
const CACHED_BLOCKS = 3;

async function asset(name: string, release: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_boost_reference_asset", { name, release }));
}
export function loadBoostIndex(): Promise<Index> {
  if (!indexPromise) {
    const pending = invoke<{ release: string | null }>("boost_reference_local_status")
      .then(async (status) => {
        if (!status.release) throw new Error("Boost reference is not installed.");
        const bytes = await asset("index.json", status.release);
        const index = JSON.parse(decoder.decode(bytes)) as Index;
        if (
          index?.codec !== "brotli" ||
          !index.home?.startsWith("boost/") ||
          !Array.isArray(index.blocks) ||
          !index.files ||
          !Object.hasOwn(index.files, index.home)
        )
          throw new Error("The Boost reference index is invalid.");
        return { ...index, release: status.release };
      })
      .catch((error: unknown) => {
        if (indexPromise === pending) indexPromise = null;
        throw error;
      });
    indexPromise = pending;
  }
  return indexPromise;
}
async function block(index: Index, which: number): Promise<Uint8Array> {
  const key = `${index.release}:${which}`;
  const cached = blocks.get(key);
  if (cached) return cached;
  const name = index.blocks[which];
  if (!name) throw new Error("Boost article block is missing.");
  const pending = asset(name, index.release).catch((error: unknown) => {
    if (blocks.get(key) === pending) blocks.delete(key);
    throw error;
  });
  blocks.set(key, pending);
  if (blocks.size > CACHED_BLOCKS) blocks.delete(blocks.keys().next().value!);
  return pending;
}
async function readEntry(index: Index, path: string): Promise<string> {
  const entry = Object.hasOwn(index.files, path) ? index.files[path] : null;
  if (!entry) throw new Error("This page is not in the offline Boost reference.");
  const [which, offset, length] = entry;
  const bytes = await block(index, which);
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 1 ||
    offset + length > bytes.length
  )
    throw new Error("The Boost reference page is incomplete.");
  return decoder.decode(bytes.subarray(offset, offset + length));
}
/** The target of a `<meta http-equiv="refresh">` stub, if it stays in the book. */
function redirectOf(html: string, from: string): string | null {
  for (const [tag] of html.slice(0, 4096).matchAll(/<meta\b[^>]*>/gi)) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue;
    const url = /content\s*=\s*["'][^"']*?url\s*=\s*([^"'\s>]+)/i.exec(tag)?.[1];
    return url ? resolveBoostHref(url, from) : null;
  }
  return null;
}
/** Read a page, following Boost's redirect stubs. `path` is where it landed. */
export async function readBoostPage(path: string): Promise<{ path: string; html: string }> {
  const index = await loadBoostIndex();
  let html = await readEntry(index, path);
  for (let hop = 0; hop < 3; hop++) {
    const next = redirectOf(html, path);
    if (!next || !Object.hasOwn(index.files, next)) break;
    path = next;
    html = await readEntry(index, path);
  }
  return { path, html };
}
export function labelBoost(path: string): string {
  return path
    .replace(/^boost\//, "")
    .replace(/\.html?$/, "")
    .replace(/\//g, " · ");
}
const BOOST_SITE = /^(?:www\.)?boost\.org$/i;
export function resolveBoostHref(href: string, from: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, `https://offline.invalid/${from}`);
  } catch {
    return null;
  }
  if (url.search) return null;
  let pathname = url.pathname;
  // Pages link to boost.org for other libraries; those pages are in the pack.
  if (BOOST_SITE.test(url.hostname) && (url.protocol === "https:" || url.protocol === "http:")) {
    const site = /^\/(?:doc\/libs\/[^/]+\/)?((?:libs|doc|more|tools)\/.*)$/.exec(pathname);
    if (!site) return null;
    pathname = `/boost/${site[1]}`;
  } else if (url.origin !== "https://offline.invalid") return null;
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (path.endsWith("/")) path += "index.html";
  if (
    !path.startsWith("boost/") ||
    !/\.html?$/.test(path) ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    return null;
  return path;
}
export async function searchBoost(query: string, limit = 30): Promise<BoostHit[]> {
  const index = await loadBoostIndex();
  const parts = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  searchable ??= Object.keys(index.files).map((path, at) => {
    const label = index.titles?.[at] || labelBoost(path);
    return { path, label, text: `${label} ${path}`.toLocaleLowerCase() };
  });
  const hits = searchable.filter((page) => parts.every((part) => page.text.includes(part)));
  // Pages whose title names the query come before pages that merely live near it.
  const titled = (label: string) =>
    parts.every((part) => label.toLocaleLowerCase().includes(part)) ? 0 : 1;
  return hits
    .sort((a, b) => titled(a.label) - titled(b.label) || a.label.length - b.label.length)
    .slice(0, limit)
    .map(({ path, label }) => ({ path, label, category: "Boost" }));
}
export function clearBoostCache() {
  indexPromise = null;
  searchable = null;
  blocks.clear();
}
export function boostPackSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
