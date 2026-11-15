"use client";

/**
 * The C++ reference, full screen, from the book packed into the app.
 *
 * Rendered into a shadow root rather than an iframe. The pages carry their
 * own stylesheet and would otherwise fight the app's, and an iframe would
 * have meant arguing with `frame-src 'self'` for no gain. A shadow root gives
 * the same style isolation and still lets us catch clicks.
 *
 * Every link is intercepted. Pages in the book link to the live site with
 * absolute URLs, so an internal link is recognised and loaded from the
 * archive; anything else -- godbolt, Stack Overflow, Wikipedia, all of which
 * the book links to -- is refused and says so. A candidate in a locked-down
 * exam who clicks a link must not be left looking at a dead page wondering
 * whether the app broke.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, CornerUpLeft, Search, X } from "lucide-react";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HOME_PAGE, type Hit, labelOf, readPage, resolveHref, search } from "../cppref";
import {
  labelBoost,
  loadBoostIndex,
  readBoostPage,
  resolveBoostHref,
  searchBoost,
} from "../boostref";
import { invoke } from "@ams/api-client";
import { referenceContent } from "../reference-content";
import { useTheme } from "@/lib/theme";

const ASSET_BASE = "/cppref/assets";

/**
 * Dark mode for a stylesheet written in 2011 for a white page.
 *
 * The book hardcodes its palette -- `background: white`, `color: black`, and
 * for links `color: black !important` -- so nothing here can be done by
 * inheriting the app's variables alone; the overrides have to be as loud as
 * what they are overriding. Colours come from the app's custom properties,
 * which cross into the shadow root, so this follows the theme toggle rather
 * than guessing from `prefers-color-scheme`.
 *
 * Surfaces fall into three groups: page containers go transparent and let the
 * app's background show; code, tables and callouts get a faint lift so they
 * stay distinguishable; menus and dropdowns must stay *opaque*, because they
 * float over text and a transparent one is unreadable.
 */
