import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { AccessLevel, Category, PageSummary, PageType, Space, Widget, WidgetKind } from "@commons-root/gen-shared";
import DocEditor from "../DocEditor";
import Menu from "../ui/Menu";
import { categoryOptions, childrenOf, errorText, useLoaded, wiki } from "./api";
import { NavLink, pageRoute, useNav } from "./nav";
import PageList from "./PageList";
import { t } from "../i18n";

type Props = { space: Space; types: PageType[]; categories: Category[] };

const widgetDoc = (spaceId: string, widgetId: string) => `widget:${spaceId}_${widgetId}`;

const KINDS: { kind: WidgetKind; label: () => string }[] = [
  { kind: WidgetKind.WIDGET_TEXT, label: () => t("widget.text") },
  { kind: WidgetKind.WIDGET_SEARCH, label: () => t("widget.search") },
  { kind: WidgetKind.WIDGET_FEATURED, label: () => t("widget.featured") },
  { kind: WidgetKind.WIDGET_RECENT, label: () => t("widget.recent") },
  { kind: WidgetKind.WIDGET_LIST, label: () => t("widget.list") },
  { kind: WidgetKind.WIDGET_LINKS, label: () => t("widget.links") },
];
const kindLabel = (kind: WidgetKind) => KINDS.find((k) => k.kind === kind)?.label() ?? "";

const blank = (kind: WidgetKind): Widget => ({
  id: crypto.randomUUID(),
  kind,
  title: "",
  pageIds: [],
  count: 8,
  categoryId: "",
  tag: "",
  links: [],
  wide: kind === WidgetKind.WIDGET_TEXT || kind === WidgetKind.WIDGET_SEARCH,
  pages: [],
});

