import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Upload, X } from "lucide-react";
import { AccessLevel, Category, FieldDef, FieldValue, Page, PageType } from "@commons-root/gen-shared";
import DocEditor from "../DocEditor";
import type { EditorTools } from "../ArticleEditor";
import { categoryOptions, errorText, isExtra, typeOf, wiki } from "./api";
import { InfoboxEditor } from "./Infobox";
import { NoteText } from "./WikiText";
import type { Heading } from "./outline";
import { t } from "../i18n";

export type PageDraft = { title: string; typeId: string; categoryId: string; tags: string[]; lang: string; fields: FieldValue[] };

const draftOf = (page: Page): PageDraft => ({
  title: page.title,
  typeId: page.typeId,
  categoryId: page.categoryId,
  tags: page.tags,
  lang: page.lang,
  fields: page.fields,
});

/**
 * What the page is, beside its text: title, type, category, tags, language
 * and infobox values. Each change is saved to the draft at once; it goes
 * public with the text when the page is published.
 */
export function usePageDraft(page: Page, onSaved: () => void, onError: (message: string) => void) {
  const [draft, setDraft] = useState<PageDraft>(() => draftOf(page));
  // Another editor's change shows here too.
  useEffect(() => setDraft(draftOf(page)), [page.title, page.typeId, page.categoryId, page.tags.join(","), page.lang, JSON.stringify(page.fields)]);
  const latest = useRef(draft);
  latest.current = draft;
  const save = useCallback(
    async (change: Partial<PageDraft>) => {
      const next = { ...latest.current, ...change };
      latest.current = next;
      setDraft(next);
      try {
        await wiki.updatePage({
          id: page.id,
          title: next.title.trim() || page.title,
          typeId: next.typeId,
          categoryId: next.categoryId,
          tags: next.tags,
          fields: next.fields,
          lang: next.lang,
        });
        onSaved();
      } catch (err) {
        onError(errorText(err));
      }
    },
    [page.id, page.title, onSaved, onError],
  );
  const setField = (def: FieldDef, value: string) =>
    save({ fields: [...latest.current.fields.filter((f) => f.fieldId !== def.id), { fieldId: def.id, value, name: "", icon: "" }] });
  // The page's extra infobox rows, in their order.
  const setExtras = (extras: FieldValue[]) => save({ fields: [...latest.current.fields.filter((f) => !isExtra(f)), ...extras] });
  return { draft, save, setField, setExtras };
}

/** The page's title, written where it shows. */
export const TitleInput: React.FC<{ value: string; disabled: boolean; onSave: (title: string) => void }> = ({ value, disabled, onSave }) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="page-title title-input"
      value={text}
      disabled={disabled}
      maxLength={200}
      aria-label={t("page.title")}
      placeholder={t("page.untitled")}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text.trim() !== value && onSave(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") (setText(value), e.currentTarget.blur());
      }}
    />
  );
};

type Props = {
  page: Page;
  types: PageType[];
  categories: Category[];
  edit: ReturnType<typeof usePageDraft>;
  focus: { index: number; text: string } | null;
  onPublish: () => void;
  onError: (message: string) => void;
  onEditor: (editor: Editor | null) => void;
};

/**
 * The page edited in place, as with Wikipedia's visual editor: the text in
 * the page's own look, the infobox filled in where it shows, the references
 * and categories under the text.
 */
