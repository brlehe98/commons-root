import React, { useState } from "react";
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  Clock,
  Dices,
  FilePen,
  FolderPlus,
  Hash,
  Home as HomeIcon,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
  FolderInput,
  X,
} from "lucide-react";
import { AccessLevel, Category, PageType, Space } from "@commons-root/gen-shared";
import { confirmDialog, formDialog, promptDialog } from "../ui/dialog";
import Menu from "../ui/Menu";
import { categoryOptions, childrenOf, errorText, pathOf, useLoaded, wiki } from "./api";
import { NavLink, pageRoute, SpaceAt, useNav } from "./nav";
import Home from "./Home";
import PageView from "./PageView";
import PageList from "./PageList";
import TopBar, { BarTool } from "./TopBar";
import AllPages from "./AllPages";
import Search from "./Search";
import { useBackButton } from "../ui/backButton";
import { t } from "../i18n";

type Props = {
  space: Space;
  spaces: Space[];
  types: PageType[];
  at: SpaceAt;
  search?: { query: string; spaceId?: string };
  /** The bar's tools (reports, notifications, settings). */
  tools: BarTool[];
  /** A view of the app shown in place of the space's own (settings, reports). */
  content?: React.ReactNode;
  notice?: string;
};

const MENU_KEY = "commons.menuPinned";
const narrow = () => window.matchMedia("(max-width: 920px)").matches;

/** Whether the main menu stays beside the page on wide screens (it opens over the page on narrow ones). */
function useMenuPinned(): [boolean, (pinned: boolean) => void] {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(MENU_KEY) !== "0";
    } catch {
      return true;
    }
  });
  return [
    pinned,
    (next) => {
      setPinned(next);
      try {
        localStorage.setItem(MENU_KEY, next ? "1" : "0");
      } catch {
        // Private window: the choice lasts until the page closes.
      }
    },
  ];
}

/**
 * A space, laid out as Wikipedia: one bar at the top, the main menu on the
 * side (categories, recent changes…), and the home page, a page or a list
 * in the middle.
 */
