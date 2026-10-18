import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { windowPlace } from "./windows";
import { t } from "../i18n";

type Props = {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  /** Keeps the reading position: reopening shows where the reader left off. */
  scrollKey?: string;
  children: React.ReactNode;
};

// Where each window was read up to, kept while the app is open.
const scrollMemory = new Map<string, number>();
// How long to keep trying to restore the position while the content loads.
const RESTORE_MS = 3000;

/** A window over the page, opened and closed from its button (or its ×). */
const FloatingWindow: React.FC<Props> = ({ title, icon, onClose, scrollKey, children }) => {
  const body = useRef<HTMLDivElement>(null);
  const place = windowPlace();

  // Back to where the reader was when the window is opened again.
  useEffect(() => {
    if (!scrollKey) return;
    const target = scrollMemory.get(scrollKey) ?? 0;
    if (!target) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const el = body.current;
      if (!el) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2 || Date.now() - started > RESTORE_MS) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [scrollKey]);

  return createPortal(
    <div
      className="sg-window"
      style={{ right: place.right }}
      role="dialog"
      aria-label={title}
    >
      <header className="sg-head">
        {icon}
        <span className="sg-title">{title}</span>
        <button className="icon" title={t("common.close")} onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="sg-body" ref={body} onScroll={(e) => scrollKey && scrollMemory.set(scrollKey, e.currentTarget.scrollTop)}>
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default FloatingWindow;
