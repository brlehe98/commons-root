import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { buildReadExtensions } from "../editor/extensions";
import { PMNode, wiki } from "./api";
import { outline, PAGE_LINK } from "./outline";
import { t } from "../i18n";

type Props = {
  doc: PMNode;
  /** Opens another page of the wiki. */
  onOpenPage: (pageId: string) => void;
  /** Lets the parent scroll to a heading (by its order in the text). */
  bodyRef?: React.RefObject<HTMLDivElement>;
};

/** The published text, read-only, with links to other pages opened in the app. */
const ReadView: React.FC<Props> = ({ doc, onOpenPage, bodyRef }) => {
  const own = useRef<HTMLDivElement>(null);
  const ref = bodyRef ?? own;
  const editor = useEditor({ extensions: buildReadExtensions(), editable: false, content: doc }, []);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, doc]);
  const { notes, links } = useMemo(() => outline(doc), [doc]);
  // Pages linked to that do not exist (or the reader cannot see) show in red, as on Wikipedia.
  const [found, setFound] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!links.length) return setFound(new Set());
    wiki
      .checkLinks({ pageIds: links })
      .then((r) => setFound(new Set(r.pages.map((p) => p.id))))
      .catch(() => setFound(null));
  }, [links.join(",")]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !found) return;
    for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href^='#/page/']"))) {
      const id = PAGE_LINK.exec(a.getAttribute("href") ?? "")?.[1];
      a.classList.toggle("missing-link", !!id && !found.has(id));
      a.title = id && !found.has(id) ? t("read.missingLink") : "";
    }
  }, [found, editor, doc]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    const id = PAGE_LINK.exec(href)?.[1];
    if (id) {
      e.preventDefault();
      if (!a.classList.contains("missing-link")) onOpenPage(id);
      return;
    }
    // Outside links open next to the app, never in its place.
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };
  const onNote = (e: React.MouseEvent) => {
    const sup = (e.target as HTMLElement).closest("sup.footnote");
    if (!sup || !ref.current) return;
    const index = Array.from(ref.current.querySelectorAll("sup.footnote")).indexOf(sup);
    document.getElementById(`note-${index + 1}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <>
      <div
        className="read-body"
        ref={ref}
        onClick={(e) => {
          onClick(e);
          onNote(e);
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {notes.length > 0 && (
        <section className="references">
          <h2>{t("read.references")}</h2>
          <ol>
            {notes.map((n, i) => (
              <li key={i} id={`note-${i + 1}`}>
                {n.text}
                {/^https?:\/\//i.test(n.url) && (
                  <>
                    {" "}
                    <a href={n.url} target="_blank" rel="noopener noreferrer">
                      {n.url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
};

export default ReadView;
