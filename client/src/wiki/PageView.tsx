import React, { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Flag, History, Languages, Pencil, Settings2, Upload } from "lucide-react";
import { AccessLevel, Category, Community, Page, PageType, ReportKind, Revision, Space } from "@commons-root/gen-shared";
import DocEditor from "../DocEditor";
import Menu from "../ui/Menu";
import { confirmDialog, formDialog } from "../ui/dialog";
import { cachedName, loadNames } from "../users";
import { errorText, formatDate, LANGS, langName, loadContent, pathOf, PMNode, typeOf, useLoaded, wiki } from "./api";
import { NavLink, pageRoute, useNav } from "./nav";
import ReadView from "./ReadView";
import { outline } from "./outline";
import Infobox from "./Infobox";
import PageDetails from "./PageDetails";
import { locale, t } from "../i18n";

type Tab = "read" | "edit" | "history";

type Props = {
  space: Space;
  spaces: Space[];
  types: PageType[];
  categories: Category[];
  pageId: string;
  tab?: Tab;
  revisionId?: string;
};

const pageDoc = (id: string) => `page:${id}`;

/** A page as on Wikipedia: Read, Edit (or Suggest changes) and History tabs over the article. */
const PageView: React.FC<Props> = ({ space, spaces, types, categories, pageId, tab = "read", revisionId }) => {
  const { replace, go } = useNav();
  const { value, error, reload } = useLoaded(`page:${pageId}`, () => wiki.getPage({ id: pageId }).then((r) => r.page ?? null), { pageId });
  const [problem, setProblem] = useState<string | null>(null);
  const page = value ?? null;

  if (error && !page) return <div className="app-message">{error}</div>;
  if (!page) return <div className="app-message">{t("app.loading")}</div>;

  const published = page.publishedAt > 0n;
  const canSuggest = page.level >= AccessLevel.COMMENT;
  const editLabel = page.level >= AccessLevel.EDIT ? t("page.edit") : t("page.suggest");
  const setTab = (next: Tab) => replace(pageRoute(space.id, page.id, next === "read" ? undefined : next));
  const type = typeOf(types, page.typeId);

  const report = async () => {
    const answer = await formDialog(
      t("report.title"),
      [
        {
          key: "kind",
          label: t("report.kind"),
          options: [
            { value: String(ReportKind.REPORT_ERROR), label: t("report.error") },
            { value: String(ReportKind.REPORT_ADDITION), label: t("report.addition") },
          ],
        },
        { key: "text", label: t("report.text"), long: true, placeholder: t("report.textHint") },
      ],
      { ok: t("report.send") },
    );
    if (!answer?.text.trim()) return;
    try {
      await wiki.sendReport({ pageId: page.id, kind: Number(answer.kind) as ReportKind, text: answer.text });
      setProblem(t("report.sent"));
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const follow = () =>
    wiki
      .follow({ kind: "page", id: page.id, follow: !page.following })
      .then(reload)
      .catch((err) => setProblem(errorText(err)));

  const settings = async (action: "community" | "move" | "translate" | "delete") => {
    try {
      if (action === "community") {
        const answer = await formDialog(t("page.communityTitle"), [
          {
            key: "community",
            label: t("page.community"),
            value: String(page.community),
            options: [
              { value: String(Community.NONE), label: t("community.none") },
              { value: String(Community.SUGGEST), label: t("community.suggest") },
              { value: String(Community.EDIT), label: t("community.edit") },
            ],
          },
        ]);
        if (answer) await wiki.setCommunity({ id: page.id, community: Number(answer.community) as Community });
      } else if (action === "move") {
        const targets = spaces.filter((s) => s.level >= AccessLevel.EDIT && s.id !== space.id);
        if (!targets.length) return setProblem(t("page.noMoveTarget"));
        const answer = await formDialog(
          t("page.moveTitle"),
          [{ key: "space", label: t("page.moveTo"), options: targets.map((s) => ({ value: s.id, label: s.name })) }],
          { ok: t("page.move") },
        );
        if (!answer) return;
        await wiki.movePage({ id: page.id, spaceId: answer.space, categoryId: "" });
        replace(pageRoute(answer.space, page.id));
      } else if (action === "translate") {
        const taken = new Set([page.lang, ...page.translations.map((tr) => tr.lang)]);
        const free = LANGS.filter((code) => !taken.has(code));
        if (!free.length) return setProblem(t("page.allLanguages"));
        const answer = await formDialog(
          t("page.translateTitle"),
          [
            { key: "lang", label: t("page.language"), options: free.map((code) => ({ value: code, label: langName(code) })) },
            { key: "title", label: t("page.titleIn"), value: page.publishedTitle || page.title },
          ],
          { ok: t("page.translate") },
        );
        if (!answer) return;
        const created = await wiki.createPage({
          spaceId: space.id,
          title: answer.title.trim() || page.title,
          typeId: page.typeId,
          categoryId: page.categoryId,
          translationOf: page.id,
          lang: answer.lang,
        });
        if (created.page) go(pageRoute(space.id, created.page.id, "edit"));
      } else if (action === "delete") {
        if (!(await confirmDialog(t("page.confirmDelete", { title: page.publishedTitle || page.title }), { ok: t("common.delete"), danger: true }))) return;
        await wiki.deletePage({ id: page.id });
        replace({ view: "space", spaceId: space.id });
      }
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const publish = async () => {
    const answer = await formDialog(t("page.publishTitle"), [{ key: "note", label: t("page.publishNote"), placeholder: t("page.publishNoteHint") }], {
      ok: t("page.publish"),
    });
    if (!answer) return;
    try {
      await wiki.publish({ id: page.id, note: answer.note.trim() });
      reload();
      setTab("read");
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const shownTitle = tab === "edit" ? page.title : page.publishedTitle || page.title;

  return (
    <article className="wiki-page">
      <header className="page-head">
        <div className="page-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "read"} className={tab === "read" ? "page-tab on" : "page-tab"} onClick={() => setTab("read")}>
            {t("page.read")}
          </button>
          {canSuggest && (
            <button role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "page-tab on" : "page-tab"} onClick={() => setTab("edit")}>
              <Pencil size={14} /> {editLabel}
            </button>
          )}
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "page-tab on" : "page-tab"} onClick={() => setTab("history")}>
            <History size={14} /> {t("page.history")}
          </button>
          <span className="spacer" />
          {page.translations.length > 0 && (
            <Menu
              className="page-langs"
              title={t("page.languages")}
              align="right"
              trigger={
                <>
                  <Languages size={15} /> <span className="page-langs-count">{page.translations.length + 1}</span>
                </>
              }
              items={page.translations.map((tr) => ({
                key: tr.pageId,
                label: langName(tr.lang),
                hint: tr.title,
                onSelect: () => go(pageRoute(space.id, tr.pageId)),
              }))}
            />
          )}
          <button className="icon" title={page.following ? t("page.unfollow") : t("page.follow")} onClick={follow}>
            {page.following ? <BellOff size={16} /> : <Bell size={16} />}
          </button>
          {published && (
            <button className="icon" title={t("report.title")} onClick={report}>
              <Flag size={16} />
            </button>
          )}
          {page.canPublish && (
            <Menu
              title={t("page.settings")}
              align="right"
              trigger={<Settings2 size={16} />}
              items={[
                { key: "community", label: t("page.communityTitle"), hint: communityLabel(page.community), onSelect: () => settings("community") },
                { key: "translate", label: t("page.translateTitle"), onSelect: () => settings("translate") },
                { key: "move", label: t("page.moveTitle"), onSelect: () => settings("move") },
                "separator",
                { key: "delete", label: t("page.delete"), danger: true, onSelect: () => settings("delete") },
              ]}
            />
          )}
        </div>
        <h1 className="page-title">{shownTitle || t("page.untitled")}</h1>
        <p className="page-from">
          {t("page.from", { space: space.name })}
          {page.lang && <> · {langName(page.lang)}</>}
        </p>
      </header>

      {problem && (
        <div className="banner" role="status" onClick={() => setProblem(null)}>
          {problem}
        </div>
      )}
      {page.canPublish && page.openReports > 0 && (
        <div className="banner">
          <NavLink to={{ view: "reports", pageId: page.id }}>{t("page.openReports", { count: page.openReports })}</NavLink>
        </div>
      )}

      {tab === "edit" && canSuggest ? (
        <div className="page-edit">
          {page.level < AccessLevel.EDIT && <p className="hint">{t("page.suggestHint")}</p>}
          <PageDetails page={page} types={types} categories={categories} onError={setProblem} onSaved={reload} />
          <div className="page-editor">
            <DocEditor
              docId={pageDoc(page.id)}
              level={page.level}
              actions={
                page.canPublish ? (
                  <button className="primary publish-button" onClick={publish} title={page.draftChanged || !published ? undefined : t("page.nothingNew")}>
                    <Upload size={15} /> {t("page.publish")}
                  </button>
                ) : undefined
              }
            />
          </div>
        </div>
      ) : tab === "history" ? (
        <PageHistory page={page} onOpen={(id) => go({ view: "space", spaceId: space.id, at: { kind: "page", pageId: page.id, tab: "read", revisionId: id } })} />
      ) : !published ? (
        <div className="empty-page">
          <p>{t("page.notPublished")}</p>
          {canSuggest && <button onClick={() => setTab("edit")}>{editLabel}</button>}
        </div>
      ) : (
        <PublishedPage
          page={page}
          space={space}
          type={type}
          categories={categories}
          revisionId={revisionId}
          onCurrent={() => replace(pageRoute(space.id, page.id))}
          onEdit={canSuggest ? () => setTab("edit") : undefined}
        />
      )}
    </article>
  );
};

const communityLabel = (c: Community) => (c === Community.EDIT ? t("community.edit") : c === Community.SUGGEST ? t("community.suggest") : t("community.none"));

/** The published text with its infobox, contents, references, categories and backlinks. */
const PublishedPage: React.FC<{
  page: Page;
  space: Space;
  type: PageType | undefined;
  categories: Category[];
  revisionId?: string;
  onCurrent: () => void;
  onEdit?: () => void;
}> = ({ page, space, type, categories, revisionId, onCurrent, onEdit }) => {
  const { go } = useNav();
  const [content, setContent] = useState<{ json: PMNode; title: string; fields: Page["publishedFields"] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setError(null);
    loadContent(page.id, Number(revisionId ?? 0))
      .then(setContent)
      .catch((err) => setError(errorText(err)));
  }, [page.id, revisionId, Number(page.publishedAt)]);
  const headings = useMemo(() => (content ? outline(content.json).headings : []), [content]);
  const [names, setNames] = useState(0);
  useEffect(() => {
    if (page.publishedBy) loadNames([page.publishedBy]).then(() => setNames((n) => n + 1));
  }, [page.publishedBy]);

  if (error) return <div className="app-message">{error}</div>;
  if (!content) return <div className="app-message">{t("app.loading")}</div>;

  const toHeading = (i: number) => body.current?.querySelectorAll(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4")[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
  const path = pathOf(categories, page.categoryId);
  const showContents = headings.length >= 3;

  return (
    <div className="page-body">
      {revisionId && (
        <div className="banner old-version">
          {t("page.oldVersion")}{" "}
          <button className="link" onClick={onCurrent}>
            {t("page.currentVersion")}
          </button>
        </div>
      )}
      <div className="page-columns">
        <div className="page-main">
          <ReadView doc={content.json} bodyRef={body} onOpenPage={(id) => go(pageRoute(space.id, id))} />
        </div>
        {(type || showContents) && (
          <div className="page-side">
            <Infobox title={content.title || page.publishedTitle} type={type} values={content.fields} />
            {showContents && (
              <nav className="toc" aria-label={t("read.contents")}>
                <div className="toc-title">{t("read.contents")}</div>
                <ol>
                  {headings.map((h, i) => (
                    <li key={i} className={`toc-l${Math.min(h.level, 4)}`}>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          toHeading(i);
                        }}
                      >
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>
        )}
      </div>

      {(path.length > 0 || page.tags.length > 0) && (
        <footer className="catlinks">
          {path.length > 0 && (
            <div>
              <span className="catlinks-label">{t("read.category")}</span>{" "}
              {path.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && " › "}
                  <NavLink to={{ view: "space", spaceId: space.id, at: { kind: "category", categoryId: c.id } }}>{c.name}</NavLink>
                </React.Fragment>
              ))}
            </div>
          )}
          {page.tags.length > 0 && (
            <div>
              <span className="catlinks-label">{t("read.tags")}</span>{" "}
              {page.tags.map((tag, i) => (
                <React.Fragment key={tag}>
                  {i > 0 && " · "}
                  <NavLink to={{ view: "space", spaceId: space.id, at: { kind: "tag", tag } }}>{tag}</NavLink>
                </React.Fragment>
              ))}
            </div>
          )}
        </footer>
      )}

      {page.backlinks.length > 0 && (
        <details className="backlinks">
          <summary>{t("read.whatLinksHere", { count: page.backlinks.length })}</summary>
          <ul>
            {page.backlinks.map((b) => (
              <li key={b.id}>
                <NavLink to={pageRoute(b.spaceId, b.id)}>{b.title}</NavLink>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="page-stamp" data-names={names}>
        {t("read.lastPublished", { date: formatDate(page.publishedAt), name: cachedName(page.publishedBy) })}
        {onEdit && page.draftChanged && (
          <>
            {" "}
            <button className="link" onClick={onEdit}>
              {t("read.changesWaiting")}
            </button>
          </>
        )}
      </p>
    </div>
  );
};

/** The publications of the page, newest first. Draft versions are in the editor's own history. */
const PageHistory: React.FC<{ page: Page; onOpen: (revisionId: string) => void }> = ({ page, onOpen }) => {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setNames] = useState(0);
  useEffect(() => {
    wiki
      .listRevisions({ id: page.id })
      .then(async (r) => {
        setRevisions(r.revisions);
        await loadNames([...new Set(r.revisions.map((v) => v.authorId))]);
        setNames((n) => n + 1);
      })
      .catch((err) => setError(errorText(err)));
  }, [page.id, Number(page.publishedAt)]);
  if (error) return <div className="app-message">{error}</div>;
  if (!revisions) return <div className="app-message">{t("app.loading")}</div>;
  return (
    <section className="page-history">
      <p className="hint">{page.level >= AccessLevel.COMMENT ? t("history.publicationsHintEditor") : t("history.publicationsHint")}</p>
      {revisions.length ? (
        <ol className="revision-list">
          {revisions.map((r, i) => (
            <li key={String(r.id)}>
              <button className="link" onClick={() => onOpen(i === 0 ? "" : String(r.id))}>
                {new Date(Number(r.createdAt)).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })}
              </button>{" "}
              <span className="revision-author">{cachedName(r.authorId)}</span>
              {i === 0 && <span className="revision-current">{t("history.currentPublication")}</span>}
              {r.note && <span className="revision-note">{r.note}</span>}
              {r.title !== (revisions[i + 1]?.title ?? r.title) && <span className="revision-note">{t("history.renamed", { title: r.title })}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">{t("history.noPublications")}</p>
      )}
    </section>
  );
};

export default PageView;
