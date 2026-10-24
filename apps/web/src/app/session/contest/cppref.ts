/**
 * Reading pages out of the packed cppreference book.
 *
 * The book ships as 321 brotli blocks under `public/cppref/` plus an index
 * saying which block holds each page and where in it. Nothing here
 * decompresses anything: the blocks are served with `Content-Encoding: br`,
 * so `fetch` hands back plain bytes and the browser did the work in its
 * network layer. That is the whole reason the format is what it is -- a
 * decoder in the bundle would have cost more than the pages do.
 *
 * A block is 1 MB of pages, so reading one page warms its neighbours too.
 * Candidates read sideways -- `vector`, then `vector::insert`, then
 * `vector::erase` -- and those are adjacent in the index, so they land in the
 * same block and the second lookup is free.
 */

const BASE = "/cppref";

/** `[blockIndex, byteOffset, byteLength]` */
type Entry = [number, number, number];

type Index = {
  codec: string;
  release: string;
  blocks: string[];
  files: Record<string, Entry>;
};

/** How many inflated blocks to keep. Eight is ~8 MB and covers the whole of
 *  a candidate's reading in one sitting; beyond that the oldest goes. */
const CACHE_BLOCKS = 8;

let indexPromise: Promise<Index> | null = null;
const blocks = new Map<number, Promise<Uint8Array>>();
const decoder = new TextDecoder();

export function loadIndex(): Promise<Index> {
  indexPromise ??= fetch(`${BASE}/index.json`).then((res) => {
    if (!res.ok) throw new Error(`cppref index unavailable (${res.status})`);
    return res.json() as Promise<Index>;
  });
  return indexPromise;
}

function blockBytes(index: Index, which: number): Promise<Uint8Array> {
  const cached = blocks.get(which);
  if (cached) return cached;

  const name = index.blocks[which];
  if (!name) return Promise.reject(new Error(`no such block ${which}`));

  const pending = fetch(`${BASE}/${name}`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`cppref block ${name} unavailable (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    })
    .catch((error: unknown) => {
      // A failed block must not poison the cache, or one flaky fetch makes
      // every page in that block permanently unreadable for the session.
      blocks.delete(which);
      throw error;
    });

  blocks.set(which, pending);
  // Insertion-ordered, so the first key is the oldest.
  if (blocks.size > CACHE_BLOCKS) {
    const oldest = blocks.keys().next();
    if (!oldest.done) blocks.delete(oldest.value);
  }
  return pending;
}

/** The book's entry point. */
export const HOME_PAGE = "reference/en/cpp.html";

/**
 * Turn whatever a link says into a key in the index.
 *
 * Pages in the book link to the *live* site with absolute URLs -- 33,019 of
 * them -- so rather than rewriting every file at pack time, the transform
 * happens here: `https://en.cppreference.com/w/cpp/container/vector` is
 * `reference/en/cpp/container/vector.html`. Returns null for anything that is
 * not a page of this book, which is how external links get refused.
 */
export function resolveHref(href: string, from: string = HOME_PAGE): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return null;

  let path: string;
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    // Only the book's own host, and only its article namespace.
    if (url.hostname !== "en.cppreference.com") return null;
    if (!url.pathname.startsWith("/w/")) return null;
    path = `reference/en/${url.pathname.slice("/w/".length)}`;
  } else if (raw.startsWith("/")) {
    path = raw.replace(/^\/+/, "");
    if (path.startsWith("w/")) path = `reference/en/${path.slice(2)}`;
  } else {
    // Relative to the page it was found on.
    const base = from.slice(0, from.lastIndexOf("/") + 1);
    path = normalise(base + raw);
  }

  path = path.split("#")[0].split("?")[0];
  if (!path) return null;
  if (!path.endsWith(".html")) path = `${path}.html`;
  return path;
}

/** Collapse `.` and `..` without touching the host, which there isn't one of. */
function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

export type Page = { path: string; html: string };

/** Read one page. Throws if the path is not in the book. */
export async function readPage(path: string): Promise<Page> {
  const index = await loadIndex();
  const entry = index.files[path];
  if (!entry) throw new Error(`not in the reference: ${path}`);
  const [which, offset, length] = entry;
  const bytes = await blockBytes(index, which);
  return { path, html: decoder.decode(bytes.subarray(offset, offset + length)) };
}

export async function hasPage(path: string): Promise<boolean> {
  const index = await loadIndex();
  return Object.hasOwn(index.files, path);
}

/** Categories under `cpp/` that are not `std::` names. */
const NOT_STD = new Set([
  "language",
  "keyword",
  "preprocessor",
  "header",
  "symbol",
  "links",
  "meta",
  "freestanding",
]);

/** The category a page sits in -- `container`, `algorithm`, `language` -- which
 *  is what tells a candidate whether a hit is the one they meant. */