const THEME_CSS = `
.cppref-page { color: var(--color-text-primary); }

.cppref-page[data-theme="dark"] #content,
.cppref-page[data-theme="dark"] div#content,
.cppref-page[data-theme="dark"] div#cpp-content-base,
.cppref-page[data-theme="dark"] div#cpp-footer-base,
.cppref-page[data-theme="dark"] .printfooter,
.cppref-page[data-theme="dark"] .catlinks,
.cppref-page[data-theme="dark"] #footer,
.cppref-page[data-theme="dark"] div#footer ul li,
.cppref-page[data-theme="dark"] div#cpp-head-first-base,
.cppref-page[data-theme="dark"] div#cpp-head-second-base,
.cppref-page[data-theme="dark"] div#cpp-head-personal ul,
.cppref-page[data-theme="dark"] h1,
.cppref-page[data-theme="dark"] h2,
.cppref-page[data-theme="dark"] h3,
.cppref-page[data-theme="dark"] h4,
.cppref-page[data-theme="dark"] h5,
.cppref-page[data-theme="dark"] h6 {
  background: transparent !important;
  color: var(--color-text-primary) !important;
}

/* Floating things keep a solid surface or they are unreadable over text. */
.cppref-page[data-theme="dark"] .t-navbar-menu > div,
.cppref-page[data-theme="dark"] .t-tr-dropdown > div > div,
.cppref-page[data-theme="dark"] div.vectorMenu ul,
.cppref-page[data-theme="dark"] .os-suggest,
.cppref-page[data-theme="dark"] .os-suggest-result,
.cppref-page[data-theme="dark"] .os-suggest-result-hl,
.cppref-page[data-theme="dark"] div#simpleSearch {
  background: var(--color-background-popover, var(--color-background-card)) !important;
  color: var(--color-text-primary) !important;
  border-color: var(--color-border) !important;
}

/* Code, tables and callouts: lifted a little, not white. */
.cppref-page[data-theme="dark"] pre,
.cppref-page[data-theme="dark"] code,
.cppref-page[data-theme="dark"] .mw-code,
.cppref-page[data-theme="dark"] div.mw-geshi,
.cppref-page[data-theme="dark"] #toc,
.cppref-page[data-theme="dark"] .toc,
.cppref-page[data-theme="dark"] .toccolours,
.cppref-page[data-theme="dark"] div.thumbinner,
.cppref-page[data-theme="dark"] table.wikitable,
.cppref-page[data-theme="dark"] table.wikitable > * > tr > th,
.cppref-page[data-theme="dark"] .mw-datatable td,
.cppref-page[data-theme="dark"] table.fmbox,
.cppref-page[data-theme="dark"] table.fmbox-system,
.cppref-page[data-theme="dark"] table.ombox,
.cppref-page[data-theme="dark"] table.cmbox-style,
.cppref-page[data-theme="dark"] .messagebox,
.cppref-page[data-theme="dark"] .errorbox,
.cppref-page[data-theme="dark"] .warningbox,
.cppref-page[data-theme="dark"] .successbox {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent) !important;
  color: var(--color-text-primary) !important;
  border-color: var(--color-border) !important;
}

/* The front page is a table, not an article: different containers, same
   assumption of #fafafa panels hairlined in silver. */
.cppref-page[data-theme="dark"] .mainpagetable tr.row td,
.cppref-page[data-theme="dark"] .mainpagetable tr.rowtop td {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent) !important;
  color: var(--color-text-primary) !important;
  border-color: var(--color-border) !important;
}

.cppref-page[data-theme="dark"] table,
.cppref-page[data-theme="dark"] th,
.cppref-page[data-theme="dark"] td,
.cppref-page[data-theme="dark"] hr {
  border-color: var(--color-border) !important;
}

/* The book forces links black with !important, which on a dark page is an
   invisible link. Declared last and just as loudly. */
.cppref-page[data-theme="dark"] a,
.cppref-page[data-theme="dark"] a.external,
.cppref-page[data-theme="dark"] a.stub,
.cppref-page[data-theme="dark"] a:visited {
  color: #7fb4ff !important;
}
.cppref-page[data-theme="dark"] a.new,
.cppref-page[data-theme="dark"] a[href*="redlink"] {
  color: #ff8a80 !important;
}
.cppref-page[data-theme="dark"] a:hover { text-decoration: underline; }

/* Diagrams and formula images are black ink on transparent. */
.cppref-page[data-theme="dark"] img[src*="/math/"],
.cppref-page[data-theme="dark"] img.mwe-math-fallback-image-inline {
  filter: invert(1) hue-rotate(180deg);
}
`;
const STYLESHEETS = [
  `${ASSET_BASE}/reference/common/ext.css`,
  `${ASSET_BASE}/reference/common/site_modules.css`,
];

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

