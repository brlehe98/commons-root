import React, { useEffect } from "react";
import { t } from "../i18n";
import { promptDialog } from "../ui/dialog";
import { createPortal } from "react-dom";
import { Editor, useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Copy,
  History,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { redo, undo } from "./collaboration";
import { HIGHLIGHTS, isDarkTheme, TEXT_COLORS } from "./palette";

type Props = {
  editor: Editor;
  onClose: () => void;
  onAddPhoto: () => void;
  onCopy: () => void;
  onHistory?: () => void;
};

const ALIGN = [
  ["left", "sheet.left", AlignLeft],
  ["center", "editor.center", AlignCenter],
  ["right", "sheet.right", AlignRight],
  ["justify", "editor.justify", AlignJustify],
] as const;

/** Phone: every tool the one-line toolbar leaves out, as big buttons in a sheet from the bottom. */
const FormatSheet: React.FC<Props> = ({ editor, onClose, onAddPhoto, onCopy, onHistory }) => {
  const a = useEditorState({
    editor,
    selector: ({ editor }) => ({
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bullet: editor.isActive("bulletList"),
      ordered: editor.isActive("orderedList"),
      quote: editor.isActive("blockquote"),
      align: (["left", "center", "right", "justify"] as const).find((x) => editor.isActive({ textAlign: x })) ?? "left",
      highlight: (editor.getAttributes("highlight").color as string | undefined) ?? "",
      color: (editor.getAttributes("textStyle").color as string | undefined) ?? "",
      link: (editor.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chain = () => editor.chain().focus();
  const shown = (c: { color: string; dark: string }) => (isDarkTheme() ? c.dark : c.color);
  // Buttons keep the text selection: no focus change on press.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const tool = (label: string, icon: React.ReactNode, on: boolean, run: () => void) => (
    <button type="button" className={on ? "fs-tool on" : "fs-tool"} onMouseDown={keep} onClick={run} aria-pressed={on}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return createPortal(
    <>
      <div className="fs-scrim" onClick={onClose} />
      <div className="format-sheet" role="dialog" aria-label={t("sheet.formatting")}>
        <header className="fs-head">
          <span>{t("sheet.formatting")}</span>
          <button className="icon" title={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="fs-grid">
          {tool(t("sheet.undo"), <Undo2 size={20} />, false, () => undo(editor.state))}
          {tool(t("sheet.redo"), <Redo2 size={20} />, false, () => redo(editor.state))}
          {tool(t("sheet.underline"), <UnderlineIcon size={20} />, a.underline, () => chain().toggleUnderline().run())}
          {tool(t("sheet.strike"), <Strikethrough size={20} />, a.strike, () => chain().toggleStrike().run())}
          {tool(t("sheet.bullets"), <List size={20} />, a.bullet, () => chain().toggleBulletList().run())}
          {tool(t("sheet.numbers"), <ListOrdered size={20} />, a.ordered, () => chain().toggleOrderedList().run())}
          {tool(t("editor.quote"), <Quote size={20} />, a.quote, () => chain().toggleBlockquote().run())}
          {tool(t("sheet.line"), <Minus size={20} />, false, () => chain().setHorizontalRule().run())}
        </div>

        <div className="fs-label">{t("editor.alignment")}</div>
        <div className="fs-row">
          {ALIGN.map(([value, label, Icon]) => (
            <button key={value} type="button" className={a.align === value ? "fs-chip on" : "fs-chip"} onMouseDown={keep} onClick={() => chain().setTextAlign(value).run()} title={t(label)}>
              <Icon size={20} />
            </button>
          ))}
          <button type="button" className="fs-chip" onMouseDown={keep} onClick={() => chain().outdent().run()} title={t("editor.outdent")}>
            <IndentDecrease size={20} />
          </button>
          <button type="button" className="fs-chip" onMouseDown={keep} onClick={() => chain().indent().run()} title={t("editor.indent")}>
            <IndentIncrease size={20} />
          </button>
        </div>

        <div className="fs-label">{t("editor.highlight")}</div>
        <div className="fs-row">
          <button type="button" className={!a.highlight ? "swatch none active" : "swatch none"} title={t("editor.noHighlight")} onMouseDown={keep} onClick={() => chain().unsetHighlight().run()} />
          {HIGHLIGHTS.map((h) => (
            <button
              key={h.color}
              type="button"
              className={a.highlight === h.color ? "swatch active" : "swatch"}
              style={{ background: shown(h) }}
              title={h.label}
              onMouseDown={keep}
              onClick={() => chain().setHighlight({ color: h.color }).run()}
            />
          ))}
        </div>

        <div className="fs-label">{t("editor.textColor")}</div>
        <div className="fs-row">
          <button type="button" className={!a.color ? "swatch default active" : "swatch default"} title={t("style.defaultColor")} onMouseDown={keep} onClick={() => chain().unsetColor().run()} />
          {TEXT_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              className={a.color === c.color ? "swatch active" : "swatch"}
              style={{ background: shown(c) }}
              title={c.label}
              onMouseDown={keep}
              onClick={() => chain().setColor(c.color).run()}
            />
          ))}
        </div>

        <div className="fs-grid fs-actions">
          {tool(t("editor.link"), <LinkIcon size={20} />, !!a.link, async () => {
            const href = await promptDialog(t("sheet.linkPrompt"), a.link || "https://");
            if (href === null) return;
            href.trim() ? chain().extendMarkRange("link").setLink({ href: href.trim() }).run() : chain().unsetLink().run();
          })}
          {tool(t("sheet.photo"), <ImagePlus size={20} />, false, () => {
            onClose();
            onAddPhoto();
          })}
          {tool(t("sheet.clear"), <RemoveFormatting size={20} />, false, () =>
            chain().unsetBold().unsetItalic().unsetUnderline().unsetStrike().unsetHighlight().unsetColor().run(),
          )}
          {onHistory &&
            tool(t("sheet.history"), <History size={20} />, false, () => {
              onClose();
              onHistory();
            })}
          {tool(t("editor.copy"), <Copy size={20} />, false, () => {
            onClose();
            onCopy();
          })}
        </div>
      </div>
    </>,
    document.body,
  );
};

export default FormatSheet;
