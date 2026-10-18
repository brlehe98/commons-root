import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PageSummary } from "@commons-root/gen-shared";
import { fileUrl, isPdf } from "../editor/attachment";
import { PMNode, wiki } from "./api";
import { outline, PAGE_LINK } from "./outline";
import Lightbox, { StoredImage } from "./Lightbox";
import { t } from "../i18n";

type Props = {
  doc: PMNode;
  /** Opens another page of the wiki. */
  onOpenPage: (pageId: string) => void;
  /** Offered beside each heading to the people who can edit: opens the editor at that section. */
  onEditSection?: (index: number, text: string) => void;
  /** Drawn at the top of the text, floated to the right: the infobox. */
  aside?: React.ReactNode;
};

/** The heading elements of the text, in order: `section-0`, `section-1`… */
export const sectionId = (i: number) => `section-${i}`;
const noteId = (n: number) => `cite-note-${n}`;
const refId = (n: number) => `cite-ref-${n}`;

/** Scrolls a part of the page into view and marks it for a moment. */
export function reveal(el: Element | null, mark = false) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: mark ? "center" : "start" });
  if (!mark) return;
  el.classList.remove("targeted");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("targeted");
  window.setTimeout(() => el.classList.remove("targeted"), 2200);
}

type Preview = { x: number; y: number; below: boolean; title?: string; text: string };

/**
 * The published text as on Wikipedia: headings with an [edit] link, numbered
 * notes listed under References, links to missing pages in red, previews of
 * linked pages and notes on hover, photos that open full size.
 */
