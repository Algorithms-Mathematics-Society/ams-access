import createDOMPurify from "dompurify";

type PurifierInstance = {
  addHook(
    name: "uponSanitizeAttribute",
    hook: (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => void
  ): void;
  sanitize(html: string, options: Record<string, unknown>): DocumentFragment | string;
};

const OFFLINE_ORIGIN = "https://offline.invalid";
const ASSET_PREFIX = "/cppref/assets/reference/";
const BOOK_PREFIX = "/reference/";

// Kept intentionally small: the reference is documentation, so it needs text,
// tables and code, not active browser controls or embedded documents.
const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "tt",
  "u",
  "ul",
  "var",
];

const ALLOWED_ATTR = [
  "alt",
  "aria-label",
  "class",
  "colspan",
  "height",
  "href",
  "id",
  "lang",
  "rowspan",
  "scope",
  "src",
  "title",
  "width",
];

/** Resolve an image source to the only local reference asset namespace. */
export function resolveReferenceAsset(source: string, from: string): string | null {
  const raw = source.trim();
  if (!raw || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.startsWith("//")) return null;

  // Absolute asset URLs are permitted only when they already name this exact
  // offline bundle. Other root-relative URLs belong to the host application.
  if (decoded.startsWith("/")) {
    if (!decoded.startsWith(ASSET_PREFIX)) return null;
    try {
      const direct = new URL(decoded, OFFLINE_ORIGIN);
      if (direct.search || direct.hash || !direct.pathname.startsWith(ASSET_PREFIX)) return null;
      return direct.pathname;
    } catch {
      return null;
    }
  }

  try {
    const normalizedFrom = from.startsWith("/cppref/") ? from.slice("/cppref".length) : from;
    const basePath = normalizedFrom.startsWith("/") ? normalizedFrom : `/${normalizedFrom}`;
    const base = new URL(basePath, OFFLINE_ORIGIN);
    const resolved = new URL(decoded, base);
    if (resolved.origin !== OFFLINE_ORIGIN || resolved.search || resolved.hash) return null;
    if (!resolved.pathname.startsWith(BOOK_PREFIX)) return null;
    if (resolved.pathname.split("/").some((part) => part === "." || part === "..")) return null;
    return `${ASSET_PREFIX}${resolved.pathname.slice(BOOK_PREFIX.length)}`;
  } catch {
    return null;
  }
}

/**
 * Convert a bundled cppreference page into inert, offline-only article markup.
 * All URL-bearing attributes are filtered before the fragment can enter the
 * live document; link destinations are retained only as data for the panel's
 * controlled in-app navigation handler.
 */
export function referenceContent(html: string, from: string): string {
  if (typeof window === "undefined" || !window.document) return "";

  const purifier = (createDOMPurify as unknown as (win: Window) => PurifierInstance)(window);
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName.toLowerCase();
    if (name === "src") {
      data.attrValue =
        node.nodeName.toLowerCase() === "img"
          ? (resolveReferenceAsset(data.attrValue, from) ?? "")
          : "";
      if (!data.attrValue) data.keepAttr = false;
    }
    if (name === "href" && node.nodeName.toLowerCase() !== "a") data.keepAttr = false;
    // No inline CSS: even sanitized CSS can hide network-capable syntax.
    if (name === "style" || name.startsWith("on") || name === "srcset" || name === "ping") {
      data.keepAttr = false;
    }
    // Never trust attacker-supplied navigation metadata.
    if (name === "data-cppref-href") data.keepAttr = false;
  });

  const fragment = purifier.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    FORBID_TAGS: [
      "base",
      "button",
      "embed",
      "form",
      "iframe",
      "input",
      "link",
      "math",
      "meta",
      "object",
      "script",
      "style",
      "svg",
      "template",
    ],
    FORBID_ATTR: ["action", "formaction", "srcdoc", "target", "download", "xlink:href"],
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;

  for (const anchor of Array.from(fragment.querySelectorAll("a"))) {
    const original = anchor.getAttribute("href");
    anchor.removeAttribute("href");
    anchor.setAttribute("role", "link");
    anchor.setAttribute("tabindex", "0");
    if (original) anchor.setAttribute("data-cppref-href", original);
  }

  return Array.from(fragment.childNodes)
    .map((node) => {
      const container = window.document.createElement("div");
      container.append(node.cloneNode(true));
      return container.innerHTML;
    })
    .join("");
}
