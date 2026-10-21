import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { rootClient } from "@rootsdk/client-app";
import { docServiceClient, wikiServiceClient } from "@commons-root/gen-client";
import { AccessLevel } from "@commons-root/gen-shared";
import {
  applySuggestion,
  applySuggestions,
  revertSuggestion,
  revertSuggestions,
  isSuggestChangesEnabled,
  enableSuggestChanges,
  disableSuggestChanges,
} from "@handlewithcare/prosemirror-suggest-changes";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  Minus,
  MoreHorizontal,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Type,
  Underline as UnderlineIcon,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Eye,
  ChevronRight,
  BookMarked,
  FilePenLine,
  FileText,
  Paperclip,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  X as CloseIcon,
  Image as ImageIcon,
  ImagePlus,
  ImageUp,
  Trash2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  History,
  Languages,
  MessageSquarePlus,
  Redo2,
  Undo2,
} from "lucide-react";
import { DocSync, SyncStatus } from "./sync";
import { undo, redo } from "./editor/collaboration";
import { buildExtensions } from "./editor/extensions";
import { listSuggestions, countWords } from "./editor/suggestionList";
import { cachedName, colorForUser, loadNames } from "./users";
import CommentsPanel, { Draft } from "./CommentsPanel";
import VersionHistory from "./VersionHistory";
import { detectLanguage, Language, LANGUAGES, languageName, Readability, readability } from "./editor/readability";
import { setTextLanguage } from "./editor/spellcheck/plugin";
import { reportSuggestionAdded, reportSuggestionResolved } from "./editor/activity";
import { authorOf } from "./editor/suggestions";
import Menu from "./ui/Menu";
import { isNarrow, usePanel } from "./ui/usePanel";
import { useBackButton } from "./ui/backButton";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { figureImageUrl } from "./editor/figure";
import SwatchMenu from "./ui/SwatchMenu";
import FormatSheet from "./editor/FormatSheet";
import { commentDraftKey } from "./editor/commentDraft";
import { HIGHLIGHTS, TEXT_COLORS } from "./editor/palette";
import { locale, t } from "./i18n";
import { formDialog, promptDialog } from "./ui/dialog";
import type { PageSummary } from "@commons-root/gen-shared";

// variant "reader": the text alone, read-only (the style guide window).
// variant "doc": a plain shared document (the style guide in Settings):
// formatting only, no comments, suggestions, copy or side panel.
// variant "field": a small formatted text box (a long answer in a pitch form),
// without side panel, counts or article actions.
// variant "wiki": a page of the knowledge base edited in place: no paper
// sheet, the page's own typography, the toolbar stuck to the top while the
// page scrolls; `before` and `after` sit above and under the text.
// language: the text's language when chosen on its tab (null: detected);
// onLanguageChange offers the choice under the text.
type Props = {
  sync: DocSync;
  userId: string;
  status: SyncStatus;
  level: AccessLevel;
  compact?: boolean;
  language?: Language | null;
  onLanguageChange?: (language: Language | null) => void;
  variant?: "field" | "reader" | "doc" | "wiki";
  emptyText?: string;
  /** Buttons for the page itself (Publish…), at the end of the toolbar. */
  actions?: React.ReactNode;
  /** Shown before the text, in the same flow (an infobox floated beside it). */
  before?: React.ReactNode;
  /** Shown under the text, with what it needs to act on it (live references…). */
  after?: (tools: EditorTools) => React.ReactNode;
  /** Opens the text at a heading: the one with this text, else the nth. */
  focus?: { index: number; text: string } | null;
  /** The editor, once ready, for views outside the text (the contents). */
  onEditor?: (editor: Editor | null) => void;
};

export type EditorTools = { editor: Editor; editSource: (pos?: number) => void };

