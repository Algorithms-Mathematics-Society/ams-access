/** Offline Boost book reader. All bytes come from native verified cache. */
import { invoke } from "@ams/api-client";

type Entry = [number, number, number];
type Index = {
  release: string;
  codec: string;
  home: string;
  blocks: string[];
  files: Record<string, Entry>;
};
export type BoostHit = { path: string; label: string; category: string };
let indexPromise: Promise<Index> | null = null;
const blocks = new Map<string, Promise<Uint8Array>>();
const decoder = new TextDecoder();

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
  if (blocks.size > 8) blocks.delete(blocks.keys().next().value!);
  return pending;
}
export async function readBoostPage(path: string): Promise<{ path: string; html: string }> {
  const index = await loadBoostIndex();
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
  return { path, html: decoder.decode(bytes.subarray(offset, offset + length)) };
}
export function labelBoost(path: string): string {
  return path
    .replace(/^boost\//, "")
    .replace(/\.html$/, "")
    .replace(/\//g, " · ");
}
export function resolveBoostHref(href: string, from: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw))
    return null;
  let url: URL;
  try {
    url = new URL(raw, `https://offline.invalid/${from}`);
  } catch {
    return null;
  }
  if (url.origin !== "https://offline.invalid" || url.search) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
  if (
    !path.startsWith("boost/") ||
    !path.endsWith(".html") ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    return null;
  return path;
}
export async function searchBoost(query: string, limit = 30): Promise<BoostHit[]> {
  const index = await loadBoostIndex();
  const parts = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  return Object.keys(index.files)
    .filter((path) => parts.every((part) => path.toLocaleLowerCase().includes(part)))
    .slice(0, limit)
    .map((path) => ({ path, label: labelBoost(path), category: "Boost" }));
}
export function clearBoostCache() {
  indexPromise = null;
  blocks.clear();
}
