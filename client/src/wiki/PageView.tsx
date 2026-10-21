import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Bell, BellOff, BookOpen, ChevronDown, Flag, FolderTree, Hash, History, Languages, Lightbulb, Link2, Pencil } from "lucide-react";
import { AccessLevel, Category, Community, Page, PageType, ReportKind, Revision, Space } from "@commons-root/gen-shared";
import Menu, { MenuItem } from "../ui/Menu";
import { confirmDialog, formDialog } from "../ui/dialog";
import { loadNames } from "../users";
import { errorText, formatDate, LANGS, langName, loadContent, pathOf, PMNode, typeOf, useLoaded, wiki } from "./api";
import { NavLink, pageRoute, useNav } from "./nav";
import WikiText, { sectionId } from "./WikiText";
import { outline } from "./outline";
import Infobox from "./Infobox";
import PageEdit, { TitleInput, useLiveHeadings, usePageDraft } from "./PageEdit";
import { ContentsButton, ContentsColumn, useContentsPinned } from "./Contents";
import UserName, { withUser } from "../ui/UserName";
import CategoryIcon from "./CategoryIcon";
import { locale, t } from "../i18n";
import { showToast } from "../ui/toast";

type Tab = "read" | "edit" | "history";

type Props = {
  space: Space;
  spaces: Space[];
  types: PageType[];
  categories: Category[];
  pageId: string;
  tab?: Tab;
  revisionId?: string;
  section?: { index: number; text: string };
};

/** A page as on Wikipedia: Read, Edit and History tabs over the article. */
const PageView: React.FC<Props> = (props) => {
  const { value, error, reload } = useLoaded(`page:${props.pageId}`, () => wiki.getPage({ id: props.pageId }).then((r) => r.page ?? null), {
    pageId: props.pageId,
  });
  if (error && !value) return <div className="app-message">{error}</div>;
  if (!value) return <div className="app-message">{t("app.loading")}</div>;
  return <PageLayout {...props} page={value} reload={reload} />;
};

type Content = { json: PMNode; title: string; fields: Page["publishedFields"] };

