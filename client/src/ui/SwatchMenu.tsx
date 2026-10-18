import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { isDarkTheme, PaletteColor } from "../editor/palette";

type Props = {
  title: string;
  /** The icon in the toolbar; a bar under it shows the current color. */
  icon: React.ReactNode;
  colors: PaletteColor[];
  value: string;
  /** Shown first: the default color, or no highlight. */
  noneLabel: string;
  noneClass: "none" | "default";
  onPick: (color: string) => void;
  onNone: () => void;
};

/** A toolbar button that opens round color swatches, like the color pickers elsewhere in the app. */
const SwatchMenu: React.FC<Props> = ({ title, icon, colors, value, noneLabel, noneClass, onPick, onNone }) => {
  const [open, setOpen] = useState(false);
  // Show each color as it looks in the current theme.
  const shown = (color: string) => (isDarkTheme() ? (colors.find((c) => c.color === color)?.dark ?? color) : color);
  const ref = useRef<HTMLDivElement>(null);

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
    <div className={value ? "menu color-menu on" : "menu color-menu"} ref={ref}>
      <button type="button" className="menu-trigger" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        <span className="color-trigger">
          {icon}
          <span className="color-bar" style={{ background: value ? shown(value) : "transparent" }} />
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="menu-pop swatch-pop" role="menu" aria-label={title}>
          <button
            type="button"
            className={!value ? `swatch ${noneClass} active` : `swatch ${noneClass}`}
            title={noneLabel}
            aria-label={noneLabel}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (onNone(), setOpen(false))}
          />
          {colors.map((c) => (
            <button
              type="button"
              key={c.color}
              className={value === c.color ? "swatch active" : "swatch"}
              style={{ background: shown(c.color) }}
              title={c.label}
              aria-label={c.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (onPick(c.color), setOpen(false))}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SwatchMenu;