/** A space's front page: blocks the editors arrange (text, search, featured pages…). */
const Home: React.FC<Props> = ({ space, types, categories }) => {
  const { value, error, reload } = useLoaded(`home:${space.id}`, () => wiki.getHome({ spaceId: space.id }).then((r) => r.widgets), { spaceId: space.id });
  const [editing, setEditing] = useState<Widget[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const canEdit = space.level >= AccessLevel.EDIT;
  const widgets = editing ?? value ?? [];

  const save = async () => {
    if (!editing) return;
    try {
      await wiki.saveHome({ spaceId: space.id, widgets: editing.map((w) => ({ ...w, pages: [] })) });
      setEditing(null);
      reload();
    } catch (err) {
      setProblem(errorText(err));
    }
  };
  const change = (i: number, next: Widget) => editing && setEditing(editing.map((w, j) => (j === i ? next : w)));
  const move = (i: number, delta: number) => {
    if (!editing) return;
    const next = [...editing];
    const [w] = next.splice(i, 1);
    next.splice(i + delta, 0, w);
    setEditing(next);
  };

  if (error && !value) return <div className="app-message">{error}</div>;

  return (
    <div className={editing ? "home editing" : "home"}>
      <header className="home-head">
        <h1 className="page-title">{space.name}</h1>
        {canEdit &&
          (editing ? (
            <div className="home-actions">
              <Menu
                trigger={
                  <>
                    <Plus size={15} /> {t("home.addBlock")}
                  </>
                }
                items={KINDS.map((k) => ({ key: String(k.kind), label: k.label(), onSelect: () => setEditing([...editing, blank(k.kind)]) }))}
              />
              <button onClick={() => setEditing(null)}>{t("common.cancel")}</button>
              <button className="primary" onClick={save}>
                <Check size={15} /> {t("home.done")}
              </button>
            </div>
          ) : (
            <button className="home-edit" onClick={() => setEditing((value ?? []).map((w) => ({ ...w })))}>
              <Pencil size={14} /> {t("home.edit")}
            </button>
          ))}
      </header>
      {problem && (
        <div className="banner error" onClick={() => setProblem(null)}>
          {problem}
        </div>
      )}
      {!widgets.length && <p className="hint list-empty">{canEdit ? t("home.emptyEditor") : t("home.empty")}</p>}
      <div className="home-grid">
        {widgets.map((w, i) => (
          <section key={w.id} className={w.wide ? "widget wide" : "widget"}>
            {editing && (
              <div className="widget-tools">
                <span className="widget-kind">{kindLabel(w.kind)}</span>
                <label className="widget-wide">
                  <input type="checkbox" checked={w.wide} onChange={(e) => change(i, { ...w, wide: e.target.checked })} /> {t("home.wide")}
                </label>
                <button className="icon" disabled={i === 0} title={t("common.moveUp")} onClick={() => move(i, -1)}>
                  <ArrowUp size={15} />
                </button>
                <button className="icon" disabled={i === widgets.length - 1} title={t("common.moveDown")} onClick={() => move(i, 1)}>
                  <ArrowDown size={15} />
                </button>
                <button className="icon danger" title={t("home.removeBlock")} onClick={() => setEditing(editing.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </button>
              </div>
            )}
            {editing ? (
              <WidgetEditor widget={w} space={space} categories={categories} onChange={(next) => change(i, next)} />
            ) : (
              <WidgetView widget={w} space={space} types={types} categories={categories} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
};

const WidgetView: React.FC<{ widget: Widget; space: Space; types: PageType[]; categories: Category[] }> = ({ widget: w, space, types, categories }) => {
  const { go } = useNav();
  const [query, setQuery] = useState("");
  const title = w.title ? <h2 className="widget-title">{w.title}</h2> : null;
  switch (w.kind) {
    case WidgetKind.WIDGET_TEXT:
      return (
        <>
          {title}
          <div className="widget-text">
            <DocEditor docId={widgetDoc(space.id, w.id)} level={AccessLevel.READ} variant="reader" emptyText="" />
          </div>
        </>
      );
    case WidgetKind.WIDGET_SEARCH:
      return (
        <>
          {title}
          <form
            className="widget-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) go({ view: "search", query: query.trim(), spaceId: space.id });
            }}
          >
            <Search size={16} />
            <input value={query} placeholder={t("search.placeholderIn", { space: space.name })} onChange={(e) => setQuery(e.target.value)} />
            <button type="submit">{t("search.go")}</button>
          </form>
        </>
      );
    case WidgetKind.WIDGET_LINKS:
      return (
        <>
          {title ?? <h2 className="widget-title">{t("widget.links")}</h2>}
          <ul className="widget-links">
            {w.links.map((l, i) => (
              <li key={i}>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label || l.url}
                </a>
              </li>
            ))}
          </ul>
        </>
      );
    case WidgetKind.WIDGET_FEATURED:
      return (
        <>
          {title ?? <h2 className="widget-title">{t("widget.featured")}</h2>}
          <div className="featured">
            {w.pages.map((p) => (
              <FeaturedCard key={p.id} page={p} />
            ))}
            {!w.pages.length && <p className="hint">{t("widget.noFeatured")}</p>}
          </div>
        </>
      );
    default: {
      // Recent pages, or a category's or tag's pages.
      const category = categories.find((c) => c.id === w.categoryId);
      const fallback = w.kind === WidgetKind.WIDGET_RECENT ? t("widget.recent") : category?.name ?? w.tag;
      const more =
        w.kind === WidgetKind.WIDGET_LIST && (category || w.tag)
          ? { view: "space" as const, spaceId: space.id, at: category ? { kind: "category" as const, categoryId: category.id } : { kind: "tag" as const, tag: w.tag } }
          : null;
      return (
        <>
          {title ?? <h2 className="widget-title">{fallback}</h2>}
          <PageList pages={w.pages} types={types} empty={t("widget.noPages")} />
          {more && w.pages.length >= w.count && (
            <NavLink className="widget-more" to={more}>
              {t("widget.seeAll")}
            </NavLink>
          )}
        </>
      );
    }
  }
};

const FeaturedCard: React.FC<{ page: PageSummary }> = ({ page }) => {
  const { go } = useNav();
  return (
    <a
      href="#"
      className="featured-card"
      onClick={(e) => {
        e.preventDefault();
        go(pageRoute(page.spaceId, page.id));
      }}
    >
      <span className="featured-title">{page.title}</span>
      {page.lead && <span className="featured-lead">{page.lead}</span>}
    </a>
  );
};

/** The settings of one block while the home page is being arranged. */
const WidgetEditor: React.FC<{ widget: Widget; space: Space; categories: Category[]; onChange: (w: Widget) => void }> = ({
  widget: w,
  space,
  categories,
  onChange,
}) => (
  <div className="widget-editor">
    <label className="detail">
      <span>{t("home.blockTitle")}</span>
      <input value={w.title} placeholder={kindLabel(w.kind)} maxLength={80} onChange={(e) => onChange({ ...w, title: e.target.value })} />
    </label>
    {w.kind === WidgetKind.WIDGET_TEXT && (
      <div className="widget-text editing">
        <DocEditor docId={widgetDoc(space.id, w.id)} level={AccessLevel.EDIT} variant="field" />
      </div>
    )}
    {(w.kind === WidgetKind.WIDGET_RECENT || w.kind === WidgetKind.WIDGET_LIST) && (
      <label className="detail">
        <span>{t("home.count")}</span>
        <input type="number" min={1} max={30} value={w.count} onChange={(e) => onChange({ ...w, count: Number(e.target.value) || 8 })} />
      </label>
    )}
    {w.kind === WidgetKind.WIDGET_LIST && (
      <div className="detail-row">
        <label className="detail">
          <span>{t("page.category")}</span>
          <select value={w.categoryId} onChange={(e) => onChange({ ...w, categoryId: e.target.value, tag: e.target.value ? "" : w.tag })}>
            {categoryOptions(categories, t("home.anyCategory")).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="detail">
          <span>{t("home.orTag")}</span>
          <input value={w.tag} disabled={!!w.categoryId} onChange={(e) => onChange({ ...w, tag: e.target.value })} />
        </label>
      </div>
    )}
    {w.kind === WidgetKind.WIDGET_FEATURED && <FeaturedPicker widget={w} spaceId={space.id} onChange={onChange} />}
    {w.kind === WidgetKind.WIDGET_LINKS && (
      <div className="links-editor">
        {w.links.map((l, i) => (
          <div key={i} className="detail-row">
            <input
              value={l.label}
              placeholder={t("home.linkLabel")}
              onChange={(e) => onChange({ ...w, links: w.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
            />
            <input
              value={l.url}
              placeholder="https://"
              onChange={(e) => onChange({ ...w, links: w.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
            />
            <button className="icon" title={t("home.removeLink")} onClick={() => onChange({ ...w, links: w.links.filter((_, j) => j !== i) })}>
              <X size={15} />
            </button>
          </div>
        ))}
        <button onClick={() => onChange({ ...w, links: [...w.links, { label: "", url: "" }] })}>
          <Plus size={15} /> {t("home.addLink")}
        </button>
      </div>
    )}
    {w.kind === WidgetKind.WIDGET_SEARCH && <p className="hint">{t("home.searchHint")}</p>}
    {w.kind === WidgetKind.WIDGET_RECENT && <p className="hint">{t("home.recentHint")}</p>}
    {!childrenOf(categories, "").length && w.kind === WidgetKind.WIDGET_LIST && <p className="hint">{t("home.noCategories")}</p>}
  </div>
);

/** Picks the pages a Featured block shows, by searching their titles. */
const FeaturedPicker: React.FC<{ widget: Widget; spaceId: string; onChange: (w: Widget) => void }> = ({ widget: w, spaceId, onChange }) => {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<PageSummary[]>([]);
  // Titles of the pages already chosen, kept as they are found.
  const [known, setKnown] = useState<Map<string, string>>(() => new Map(w.pages.map((p) => [p.id, p.title])));
  useEffect(() => {
    const q = query.trim();
    if (!q) return setFound([]);
    const timer = window.setTimeout(
      () =>
        wiki
          .findPages({ query: q })
          .then((r) => setFound(r.pages.filter((p) => !p.draftOnly && p.spaceId === spaceId)))
          .catch(() => setFound([])),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [query, spaceId]);
  return (
    <div className="featured-picker">
      <ol>
        {w.pageIds.map((id) => (
          <li key={id}>
            {known.get(id) ?? id}
            <button className="icon" title={t("home.removePage")} onClick={() => onChange({ ...w, pageIds: w.pageIds.filter((x) => x !== id) })}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
      <input value={query} placeholder={t("home.findPage")} onChange={(e) => setQuery(e.target.value)} />
      {found.length > 0 && (
        <ul className="picker-results">
          {found
            .filter((p) => !w.pageIds.includes(p.id))
            .slice(0, 8)
            .map((p) => (
              <li key={p.id}>
                <button
                  className="link"
                  onClick={() => {
                    setKnown(new Map(known).set(p.id, p.title));
                    onChange({ ...w, pageIds: [...w.pageIds, p.id] });
                    setQuery("");
                  }}
                >
                  {p.title}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};

export default Home;
