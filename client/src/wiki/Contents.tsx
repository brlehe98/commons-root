import React, { useEffect, useRef, useState } from "react";
import { ListTree, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Heading } from "./outline";
import { t } from "../i18n";

type Props = {
  headings: Heading[];
  /** The headings in the page, in the same order, to scroll to and follow. */
  targets: () => HTMLElement[];
};

const PIN_KEY = "commons.contentsPinned";

/** Whether the contents sit in a column beside the page (or behind a button by the title). */
export function useContentsPinned(): [boolean, (pinned: boolean) => void] {
  const [pinned, setPinned] = useState(() => {
    try {
      return localStorage.getItem(PIN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const set = (next: boolean) => {
    setPinned(next);
    try {
      localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      // Private window: the choice lasts until the page closes.
    }
  };
  return [pinned, set];
}

const scroller = (el: Element | null) => el?.closest(".space-main") ?? null;

/** The heading the reader is in: the last one above the top of the view. */
function useActive(nav: React.RefObject<HTMLElement>, targets: () => HTMLElement[], count: number) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const root = scroller(nav.current);
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = root.getBoundingClientRect().top + 90;
      const list = targets();
      let current = -1;
      for (let i = 0; i < list.length; i++) if (list[i].getBoundingClientRect().top <= top) current = i;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [count, targets]);
  return active;
}

const List: React.FC<{ headings: Heading[]; active: number; onGo: (i: number) => void }> = ({ headings, active, onGo }) => {
  // The highest level used is the first step of the list, whatever its number.
  const top = Math.min(...headings.map((h) => h.level));
  return (
    <ul className="toc-list">
      <li className={active < 0 ? "toc-item on" : "toc-item"}>
        <a href="#" onClick={(e) => (e.preventDefault(), onGo(-1))}>
          {t("read.top")}
        </a>
      </li>
      {headings.map((h, i) => (
        <li key={i} className={i === active ? "toc-item on" : "toc-item"} style={{ paddingLeft: `${Math.min(3, h.level - top) * 14}px` }}>
          <a href="#" onClick={(e) => (e.preventDefault(), onGo(i))}>
            {h.text || "…"}
          </a>
        </li>
      ))}
    </ul>
  );
};

function go(nav: HTMLElement | null, targets: () => HTMLElement[], i: number) {
  if (i < 0) scroller(nav)?.scrollTo({ top: 0, behavior: "smooth" });
  else targets()[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The contents in their own column, following the reader down the page. */
export const ContentsColumn: React.FC<Props & { onHide: () => void }> = ({ headings, targets, onHide }) => {
  const ref = useRef<HTMLElement>(null);
  const active = useActive(ref, targets, headings.length);
  return (
    <nav className="toc-column" ref={ref} aria-label={t("read.contents")}>
      <div className="toc-head">
        <span className="toc-title">{t("read.contents")}</span>
        <button className="link toc-hide" onClick={onHide} title={t("read.hideContents")}>
          <PanelLeftClose size={14} /> {t("read.hide")}
        </button>
      </div>
      <List headings={headings} active={active} onGo={(i) => go(ref.current, targets, i)} />
    </nav>
  );
};

/** The contents behind a button beside the title, on narrow screens or when hidden. */
export const ContentsButton: React.FC<Props & { pinned: boolean; onPin: () => void }> = ({ headings, targets, pinned, onPin }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = useActive(ref, targets, headings.length);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={pinned ? "toc-button pinned" : "toc-button"} ref={ref}>
      <button className="icon" title={t("read.contents")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ListTree size={18} />
      </button>
      {open && (
        <div className="toc-pop" role="dialog" aria-label={t("read.contents")}>
          <div className="toc-head">
            <span className="toc-title">{t("read.contents")}</span>
            <button className="link toc-pin" onClick={() => (setOpen(false), onPin())} title={t("read.pinContents")}>
              <PanelLeftOpen size={14} /> {t("read.pin")}
            </button>
          </div>
          <List
            headings={headings}
            active={active}
            onGo={(i) => {
              setOpen(false);
              go(ref.current, targets, i);
            }}
          />
        </div>
      )}
    </div>
  );
};