const PageLayout: React.FC<Props & { page: Page; reload: () => void }> = ({ space, spaces, types, categories, page, reload, tab = "read", revisionId, section }) => {
  const { replace, go } = useNav();
  const [problem, setProblem] = useState<string | null>(null);
  const edit = usePageDraft(page, reload, setProblem);
  const published = page.publishedAt > 0n;
  const canSuggest = page.level >= AccessLevel.COMMENT;
  const canEdit = page.level >= AccessLevel.EDIT;
  const editing = tab === "edit" && canSuggest;
  const reading = tab === "read" || (tab === "edit" && !canSuggest);
  const editLabel = !published ? t("page.create") : canEdit ? t("page.edit") : t("page.suggest");
  const at = (next: Tab, extra?: { section?: { index: number; text: string } }) =>
    replace({
      view: "space",
      spaceId: space.id,
      at: {
        kind: "page",
        pageId: page.id,
        tab: next === "read" ? undefined : next,
        ...extra,
      },
    });

  // The published text, for reading.
  const [content, setContent] = useState<Content | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  useEffect(() => {
    if (!published || !reading) return;
    setContentError(null);
    loadContent(page.id, Number(revisionId ?? 0))
      .then(setContent)
      .catch((err) => setContentError(errorText(err)));
  }, [page.id, revisionId, Number(page.publishedAt), reading]);

  // The contents: the published headings, or the ones being written.
  const [editor, setEditor] = useState<Editor | null>(null);
  const live = useLiveHeadings(editing ? editor : null);
  const readHeadings = useMemo(() => (content ? outline(content.json).headings : []), [content]);
  const readTargets = useCallback(() => readHeadings.map((_, i) => document.getElementById(sectionId(i))).filter((el): el is HTMLElement => !!el), [readHeadings]);
  const headings = editing ? live.headings : reading && content ? readHeadings : [];
  const targets = editing ? live.targets : readTargets;
  const [pinned, setPinned] = useContentsPinned();
  const hasContents = headings.length >= 2;

  const report = async (kind: ReportKind) => {
    const answer = await formDialog(
      kind === ReportKind.REPORT_ERROR ? t("report.reportError") : t("report.suggestAddition"),
      [
        {
          key: "text",
          label: t("report.text"),
          long: true,
          placeholder: t("report.textHint"),
        },
      ],
      { ok: t("report.send") },
    );
    if (!answer?.text.trim()) return;
    try {
      await wiki.sendReport({ pageId: page.id, kind, text: answer.text });
      showToast(t("report.sent"));
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const follow = () =>
    wiki
      .follow({ kind: "page", id: page.id, follow: !page.following })
      .then(reload)
      .catch((err) => setProblem(errorText(err)));

  const settings = async (action: "community" | "language" | "move" | "translate" | "delete") => {
    try {
      if (action === "community") {
        const answer = await formDialog(t("page.communityTitle"), [
          {
            key: "community",
            label: t("page.community"),
            value: String(page.community),
            options: [
              { value: String(Community.NONE), label: t("community.none") },
              {
                value: String(Community.SUGGEST),
                label: t("community.suggest"),
              },
              { value: String(Community.EDIT), label: t("community.edit") },
            ],
          },
        ]);
        if (answer)
          await wiki.setCommunity({
            id: page.id,
            community: Number(answer.community) as Community,
          });
        reload();
      } else if (action === "language") {
        const answer = await formDialog(t("page.languageTitle"), [
          {
            key: "lang",
            label: t("page.language"),
            value: edit.draft.lang,
            options: [{ value: "", label: t("page.anyLanguage") }, ...LANGS.map((code) => ({ value: code, label: langName(code) }))],
          },
        ]);
        if (answer && answer.lang !== edit.draft.lang) await edit.save({ lang: answer.lang });
      } else if (action === "move") {
        const targets = spaces.filter((s) => s.level >= AccessLevel.EDIT && s.id !== space.id);
        if (!targets.length) return setProblem(t("page.noMoveTarget"));
        const answer = await formDialog(
          t("page.moveTitle"),
          [
            {
              key: "space",
              label: t("page.moveTo"),
              options: targets.map((s) => ({ value: s.id, label: s.name })),
            },
          ],
          { ok: t("page.move") },
        );
        if (!answer) return;
        await wiki.movePage({
          id: page.id,
          spaceId: answer.space,
          categoryId: "",
        });
        replace(pageRoute(answer.space, page.id));
      } else if (action === "translate") {
        const taken = new Set([page.lang, ...page.translations.map((tr) => tr.lang)]);
        const free = LANGS.filter((code) => !taken.has(code));
        if (!free.length) return setProblem(t("page.allLanguages"));
        const answer = await formDialog(
          t("page.translateTitle"),
          [
            {
              key: "lang",
              label: t("page.language"),
              options: free.map((code) => ({
                value: code,
                label: langName(code),
              })),
            },
            {
              key: "title",
              label: t("page.titleIn"),
              value: page.publishedTitle || page.title,
            },
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
        if (
          !(await confirmDialog(
            t("page.confirmDelete", {
              title: page.publishedTitle || page.title,
            }),
            { ok: t("common.delete"), danger: true },
          ))
        )
          return;
        await wiki.deletePage({ id: page.id });
        replace({ view: "space", spaceId: space.id });
      }
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const publish = async () => {
    const answer = await formDialog(
      t("page.publishTitle"),
      [
        {
          key: "note",
          label: t("page.publishNote"),
          placeholder: t("page.publishNoteHint"),
        },
      ],
      {
        ok: t("page.publish"),
      },
    );
    if (!answer) return;
    try {
      await wiki.publish({ id: page.id, note: answer.note.trim() });
      reload();
      at("read");
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const tools: (MenuItem | "separator")[] = [
    {
      key: "follow",
      label: page.following ? t("page.unfollow") : t("page.follow"),
      onSelect: follow,
    },
    ...(published
      ? [
          {
            key: "error",
            label: t("report.reportError"),
            onSelect: () => report(ReportKind.REPORT_ERROR),
          },
          {
            key: "addition",
            label: t("report.suggestAddition"),
            onSelect: () => report(ReportKind.REPORT_ADDITION),
          },
        ]
      : []),
    ...(page.canPublish
      ? [
          "separator" as const,
          {
            key: "language",
            label: t("page.languageTitle"),
            hint: edit.draft.lang ? langName(edit.draft.lang) : t("page.anyLanguage"),
            onSelect: () => settings("language"),
          },
          {
            key: "community",
            label: t("page.communityTitle"),
            hint: communityLabel(page.community),
            onSelect: () => settings("community"),
          },
          {
            key: "translate",
            label: t("page.translateTitle"),
            onSelect: () => settings("translate"),
          },
          {
            key: "move",
            label: t("page.moveTitle"),
            onSelect: () => settings("move"),
          },
          "separator" as const,
          {
            key: "delete",
            label: t("page.delete"),
            danger: true,
            onSelect: () => settings("delete"),
          },
        ]
      : []),
  ];

  const title = editing ? edit.draft.title : (revisionId && content?.title) || page.publishedTitle || page.title;
  const type = typeOf(types, page.typeId);
  const path = pathOf(categories, page.categoryId);

  let body: React.ReactNode;
  if (editing) {
    body = (
      <PageEdit page={page} types={types} categories={categories} edit={edit} focus={section ?? null} onPublish={publish} onError={setProblem} onEditor={setEditor} />
    );
  } else if (tab === "history") {
    body = (
      <PageHistory
        page={page}
        onOpen={(id) =>
          go({
            view: "space",
            spaceId: space.id,
            at: { kind: "page", pageId: page.id, revisionId: id || undefined },
          })
        }
      />
    );
  } else if (!published) {
    body = (
      <div className="empty-page">
        <p>{t("page.notPublished")}</p>
        {canSuggest && <button onClick={() => at("edit")}>{editLabel}</button>}
      </div>
    );
  } else if (contentError) {
    body = <div className="app-message">{contentError}</div>;
  } else if (!content) {
    body = <div className="app-message">{t("app.loading")}</div>;
  } else {
    body = (
      <>
        {revisionId && (
          <div className="banner old-version">
            {t("page.oldVersion")}{" "}
            <button className="link" onClick={() => replace(pageRoute(space.id, page.id))}>
              {t("page.currentVersion")}
            </button>
          </div>
        )}
        <WikiText
          doc={content.json}
          onOpenPage={(id) => go(pageRoute(space.id, id))}
          onEditSection={canSuggest && !revisionId ? (index, text) => at("edit", { section: { index, text } }) : undefined}
          aside={<Infobox title={content.title || page.publishedTitle} type={type} values={content.fields} />}
        />
        {(path.length > 0 || page.tags.length > 0) && (
          <footer className="catlinks">
            {path.length > 0 && (
              <div className="catlinks-row">
                <NavLink
                  className="catlinks-label"
                  to={{
                    view: "space",
                    spaceId: space.id,
                    at: {
                      kind: "category",
                      categoryId: path[path.length - 1].id,
                    },
                  }}
                >
                  <FolderTree size={14} /> {t("read.category")}
                </NavLink>
                <span>
                  {path.map((c, i) => (
                    <React.Fragment key={c.id}>
                      {i > 0 && <span className="catlinks-sep"> › </span>}
                      <NavLink
                        to={{
                          view: "space",
                          spaceId: space.id,
                          at: { kind: "category", categoryId: c.id },
                        }}
                      >
                        <CategoryIcon category={c} size={13} /> {c.name}
                      </NavLink>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            )}
            {page.tags.length > 0 && (
              <div className="catlinks-row">
                <NavLink
                  className="catlinks-label"
                  to={{
                    view: "space",
                    spaceId: space.id,
                    at: { kind: "tags" },
                  }}
                >
                  <Hash size={14} /> {t("read.tags")}
                </NavLink>
                <span>
                  {page.tags.map((tag, i) => (
                    <React.Fragment key={tag}>
                      {i > 0 && <span className="catlinks-sep"> | </span>}
                      <NavLink
                        to={{
                          view: "space",
                          spaceId: space.id,
                          at: { kind: "tag", tag },
                        }}
                      >
                        {tag}
                      </NavLink>
                    </React.Fragment>
                  ))}
                </span>
              </div>
            )}
          </footer>
        )}
        {page.backlinks.length > 0 && (
          <details className="backlinks">
            <summary>
              <Link2 size={14} /> {t("read.whatLinksHere", { count: page.backlinks.length })}
            </summary>
            <ul>
              {page.backlinks.map((b) => (
                <li key={b.id}>
                  <NavLink to={pageRoute(b.spaceId, b.id)}>{b.title}</NavLink>
                </li>
              ))}
            </ul>
          </details>
        )}
        <PageStamp page={page} onEdit={canSuggest ? () => at("edit") : undefined} onReport={report} />
      </>
    );
  }

  return (
    <article className={`wiki-page${hasContents ? " has-contents" : ""}${hasContents && pinned ? " contents-pinned" : ""}${editing ? " is-editing" : ""}`}>
      {hasContents && <ContentsColumn headings={headings} targets={targets} onHide={() => setPinned(false)} />}
      <div className="wiki-col">
        <header className="wiki-head">
          <div className="title-row">
            {hasContents && <ContentsButton headings={headings} targets={targets} pinned={pinned} onPin={() => setPinned(true)} />}
            {editing ? (
              <TitleInput value={edit.draft.title} disabled={!canEdit} onSave={(next) => edit.save({ title: next })} />
            ) : (
              <h1 className="page-title">{title || t("page.untitled")}</h1>
            )}
            {(page.translations.length > 0 || page.canPublish) && (
              <Menu
                className="page-langs"
                title={t("page.languages")}
                align="right"
                trigger={
                  <>
                    <Languages size={16} />
                    <span className="page-langs-label">
                      {page.translations.length
                        ? t("page.languagesCount", {
                            count: page.translations.length + 1,
                          })
                        : t("page.addLanguages")}
                    </span>
                    <ChevronDown size={14} />
                  </>
                }
                items={[
                  ...page.translations.map((tr) => ({
                    key: tr.pageId,
                    label: langName(tr.lang),
                    hint: tr.title,
                    onSelect: () => go(pageRoute(space.id, tr.pageId)),
                  })),
                  ...(page.canPublish
                    ? [
                        ...(page.translations.length ? ["separator" as const] : []),
                        {
                          key: "add",
                          label: t("page.translateTitle"),
                          onSelect: () => settings("translate"),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
          <nav className="page-tabs">
            <div className="tabs-left">
              <span className="page-tab on">{t("page.pageTab")}</span>
              {page.canPublish && (
                <NavLink className="page-tab" to={{ view: "reports", pageId: page.id }}>
                  {page.openReports ? t("app.reportsCount", { count: page.openReports }) : t("app.reports")}
                </NavLink>
              )}
            </div>
            <div className="tabs-right" role="tablist">
              <button role="tab" aria-selected={reading} className={reading ? "page-tab on" : "page-tab"} onClick={() => at("read")}>
                <BookOpen size={15} /> {t("page.read")}
              </button>
              {canSuggest && (
                <button role="tab" aria-selected={editing} className={editing ? "page-tab on" : "page-tab"} onClick={() => at("edit")}>
                  <Pencil size={15} /> {editLabel}
                </button>
              )}
              <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "page-tab on" : "page-tab"} onClick={() => at("history")}>
                <History size={15} /> {t("page.history")}
              </button>
              <button className="icon page-follow" title={page.following ? t("page.unfollow") : t("page.follow")} aria-pressed={page.following} onClick={follow}>
                {page.following ? <BellOff size={16} /> : <Bell size={16} />}
              </button>
              <Menu
                className="page-tools"
                title={t("page.tools")}
                align="right"
                trigger={
                  <>
                    <span>{t("page.tools")}</span>
                    <ChevronDown size={14} />
                  </>
                }
                items={tools}
              />
            </div>
          </nav>
        </header>
        <p className="tagline">
          {tab === "history" ? t("history.title") : t("page.from", { space: space.name })}
          {tab !== "history" && edit.draft.lang && <> · {langName(edit.draft.lang)}</>}
        </p>
        {problem && (
          <div className="banner" role="status" onClick={() => setProblem(null)}>
            {problem}
          </div>
        )}
        {body}
      </div>
    </article>
  );
};

const communityLabel = (c: Community) => (c === Community.EDIT ? t("community.edit") : c === Community.SUGGEST ? t("community.suggest") : t("community.none"));

/** The line at the bottom of a page: when it was published, by whom, and how to point out a problem. */
const PageStamp: React.FC<{
  page: Page;
  onEdit?: () => void;
  onReport: (kind: ReportKind) => void;
}> = ({ page, onEdit, onReport }) => {
  const [, setNames] = useState(0);
  useEffect(() => {
    if (page.publishedBy) loadNames([page.publishedBy]).then(() => setNames((n) => n + 1));
  }, [page.publishedBy]);
  return (
    <div className="page-stamp">
      <p>
        {withUser(
          t("read.lastPublished", {
            date: formatDate(page.publishedAt),
            name: "\u0001",
          }),
          page.publishedBy,
        )}
        {onEdit && page.draftChanged && (
          <>
            {" "}
            <button className="link" onClick={onEdit}>
              {t("read.changesWaiting")}
            </button>
          </>
        )}
      </p>
      <p className="page-stamp-links">
        <button className="link" onClick={() => onReport(ReportKind.REPORT_ERROR)}>
          <Flag size={14} /> {t("report.reportError")}
        </button>
        <span aria-hidden> · </span>
        <button className="link" onClick={() => onReport(ReportKind.REPORT_ADDITION)}>
          <Lightbulb size={14} /> {t("report.suggestAddition")}
        </button>
      </p>
    </div>
  );
};

/** The publications of the page, newest first, as Wikipedia lists its history. Draft versions are in the editor's own history. */
const PageHistory: React.FC<{
  page: Page;
  onOpen: (revisionId: string) => void;
}> = ({ page, onOpen }) => {
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
        <ul className="revision-list">
          {revisions.map((r, i) => (
            <li key={String(r.id)}>
              <button className="link revision-date" onClick={() => onOpen(i === 0 ? "" : String(r.id))}>
                {new Date(Number(r.createdAt)).toLocaleString(locale(), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </button>
              <span className="revision-author">
                <UserName id={r.authorId} />
              </span>
              {i === 0 && <span className="revision-current">{t("history.currentPublication")}</span>}
              {r.note && <span className="revision-note">({r.note})</span>}
              {r.title !== (revisions[i + 1]?.title ?? r.title) && <span className="revision-note">{t("history.renamed", { title: r.title })}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("history.noPublications")}</p>
      )}
    </section>
  );
};

export default PageView;