const WikiText: React.FC<Props> = ({ doc, onOpenPage, onEditSection, aside }) => {
  const { notes, links } = useMemo(() => outline(doc), [doc]);
  // Linked pages the reader can open; the others show in red.
  const [pages, setPages] = useState<Map<string, PageSummary> | null>(null);
  useEffect(() => {
    if (!links.length) return setPages(new Map());
    wiki
      .checkLinks({ pageIds: links })
      .then((r) => setPages(new Map(r.pages.map((p) => [p.id, p]))))
      .catch(() => setPages(null));
  }, [links.join(",")]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<number>();
  const [photo, setPhoto] = useState<{ uri: string; caption: string } | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showPreview = (el: HTMLElement, content: Omit<Preview, "x" | "y" | "below">) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const box = el.getBoundingClientRect();
      const below = box.bottom + 220 < window.innerHeight;
      setPreview({ ...content, x: Math.max(8, Math.min(box.left, window.innerWidth - 348)), y: below ? box.bottom + 6 : box.top - 6, below });
    }, 450);
  };
  const hidePreview = () => {
    window.clearTimeout(timer.current);
    setPreview(null);
  };

  // Where the infobox goes on a narrow column: after the first paragraph with text.
  const leadEnd = Math.max(0, (doc.content ?? []).findIndex((n) => n.type === "paragraph" && (n.content ?? []).length > 0));

  // One pass over the text: notes and headings are numbered in order.
  let note = 0;
  let heading = 0;

  const linkFor = (href: string, children: React.ReactNode, key: React.Key) => {
    const id = PAGE_LINK.exec(href)?.[1];
    if (id) {
      const target = pages?.get(id);
      const missing = pages !== null && !target;
      return (
        <a
          key={key}
          href={href}
          className={missing ? "missing-link" : undefined}
          title={missing ? t("read.missingLink") : undefined}
          onClick={(e) => {
            e.preventDefault();
            hidePreview();
            if (!missing) onOpenPage(id);
          }}
          onMouseEnter={(e) => target && showPreview(e.currentTarget, { title: target.title, text: target.lead })}
          onMouseLeave={hidePreview}
        >
          {children}
        </a>
      );
    }
    // Only web and mail addresses open; anything else (a script) stays plain text.
    if (!/^(https?:|mailto:)/i.test(href)) return <React.Fragment key={key}>{children}</React.Fragment>;
    const outside = /^https?:/i.test(href);
    return (
      <a key={key} href={href} className={outside ? "external" : undefined} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  };

  const inline = (n: PMNode, key: React.Key): React.ReactNode => {
    switch (n.type) {
      case "text": {
        let out: React.ReactNode = n.text ?? "";
        for (const m of n.marks ?? []) {
          const color = String(m.attrs?.color ?? "");
          switch (m.type) {
            case "bold":
              out = <strong>{out}</strong>;
              break;
            case "italic":
              out = <em>{out}</em>;
              break;
            case "underline":
              out = <u>{out}</u>;
              break;
            case "strike":
              out = <s>{out}</s>;
              break;
            case "highlight":
              out = color ? (
                <mark data-color={color} style={{ backgroundColor: color }}>
                  {out}
                </mark>
              ) : (
                <mark>{out}</mark>
              );
              break;
            case "textStyle":
              if (color) out = <span style={{ color }}>{out}</span>;
              break;
          }
        }
        // The link goes outside the other marks, so it stays one link.
        const link = n.marks?.find((m) => m.type === "link");
        return link ? linkFor(String(link.attrs?.href ?? ""), out, key) : <React.Fragment key={key}>{out}</React.Fragment>;
      }
      case "hardBreak":
        return <br key={key} />;
      case "footnote": {
        const n1 = ++note;
        const text = String(n.attrs?.text ?? "");
        return (
          <sup key={key} id={refId(n1)} className="reference">
            {/* A word joiner keeps the number on the line of the word before it. */}
            {"\u2060"}
            <a
              href={`#${noteId(n1)}`}
              onClick={(e) => {
                e.preventDefault();
                hidePreview();
                reveal(document.getElementById(noteId(n1)), true);
              }}
              onMouseEnter={(e) => showPreview(e.currentTarget, { text })}
              onMouseLeave={hidePreview}
            >
              [{n1}]
            </a>
          </sup>
        );
      }
      default:
        return <React.Fragment key={key}>{(n.content ?? []).map(inline)}</React.Fragment>;
    }
  };

  const blockStyle = (n: PMNode): React.CSSProperties | undefined => {
    const align = n.attrs?.textAlign as string | undefined;
    const indent = Number(n.attrs?.indent ?? 0);
    if ((!align || align === "left") && !indent) return undefined;
    return { textAlign: align && align !== "left" ? (align as React.CSSProperties["textAlign"]) : undefined, marginLeft: indent ? `${indent * 2}em` : undefined };
  };

  const block = (n: PMNode, key: React.Key): React.ReactNode => {
    const kids = () => (n.content ?? []).map(block);
    switch (n.type) {
      case "paragraph":
        return (
          <p key={key} className={n.attrs?.surtitle ? "surtitle" : undefined} style={blockStyle(n)}>
            {(n.content ?? []).map(inline)}
          </p>
        );
      case "heading": {
        const i = heading++;
        const level = Math.min(4, Math.max(1, Number(n.attrs?.level ?? 2)));
        const Tag = `h${level}` as "h2";
        const text = (n.content ?? []).map((c) => c.text ?? "").join("").trim();
        return (
          <Tag key={key} id={sectionId(i)} style={blockStyle(n)}>
            <span className="heading-text">{(n.content ?? []).map(inline)}</span>
            {onEditSection && (
              <span className="section-edit">
                <button className="link" onClick={() => onEditSection(i, text)} aria-label={t("read.editSection", { section: text })}>
                  {t("read.edit")}
                </button>
              </span>
            )}
          </Tag>
        );
      }
      case "bulletList":
        return <ul key={key}>{kids()}</ul>;
      case "orderedList":
        return (
          <ol key={key} start={Number(n.attrs?.start ?? 1) !== 1 ? Number(n.attrs?.start) : undefined}>
            {kids()}
          </ol>
        );
      case "listItem":
        return <li key={key}>{kids()}</li>;
      case "blockquote":
        return <blockquote key={key}>{kids()}</blockquote>;
      case "horizontalRule":
        return <hr key={key} />;
      case "figure": {
        const uri = String(n.attrs?.uri ?? "");
        const caption = (n.content ?? []).map((c) => c.text ?? "").join("");
        if (!uri) return null;
        return (
          <figure key={key} className="figure thumb">
            <button className="thumb-open" onClick={() => setPhoto({ uri, caption })} title={t("read.openPhoto")}>
              <StoredImage uri={uri} alt={caption} loading="lazy" />
            </button>
            {caption && <figcaption>{(n.content ?? []).map(inline)}</figcaption>}
          </figure>
        );
      }
      case "attachment": {
        const url = fileUrl(String(n.attrs?.uri ?? ""));
        const name = String(n.attrs?.name ?? "");
        return (
          <div key={key} className="attachment">
            <a href={url || undefined} target="_blank" rel="noopener noreferrer">
              {name || t("file.default")}
            </a>
            {url && isPdf(name) && <iframe className="pdf-view" src={url} title={name} loading="lazy" referrerPolicy="no-referrer" />}
          </div>
        );
      }
      default:
        // A block this version does not know: its text still shows.
        return n.content?.some((c) => c.type === "text") ? <p key={key}>{(n.content ?? []).map(inline)}</p> : <React.Fragment key={key}>{kids()}</React.Fragment>;
    }
  };

  return (
    <>
      <div className="wiki-read tiptap">
        {/* The infobox floats beside the text from the top; on a narrow column it comes after the first paragraph, as on Wikipedia's mobile site. */}
        <div className="aside-top">{aside}</div>
        {(doc.content ?? []).map((n, i) =>
          i === leadEnd ? (
            <React.Fragment key={i}>
              {block(n, i)}
              <div className="aside-lead">{aside}</div>
            </React.Fragment>
          ) : (
            block(n, i)
          ),
        )}
      </div>
      {notes.length > 0 && (
        <section className="references">
          <h2>{t("read.references")}</h2>
          <ol>
            {notes.map((n, i) => (
              <li key={i} id={noteId(i + 1)}>
                <a
                  className="ref-back"
                  href={`#${refId(i + 1)}`}
                  title={t("read.backToText")}
                  onClick={(e) => {
                    e.preventDefault();
                    reveal(document.getElementById(refId(i + 1)), true);
                  }}
                >
                  ^
                </a>{" "}
                <NoteText note={n} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {preview &&
        createPortal(
          <div
            className={preview.title ? "hover-preview page-preview" : "hover-preview"}
            style={{ left: preview.x, ...(preview.below ? { top: preview.y } : { bottom: window.innerHeight - preview.y }) }}
            role="tooltip"
          >
            {preview.title && <div className="preview-title">{preview.title}</div>}
            <div className="preview-text">{preview.text || (preview.title ? t("read.noLead") : "")}</div>
          </div>,
          document.body,
        )}
      {photo && <Lightbox uri={photo.uri} caption={photo.caption} onClose={() => setPhoto(null)} />}
    </>
  );
};

/** A source as References lists it: its text, then its address. */
export function NoteText({ note }: { note: { text: string; url: string } }) {
  return (
    <>
      {note.text}
      {/^https?:\/\//i.test(note.url) && (
        <>
          {" "}
          <a className="external" href={note.url} target="_blank" rel="noopener noreferrer">
            {note.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
          </a>
        </>
      )}
    </>
  );
}

export default WikiText;
