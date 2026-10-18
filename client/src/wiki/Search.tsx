import React, { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { PageSummary, PageType, Space } from "@commons-root/gen-shared";
import { categoryOptions, errorText, useCategories, wiki } from "./api";
import { useNav } from "./nav";
import PageList from "./PageList";
import { t } from "../i18n";

type Props = { query: string; spaceId?: string; spaces: Space[]; types: PageType[] };

/** Full-text search over published pages, narrowed by space, category, tag or type. */
const Search: React.FC<Props> = ({ query, spaceId = "", spaces, types }) => {
  const { replace } = useNav();
  const [text, setText] = useState(query);
  const [filters, setFilters] = useState({ categoryId: "", tag: "", typeId: "" });
  const [results, setResults] = useState<PageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { categories } = useCategories(spaceId || spaces[0]?.id || "");
  const names = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces]);

  useEffect(() => setText(query), [query]);
  useEffect(() => {
    if (!query.trim() && !filters.tag && !filters.typeId && !filters.categoryId) return setResults(null);
    setError(null);
    wiki
      .search({ query, spaceId, ...filters, categoryId: spaceId ? filters.categoryId : "" })
      .then((r) => setResults(r.pages))
      .catch((err) => setError(errorText(err)));
  }, [query, spaceId, filters.categoryId, filters.tag, filters.typeId]);

  return (
    <div className="search-view">
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          replace({ view: "search", query: text.trim(), spaceId: spaceId || undefined });
        }}
      >
        <SearchIcon size={18} />
        <input autoFocus value={text} placeholder={t("search.placeholder")} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="primary">
          {t("search.go")}
        </button>
      </form>
      <div className="search-filters">
        <select value={spaceId} onChange={(e) => replace({ view: "search", query, spaceId: e.target.value || undefined })} aria-label={t("search.space")}>
          <option value="">{t("search.allSpaces")}</option>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {spaceId && (
          <select value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })} aria-label={t("page.category")}>
            {categoryOptions(categories, t("search.allCategories")).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <select value={filters.typeId} onChange={(e) => setFilters({ ...filters, typeId: e.target.value })} aria-label={t("page.type")}>
          <option value="">{t("search.allTypes")}</option>
          {types.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.name}
            </option>
          ))}
        </select>
        <input
          className="search-tag"
          placeholder={t("search.tag")}
          defaultValue={filters.tag}
          onBlur={(e) => setFilters({ ...filters, tag: e.target.value.trim() })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>
      {error && <div className="banner error">{error}</div>}
      {results && (
        <>
          <p className="hint search-count">{t("search.count", { count: results.length })}</p>
          <PageList pages={results} types={types} empty={t("search.none")} spaceNames={spaceId ? undefined : names} />
        </>
      )}
    </div>
  );
};

export default Search;