const ArticleEditor: React.FC<Props> = ({
  sync,
  userId,
  status,
  level,
  compact,
  language = null,
  onLanguageChange,
  variant,
  emptyText,
  actions,
  before,
  after,
  focus,
  onEditor,
}) => {
  const canEdit = level >= AccessLevel.EDIT;
  // Comment level may only suggest; read level only reads.
  const canSuggest = level >= AccessLevel.COMMENT;
  const commentShortcut = useRef<() => void>(() => undefined);
  const editor = useEditor(
    {
      extensions: buildExtensions(sync, userId, { spellcheck: true }),
      editable: canSuggest,
      editorProps: {
        handleKeyDown: (_view, event) => {
          if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.key.toLowerCase() !== "m") return false;
          commentShortcut.current();
          return true;
        },
      },
      onCreate: ({ editor }) => {
        if (canSuggest && !canEdit) enableSuggestChanges(editor.state, editor.view.dispatch);
      },
    },
    [sync, level],
  );
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const noticeTimer = useRef<number>();
  const [draft, setDraft] = useState<Draft | null>(null);
  // The words being commented on stay highlighted until the comment is sent or cancelled.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(commentDraftKey, draft ? { from: draft.from, to: draft.to } : null));
  }, [draft, editor]);
  // Selecting other words drops the comment being started, so the comment
  // button is offered again for the new selection.
  useEffect(() => {
    if (!draft || !editor) return;
    const onSelect = () => {
      const { from, to, empty } = editor.state.selection;
      if (!empty && (from !== draft.from || to !== draft.to)) setDraft(null);
    };
    editor.on("selectionUpdate", onSelect);
    return () => {
      editor.off("selectionUpdate", onSelect);
    };
  }, [draft, editor]);
  // A wiki page keeps the text's width: its panel starts closed.
  const [sideOpen, setSideOpen] = usePanel(variant === "wiki" ? "commons.pagePanel" : "commons.sidePanel", variant !== "wiki");
  const [showHistory, setShowHistory] = useState(false);
  // On a phone the panel covers the text: the back button closes it.
  useBackButton(sideOpen && isNarrow(), () => setSideOpen(false));
  // A comment or a suggestion clicked in the text: the panel opens on it.
  const [reveal, setReveal] = useState<{ id: string; at: number } | null>(null);
  const [revealSuggestion, setRevealSuggestion] = useState<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom as HTMLElement;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const note = target.closest("sup[data-footnote]");
      if (note && canSuggestRef.current) {
        const pos = editor.view.posAtDOM(note, 0);
        if (editor.state.doc.nodeAt(pos)?.type.name === "footnote") editSourceRef.current(pos);
        return;
      }
      const id = target.closest("[data-comment]")?.getAttribute("data-comment");
      const suggestion = suggestionIdAt(target);
      if (!id && !suggestion) return;
      setSideOpen(true);
      if (id) setReveal({ id, at: Date.now() });
      else if (suggestion) setRevealSuggestion({ id: suggestion, at: Date.now() });
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor, setSideOpen]);
  const mySuggestions = useRef<Set<string> | null>(null);
  const canSuggestRef = useRef(canSuggest);
  canSuggestRef.current = canSuggest;
  const editSourceRef = useRef<(pos: number) => void>(() => undefined);
  const pageRef = useRef<HTMLElement>(null);

  const view = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return null;
      const { doc, selection } = editor.state;
      return {
        suggesting: isSuggestChangesEnabled(editor.state),
        suggestions: listSuggestions(doc),
        // The suggestion the cursor is in, highlighted in the text and the panel.
        activeSuggestion: suggestionAtSelection(editor.state),
        words: countWords(doc),
        // Nothing at all, not even a photo: one empty paragraph.
        empty: doc.childCount === 1 && doc.firstChild!.content.size === 0,
        selectedWords: selection.empty ? 0 : countWords(doc, selection.from, selection.to),
        // Readability is measured on articles and pages, not in small form fields.
        text: variant && variant !== "wiki" ? "" : doc.textBetween(0, doc.content.size, "\n", " "),
      };
    },
  });

  useEffect(() => {
    if (view) loadNames(view.suggestions.map((s) => s.author)).catch(() => undefined);
  }, [view?.suggestions.length]);

  useEffect(() => {
    if (!editor || !onEditor) return;
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  // A section's [edit] link: the cursor goes to the end of its heading, in view.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focus) return;
    const timer = window.setTimeout(() => {
      let byText = -1;
      let byIndex = -1;
      let n = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "heading") return true;
        if (byText < 0 && node.textContent.trim() === focus.text) byText = pos;
        if (n++ === focus.index) byIndex = pos;
        return false;
      });
      const pos = byText >= 0 ? byText : byIndex;
      if (pos < 0) return;
      const node = editor.state.doc.nodeAt(pos);
      if (!node) return;
      editor.chain().setTextSelection(pos + node.nodeSize - 1).focus(undefined, { scrollIntoView: false }).run();
      (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [editor, focus?.index, focus?.text]);

  // After the panel opens, bring the clicked suggestion to the middle of it.
  useEffect(() => {
    if (!revealSuggestion) return;
    const timer = window.setTimeout(
      () =>
        pageRef.current?.parentElement
          ?.querySelector(`.suggestion[data-suggestion="${CSS.escape(revealSuggestion.id)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      60,
    );
    return () => window.clearTimeout(timer);
  }, [revealSuggestion]);

  // Tells the project's authors when this member adds a suggestion.
  useEffect(() => {
    if (!view) return;
    const mine = new Set(view.suggestions.filter((s) => s.author === userId).map((s) => String(s.id)));
    const before = mySuggestions.current;
    mySuggestions.current = mine;
    if (before && Array.from(mine).some((id) => !before.has(id))) reportSuggestionAdded(sync.docId);
  }, [view?.suggestions, userId, sync.docId]);

  // The language chosen on the tab, or the one the words show.
  const detected = useMemo(() => (view?.text ? detectLanguage(view.text) : null), [view?.text]);
  const score = useMemo(() => (view?.text ? readability(view.text, language ?? undefined) : null), [view?.text, language]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) setTextLanguage(editor.view, language);
  }, [editor, language]);

  if (!editor || !view) return null;

  const run = (cmd: typeof applySuggestions) => cmd(editor.state, editor.view.dispatch);
  // Errors stay long enough to be read (and can be closed); a newer message replaces the last.
  const flash = (msg: string, error = false) => {
    window.clearTimeout(noticeTimer.current);
    setNotice({ text: msg, error });
    noticeTimer.current = window.setTimeout(() => setNotice(null), error ? 15000 : 4000);
  };

  /** Adds a photo, or with `replace` swaps the selected one and keeps its caption. */
  const addPhoto = async (replace: boolean) => {
    const target = replace ? editor.state.selection.from : -1;
    try {
      const { tokens } = await rootClient.assets.fileUpload({
        fileType: "imageAll",
        multiple: false,
        windowTitle: replace ? t("editor.replacePhotoTitle") : t("editor.addPhotoTitle"),
      });
      if (!tokens?.length) {
        flash(t("editor.noPhoto"));
        return;
      }
      flash(t("editor.savingPhoto"));
      const { uri } = await docServiceClient.commitPhoto({ token: tokens[0] });
      if (replace) {
        if (editor.state.doc.nodeAt(target)?.type.name !== "figure") throw new Error(t("editor.photoMoved"));
        editor.chain().focus().setNodeSelection(target).replaceFigure(uri).run();
        flash(t("editor.photoReplaced"));
        return;
      }
      editor.chain().focus().insertFigure(uri).run();
      flash(t("editor.photoAdded"));
    } catch (err) {
      console.error("addPhoto failed", err);
      const message = String((err as Error)?.message ?? err);
      // Root cancels the transfer of a file that is too large without saying why.
      flash(/cancel|timeout|too large|size/i.test(message) ? t("editor.photoTooBig", { max: PHOTO_MAX_MB }) : t("editor.photoFailed", { error: message }), true);
    }
  };

  const startComment = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      flash(t("editor.selectFirst"));
      return;
    }
    setDraft({ from, to, quote: editor.state.doc.textBetween(from, to, " ").slice(0, 280) });
    // The comment is written in the side panel.
    setSideOpen(true);
  };

  commentShortcut.current = canSuggest ? startComment : () => undefined;
  editSourceRef.current = (pos) => void editSource(pos);

  /** Adds a source at the cursor, or with `pos` edits the one there. */
  const editSource = async (pos?: number) => {
    const node = pos != null ? editor.state.doc.nodeAt(pos) : null;
    const values = await formDialog(node ? t("source.editTitle") : t("source.addTitle"), [
      { key: "text", label: t("source.text"), value: (node?.attrs.text as string) ?? "", placeholder: t("source.textHint"), long: true },
      { key: "url", label: t("source.url"), value: (node?.attrs.url as string) ?? "", placeholder: "https://" },
    ]);
    if (!values) return;
    const text = values.text.trim().slice(0, 1000);
    const url = cleanUrl(values.url);
    if (node && pos != null) {
      if (!text) return editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, text, url }));
      return;
    }
    if (text) editor.chain().focus().insertFootnote({ text, url }).run();
  };

  /** Attaches a file from Root's file picker. */
  const attachFile = async () => {
    try {
      const { tokens } = await rootClient.assets.fileUpload({ fileType: "all", multiple: false, windowTitle: t("file.addTitle") });
      if (!tokens?.length) return;
      flash(t("file.saving"));
      const { uri } = await docServiceClient.commitPhoto({ token: tokens[0] });
      const guess = decodeURIComponent(tokens[0].split(/[\\/]/).pop() ?? "").replace(/^[0-9a-f-]{20,}[-_]?/i, "");
      const name = (await promptDialog(t("file.name"), guess || t("file.default")))?.trim() || guess || t("file.default");
      editor.chain().focus().insertAttachment({ uri, name: name.slice(0, 200) }).run();
      flash(t("file.added"));
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      flash(/cancel|timeout|too large|size/i.test(message) ? t("editor.photoTooBig", { max: PHOTO_MAX_MB }) : t("file.failed", { error: message }), true);
    }
  };

  return (
    <div className={(compact ? "layout compact" : "layout") + (variant ? ` ${variant}` : "")}>
      <Toolbar
        editor={editor}
        canSuggest={canSuggest}
        mode={
          canSuggest && !canEdit ? (
            // Comment level: say plainly that edits become suggestions.
            <span className="access-pill suggest" title={t("access.suggestHint")}>
              <FilePenLine size={15} />
              <span className="access-label">{t("access.suggestOnly")}</span>
              <span className="access-short">{t("access.suggestShort")}</span>
            </span>
          ) : canSuggest ? (
            <Menu
              className="mode-menu"
              title={canEdit ? t("editor.modeTitle") : t("editor.suggestOnly")}
              disabled={!canEdit}
              trigger={
                <>
                  {view.suggesting ? <FilePenLine size={ICON} /> : <Pencil size={ICON} />}
                  <span>{view.suggesting ? t("editor.suggesting") : t("editor.editing")}</span>
                  <ChevronDown size={14} />
                </>
              }
              items={[
                {
                  key: "edit",
                  label: t("editor.editing"),
                  hint: t("editor.editingHint"),
                  icon: <Pencil size={16} />,
                  active: !view.suggesting,
                  onSelect: () => disableSuggestChanges(editor.state, editor.view.dispatch),
                },
                {
                  key: "suggest",
                  label: t("editor.suggesting"),
                  hint: t("editor.suggestingHint"),
                  icon: <FilePenLine size={16} />,
                  active: view.suggesting,
                  onSelect: () => enableSuggestChanges(editor.state, editor.view.dispatch),
                },
              ]}
            />
          ) : null
        }
        onAddPhoto={() => addPhoto(false)}
        onSource={() => editSource()}
        onAttach={attachFile}
        onHistory={compact ? undefined : () => setShowHistory(true)}
        onReplacePhoto={() => addPhoto(true)}
        onComment={startComment}
        trailing={
          <>
            <span className={`sync-state ${status}`} role="status">
              {status === "synced" ? t("common.saved") : status === "error" ? t("editor.offline") : t("editor.connecting")}
            </span>
            {!compact && (
              <button className={showHistory ? "icon on" : "icon"} onClick={() => setShowHistory(!showHistory)} title={t("editor.history")}>
                <History size={ICON} />
              </button>
            )}
            {actions}
            <button
              className={sideOpen ? "icon on panel-toggle" : "icon panel-toggle"}
              title={sideOpen ? t("editor.hidePanel") : t("editor.showPanel")}
              onClick={() => setSideOpen(!sideOpen)}
            >
              {sideOpen ? <PanelRightClose size={ICON} /> : <PanelRightOpen size={ICON} />}
              {!sideOpen && view.suggestions.length > 0 && <span className="badge">{view.suggestions.length}</span>}
            </button>
          </>
        }
      />

      <div className="workspace" style={{ position: "relative" }}>
        {showHistory && <VersionHistory docId={sync.docId} editor={editor} level={level} onClose={() => setShowHistory(false)} />}
        <main className="page" ref={pageRef}>
          {before}
          {/* The editor stays mounted so the text still syncs in while it is empty. */}
          {emptyText && view.empty && <p className="hint empty-doc">{emptyText}</p>}
          <EditorContent editor={editor} className="article" hidden={!!emptyText && view.empty} />
          {after?.({ editor, editSource: (pos) => void editSource(pos) })}
          {canSuggest && !draft && <FloatingComment editor={editor} pageRef={pageRef} onComment={startComment} above={variant === "wiki"} />}
          <footer className="counts">
            <span className="counts-text">
            {t("editor.words", { count: view.words })}{view.selectedWords ? ` · ${t("editor.selected", { count: view.selectedWords })}` : ""}
            {score && (
              <span
                className="readability"
                title={t("editor.readAs", { language: languageName(score.language), sentences: score.sentences, syllables: score.syllables })}
              >
                {" · "}{t("editor.readabilityLine", { grade: formatGrade(score.grade), difficulty: score.difficulty, level: score.level })}
              </span>
            )}
            </span>
            {onLanguageChange && (
              <label className="text-language" title={t("lang.hint")}>
                <Languages size={13} aria-hidden />
                <select
                  aria-label={t("lang.label")}
                  value={language ?? ""}
                  disabled={!canEdit}
                  onChange={(e) => onLanguageChange((e.target.value || null) as Language | null)}
                >
                  <option value="">{t("lang.auto", { language: languageName(detected ?? "fr") })}</option>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {menuLanguageName(l)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </footer>
        </main>

        {sideOpen && isNarrow() && <div className="panel-scrim" onClick={() => setSideOpen(false)} />}
        <aside className={sideOpen ? "sidebar" : "sidebar closed"} aria-hidden={!sideOpen}>
          <button className="icon panel-close" title={t("common.close")} onClick={() => setSideOpen(false)}>
            <CloseIcon size={16} />
          </button>
          <CommentsPanel
            docId={sync.docId}
            editor={editor}
            ydoc={sync.ydoc}
            userId={userId}
            canComment={canSuggest}
            canEdit={canEdit}
            draft={draft}
            onDraftDone={() => setDraft(null)}
            reveal={reveal}
          />
          <div className="sidebar-head">
            <h2>{t("editor.suggestions", { count: view.suggestions.length })}</h2>
            {canEdit && view.suggestions.length > 0 && (
              <div className="row">
                <button
                  onClick={() => {
                    reportSuggestionResolved(sync.docId, view.suggestions.map((s) => s.author), true);
                    run(applySuggestions);
                  }}
                >
                  {t("editor.acceptAll")}
                </button>
                <button
                  onClick={() => {
                    reportSuggestionResolved(sync.docId, view.suggestions.map((s) => s.author), false);
                    run(revertSuggestions);
                  }}
                >
                  {t("editor.rejectAll")}
                </button>
              </div>
            )}
          </div>
          {view.activeSuggestion && (
            <style>{`.tiptap [data-id="${CSS.escape(JSON.stringify(view.activeSuggestion))}"] { background-color: color-mix(in srgb, var(--suggestion-color) 30%, transparent); outline: 1px solid var(--suggestion-color); border-radius: 2px; }`}</style>
          )}
          {view.suggestions.map((s) => (
            <div
              key={String(s.id)}
              data-suggestion={String(s.id)}
              className={view.activeSuggestion === String(s.id) ? "suggestion active" : "suggestion"}
            >
              <div className="who">
                <span className="avatar" style={{ background: colorForUser(s.author) }}>
                  {cachedName(s.author).slice(0, 1).toUpperCase()}
                </span>
                {cachedName(s.author)}
              </div>
              {s.deleted && <del>{s.deleted}</del>}
              {s.inserted && <ins>{s.inserted}</ins>}
              {s.structural && !s.inserted && !s.deleted && <em>{t("editor.formatChange")}</em>}
              {canEdit && (
                <div className="row">
                  <button
                    onClick={() => {
                      reportSuggestionResolved(sync.docId, [authorOf(s.id)], true);
                      applySuggestion(s.id)(editor.state, editor.view.dispatch);
                    }}
                  >
                    {t("editor.accept")}
                  </button>
                  <button
                    onClick={() => {
                      reportSuggestionResolved(sync.docId, [authorOf(s.id)], false);
                      revertSuggestion(s.id)(editor.state, editor.view.dispatch);
                    }}
                  >
                    {t("editor.reject")}
                  </button>
                </div>
              )}
            </div>
          ))}
          {!compact && <TextStats words={view.words} selected={view.selectedWords} score={score} />}
        </aside>
      </div>
      {notice && (
        <div className={notice.error ? "notice error" : "notice"} role={notice.error ? "alert" : "status"}>
          {notice.text}
          {notice.error && (
            <button className="icon notice-close" title={t("common.close")} onClick={() => setNotice(null)}>
              <CloseIcon size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const ICON = 18;

/** "Français", "Portugais (Brésil)": a language as a menu entry, in the reader's language. */
function menuLanguageName(language: Language): string {
  let name: string = language;
  try {
    name = new Intl.DisplayNames([locale()], { type: "language" }).of(language === "pt" ? "pt-BR" : language) ?? language;
  } catch {
    // Older browsers: the code stands in.
  }
  return name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1);
}
// Larger photos do not get through Root's upload.
const PHOTO_MAX_MB = 10;


type ToolbarProps = {
  editor: Editor;
  canSuggest: boolean;
  mode: React.ReactNode;
  trailing: React.ReactNode;
  onAddPhoto: () => void;
  onReplacePhoto: () => void;
  onComment: () => void;
  onSource: () => void;
  onAttach: () => void;
  onHistory?: () => void;
};

const ALIGNMENTS = [
  ["left", "editor.alignLeft", AlignLeft],
  ["center", "editor.center", AlignCenter],
  ["right", "editor.alignRight", AlignRight],
  ["justify", "editor.justify", AlignJustify],
] as const;

/** The single row above the text: mode, formatting, then people and actions. */
const Toolbar: React.FC<ToolbarProps> = ({ editor, canSuggest, mode, trailing, onAddPhoto, onReplacePhoto, onComment, onSource, onAttach, onHistory }) => {
  const photo = useEditorState({
    editor,
    selector: ({ editor }) => {
      const sel = editor.state.selection;
      return sel instanceof NodeSelection && sel.node.type.name === "figure" ? (sel.node.attrs.uri as string) : null;
    },
  });
  const [linkOpen, setLinkOpen] = useState(false);
  // Narrow toolbar: one line of essentials, opened to every tool on demand.
  const [expanded, setExpanded] = useState(false);
  // Whether the extra tools land on a new line (the arrow then points down)
  // or fit beside the others (it points right): that depends on the room.
  const main = useRef<HTMLDivElement>(null);
  const [opensDown, setOpensDown] = useState(false);
  const extraWidth = useRef(280);
  const collapsedWidth = useRef(0);
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const measure = () => {
      const items = Array.from(el.querySelectorAll<HTMLElement>(":scope > *, :scope > .tb-contents > *, :scope > .tb-wide > *, :scope > .tb-extra > *")).filter(
        (c) => c.offsetWidth > 0 && getComputedStyle(c).display !== "contents",
      );
      if (!items.length) return;
      const box = el.getBoundingClientRect();
      const left = Math.min(...items.map((c) => c.getBoundingClientRect().left));
      const right = Math.max(...items.map((c) => c.getBoundingClientRect().right));
      const top = Math.min(...items.map((c) => c.getBoundingClientRect().top));
      const wrapped = items.some((c) => c.getBoundingClientRect().top > top + 8);
      if (expanded) {
        if (!wrapped && collapsedWidth.current) extraWidth.current = Math.max(0, right - left - collapsedWidth.current);
        setOpensDown(wrapped);
      } else {
        collapsedWidth.current = right - left;
        setOpensDown(right - left + extraWidth.current > box.width);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded]);
  // Phone: the tools left out of the one-line toolbar, in a sheet from the bottom.
  const [sheet, setSheet] = useState(false);
  const [href, setHref] = useState("");
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      quote: editor.isActive("blockquote"),
      highlight: (editor.getAttributes("highlight").color as string | undefined) ?? (editor.isActive("highlight") ? HIGHLIGHTS[0].color : ""),
      color: (editor.getAttributes("textStyle").color as string | undefined) ?? "",
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      level: editor.isActive("paragraph", { surtitle: true })
        ? "s"
        : (([1, 2, 3, 4] as const).find((level) => editor.isActive("heading", { level })) ?? 0),
      align: (["left", "center", "right", "justify"] as const).find((a) => editor.isActive({ textAlign: a })) ?? "left",
    }),
  });
  const chain = () => editor.chain().focus();
  if (!canSuggest)
    return (
      <div className="toolbar readonly">
        <span className="access-pill readonly" title={t("access.readHint")}>
          <Eye size={15} />
          <span className="access-label">{t("editor.readOnly")}</span>
        </span>
        <div className="spacer" />
        {trailing}
      </div>
    );
  const AlignIcon = ALIGNMENTS.find(([value]) => value === active.align)![2];
  return (
    <div className={expanded ? "toolbar split expanded" : "toolbar split"}>
      {/* Formatting on the left (it may wrap); status and article actions stay a block of their own. */}
      <div className="tb-main" ref={main}>
      {mode}
      <span className="sep tb-m-hide tb-undo" />
      <button className="icon tb-m-hide tb-undo" title={t("editor.undo")} onClick={() => undo(editor.state)}>
        <Undo2 size={ICON} />
      </button>
      <button className="icon tb-m-hide tb-undo" title={t("editor.redo")} onClick={() => redo(editor.state)}>
        <Redo2 size={ICON} />
      </button>
      <span className="sep" />
      <select
        value={active.level}
        onChange={(e) => {
          if (e.target.value === "s") return chain().setParagraph().updateAttributes("paragraph", { surtitle: true }).run();
          const level = Number(e.target.value) as 0 | 1 | 2 | 3 | 4;
          level ? chain().setHeading({ level }).run() : chain().setParagraph().updateAttributes("paragraph", { surtitle: null }).run();
        }}
      >
        <option value={0}>{t("editor.text")}</option>
        <option value="s">{t("editor.surtitle")}</option>
        <option value={1}>{t("editor.heading", { n: 1 })}</option>
        <option value={2}>{t("editor.heading", { n: 2 })}</option>
        <option value={3}>{t("editor.heading", { n: 3 })}</option>
        <option value={4}>{t("editor.heading", { n: 4 })}</option>
      </select>
      <button className={active.bold ? "icon on" : "icon"} title={t("editor.bold")} onClick={() => chain().toggleBold().run()}>
        <Bold size={ICON} />
      </button>
      <button className={active.italic ? "icon on" : "icon"} title={t("editor.italic")} onClick={() => chain().toggleItalic().run()}>
        <Italic size={ICON} />
      </button>
      <button className={active.underline ? "icon on tb-m-hide" : "icon tb-m-hide"} title={t("editor.underline")} onClick={() => chain().toggleUnderline().run()}>
        <UnderlineIcon size={ICON} />
      </button>
      <span className="tb-extra tb-m-hide">
      <SwatchMenu
        title={t("editor.highlight")}
        icon={<Highlighter size={ICON} />}
        colors={HIGHLIGHTS}
        value={active.highlight}
        noneLabel={t("editor.noHighlight")}
        noneClass="none"
        onPick={(color) => chain().setHighlight({ color }).run()}
        onNone={() => chain().unsetHighlight().run()}
      />
      <SwatchMenu
        title={t("editor.textColor")}
        icon={<Baseline size={ICON} />}
        colors={TEXT_COLORS}
        value={active.color}
        noneLabel={t("style.defaultColor")}
        noneClass="default"
        onPick={(color) => chain().setColor(color).run()}
        onNone={() => chain().unsetColor().run()}
      />
      </span>
      <span className="sep" />
      <button className={active.bullet ? "icon on tb-m-hide" : "icon tb-m-hide"} title={t("editor.bullets")} onClick={() => chain().toggleBulletList().run()}>
        <List size={ICON} />
      </button>
      <button className={active.ordered ? "icon on tb-m-hide" : "icon tb-m-hide"} title={t("editor.numbers")} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={ICON} />
      </button>
      {/* Quote, alignment and indents go into the "more" menu when the toolbar is narrow. */}
      <span className="tb-wide tb-m-hide">
      <button className={active.quote ? "icon on" : "icon"} title={t("editor.quote")} onClick={() => chain().toggleBlockquote().run()}>
        <Quote size={ICON} />
      </button>
      <span className="sep" />
      <Menu
        className="align-menu"
        title={t("editor.alignment")}
        trigger={
          <>
            <AlignIcon size={ICON} />
            <ChevronDown size={12} />
          </>
        }
        items={ALIGNMENTS.map(([value, label, Icon]) => ({
          key: value,
          label: t(label),
          icon: <Icon size={16} />,
          active: active.align === value,
          onSelect: () => chain().setTextAlign(value).run(),
        }))}
      />
      <span className="sep" />
      <button className="icon" title={t("editor.outdentKey")} onClick={() => chain().outdent().run()}>
        <IndentDecrease size={ICON} />
      </button>
      <button className="icon" title={t("editor.indentKey")} onClick={() => chain().indent().run()}>
        <IndentIncrease size={ICON} />
      </button>
      </span>
      <Menu
        className="more-menu tb-m-hide"
        align="right"
        title={t("editor.moreFormatting")}
        trigger={<MoreHorizontal size={ICON} />}
        items={[
          { key: "quote", label: t("editor.quote"), icon: <Quote size={16} />, active: active.quote, className: "narrow-only", onSelect: () => chain().toggleBlockquote().run() },
          ...ALIGNMENTS.map(([value, label, Icon]) => ({
            key: `align-${value}`,
            label: t(label),
            icon: <Icon size={16} />,
            active: active.align === value,
            className: "narrow-only",
            onSelect: () => chain().setTextAlign(value).run(),
          })),
          { key: "outdent", label: t("editor.outdent"), hint: "Shift+Tab", icon: <IndentDecrease size={16} />, className: "narrow-only", onSelect: () => chain().outdent().run() },
          { key: "indent", label: t("editor.indent"), hint: "Tab", icon: <IndentIncrease size={16} />, className: "narrow-only", onSelect: () => chain().indent().run() },
          {
            key: "strike",
            label: t("editor.strike"),
            hint: "Ctrl+Shift+S",
            icon: <Strikethrough size={16} />,
            active: active.strike,
            onSelect: () => chain().toggleStrike().run(),
          },
          { key: "rule", label: t("editor.rule"), icon: <Minus size={16} />, onSelect: () => chain().setHorizontalRule().run() },
          "separator",
          {
            key: "clear",
            label: t("editor.clear"),
            hint: t("editor.clearHint"),
            icon: <RemoveFormatting size={16} />,
            onSelect: () => chain().unsetBold().unsetItalic().unsetUnderline().unsetStrike().unsetHighlight().unsetColor().run(),
          },
        ]}
      />
      <button
        className={expanded ? "icon tb-expand tb-m-hide on" : "icon tb-expand tb-m-hide"}
        title={expanded ? t("editor.fewerTools") : t("editor.allTools")}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {/* The arrow shows where the tools appear: beside the others, or on a new line. */}
        {expanded ? opensDown ? <ChevronUp size={ICON} /> : <ChevronLeft size={ICON} /> : opensDown ? <ChevronDown size={ICON} /> : <ChevronRight size={ICON} />}
      </button>
      <span className="sep" />
      <span className="tb-m-hide tb-contents">
      {linkOpen ? (
        <LinkForm editor={editor} href={href} setHref={setHref} onDone={() => setLinkOpen(false)} />
      ) : (
        <button
          className="icon"
          title={t("editor.link")}
          onClick={() => {
            setHref(editor.getAttributes("link").href ?? "");
            setLinkOpen(true);
          }}
        >
          <LinkIcon size={ICON} />
        </button>
      )}
      {photo ? (
        <Menu
          className="photo-menu on"
          title={t("editor.selectedPhoto")}
          trigger={<ImageIcon size={ICON} />}
          items={[
            { key: "replace", label: t("editor.replacePhoto"), hint: t("editor.keepsCaption"), icon: <ImageUp size={16} />, onSelect: onReplacePhoto },
            {
              key: "remove",
              label: t("editor.removePhoto"),
              icon: <Trash2 size={16} />,
              danger: true,
              onSelect: () => editor.chain().focus().deleteSelection().run(),
            },
          ]}
        >
          <img className="photo-menu-preview" src={figureImageUrl(photo)} alt="" />
        </Menu>
      ) : (
        <button className="icon" title={t("editor.addPhotoTitle")} onClick={onAddPhoto}>
          <ImagePlus size={ICON} />
        </button>
      )}
      <button className="icon" title={t("source.add")} onClick={onSource}>
        <BookMarked size={ICON} />
      </button>
      <button className="icon" title={t("file.add")} onClick={onAttach}>
        <Paperclip size={ICON} />
      </button>
      <span className="sep" />
      </span>
      <button className="icon tb-sheet" title={t("editor.moreFormatting")} onMouseDown={(e) => e.preventDefault()} onClick={() => setSheet(true)}>
        <Type size={ICON} />
      </button>
      <button className="icon" title={t("editor.commentSelection")} onClick={onComment}>
        <MessageSquarePlus size={ICON} />
      </button>
      </div>
      <div className="tb-side">{trailing}</div>
      {sheet && <FormatSheet editor={editor} onClose={() => setSheet(false)} onAddPhoto={onAddPhoto} onSource={onSource} onAttach={onAttach} onHistory={onHistory} />}
    </div>
  );
};

/** "example.org" becomes "https://example.org"; anything not a web address is dropped. */
function cleanUrl(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const url = /^[a-z]+:/i.test(v) ? v : `https://${v}`;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 500) : "";
}

/** The page an internal link points to, as stored in the text. */
export const pageHref = (pageId: string) => `#/page/${pageId}`;

/**
 * Links to a web address, or to another page of the knowledge base: typing
 * words instead of an address lists the pages whose title matches.
 */
const LinkForm: React.FC<{ editor: Editor; href: string; setHref: (v: string) => void; onDone: () => void }> = ({ editor, href, setHref, onDone }) => {
  const [pages, setPages] = useState<PageSummary[]>([]);
  const isAddress = /^(https?:|www\.|#|mailto:)/i.test(href.trim()) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(href.trim());
  useEffect(() => {
    const q = href.trim();
    if (q.length < 2 || isAddress) return setPages([]);
    const timer = window.setTimeout(() => {
      wikiServiceClient
        .findPages({ query: q })
        .then((r) => setPages(r.pages))
        .catch(() => setPages([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [href, isAddress]);
  const link = (target: string, title?: string) => {
    const { empty } = editor.state.selection;
    if (empty && title) editor.chain().focus().insertContent({ type: "text", text: title, marks: [{ type: "link", attrs: { href: target } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: target }).run();
    onDone();
  };
  return (
    <form
      className="link-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!href.trim()) {
          editor.chain().focus().unsetLink().run();
          return onDone();
        }
        if (!isAddress && pages[0]) return link(pageHref(pages[0].id), pages[0].title);
        const url = href.startsWith("#") ? href.trim() : cleanUrl(href);
        if (url) link(url);
        else onDone();
      }}
    >
      <input autoFocus placeholder={t("link.placeholder")} value={href} onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <button type="submit">OK</button>
      {pages.length > 0 && (
        <div className="menu-pop link-pages" role="listbox">
          {pages.map((p) => (
            <button key={p.id} type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => link(pageHref(p.id), p.title)}>
              <span className="menu-icon">
                <FileText size={15} />
              </span>
              <span className="menu-label">{p.title}</span>
              {p.draftOnly && <span className="menu-hint">{t("page.draft")}</span>}
            </button>
          ))}
        </div>
      )}
    </form>
  );
};

/** A comment button in the paper's right margin, level with the selected text. */
const FloatingComment: React.FC<{ editor: Editor; pageRef: React.RefObject<HTMLElement>; onComment: () => void; above?: boolean }> = ({
  editor,
  pageRef,
  onComment,
  above,
}) => {
  const sel = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      return { from, to, show: !empty && editor.isFocused };
    },
  });
  const page = pageRef.current;
  if (!sel.show || !page) return null;
  let start: { top: number };
  let end: { top: number; left: number };
  try {
    start = editor.view.coordsAtPos(sel.from);
    end = editor.view.coordsAtPos(sel.to);
  } catch {
    return null;
  }
  const pageBox = page.getBoundingClientRect();
  const paperBox = (editor.view.dom as HTMLElement).getBoundingClientRect();
  let top = start.top - 4;
  let left = paperBox.right - 46;
  if (above) {
    // The text runs to the edge here: the button sits above the end of the
    // selection, never over the infobox floated beside the text.
    top = end.top - 40;
    let right = paperBox.right;
    page.querySelectorAll(".infobox").forEach((box) => {
      const r = box.getBoundingClientRect();
      if (top < r.bottom && end.top + 20 > r.top) right = Math.min(right, r.left - 8);
    });
    left = Math.max(paperBox.left, Math.min(end.left - 17, right - 34));
  }
  return (
    <button
      className="floating-comment"
      title={t("editor.commentKey")}
      style={{ top: top - pageBox.top + page.scrollTop, left: left - pageBox.left + page.scrollLeft }}
      // Keep the selection: the click must not take focus from the text.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onComment}
    >
      <MessageSquarePlus size={18} />
    </button>
  );
};

const SUGGESTION_MARK_NAMES = new Set(["insertion", "deletion", "modification"]);

/** The id of the suggestion a clicked element belongs to, if any. */
function suggestionIdAt(el: HTMLElement): string | null {
  const raw = el.closest("ins[data-id], del[data-id], span[data-type='modification'][data-id]")?.getAttribute("data-id");
  if (!raw) return null;
  try {
    return String(JSON.parse(raw));
  } catch {
    return raw;
  }
}

/** The suggestion around the cursor, as a comment's thread is found under it. */
function suggestionAtSelection(state: EditorState): string | null {
  const { $from } = state.selection;
  const marks = [...$from.marks(), ...($from.nodeAfter?.marks ?? []), ...($from.nodeBefore?.marks ?? [])];
  const mark = marks.find((m) => SUGGESTION_MARK_NAMES.has(m.type.name) && m.attrs.id != null);
  return mark ? String(mark.attrs.id) : null;
}

/** Word count and readability, in the sidebar. */
/** 9.6 in English, 9,6 in French: written the reader's way. */
function formatGrade(grade: number): string {
  return grade.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const TextStats: React.FC<{ words: number; selected: number; score: Readability | null }> = ({ words, selected, score }) => (
  <div className="measure">
    <h2>{t("editor.textStats")}</h2>
    <ul>
      <li>
        {t("editor.words", { count: words })}
        {selected ? ` ${t("editor.selectedParen", { count: selected })}` : ""}
      </li>
      {score ? (
        <>
          <li>
            {t("editor.readability")} <strong>{formatGrade(score.grade)}</strong> ({score.difficulty})
          </li>
          <li>{t("editor.readingLevel", { level: score.level })}</li>
          <li>{t("editor.perSentence", { n: (score.words / score.sentences).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</li>
          <li>{t("editor.perParagraph", { n: score.paragraphWords })}</li>
          <li title={score.longestSentence.start}>
            {t("editor.longestSentence", { count: score.longestSentence.words })}
            <span className="stat-quote">{score.longestSentence.start}</span>
          </li>
          <li title={score.longestParagraph.start}>
            {t("editor.longestParagraph", { count: score.longestParagraph.words })}
            <span className="stat-quote">{score.longestParagraph.start}</span>
          </li>
        </>
      ) : (
        <li className="hint">{t("editor.from10")}</li>
      )}
    </ul>
  </div>
);

export default ArticleEditor;