const PageEdit: React.FC<Props> = ({ page, types, categories, edit, focus, onPublish, onError, onEditor }) => {
  const { draft, save, setField, setExtras } = edit;
  const canEdit = page.level >= AccessLevel.EDIT;
  const published = page.publishedAt > 0n;
  const type = typeOf(types, draft.typeId);
  const after = (tools: EditorTools) => (
    <>
      <LiveReferences {...tools} canEdit={page.level >= AccessLevel.COMMENT} />
      <CategoryEditor
        draft={draft}
        categories={categories}
        canChangeCategory={page.canPublish}
        canTag={canEdit}
        onCategory={(categoryId) => save({ categoryId })}
        onTags={(tags) => save({ tags })}
      />
    </>
  );
  return (
    <div className="page-edit">
      {/* Publish sits on its own row above the toolbar, easy to find on every screen.
          A page never published just says "Publish". */}
      {page.canPublish && (
        <div className="publish-row">
          <button className="primary publish-button" onClick={onPublish} title={page.draftChanged || !published ? undefined : t("page.nothingNew")}>
            <Upload size={15} /> {t(published ? "page.publishChanges" : "page.publish")}
          </button>
        </div>
      )}
      {page.level < AccessLevel.EDIT && <p className="hint edit-hint">{t("page.suggestHint")}</p>}
      <DocEditor
        docId={`page:${page.id}`}
        level={page.level}
        variant="wiki"
        focus={focus}
        onEditor={onEditor}
        before={
          <InfoboxEditor
            title={draft.title}
            type={type}
            types={types}
            values={draft.fields}
            canEdit={canEdit}
            canChangeType={page.canPublish}
            onValue={setField}
            onExtras={setExtras}
            onType={(typeId) => save({ typeId })}
            onError={onError}
          />
        }
        after={after}
      />
    </div>
  );
};

/** The sources cited in the text being edited, numbered as they will show; a click edits one. */
const LiveReferences: React.FC<EditorTools & { canEdit: boolean }> = ({ editor, editSource, canEdit }) => {
  const notes = useEditorState({
    editor,
    selector: ({ editor }) => {
      const out: { text: string; url: string; pos: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "footnote") out.push({ text: String(node.attrs.text ?? ""), url: String(node.attrs.url ?? ""), pos });
      });
      return out;
    },
  });
  if (!notes.length) return null;
  return (
    <section className="references live">
      <h2>{t("read.references")}</h2>
      <ol>
        {notes.map((n, i) => (
          <li key={i}>
            {canEdit ? (
              <button className="ref-edit" title={t("source.editTitle")} onClick={() => editSource(n.pos)}>
                <NoteText note={n} />
              </button>
            ) : (
              <NoteText note={n} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
};

/** The category and the tags, chosen at the bottom of the page as on Wikipedia. */
const CategoryEditor: React.FC<{
  draft: PageDraft;
  categories: Category[];
  canChangeCategory: boolean;
  canTag: boolean;
  onCategory: (categoryId: string) => void;
  onTags: (tags: string[]) => void;
}> = ({ draft, categories, canChangeCategory, canTag, onCategory, onTags }) => {
  const [tag, setTag] = useState("");
  const add = (text = tag) => {
    const next = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setTag("");
    if (next.length) onTags([...new Set([...draft.tags, ...next])]);
  };
  return (
    <footer className="catlinks editing">
      <label className="catlinks-row">
        <span className="catlinks-label">{t("read.category")}</span>
        <select value={draft.categoryId} disabled={!canChangeCategory} onChange={(e) => onCategory(e.target.value)}>
          {categoryOptions(categories).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div className="catlinks-row">
        <span className="catlinks-label">{t("read.tags")}</span>
        <span className="tag-edit">
          {draft.tags.map((x) => (
            <span key={x} className="tag-pill">
              {x}
              {canTag && (
                <button className="icon" title={t("page.removeTag", { tag: x })} onClick={() => onTags(draft.tags.filter((y) => y !== x))}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {canTag && (
            <input
              className="tag-input"
              value={tag}
              placeholder={t("page.addTag")}
              maxLength={60}
              onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setTag(e.target.value))}
              onBlur={() => add()}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            />
          )}
        </span>
      </div>
    </footer>
  );
};

/** The headings of the text being edited, as the contents list them. */
export function useLiveHeadings(editor: Editor | null): { headings: Heading[]; targets: () => HTMLElement[] } {
  const headings =
    useEditorState({
      editor,
      selector: ({ editor }) => {
        if (!editor) return [] as Heading[];
        const out: Heading[] = [];
        editor.state.doc.descendants((node) => {
          if (node.type.name !== "heading") return true;
          out.push({ level: Number(node.attrs.level ?? 2), text: node.textContent.trim() });
          return false;
        });
        return out;
      },
    }) ?? [];
  const targets = useCallback(() => (editor && !editor.isDestroyed ? Array.from(editor.view.dom.querySelectorAll<HTMLElement>("h1, h2, h3, h4")) : []), [editor]);
  return { headings, targets };
}

export default PageEdit;
