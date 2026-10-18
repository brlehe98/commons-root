import React, { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import type { PageSummary, Space } from "@commons-root/gen-shared";
import { spaceName, wiki } from "./api";
import { pageRoute, useNav } from "./nav";
import { t } from "../i18n";

type Props = { space: Space; spaces: Space[] };

/**
 * The search bar at the top of a space, as on Wikipedia: page titles are
 * suggested while typing; Enter opens the one picked, or searches the text.
 */
const SearchBox: React.FC<Props> = ({ space, spaces }) => {
  const { go } = useNav();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PageSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResults([]);
    const ask = ++asked.current;
    const timer = window.setTimeout(() => {
      wiki
        .findPages({ query: q })
        .then((r) => {
          if (ask !== asked.current) return;
          // This space's pages first.
          const pages = [...r.pages].sort((a, b) => Number(b.spaceId === space.id) - Number(a.spaceId === space.id));
          setResults(pages.slice(0, 8));
          setPicked(-1);
        })
        .catch(() => ask === asked.current && setResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, space.id]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const done = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const openPage = (p: PageSummary) => {
    go(pageRoute(p.spaceId, p.id));
    done();
  };
  const searchAll = () => {
    const q = query.trim();
    if (!q) return;
    go({ view: "search", query: q, spaceId: space.main ? undefined : space.id });
    done();
  };
  // The suggestions, then "search for pages containing…".
  const count = results.length + (query.trim() ? 1 : 0);

  return (
    <div className="search-bar" ref={box}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (picked >= 0 && picked < results.length) openPage(results[picked]);
          else searchAll();
        }}
      >
        <SearchIcon size={16} aria-hidden />
        <input
          type="search"
          value={query}
          placeholder={t("search.placeholderIn", { space: space.name })}
          aria-label={t("search.placeholderIn", { space: space.name })}
          aria-expanded={open && count > 0}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPicked((p) => (count ? (p + 1) % count : -1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setPicked((p) => (count ? (p <= 0 ? count - 1 : p - 1) : -1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button type="submit" className="search-go">
          {t("search.go")}
        </button>
      </form>
      {open && count > 0 && (
        <ul className="search-suggestions" role="listbox">
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === picked}>
              <button className={i === picked ? "suggestion-item on" : "suggestion-item"} onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(p)}>
                <span className="suggestion-title">{p.title}</span>
                {p.spaceId !== space.id && <span className="suggestion-space">{spaceName(spaces, p.spaceId)}</span>}
                {p.draftOnly ? <span className="suggestion-lead">{t("page.neverPublished")}</span> : p.lead && <span className="suggestion-lead">{p.lead}</span>}
              </button>
            </li>
          ))}
          <li role="option" aria-selected={picked === results.length}>
            <button
              className={picked === results.length ? "suggestion-item containing on" : "suggestion-item containing"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={searchAll}
            >
              <SearchIcon size={15} aria-hidden /> {t("search.containing", { query: query.trim() })}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

export default SearchBox;