export function categoryOf(path: string): string {
  const parts = path
    .replace(/^reference\/en\//, "")
    .replace(/\.html$/, "")
    .split("/");
  if (parts.length < 2) return parts[0] === "c" ? "C" : "C++";
  return parts[0] === "c" ? `C: ${parts[1]}` : parts[1];
}

/**
 * How a path reads as a name.
 *
 * The first segment under `cpp/` is a category, not part of the name, so
 * `cpp/container/vector` is `std::vector` and not `container::vector`.
 * Headers read as `<vector>`, and language and keyword pages are not `std::`
 * anything.
 */
export function labelOf(path: string): string {
  const trimmed = path.replace(/^reference\/en\//, "").replace(/\.html$/, "");
  const parts = trimmed.split("/");
  const language = parts[0];
  const rest = parts.slice(1);
  if (rest.length === 0) return language === "c" ? "C" : "C++";

  const category = rest[0];
  const tail = rest.slice(1).filter((part) => part !== "manip");
  if (category === "header") return `<${tail.join("/") || "header"}>`;
  if (NOT_STD.has(category)) return tail.join(" ") || category;
  if (tail.length === 0) return category;
  if (language === "c") return tail.join("::");
  return `std::${tail.join("::")}`;
}

export type Hit = { path: string; label: string; category: string };

/**
 * The names candidates type, mapped to the names the book files them under.
 *
 * `std::string` has no page: it is a typedef of `basic_string`, and the same
 * is true of every stream and of `string_view`. Searching the obvious thing
 * and getting nothing is how an editor teaches people to stop trusting it, so
 * the obvious thing has to work.
 */
const TYPEDEFS: Record<string, string> = {
  string: "basic_string",
  wstring: "basic_string",
  u8string: "basic_string",
  u16string: "basic_string",
  u32string: "basic_string",
  string_view: "basic_string_view",
  wstring_view: "basic_string_view",
  stringstream: "basic_stringstream",
  istringstream: "basic_istringstream",
  ostringstream: "basic_ostringstream",
  fstream: "basic_fstream",
  ifstream: "basic_ifstream",
  ofstream: "basic_ofstream",
  iostream: "basic_iostream",
  istream: "basic_istream",
  ostream: "basic_ostream",
  streambuf: "basic_streambuf",
  regex: "basic_regex",
  smatch: "match_results",
  cmatch: "match_results",
};

/** `std::vector::push_back`, `vector push_back` and `vector/push_back` are the
 *  same query. Candidates type all three. */
function segmentsOf(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .replace(/::|\s+|\./g, "/")
    .replace(/^std\//, "")
    .split("/")
    .filter(Boolean);
}

/** Whether every segment occurs in `key`, in order. */
function inOrder(key: string, segments: string[]): boolean {
  let at = 0;
  for (const segment of segments) {
    const found = key.indexOf(segment, at);
    if (found < 0) return false;
    at = found + segment.length;
  }
  return true;
}

/**
 * Rank pages against what the candidate typed.
 *
 * There is no full-text index -- that would be another megabyte to answer a
 * question nobody asks mid-exam. What gets typed is a symbol name, and symbol
 * names are the path. So this ranks on where the match lands: the page whose
 * own name is the query beats one that merely mentions it, and when the query
 * names a container too (`vector::push_back`) the pages under that container
 * are pulled up and the identically-named members of `deque` and `list` are
 * pushed down.
 */
export async function search(query: string, limit = 30): Promise<Hit[]> {
  const segments = segmentsOf(query);
  if (segments.length === 0) return [];
  const last = segments[segments.length - 1];
  if (last.length < 2 && segments.length === 1) return [];
  const needle = segments.join("/");
  const context = segments.slice(0, -1);
  const alias = TYPEDEFS[last];

  const index = await loadIndex();
  const scored: { path: string; score: number }[] = [];

  for (const path of Object.keys(index.files)) {
    const key = path.slice("reference/en/".length, -".html".length).toLowerCase();
    const leaf = key.slice(key.lastIndexOf("/") + 1);

    let score: number;
    if (leaf === last) score = 1000;
    else if (alias && leaf === alias) score = 980;
    else if (leaf.startsWith(last)) score = 820 - Math.min(120, leaf.length - last.length);
    else if (alias && leaf.startsWith(alias))
      score = 800 - Math.min(120, leaf.length - alias.length);
    else if (key.includes(needle)) score = 520;
    else if (leaf.includes(last)) score = 420;
    else if (segments.length > 1 && inOrder(key, segments)) score = 280;
    else continue;

    // A qualified query says which type it meant. Honour it both ways, or
    // `vector::push_back` ranks every container's push_back equally.
    if (context.length > 0) score += context.every((part) => key.includes(part)) ? 300 : -260;

    if (key.startsWith("cpp/")) score += 60;
    // `<vector>` is a real page and should be findable, but someone typing
    // "vector" wants the container.
    if (key.startsWith("cpp/header/")) score -= 80;
    // Real answers first: `std::experimental` and the C library are rarely
    // what a C++ contestant is reaching for.
    if (key.includes("/experimental/")) score -= 260;
    // Shallower pages are the ones people mean: `vector` over `vector/insert`.
    score -= key.split("/").length * 6;

    scored.push({ path, score });
  }

  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.slice(0, limit).map(({ path }) => ({
    path,
    label: labelOf(path),
    category: categoryOf(path),
  }));
}