const SpaceView: React.FC<Props> = ({ space, spaces, types, at, search, tools, content, notice }) => {
  const { go } = useNav();
  const { value: categories = [], reload } = useLoaded(`categories:${space.id}`, () => wiki.listCategories({ spaceId: space.id }).then((r) => r.categories), {
    spaceId: space.id,
  });
  const [problem, setProblem] = useState<string | null>(null);
  const canEdit = space.level >= AccessLevel.EDIT;
  const canSuggest = space.level >= AccessLevel.COMMENT;
  const [sideOpen, setSideOpen] = useState(false);
  const [pinned, setPinned] = useMenuPinned();
  useBackButton(sideOpen, () => setSideOpen(false));
  const toggleMenu = () => (narrow() ? setSideOpen(!sideOpen) : setPinned(!pinned));

  const randomPage = async () => {
    setSideOpen(false);
    try {
      const { pages } = await wiki.listPages({ spaceId: space.id, categoryId: "", deep: false, tag: "", typeId: "", drafts: false, recent: false, limit: 0 });
      const list = pages.filter((p) => p.publishedAt > 0n);
      if (!list.length) return setProblem(t("space.noPages"));
      go(pageRoute(space.id, list[Math.floor(Math.random() * list.length)].id));
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const newPage = async (categoryId = at.kind === "category" ? at.categoryId : "") => {
    const answer = await formDialog(
      t("space.newPage"),
      [
        { key: "title", label: t("page.title") },
        { key: "type", label: t("page.type"), options: types.map((tp) => ({ value: tp.id, label: tp.name })) },
        { key: "category", label: t("page.category"), value: categoryId, options: categoryOptions(categories) },
      ],
      { ok: t("space.create") },
    );
    if (!answer?.title.trim()) return;
    try {
      const { page } = await wiki.createPage({
        spaceId: space.id,
        title: answer.title.trim(),
        typeId: answer.type,
        categoryId: answer.category,
        translationOf: "",
        lang: "",
      });
      if (page) go(pageRoute(space.id, page.id, "edit"));
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const newCategory = async (parentId = "") => {
    const name = (await promptDialog(parentId ? t("category.newSub") : t("category.new")))?.trim();
    if (!name) return;
    try {
      const { category } = await wiki.saveCategory({ id: "", spaceId: space.id, parentId, name });
      reload();
      if (category) go({ view: "space", spaceId: space.id, at: { kind: "category", categoryId: category.id } });
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const side = (
    <aside className={sideOpen ? "space-side open" : "space-side"} aria-label={t("space.mainMenu")} onClick={(e) => (e.target as HTMLElement).closest("a") && setSideOpen(false)}>
      <div className="side-top">
        {t("space.mainMenu")}
        <button className="icon" title={t("common.close")} onClick={() => setSideOpen(false)}>
          <X size={16} />
        </button>
      </div>
      <NavLink className={at.kind === "home" && !search && !content ? "side-link on" : "side-link"} to={{ view: "space", spaceId: space.id }}>
        <HomeIcon size={15} /> {t("space.home")}
      </NavLink>
      <NavLink className={at.kind === "all" && !content ? "side-link on" : "side-link"} to={{ view: "space", spaceId: space.id, at: { kind: "all" } }}>
        <LayoutGrid size={15} /> {t("space.allPages")}
      </NavLink>
      <NavLink className={at.kind === "recent" && !content ? "side-link on" : "side-link"} to={{ view: "space", spaceId: space.id, at: { kind: "recent" } }}>
        <Clock size={15} /> {t("space.recent")}
      </NavLink>
      <button className="side-link side-button" onClick={randomPage}>
        <Dices size={15} /> {t("space.random")}
      </button>
      <div className="side-heading">
        {t("space.categories")}
        {canEdit && (
          <button className="icon" title={t("category.new")} onClick={() => newCategory()}>
            <FolderPlus size={14} />
          </button>
        )}
      </div>
      <CategoryTree categories={categories} parentId="" spaceId={space.id} at={at} depth={0} />
      {!categories.length && <p className="hint side-empty">{t("space.noCategories")}</p>}
      <div className="side-heading">{t("space.browse")}</div>
      <NavLink className={at.kind === "tags" || at.kind === "tag" ? "side-link on" : "side-link"} to={{ view: "space", spaceId: space.id, at: { kind: "tags" } }}>
        <Hash size={15} /> {t("space.tags")}
      </NavLink>
      {canSuggest && (
        <NavLink className={at.kind === "drafts" ? "side-link on" : "side-link"} to={{ view: "space", spaceId: space.id, at: { kind: "drafts" } }}>
          <FilePen size={15} /> {t("space.drafts")}
        </NavLink>
      )}
    </aside>
  );

  let main: React.ReactNode;
  if (content) main = content;
  else if (search) main = <Search query={search.query} spaceId={search.spaceId} spaces={spaces} types={types} />;
  else switch (at.kind) {
    case "page":
      main = (
        <PageView
          key={at.pageId}
          space={space}
          spaces={spaces}
          types={types}
          categories={categories}
          pageId={at.pageId}
          tab={at.tab}
          revisionId={at.revisionId}
          section={at.section}
        />
      );
      break;
    case "category":
      main = (
        <CategoryView
          key={at.categoryId}
          space={space}
          types={types}
          categories={categories}
          categoryId={at.categoryId}
          onChanged={reload}
          onNewPage={() => newPage(at.categoryId)}
          onNewSub={() => newCategory(at.categoryId)}
          onError={setProblem}
        />
      );
      break;
    case "tags":
      main = <TagsView space={space} />;
      break;
    case "tag":
      main = <TagView key={at.tag} space={space} types={types} categories={categories} tag={at.tag} />;
      break;
    case "drafts":
      main = <DraftsView space={space} types={types} categories={categories} />;
      break;
    case "recent":
      main = <RecentView space={space} types={types} categories={categories} />;
      break;
    case "all":
      main = <AllPages space={space} types={types} categories={categories} />;
      break;
    default:
      main = <Home key={space.id} space={space} types={types} categories={categories} />;
  }

  return (
    <div className={pinned ? "space" : "space menu-hidden"}>
      <TopBar
        space={space}
        spaces={spaces}
        menuOpen={sideOpen || (pinned && !narrow())}
        onMenu={toggleMenu}
        onNewPage={canEdit ? () => newPage() : undefined}
        tools={tools}
      />
      {side}
      {sideOpen && <div className="side-scrim" onClick={() => setSideOpen(false)} />}
      <main className="space-main">
        {notice && <div className="banner">{notice}</div>}
        {problem && (
          <div className="banner error" onClick={() => setProblem(null)}>
            {problem}
          </div>
        )}
        {main}
      </main>
    </div>
  );
};

/** Categories with their subcategories; the open one's branch stays unfolded. */
const CategoryTree: React.FC<{ categories: Category[]; parentId: string; spaceId: string; at: SpaceAt; depth: number }> = ({
  categories,
  parentId,
  spaceId,
  at,
  depth,
}) => {
  const openPath = at.kind === "category" ? pathOf(categories, at.categoryId).map((c) => c.id) : [];
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const list = childrenOf(categories, parentId);
  if (!list.length || depth > 20) return null;
  return (
    <ul className={depth ? "cat-tree sub" : "cat-tree"}>
      {list.map((c) => {
        const hasChildren = categories.some((x) => x.parentId === c.id);
        const open = unfolded.has(c.id) || openPath.includes(c.id);
        return (
          <li key={c.id}>
            <span className="cat-row">
              {hasChildren ? (
                <button
                  className="cat-fold"
                  aria-label={open ? t("category.fold") : t("category.unfold")}
                  onClick={() => {
                    const next = new Set(unfolded);
                    if (open) next.delete(c.id);
                    else next.add(c.id);
                    setUnfolded(next);
                  }}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="cat-fold" />
              )}
              <NavLink
                className={at.kind === "category" && at.categoryId === c.id ? "side-link on" : "side-link"}
                to={{ view: "space", spaceId, at: { kind: "category", categoryId: c.id } }}
              >
                {c.name}
              </NavLink>
            </span>
            {open && <CategoryTree categories={categories} parentId={c.id} spaceId={spaceId} at={at} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
};

const CategoryView: React.FC<{
  space: Space;
  types: PageType[];
  categories: Category[];
  categoryId: string;
  onChanged: () => void;
  onNewPage: () => void;
  onNewSub: () => void;
  onError: (message: string) => void;
}> = ({ space, types, categories, categoryId, onChanged, onNewPage, onNewSub, onError }) => {
  const { go, replace } = useNav();
  const category = categories.find((c) => c.id === categoryId);
  const { value: pages } = useLoaded(
    `category:${categoryId}`,
    () =>
      wiki
        .listPages({ spaceId: space.id, categoryId, deep: false, tag: "", typeId: "", drafts: false, recent: false, limit: 0 })
        .then((r) => r.pages),
    { spaceId: space.id },
  );
  const { value: following, reload: reloadFollow } = useLoaded(null, () => wiki.following({ kind: "category", id: categoryId }).then((r) => r.following));
  const canEdit = space.level >= AccessLevel.EDIT;
  if (!category) return <div className="app-message">{t("category.gone")}</div>;
  const path = pathOf(categories, categoryId);
  const subs = childrenOf(categories, categoryId);

  const act = (fn: () => Promise<unknown>) =>
    fn()
      .then(onChanged)
      .catch((err) => onError(errorText(err)));

  return (
    <div className="category-view">
      <nav className="crumbs">
        {path.slice(0, -1).map((c) => (
          <React.Fragment key={c.id}>
            <NavLink to={{ view: "space", spaceId: space.id, at: { kind: "category", categoryId: c.id } }}>{c.name}</NavLink> ›{" "}
          </React.Fragment>
        ))}
      </nav>
      <header className="list-head">
        <h1 className="page-title">
          <span className="title-kind">{t("category.label")}</span> {category.name}
        </h1>
        <div className="list-actions">
          <button
            className="icon"
            title={following ? t("category.unfollow") : t("category.follow")}
            onClick={() =>
              wiki
                .follow({ kind: "category", id: categoryId, follow: !following })
                .then(reloadFollow)
                .catch((err) => onError(errorText(err)))
            }
          >
            {following ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
          {canEdit && (
            <>
              <button onClick={onNewPage}>
                <Plus size={15} /> {t("space.newPage")}
              </button>
              <Menu
                title={t("category.settings")}
                align="right"
                trigger={<Pencil size={15} />}
                items={[
                  {
                    key: "rename",
                    label: t("category.rename"),
                    onSelect: async () => {
                      const name = (await promptDialog(t("category.rename"), category.name))?.trim();
                      if (name && name !== category.name) act(() => wiki.saveCategory({ id: category.id, spaceId: space.id, parentId: category.parentId, name }));
                    },
                  },
                  { key: "sub", label: t("category.newSub"), icon: <FolderPlus size={15} />, onSelect: onNewSub },
                  {
                    key: "move",
                    label: t("category.move"),
                    icon: <FolderInput size={15} />,
                    onSelect: async () => {
                      // Not under itself or one of its own subcategories.
                      const below = new Set<string>();
                      const walk = (id: string) => childrenOf(categories, id).forEach((c) => (below.add(c.id), walk(c.id)));
                      walk(category.id);
                      const options = categoryOptions(categories, t("category.top")).filter((o) => o.value !== category.id && !below.has(o.value));
                      const answer = await formDialog(t("category.move"), [{ key: "parent", label: t("category.under"), value: category.parentId, options }]);
                      if (answer && answer.parent !== category.parentId) act(() => wiki.moveCategory({ id: category.id, parentId: answer.parent, beforeId: "" }));
                    },
                  },
                  "separator",
                  {
                    key: "delete",
                    label: t("category.delete"),
                    icon: <Trash2 size={15} />,
                    danger: true,
                    onSelect: async () => {
                      if (!(await confirmDialog(t("category.confirmDelete", { name: category.name }), { ok: t("common.delete"), danger: true }))) return;
                      await act(() => wiki.deleteCategory({ id: category.id }));
                      replace(category.parentId ? { view: "space", spaceId: space.id, at: { kind: "category", categoryId: category.parentId } } : { view: "space", spaceId: space.id });
                    },
                  },
                ]}
              />
            </>
          )}
        </div>
      </header>
      {subs.length > 0 && (
        <section className="subcategories">
          <h2>{t("category.subcategories")}</h2>
          <ul>
            {subs.map((c) => (
              <li key={c.id}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    go({ view: "space", spaceId: space.id, at: { kind: "category", categoryId: c.id } });
                  }}
                >
                  {c.name}
                </a>{" "}
                <span className="hint">({c.pageCount})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <h2 className="list-subtitle">{t("category.pages", { count: pages?.length ?? 0 })}</h2>
      <PageList pages={pages ?? []} types={types} categories={categories} empty={t("category.empty")} />
    </div>
  );
};

const TagsView: React.FC<{ space: Space }> = ({ space }) => {
  const { value: tags } = useLoaded(`tags:${space.id}`, () => wiki.listTags({ spaceId: space.id }).then((r) => r.tags), { spaceId: space.id });
  const max = Math.max(1, ...(tags ?? []).map((x) => x.count));
  return (
    <div className="tags-view">
      <h1 className="page-title">{t("space.tags")}</h1>
      {tags && !tags.length && <p className="hint list-empty">{t("tags.empty")}</p>}
      <div className="tag-cloud">
        {(tags ?? []).map((x) => (
          <NavLink key={x.tag} className="tag-chip" to={{ view: "space", spaceId: space.id, at: { kind: "tag", tag: x.tag } }}>
            <span style={{ fontSize: `${0.85 + (0.5 * x.count) / max}em` }}>{x.tag}</span> <span className="tag-count">{x.count}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
};

const TagView: React.FC<{ space: Space; types: PageType[]; categories: Category[]; tag: string }> = ({ space, types, categories, tag }) => {
  const { value: pages } = useLoaded(
    `tag:${space.id}:${tag}`,
    () => wiki.listPages({ spaceId: space.id, categoryId: "", deep: false, tag, typeId: "", drafts: false, recent: false, limit: 0 }).then((r) => r.pages),
    { spaceId: space.id },
  );
  return (
    <div className="tag-view">
      <h1 className="page-title">
        <span className="title-kind">{t("tags.label")}</span> {tag}
      </h1>
      <PageList pages={pages ?? []} types={types} categories={categories} empty={t("tags.noPages")} />
    </div>
  );
};

/** The pages published last, newest first. */
const RecentView: React.FC<{ space: Space; types: PageType[]; categories: Category[] }> = ({ space, types, categories }) => {
  const { value: pages } = useLoaded(
    `recent:${space.id}`,
    () => wiki.listPages({ spaceId: space.id, categoryId: "", deep: false, tag: "", typeId: "", drafts: false, recent: true, limit: 50 }).then((r) => r.pages),
    { spaceId: space.id },
  );
  return (
    <div className="recent-view">
      <h1 className="page-title">{t("space.recent")}</h1>
      <p className="hint">{t("recent.hint")}</p>
      <PageList pages={pages ?? []} types={types} categories={categories} empty={t("recent.empty")} />
    </div>
  );
};

const DraftsView: React.FC<{ space: Space; types: PageType[]; categories: Category[] }> = ({ space, types, categories }) => {
  const { value: pages } = useLoaded(
    `drafts:${space.id}`,
    () => wiki.listPages({ spaceId: space.id, categoryId: "", deep: false, tag: "", typeId: "", drafts: true, recent: true, limit: 0 }).then((r) => r.pages),
    { spaceId: space.id },
  );
  return (
    <div className="drafts-view">
      <h1 className="page-title">{t("space.drafts")}</h1>
      <p className="hint">{t("drafts.hint")}</p>
      <PageList pages={pages ?? []} types={types} categories={categories} empty={t("drafts.empty")} drafts />
    </div>
  );
};

export default SpaceView;