export const ReferencePanel = memo(function ReferencePanel({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedHitRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [path, setPath] = useState(HOME_PAGE);
  const [book, setBook] = useState<"cpp" | "boost">("cpp");
  const [boostReady, setBoostReady] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [searchError, setSearchError] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [blocked, setBlocked] = useState<string | null>(null);
  const { theme } = useTheme();

  const go = useCallback((next: string, remember = true) => {
    setPath((current) => {
      if (remember && current !== next) setHistory((past) => [...past, current]);
      return next;
    });
    setQuery("");
    setHits([]);
    setCursor(0);
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  const back = useCallback(() => {
    scrollRef.current?.focus({ preventScroll: true });
    setHistory((past) => {
      if (past.length === 0) return past;
      setPath(past[past.length - 1]);
      return past.slice(0, -1);
    });
  }, []);

  // Render the requested page into the shadow root.
  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    (book === "boost" ? readBoostPage(path) : readPage(path))
      .then(({ html }) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        shadowRef.current ??= host.attachShadow({ mode: "open" });
        const links =
          book === "cpp"
            ? STYLESHEETS.map((href) => `<link rel="stylesheet" href="${href}">`).join("")
            : "";
        // THEME_CSS comes after the book's own sheets so that, at equal
        // specificity, ours is the one that wins.
        shadowRef.current.innerHTML =
          `${links}<style>${THEME_CSS}</style>` +
          `<div class="cppref-page" data-theme="${theme}">${referenceContent(html, path)}</div>`;
        setStatus({ kind: "idle" });
        scrollRef.current?.scrollTo({ top: 0 });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "could not open that page",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // `theme` is deliberately absent: flipping it must not refetch and
    // re-scroll the page, so the effect below just re-labels the wrapper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reload, book]);

  useEffect(() => {
    shadowRef.current?.querySelector(".cppref-page")?.setAttribute("data-theme", theme);
  }, [theme]);

  // One handler for all 33,019 internal links, and every external one.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onActivate = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
      const anchor = event
        .composedPath()
        .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
      if (!anchor) return;
      event.preventDefault();
      // Anchors have no href: middle-click, context menus, downloads and
      // default browser navigation cannot escape this controlled handler.
      if (event.type === "auxclick") return;
      const href = anchor.getAttribute("data-cppref-href") ?? "";
      if (href.startsWith("#")) {
        try {
          shadowRef.current?.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
        } catch {
          /* Ignore malformed fragment identifiers. */
        }
        return;
      }
      const target = book === "boost" ? resolveBoostHref(href, path) : resolveHref(href, path);
      if (target) {
        setBlocked(null);
        go(target);
      } else {
        setBlocked(anchor.textContent?.trim() || href);
      }
    };
    host.addEventListener("click", onActivate);
    host.addEventListener("auxclick", onActivate);
    host.addEventListener("keydown", onActivate);
    return () => {
      host.removeEventListener("click", onActivate);
      host.removeEventListener("auxclick", onActivate);
      host.removeEventListener("keydown", onActivate);
    };
  }, [go, path, book]);

  useEffect(() => {
    setSearchError("");
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (book === "boost" ? searchBoost(query) : search(query))
        .then((found) => {
          if (!cancelled) {
            setHits(found);
            setCursor(0);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setHits([]);
            setSearchError(
              error instanceof Error ? error.message : "Reference search is unavailable."
            );
          }
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, book]);

  const crumb = useMemo(() => (book === "boost" ? labelBoost(path) : labelOf(path)), [path, book]);

  useEffect(() => {
    void invoke<{ installed: boolean }>("boost_reference_local_status")
      .then((result) => setBoostReady(result.installed))
      .catch(() => {});
  }, []);

  const chooseBook = useCallback(
    async (next: "cpp" | "boost") => {
      if (next === book) return;
      setHistory([]);
      setQuery("");
      setHits([]);
      setBlocked(null);
      if (next === "boost") {
        try {
          const index = await loadBoostIndex();
          setBook("boost");
          setPath(index.home);
        } catch (error) {
          setSearchError(error instanceof Error ? error.message : "Boost reference unavailable.");
        }
      } else {
        setBook("cpp");
        setPath(HOME_PAGE);
      }
    },
    [book]
  );

  useEffect(() => {
    selectedHitRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cursor, hits]);

  /** Results are driven from the search box, so a candidate never has to move
   *  to the mouse mid-exam: arrows move, Enter opens, Escape backs out. */
  const onSearchKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown" && hits.length > 0) {
        event.preventDefault();
        setCursor((at) => (at + 1) % hits.length);
      } else if (event.key === "ArrowUp" && hits.length > 0) {
        event.preventDefault();
        setCursor((at) => (at - 1 + hits.length) % hits.length);
      } else if (event.key === "Enter" && hits[cursor]) {
        event.preventDefault();
        go(hits[cursor].path);
      } else if (event.key === "Escape") {
        event.preventDefault();
        // Clear first; a second Escape on an empty box leaves the reference.
        if (query) {
          setQuery("");
          setHits([]);
        } else {
          onClose();
        }
      }
    },
    [cursor, go, hits, onClose, query]
  );

  // The search box is the point of arriving here, so it takes focus.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <VStack gap={0} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <HStack
        gap={8}
        align="center"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        {/* Leaving is the commonest thing anyone does here, so it is the
            leftmost control and it says where it goes. Moving back through
            pages is the rarer action and sits with the page name it acts on. */}
        <Button
          type="button"
          label="Back to contest"
          variant="secondary"
          size="sm"
          icon={<ArrowLeft size={16} aria-hidden />}
          onClick={onClose}
        />

        <span style={{ width: 1, alignSelf: "stretch", background: "var(--color-border)" }} />

        {history.length > 0 ? (
          <IconButton
            type="button"
            onClick={back}
            label="Previous reference page"
            variant="secondary"
            size="sm"
            icon={<CornerUpLeft size={15} aria-hidden />}
          />
        ) : null}
        <BookOpen size={15} aria-hidden />
        <Button
          type="button"
          label="C++"
          size="sm"
          variant={book === "cpp" ? "primary" : "ghost"}
          onClick={() => void chooseBook("cpp")}
        />
        {boostReady ? (
          <Button
            type="button"
            label="Boost"
            size="sm"
            variant={book === "boost" ? "primary" : "ghost"}
            onClick={() => void chooseBook("boost")}
          />
        ) : null}
        <Text size="sm" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
          {crumb}
        </Text>

        <HStack gap={6} align="center" style={{ marginLeft: "auto", minWidth: 0 }}>
          <Search size={14} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={
              book === "boost"
                ? "Search Boost articles"
                : "Search, e.g. std::string or vector::push_back"
            }
            aria-label={
              book === "boost" ? "Search the Boost reference" : "Search the C++ reference"
            }
            spellCheck={false}
            autoComplete="off"
            style={{
              font: "inherit",
              padding: "4px 8px",
              minWidth: 280,
              border: "var(--border-width) solid var(--color-border)",
              borderRadius: "var(--radius-element)",
              background: "transparent",
              color: "inherit",
            }}
          />
          {query ? (
            <IconButton
              type="button"
              label="Clear search"
              variant="secondary"
              size="sm"
              icon={<X size={15} aria-hidden />}
              onClick={() => {
                setQuery("");
                setHits([]);
                inputRef.current?.focus();
              }}
            />
          ) : null}
        </HStack>
      </HStack>

      {blocked ? (
        <HStack
          gap={8}
          align="center"
          style={{ padding: "6px 12px", background: "rgba(255,186,0,.12)", flexShrink: 0 }}
        >
          <Text size="xsm">
            {`"${blocked}" points outside the reference, so it is not available during the exam.`}
          </Text>
          <IconButton
            type="button"
            onClick={() => setBlocked(null)}
            style={{ marginLeft: "auto" }}
            label="Dismiss"
            variant="secondary"
            size="sm"
            icon={<X size={14} aria-hidden />}
          />
        </HStack>
      ) : null}

      {searchError && (
        <Text role="alert" type="supporting" style={{ padding: "var(--spacing-3)" }}>
          {searchError}
        </Text>
      )}

      {query.trim() && hits.length === 0 && !searchError ? (
        <HStack style={{ padding: "8px 12px", flexShrink: 0 }}>
          <Text size="xsm">Nothing in the reference matches that.</Text>
        </HStack>
      ) : null}

      {hits.length > 0 ? (
        <VStack
          gap={0}
          role="listbox"
          aria-label="Search results"
          style={{
            maxHeight: "46%",
            overflowY: "auto",
            borderBottom: "var(--border-width) solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          {hits.map((hit, at) => (
            <button
              key={hit.path}
              ref={at === cursor ? selectedHitRef : undefined}
              type="button"
              role="option"
              aria-selected={at === cursor}
              // Scrolling beneath a stationary pointer must not replace keyboard selection.
              onMouseMove={() => setCursor(at)}
              onClick={() => go(hit.path)}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                textAlign: "left",
                padding: "6px 12px",
                background:
                  at === cursor ? "var(--color-background-subtle, rgba(127,127,127,.14))" : "none",
                border: "none",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
              }}
            >
              <Text size="sm" style={{ fontWeight: at === cursor ? 600 : 400 }}>
                {hit.label}
              </Text>
              <Text size="xsm" style={{ opacity: 0.65 }}>
                {hit.category}
              </Text>
            </button>
          ))}
        </VStack>
      ) : null}

      <VStack
        ref={scrollRef}
        role="region"
        aria-label={book === "boost" ? "Boost reference article" : "C++ reference article"}
        tabIndex={0}
        gap={0}
        paddingInline={3}
        style={{ flex: 1, minHeight: 0, overflow: "auto", overscrollBehavior: "contain" }}
      >
        {status.kind === "error" ? (
          <VStack gap={4} style={{ padding: "var(--spacing-6)" }}>
            <Text size="sm" style={{ fontWeight: 600 }}>
              Couldn’t open the offline reference.
            </Text>
            <Text size="xsm">{status.message}</Text>
            <Button
              label="Retry"
              variant="secondary"
              onClick={() => setReload((value) => value + 1)}
              style={{ alignSelf: "flex-start" }}
            />
          </VStack>
        ) : null}
        <div ref={hostRef} />
      </VStack>
    </VStack>
  );
});
