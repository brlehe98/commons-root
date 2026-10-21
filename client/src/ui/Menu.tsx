import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Extra class, e.g. to show an item only on narrow screens. */
  className?: string;
  onSelect: () => void;
};

type Props = {
  /** Content of the button that opens the menu. */
  trigger: React.ReactNode;
  title?: string;
  items: (MenuItem | "separator")[];
  className?: string;
  disabled?: boolean;
  align?: "left" | "right";
  /** Extra content under the items, e.g. a picker. */
  children?: React.ReactNode;
};

/** A button that opens a list of actions; closes on outside click or Escape. */
const Menu: React.FC<Props> = ({ trigger, title, items, className, disabled, align = "left", children }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // The side the list opens to: the one asked for, unless it would leave the screen (checked once per opening).
  const [side, setSide] = useState(align);

  useLayoutEffect(() => {
    if (!open) return setSide(align);
    const box = pop.current?.getBoundingClientRect();
    if (!box) return;
    if (box.left < 0) setSide("left");
    else if (box.right > window.innerWidth) setSide("right");
  }, [open, align]);

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
    <div className={`menu ${className ?? ""}`} ref={ref}>
      <button type="button" className="menu-trigger" title={title} disabled={disabled} onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu-pop ${side}`} role="menu" ref={pop}>
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep${i}`} className="menu-sep" />
            ) : (
              <button
                type="button"
                role="menuitem"
                key={item.key}
                disabled={item.disabled}
                className={`menu-item${item.active ? " active" : ""}${item.danger ? " danger" : ""}${item.className ? ` ${item.className}` : ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <span className="menu-icon">{item.icon}</span>}
                <span className="menu-label">
                  {item.label}
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </span>
              </button>
            ),
          )}
          {children}
        </div>
      )}
    </div>
  );
};

export default Menu;
